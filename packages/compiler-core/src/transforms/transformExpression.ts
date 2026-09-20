/**
 * transformExpression.ts —— 表达式处理
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformExpression.ts。
 *
 * 真 Vue 在这里做 prefixIdentifiers（把裸标识符前缀成 _ctx.foo，沙箱化 + CSP 友好）。
 * mini 采用「with(_ctx) 包裹」方案：表达式原样照抄，运行时在 with 作用域内解析，
 * 因此本文件是透传 no-op（差异记录在 docs/05）。
 */
import type { NodeTransform } from '../transform'

export const transformExpression: NodeTransform = (node, _context) => {
  // with(_ctx) 方案的 no-op；保留入口方便后续切到 prefixIdentifiers
  return
}