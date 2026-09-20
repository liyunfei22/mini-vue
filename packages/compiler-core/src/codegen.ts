/**
 * codegen.ts —— AST → 渲染函数源码
 *
 * 对应真 Vue packages/compiler-core/src/codegen.ts。
 *
 * mini 采用「with(_ctx) 包裹」的表达式方案：
 *   整个 render 函数体放进 `with (_ctx) { }`，模板表达式原样输出即可解析到
 *   setupState/props（记录与真 Vue prefixIdentifiers 的差异，文档见 docs/05）。
 * 产物形态：
 *   const { createElementVNode: _createElementVNode, ... } = Vue
 *   return function render(_ctx, _cache) {
 *     with (_ctx) {
 *       return _createElementVNode("div", { id: "app" }, [...], -1)
 *     }
 *   }
 * 运行时用 `new Function('Vue', code)(runtimeModule)` 实例化。
 */
import { isString } from '@mini-vue/shared'
import {
  createArrayExpression,
  NodeTypes,
  type CompoundExpressionNode,
  type ElementNode,
  type ExpressionNode,
  type IfBranchNode,
  type IfNode,
  type InterpolationNode,
  type RootNode,
  type TextNode,
} from './ast'
import { Fragment } from './ast'
import {
  CREATE_COMMENT,
  CREATE_ELEMENT_BLOCK,
  CREATE_ELEMENT_VNODE,
  CREATE_VNODE,
  OPEN_BLOCK,
  RENDER_LIST,
  TO_DISPLAY_STRING,
  helperNameMap,
} from './runtimeHelpers'
import type { ParserOptions } from './parse'

interface CodegenOptions extends ParserOptions {
  onError?: (error: any) => void
}

interface CodegenContext {
  code: string
  indentLevel: number
  push(code: string): void
  indent(): void
  deindent(): void
  newline(): void
  helper(key: symbol): string
}

function createCodegenContext(ast: RootNode, _options: CodegenOptions): CodegenContext {
  const context: CodegenContext = {
    code: '',
    indentLevel: 0,
    push(code) {
      context.code += code
    },
    newline() {
      context.code += '\n' + '  '.repeat(context.indentLevel)
    },
    indent() {
      context.indentLevel++
    },
    deindent() {
      context.indentLevel--
    },
    helper(key) {
      return `_${helperNameMap[key] || String((key as any).description || key)}`
    },
  }
  return context
}

export interface CodegenResult {
  code: string
  ast: RootNode
}

export function generate(ast: RootNode, options: CodegenOptions = {}): CodegenResult {
  const context = createCodegenContext(ast, options)
  const { push, newline, helper, indent, deindent } = context

  const usedHelpers = (ast as any).helpers || []
  if (usedHelpers.length) {
    const destructure = usedHelpers
      .map((h: symbol) => `${helperNameMap[h]}: _${helperNameMap[h]}`)
      .join(', ')
    push(`const { ${destructure} } = Vue`)
    newline()
  }

  // 7-3 静态提升：先收集可提升的静态子树，逐个生成 const（渲染期只会创建一次）
  const hoistedNodes: any[] = []
  collectHoistedNodes(ast.codegenNode, hoistedNodes)
  if (hoistedNodes.length) {
    for (let n = 0; n < hoistedNodes.length; n++) {
      const tmp = createSubContext(context)
      // 生成 const 本体时揭掉提升标记（防止 genVNodeCall 短路成 _hoisted_N 自引用）
      const id = hoistedNodes[n]._hoistedId
      hoistedNodes[n]._hoistedId = undefined
      genNode(hoistedNodes[n], tmp)
      hoistedNodes[n]._hoistedId = id
      push(`const _hoisted_${n + 1} = ${tmp.code}`)
      newline()
    }
  }

  push(`return function render(_ctx, _cache) {`)
  indent()
  push(`with (_ctx) {`)
  indent()
  newline()
  poshRet: {
    if (ast.codegenNode) {
      push(`return `)
      if ((ast.codegenNode as any).isBlock) {
        push(`${context.helper(OPEN_BLOCK)}(), `)
      }
      genNode(ast.codegenNode, context)
    } else {
      push(`return null`)
    }
    break poshRet
  }
  deindent()
  newline()
  push(`}`)
  deindent()
  newline()
  push(`}`)

  return { code: context.code, ast }
}

