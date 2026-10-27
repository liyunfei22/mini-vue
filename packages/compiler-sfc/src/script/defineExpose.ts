/**
 * defineExpose.ts —— defineExpose 宏处理
 *
 * 对应真 Vue compiler-sfc/src/script/defineExpose.ts（全文职责极简）：
 * 置标志 + 查重；callee 改写（defineExpose → __expose）由主流程完成。
 *
 * 衍生职责（真 compileScript.ts:881-884 联动）：hasDefineExposeCall 为 false 时，
 * setup 末尾自动补 `__expose()`（空参数 = EMPTY_OBJ = 关闭组件公开面），
 * 这是 SFC 的默认安全边界——改了条件必须两处同时改。
 */
import type { ScriptCompileContext } from './context'

export function processDefineExpose(
  ctx: ScriptCompileContext,
  node: any,
): void {
  if (ctx.hasDefineExposeCall) {
    ctx.error(`duplicate defineExpose() call`, ctx.at(node.start))
  }
  ctx.hasDefineExposeCall = true
}