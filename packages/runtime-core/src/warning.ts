/** runtime 层统一告警（与 reactivity 的 warning 同构） */
export function warn(msg: string, ...args: any[]) {
  console.warn(`[mini-vue] ${msg}`, ...args)
}
export const __DEV__ = true