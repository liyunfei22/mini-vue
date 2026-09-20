/**
 * transformIf.ts —— v-if / v-else-if / v-else 结构化变换
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformIf.ts。
 *
 * v-if 是「结构」指令：把一串兄弟节点重构成 IF 节点：
 *   <div v-if="a"/><div v-else-if="b"/><p v-else/>
 *   → IF { branches:[{condition:a,children:[div]},
 *                    {condition:b,children:[div]},
 *                    {condition:undefined,children:[p]}] }
 * codegen 阶段据此生成嵌套三元表达式。
 *
 * v-else 回链：通过 context.parent + childIndex 找前一个兄弟（必须是 IF）。
 */
import { NodeTypes, type DirectiveNode, type ElementNode, type IfBranchNode, type IfNode } from '../ast'
import type { NodeTransform, TransformContext } from '../transform'

export function createStructuralDirectiveTransform(
  name: string | RegExp,
  fn: (node: ElementNode, dir: DirectiveNode, context: TransformContext) => any,
): NodeTransform {
  const matches = (s: string) =>
    name instanceof RegExp ? name.test(s) : name === s

  return (node, context) => {
    if (node.type !== NodeTypes.ELEMENT) return
    const props = node.props
    if (props.length === 0) return
    const exitFns: Array<() => void> = []
    let structuralFound = false
    for (let i = 0; i < props.length; i++) {
      const prop = props[i]
      if (prop.type === NodeTypes.DIRECTIVE && matches((prop as DirectiveNode).name)) {
        // 结构指令先摘除：防止重遍历无限递归 / 被 transformElement 误当运行时指令
        props.splice(i, 1)
        i--
        structuralFound = true
        const onExit = fn(node, prop as DirectiveNode, context)
        if (onExit) exitFns.push(onExit)
      }
    }
    if (structuralFound) {
      return () => {
        for (let i = 0; i < exitFns.length; i++) exitFns[i]()
      }
    }
    return
  }
}

export const transformIf: NodeTransform = createStructuralDirectiveTransform(
  /^(if|else|else-if)$/,
  (node, dir, context) => processIf(node, dir, context),
)

function processIf(node: ElementNode, dir: DirectiveNode, context: TransformContext) {
  if (dir.name === 'if') {
    // 新开一个 IF 分支链
    const branch: IfBranchNode = {
      type: NodeTypes.IF_BRANCH,
      loc: node.loc,
      condition: dir.exp,
      children: [node],
      userKey: undefined,
    }
    const ifNode: IfNode = {
      type: NodeTypes.IF,
      loc: node.loc,
      branches: [branch],
      codegenNode: null as any,
    }
    // 替换当前元素为 IF 节点（后续 v-else 会追加 branch；exit 阶段生成 codegen）
    context.replaceNode(ifNode)
    // node 保持自己的 codegenNode 由 transformElement 赋值
    return
  } else {
    // v-else / v-else-if：追加到前一个兄弟的 IF 上
    const parent = context.parent
    const prevSibling = parent!.children[context.childIndex - 1] as any
    if (prevSibling && prevSibling.type === NodeTypes.IF) {
      prevSibling.branches.push({
        type: NodeTypes.IF_BRANCH,
        loc: node.loc,
        condition: dir.name === 'else-if' ? dir.exp : undefined,
        children: [node],
        userKey: undefined,
      })
      // 摘除延迟到退出阶段：等 transformElement 给这个元素建好 codegenNode 后再摘。
      // 用「身份查找」而非 childIndex —— 内层遍历（子节点）会污染 childIndex。
      return () => {
        const list = context.parent!.children
        const index = list.indexOf(node)
        if (index > -1) {
          list.splice(index, 1)
          context.currentNode = null
        }
      }
    } else {
      console.warn(`[mini-vue] v-else/v-else-if has no adjacent v-if.`)
    }
    return
  }
}