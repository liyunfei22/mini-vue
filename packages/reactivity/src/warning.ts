/**
 * warning.ts —— 开发态警告
 *
 * 对应真 Vue packages/reactivity/src/warning.ts。
 * 真 Vue 里 `__DEV__` 经构建注入，dev 才保留这些告警；mini 全部保留（见 shared/__DEV__）。
 */
export function warn(msg: string, ...args: any[]) {
  console.warn(`[mini-vue] ${msg}`, ...args)
}