function genNode(node: any, context: CodegenContext): void {
  if (isString(node)) {
    context.push(JSON.stringify(node))
    return
  }
  if (!node) {
    context.push('null')
    return
  }
  switch (node.type) {
    case NodeTypes.ELEMENT:
      genNode(node.codegenNode, context)
      break
    case NodeTypes.TEXT:
      genText(node as TextNode, context)
      break
    case NodeTypes.INTERPOLATION:
      genInterpolation(node as InterpolationNode, context)
      break
    case NodeTypes.COMPOUND_EXPRESSION:
      genCompoundExpression(node as CompoundExpressionNode, context)
      break
    case NodeTypes.VNODE_CALL:
      genVNodeCall(node, context)
      break
    case NodeTypes.JS_CALL_EXPRESSION:
      genCallExpression(node, context)
      break
    case NodeTypes.JS_ARRAY_EXPRESSION:
      genArrayExpression(node, context)
      break
    case NodeTypes.JS_OBJECT_EXPRESSION:
      genObjectExpression(node, context)
      break
    case NodeTypes.JS_PROPERTY:
      genObjectProperty(node, context)
      break
    case NodeTypes.JS_FUNCTION_EXPRESSION:
      genFunctionExpression(node, context)
      break
    case NodeTypes.JS_CONDITIONAL_EXPRESSION:
      genConditionalExpression(node, context)
      break
    case NodeTypes.IF:
      genIf(node as IfNode, context)
      break
    case NodeTypes.FOR:
      genFor(node, context)
      break
    case NodeTypes.TEXT_CALL:
      genTextCall(node, context)
      break
    case NodeTypes.SIMPLE_EXPRESSION:
      genExpression(node, context)
      break
    default:
      context.push('null')
  }
}

// ---- 各节点生成 ----

function genText(node: TextNode, context: CodegenContext) {
  context.push(JSON.stringify(node.content))
}

function genExpression(node: ExpressionNode & { isStatic?: boolean; content: string }, context: CodegenContext) {
  if (node.isStatic) {
    context.push(JSON.stringify(node.content))
  } else {
    // with(_ctx) 方案：表达式原样输出
    context.push(node.content)
  }
}

function genInterpolation(node: InterpolationNode, context: CodegenContext) {
  context.push(`${context.helper(TO_DISPLAY_STRING)}(${(node.content as any).content.trim()})`)
}

function genCompoundExpression(node: CompoundExpressionNode, context: CodegenContext) {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (isString(child)) {
      context.push(JSON.stringify(child))
    } else {
      genNode(child, context)
    }
    if (i < node.children.length - 1) {
      context.push(' + ')
    }
  }
}

function genTextCall(node: any, context: CodegenContext) {
  let { content } = node
  // 单子节点的复合表达式（合并结果）→ 解包，避免 _toDisplayString(_toDisplayString(x))
  if (content.type === NodeTypes.COMPOUND_EXPRESSION && content.children.length === 1) {
    content = content.children[0]
  }
  if (content.type === NodeTypes.TEXT) {
    genText(content, context)
    return
  }
  // 插值/复合 → _toDisplayString(内层)，内层不再二次包裹
  context.push(`${context.helper(TO_DISPLAY_STRING)}(`)
  if (content.type === NodeTypes.INTERPOLATION) {
    context.push((content.content as any).content.trim())
  } else {
    genNode(content as any, context) // 复合表达式
  }
  context.push(`)`)
}

