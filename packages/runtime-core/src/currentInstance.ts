/**
 * currentInstance.ts —— 当前组件实例（setup 期间的“谁在说话”）
 *
 * 对应真 Vue packages/runtime-core/src/currentInstance.ts。
 *
 * getCurrentInstance() 是组合式 API 的秘密：
 *   effect 需要「当前订阅者」；组件 API 需要「当前组件实例」——两者都是
 *   一个全局指针，在同步执行窗口内被临时赋值，用完即还原。
 *
 * mini 用普通模块变量 + instance.scope.on()/off() 实现：
 *   - setCurrentInstance(instance)：设指针，并把实例的 effect scope 激活
 *     （实例 setup 期创建的 effect/computed 自动归属组件，组件卸载即停止）
 *   - unsetCurrentInstance()：还原（setup 同步执行结束）
 *   真 Vue 3.5 把实例挂在 scope 上以支持异步 setup（mini 不做，文档注明）。
 */
import type { ComponentInternalInstance } from './component'

export let currentInstance: ComponentInternalInstance | null = null

export const getCurrentInstance = (): ComponentInternalInstance | null =>
  currentInstance

export function setCurrentInstance(instance: ComponentInternalInstance | null) {
  currentInstance = instance
  instance && instance.scope.on()
}

export function unsetCurrentInstance() {
  const instance = currentInstance
  currentInstance = null
  instance && instance.scope.off()
}