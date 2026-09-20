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
  CREATE_ELEMENT_VNODE,
  CREATE_VNODE,
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

  push(`return function render(_ctx, _cache) {`)
  indent()
  push(`with (_ctx) {`)
  indent()
  newline()
  poshRet: {
    if (ast.codegenNode) {
      push(`return `)
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
  const { tag, props, children, patchFlag, isComponent } = node
  const helper = isComponent ? CREATE_VNODE : CREATE_ELEMENT_VNODE
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
  context.push(`, ${patchFlag == null ? -1 : patchFlag})`)
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