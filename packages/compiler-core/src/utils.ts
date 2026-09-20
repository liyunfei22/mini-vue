/**
 * utils.ts —— 编译期小工具
 * 对应真 Vue packages/compiler-core/src/utils.ts 的必要子集。
 */
import { parseStringStyle, extend } from '@mini-vue/shared'
import { NodeTypes, isText, type ExpressionNode, type ObjectExpression } from './ast'

/** 事件名驼峰化 'update:title' → 'Update:title'（不变 `:`） */
export function toHandlerKeyCamelCase(raw: string): string {
  return `on${raw.charAt(0).toUpperCase()}${raw.slice(1)}`
}

/** 表达式 → 简单表达式/复合表达式拼接 */
export function joinExpressions(expressions: ExpressionNode[]): ExpressionNode {
  return expressions.length > 1
    ? { type: NodeTypes.COMPOUND_EXPRESSION, children: expressions, loc: (expressions[0] as any).loc }
    : expressions[0]
}

export { isText, NodeTypes }
export type { ObjectExpression }
export { extend, parseStringStyle }