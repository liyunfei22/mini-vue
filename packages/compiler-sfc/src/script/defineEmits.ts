/**
 * defineEmits.ts —— defineEmits 宏处理
 *
 * 对应真 Vue compiler-sfc/src/script/defineEmits.ts。
 * 真源码不校验实参形态：emitsRuntimeDecl = arguments[0]，原样抽文本；
 * mini 同样不校验（数组/对象/任意表达式都透传原文），只拦类型形参。
 */
import type { ScriptCompileContext } from './context'

export function processDefineEmits(
  ctx: ScriptCompileContext,
  node: any,
): void {
  if (ctx.hasDefineEmitsCall) {
    ctx.error(`duplicate defineEmits() call`, ctx.at(node.start))
  }
  ctx.hasDefineEmitsCall = true

  if (node.typeParameters) {
    ctx.error(
      `defineEmits<...> TS type macros are not supported in mini-vue compiler-sfc ` +
        `(use array form: defineEmits(['event']))`,
      ctx.at(node.start),
    )
  }

  const arg = node.arguments.length ? node.arguments[0] : null
  ctx.emitsDecl = arg
}