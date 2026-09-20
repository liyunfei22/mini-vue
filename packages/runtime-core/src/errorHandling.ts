/**
 * errorHandling.ts —— 统一错误捕获入口
 *
 * 对应真 Vue packages/runtime-core/src/errorHandling.ts。
 * 真 Vue 会把错误上抛给 `app.config.errorHandler` / 组件 errorCaptured 钩子；
 * mini 简化：全部走 handleError → console.error（保留 callWithErrorHandling 的
 * 「可带参调用 + Promise 拒绝静默」结构，后续阶段 watch/渲染都复用它）。
 */
import { isPromise } from '@mini-vue/shared'

/** 错误码（真 Vue 用数字区分错误来源，mini 保留枚举位形 式便于扩展） */
export const enum ErrorCodes {
  SETUP_FUNCTION = 0,
  RENDER_FUNCTION = 1,
  COMPONENT_EVENT_HANDLER = 2,
  COMPONENT_UPDATE = 5,
  WATCH_GETTER = 9,
  WATCH_CALLBACK = 10,
  WATCH_CLEANUP = 11,
  SCHEDULER = 21,
}

export function handleError(err: unknown, instance: any = null, _type?: ErrorCodes) {
  // mini：直接打印；可在 capstone 阶段扩展 app.config.errorHandler
  console.error(`[mini-vue] unhandled error during execution of component renderer`, err)
  if (instance && instance.appContext && instance.appContext.config.errorHandler) {
    try {
      instance.appContext.config.errorHandler(err, instance.proxy)
      return
    } catch (e) {
      console.warn('errorHandler 抛出了异常：', e)
    }
  }
}

/**
 * 带参调用 fn 并把异常交给 handleError；返回值若是 Promise，则 .catch 同样兜底。
 */
export function callWithErrorHandling(
  fn: Function,
  instance: any = null,
  _type?: ErrorCodes,
  args?: unknown[],
) {
  let res
  try {
    res = args ? fn(...args) : fn()
  } catch (err) {
    handleError(err, instance, _type)
  }
  if (res && isPromise(res)) {
    res.catch((err) => handleError(err, instance, _type))
  }
  return res
}

export function callWithArrayAsErrorHandling(fn: Function, instance: any, _type?: ErrorCodes, args?: unknown[]) {
  return callWithErrorHandling(fn, instance, _type, args)
}