function genVNodeCall(node: any, context: CodegenContext) {
  // 静态提升节点：渲染期直接引用 const（不再现场生成）
  if ((node as any)._hoistedId) {
    context.push(`_hoisted_${(node as any)._hoistedId}`)
    return
  }
  const { tag, props, children, patchFlag, isComponent, isBlock } = node
  const helper = isBlock
    ? CREATE_ELEMENT_BLOCK
    : isComponent
      ? CREATE_VNODE
      : CREATE_ELEMENT_VNODE
  context.push(`${context.helper(helper)}(`)
  // tag
  if (tag === Fragment) {
    context.push(`_Fragment`)
  } else if (isString(tag)) {
    context.push(JSON.stringify(tag))
  } else if (tag) {
    genNode(tag, context) // resolveComponent(...) 等
  } else {
    context.push('null')
  }
  context.push(`, `)
  // props
  if (props) {
    genNode(props, context)
  } else {
    context.push(props === null ? 'null' : 'undefined')
  }
  context.push(`, `)
  // children
  if (children) {
    genNode(children, context)
  } else {
    context.push('null')
  }
  context.push(`, ${patchFlag == null ? -1 : patchFlag}`)
  // 动态 props 键列表（PROPS 位时渲染器按名单 diff）
  if (node.dynamicProps && node.dynamicProps.length) {
    context.push(`, [${node.dynamicProps.map((n: string) => JSON.stringify(n)).join(', ')}]`)
  }
  context.push(`)`)
}

function genCallExpression(node: any, context: CodegenContext) {
  const callee = node.callee
  context.push(`${typeof callee === 'symbol' ? context.helper(callee) : callee}(`)
  genNodeList(node.arguments, context)
  context.push(`)`)
}

function genNodeList(nodes: any[], context: CodegenContext) {
  for (let i = 0; i < nodes.length; i++) {
    genNode(nodes[i], context)
    if (i < nodes.length - 1) context.push(', ')
  }
}

function genArrayExpression(node: any, context: CodegenContext) {
  context.push(`[`)
  genNodeList(node.elements, context)
  context.push(`]`)
}

function genObjectExpression(node: any, context: CodegenContext) {
  const { properties } = node
  context.push(`{`)
  for (let i = 0; i < properties.length; i++) {
    genNode(properties[i], context)
    if (i < properties.length - 1) context.push(`, `)
  }
  context.push(`}`)
}

function genObjectProperty(node: any, context: CodegenContext) {
  const { key, value, computed } = node
  if (computed) {
    context.push(`[`)
    genExpression(key, context)
    context.push(`]: `)
  } else {
    if (key.isStatic) {
      context.push(key.content.includes('-') || key.content.includes(':') ? JSON.stringify(key.content) : key.content)
    } else {
      genExpression(key, context)
    }
    context.push(`: `)
  }
  genNode(value, context)
}

function genFunctionExpression(node: any, context: CodegenContext) {
  const params = (node.params || []).map((p: any) =>
    isString(p) ? p : p.content,
  )
  context.push(`(${params.join(', ')}) => `)
  if (node.body && node.body.type) {
    genNode(node.body, context)
  } else if (isString(node.body)) {
    context.push(node.body)
  } else if (Array.isArray(node.body)) {
    genNode(createArrayExpression(node.body), context)
  } else if (node.body) {
    genArrayExpression({ type: NodeTypes.JS_ARRAY_EXPRESSION, elements: node.body }, context)
  }
}

function genConditionalExpression(node: any, context: CodegenContext) {
  genNode(node.test, context)
  context.push(` ? `)
  genNode(node.consequent, context)
  context.push(` : `)
  genNode(node.alternate, context)
}

