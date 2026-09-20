/**
 * lifecycle.ts —— 生命周期钩子注册
 *
 * 对应真 Vue packages/runtime-core/src/lifecycle.ts。
 *
 * 原理都基于「registerHook」：onXxx 把回调塞进「当前实例」的对应数组；
 * 渲染器在正确的时机取出数组统一执行。
 *   onMounted → instance.mounted[]，渲染器 patch 完子树（post flush）执行
 *   onUpdated / onBeforeUnmount / onUnmounted 同理。
 *
 * 注意组件实例就是一个 effect scope：钩子在 setup 里注册时，
 * scope（阶段 2 的 onScopeDispose）与这里的数组是两条平行通道。
 */
import type { ComponentInternalInstance } from './component'
import { currentInstance } from './currentInstance'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'

const enum LifecycleHooks {
  BEFORE_MOUNT = 'bm',
  MOUNTED = 'm',
  BEFORE_UPDATE = 'bu',
  UPDATED = 'u',
  BEFORE_UNMOUNT = 'bum',
  UNMOUNTED = 'um',
}

/** 钩子注册到的 instance 字段名（用简短 key 省内存，与真 Vue 一致） */
const lifecycleHooksKey = {
  [LifecycleHooks.BEFORE_MOUNT]: 'bm',
  [LifecycleHooks.MOUNTED]: 'm',
  [LifecycleHooks.BEFORE_UPDATE]: 'bu',
  [LifecycleHooks.UPDATED]: 'u',
  [LifecycleHooks.BEFORE_UNMOUNT]: 'bum',
  [LifecycleHooks.UNMOUNTED]: 'um',
} as const

/** 通用「生成钩子注册函数」的工厂 */
function injectHook(
  type: LifecycleHooks,
  hook: Function,
  target: ComponentInternalInstance | null = currentInstance,
) {
  // 允许显式指定 target（组件 options 场景），否则绑定当前实例
  if (target) {
    const hooks = (target[lifecycleHooksKey[type]] || (target[lifecycleHooksKey[type]] = [])) as Function[]
    // 包一层错误处理：钩子抛错不影响渲染器主流程
    hooks.push(() => callWithErrorHandling(hook, target, ErrorCodes.COMPONENT_UPDATE))
  } else if (__DEV__) {
    console.warn(
      `[mini-vue] ${type} is called when there is no active component instance to be associated with. ` +
        `Lifecycle injection APIs can only be used during execution of setup().`,
    )
  }
}

export { injectHook }
export const onBeforeMount = (hook: Function, target?: ComponentInternalInstance | null) =>
  injectHook(LifecycleHooks.BEFORE_MOUNT, hook, target)
export const onMounted = (hook: Function, target?: ComponentInternalInstance | null) =>
  injectHook(LifecycleHooks.MOUNTED, hook, target)
export const onBeforeUpdate = (hook: Function, target?: ComponentInternalInstance | null) =>
  injectHook(LifecycleHooks.BEFORE_UPDATE, hook, target)
export const onUpdated = (hook: Function, target?: ComponentInternalInstance | null) =>
  injectHook(LifecycleHooks.UPDATED, hook, target)
export const onBeforeUnmount = (hook: Function, target?: ComponentInternalInstance | null) =>
  injectHook(LifecycleHooks.BEFORE_UNMOUNT, hook, target)
export const onUnmounted = (hook: Function, target?: ComponentInternalInstance | null) =>
  injectHook(LifecycleHooks.UNMOUNTED, hook, target)

export const __DEV__ = true