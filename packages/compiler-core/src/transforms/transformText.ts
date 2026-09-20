/**
 * transformText.ts —— 文本合并
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformText.ts。
 *
 * 相邻的文本/插值会被合并成一个 COMPOUND_EXPRESSION（"x" + 插值 + "y"），
 * 这样 codegen 只生成一个 _toDisplayString 调用、也避免连续创建多个 Text vnode。
 * 另外：单独的文本子节点没有「细粒度 patchFlag」需求，直接当字符串字面量。
 */
import { NodeTypes, isText, type CompoundExpressionNode, type TemplateChildNode } from '../ast'
import type { NodeTransform } from '../transform'

export const transformText: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ROOT ||
    node.type === NodeTypes.ELEMENT ||
    node.type === NodeTypes.IF_BRANCH ||
    node.type === NodeTypes.FOR
  ) {
    return () => {
      const children = (node as any).children as TemplateChildNode[]
      let currentContainer: CompoundExpressionNode | undefined
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isText(child)) {
          if (!currentContainer) {
            currentContainer = children[i] = {
              type: NodeTypes.COMPOUND_EXPRESSION,
              children: [child as any],
              loc: (child as any).loc,
            } as any
          } else {
            // 并入容器并从数组摘除（真 Vue：children.splice(i, 1); i--）
            currentContainer.children.push(child as any)
            children.splice(i, 1)
            i--
          }
        } else if (child.type !== NodeTypes.COMMENT) {
          currentContainer = undefined
        }
      }
      // 单个文本/插值 → 提升为 TEXT_CALL（codegen 生成 _toDisplayString 包裹）
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (
          isText(child) &&
          (child.type === NodeTypes.TEXT ||
            child.type === NodeTypes.INTERPOLATION ||
            (child.type === NodeTypes.COMPOUND_EXPRESSION &&
              (child as any).children.length === 1))
        ) {
          ;(children[i] as any) = {
            type: NodeTypes.TEXT_CALL,
            content: child,
            loc: (child as any).loc,
          }
        }
      }
    }
  }
}