/**
 * defineOptions.ts —— defineOptions 宏处理
 *
 * 对应真 Vue compiler-sfc/src/script/defineOptions.ts。
 * 检查对象键（props/emits/expose/slots 指向对应宏）+ 存原文（主流程并进
 * Object.assign 的第一组实参）。
 *
 * 注意：defineOptions 的 name 不参与 hasDefaultExportName 判定（真源码实测：
 * defineOptions({ name }) 时 __name 仍会生成；只有普通 <script> 的 export default
 * 带 name 才跳过）——ground truth 与设计判定不同，以实测为准。
 */
import type { ScriptCompileContext } from './context'
import { extractKeys } from './utils'

export function processDefineOptions(
  ctx: ScriptCompileContext,
  node: any,
): void {
  if (ctx.hasDefineOptionsCall) {
    ctx.error(`duplicate defineOptions() call`, ctx.at(node.start))
  }
  ctx.hasDefineOptionsCall = true

  if (node.typeParameters) {
    ctx.error(
      `defineOptions<...> TS type macros are not supported in mini-vue compiler-sfc`,
      ctx.at(node.start),
    )
  }
  const arg = node.arguments.length ? node.arguments[0] : null
  if (!arg || arg.type !== 'ObjectExpression') {
    ctx.error(
      `defineOptions() must be called with an object literal of component options`,
      ctx.at(node.start),
    )
  }

  // 与对应宏冲突的键 → 报错指向（真 defineOptions.ts:79-84 同款，含 slots）
  const keys = extractKeys(arg)
  for (const key of keys) {
    const macro =
      key === 'props' ? 'defineProps' : key === 'emits' ? 'defineEmits' : key === 'expose' ? 'defineExpose' : key === 'slots' ? 'defineSlots' : null
    if (macro) {
      ctx.error(
        `defineOptions() cannot contain "${key}". Use ${macro}() instead.`,
        ctx.at(arg.start),
      )
    }
  }

  ctx.optionsDecl = arg
}