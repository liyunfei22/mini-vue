/**
 * transformFor.ts —— v-for 结构化变换
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformFor.ts。
 *
 * v-for="(item, index) in items" → FOR 节点：
 *   { source: items 表达式, valueAlias: item, indexAlias: index, children: [原元素] }
 * codegen 阶段生成 `_renderList(source, (item, index) => ...)`。
 */
import {
  createSimpleExpression,
  NodeTypes,
  type DirectiveNode,
  type ElementNode,
  type ForNode,
  type SimpleExpressionNode,
} from '../ast'
import { RENDER_LIST } from '../runtimeHelpers'
import type { NodeTransform, TransformContext } from '../transform'
import { createStructuralDirectiveTransform } from './transformIf'

const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/

export const transformFor: NodeTransform = createStructuralDirectiveTransform(
  'for',
  (node, dir, context) => {
  return processFor(node, dir, context)
})

function processFor(node: ElementNode, dir: DirectiveNode, context: TransformContext) {
  if (!dir.exp) return

  const result = parseForExpression((dir.exp as any).content)
  if (!result) {
    console.warn(`[mini-vue] v-for expression is invalid: ${(dir.exp as any).content}`)
    return
  }

  const forNode: ForNode = {
    type: NodeTypes.FOR,
    loc: node.loc,
    source: result.source,
    valueAlias: result.value,
    keyAlias: result.key,
    indexAlias: result.index,
    children: [node],
    codegenNode: null as any,
  }
  // 用 FOR 节点替换原元素；原元素进入 forNode.children
  context.helper(RENDER_LIST)
  context.replaceNode(forNode)

  return () => {
    // exit：确保子元素已经拥有 codegenNode（transformElement 已跑完）
    // 真实 mini 版本由 codegen 直接读 forNode.children 生成 renderList
  }
}

export function parseForExpression(
  input: string,
): { source: SimpleExpressionNode; value?: SimpleExpressionNode; index?: SimpleExpressionNode; key?: SimpleExpressionNode } | undefined {
  const match = input.match(forAliasRE)
  if (!match) return undefined

  const [, lhs, rhs] = match
  const source = createSimpleExpression(rhs.trim(), false)
  // (item, index) 解构
  const params = lhs.trim().replace(/^\(|\)$/g, '')
  const [first, second, third] = params.split(',').map((s) => s.trim())
  return {
    source,
    value: first ? createSimpleExpression(first, false) : undefined,
    index: second ? createSimpleExpression(second, false) : undefined,
    key: third ? createSimpleExpression(third, false) : undefined,
  }
}