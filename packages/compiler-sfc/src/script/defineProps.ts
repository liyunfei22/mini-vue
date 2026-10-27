/**
 * defineProps.ts —— defineProps 宏处理
 *
 * 对应真 Vue compiler-sfc/src/script/defineProps.ts 的对象字面量分支。
 * 只支持运行时声明形态（对象字面量实参）；TS 类型形参（typeParameters）
 * 报「mini 不支持」——真源码的 resolveType 全家（类型推导 → 运行时 props）
 * 不在 mini 范围，文档记差异。
 */
import type { ScriptCompileContext } from './context'

export function processDefineProps(
  ctx: ScriptCompileContext,
  node: any,
): void {
  if (ctx.hasDefinePropsCall) {
    ctx.error(`duplicate defineProps() call`, ctx.at(node.start))
  }
  ctx.hasDefinePropsCall = true

  if (node.typeParameters) {
    ctx.error(
      `defineProps<...> TS type macros are not supported in mini-vue compiler-sfc ` +
        `(use object literal form: defineProps({ ... }))`,
      ctx.at(node.start),
    )
  }

  const arg = node.arguments.length ? node.arguments[0] : null
  if (arg && arg.type !== 'ObjectExpression') {
    ctx.error(
      `defineProps() runtime declaration must be an object literal ` +
        `(did you use defineProps<Type>()?)`,
      ctx.at(arg.start),
    )
  }
  ctx.propsDecl = arg
  // 引用 setup 局部变量的检查延后到绑定收集完成后（compileScript 主流程统一做）
}