/** v-if 分支 → 嵌套三元 */
function genIf(node: IfNode, context: CodegenContext) {
  if (!node.branches.length) {
    context.push(`${context.helper(CREATE_COMMENT)}("v-if", true)`)
    return
  }
  genIfBranch(node.branches[0], context)
  for (let i = 1; i < node.branches.length; i++) {
    context.push(` : `)
    genIfBranch(node.branches[i], context)
  }
  // 最后一个分支若还有 condition（即没有裸 <template v-else>）→ 补注释兜底：
  // `(cond) ? X : _createCommentVNode("v-if", true)`（真 Vue 同款）
  const last = node.branches[node.branches.length - 1]
  if (last.condition) {
    context.push(` : ${context.helper(CREATE_COMMENT)}("v-if", true)`)
  }
}

function genIfBranch(branch: IfBranchNode, context: CodegenContext) {
  const { condition, children } = branch
  const child = children[0] as ElementNode
  const genBranchContent = () => genNode(child.codegenNode, context)

  if (condition) {
    context.push(`(`)
    context.push((condition as any).content.trim())
    context.push(`) ? `)
    genBranchContent()
  } else {
    // else / else-if?（else 无 condition）
    genBranchContent()
  }
}

/** v-for → _renderList(list, (item, index) => ...) */
function genFor(node: any, context: CodegenContext) {
  const { source, valueAlias, indexAlias, keyAlias, children } = node
  const params: string[] = []
  if (valueAlias) params.push(valueAlias.content.trim())
  if (indexAlias) params.push(indexAlias.content.trim())
  if (keyAlias) params.push(keyAlias.content.trim())

  context.push(`${context.helper(RENDER_LIST)}(${source.content.trim()}, (`)
  context.push(params.join(', '))
  context.push(`) => `)
  genNode(children[0].codegenNode, context)
  context.push(`)`)
}

export { NodeTypes }

// ---- 静态提升（7-3）----

/**
 * 预扫描：找出「全静态」的元素子树（patchFlag 恒 -1 且非组件/无指令/非块根），
 * 打上 _hoistedId 并收集，codegen 把它们提升为 render 作用域的 const。
 * 静态子树内不引用 _ctx，跨渲染复用同一 vnode → 渲染器 n1===n2 直接跳过 patch。
 */
function collectHoistedNodes(node: any, out: any[]) {
  if (!node || typeof node !== 'object') return
  if (node.type === NodeTypes.VNODE_CALL) {
    const hoistable =
      node.patchFlag === -1 &&
      !node.isComponent &&
      !node.isBlock &&
      !node.dirs?.length &&
      node.tag &&
      typeof node.tag === 'string' &&
      // children 必须是纯静态形态才能整体提升（JS 调用如 renderSlot 依赖 _ctx，提升会把
      // _ctx 移出 with 作用域 → ReferenceError；多 children 数组也保守不升）
      (node.children == null ||
        typeof node.children === 'string' ||
        node.children.type === NodeTypes.TEXT_CALL)
    if (hoistable) {
      // 子树一并提升（不深入）
      ;(node as any)._hoistedId = out.length + 1
      out.push(node)
      return
    }
    // children 可能是「原始数组」或「ArrayExpression 节点（.elements）」
    forNodesIn(node.children, (c: any) => collectHoistedNodes(c, out))
  } else {
    forNodesIn(node.children, (c: any) => collectHoistedNodes(c, out))
    forNodesIn(node.elements, (c: any) => collectHoistedNodes(c, out))
  }
}

/** 递归容器：兼容 JS 数组与 ArrayExpression 节点 */
function forNodesIn(nodesLike: any, fn: (c: any) => void) {
  if (!nodesLike) return
  if (typeof nodesLike.forEach === 'function') {
    nodesLike.forEach(fn)
  } else if (nodesLike.elements && typeof nodesLike.elements.forEach === 'function') {
    nodesLike.elements.forEach(fn)
  }
}

/** 独立 buffer 的 codegen 上下文：提升 const 的表达式单独生成 */
function createSubContext(main: CodegenContext): CodegenContext {
  return {
    code: '',
    indentLevel: 0,
    push(code: string) {
      this.code += code
    },
    indent() {},
    deindent() {},
    newline() {},
    helper(key: symbol) {
      return main.helper(key)
    },
  }
}
