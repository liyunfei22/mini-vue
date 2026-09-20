/**
 * @mini-vue/reactivity 入口 —— 对外公开的响应式 API
 *
 * 与真 Vue packages/reactivity/src/index.ts 对应。minDep 按阶段演进：
 *   - 阶段 1（当前）：effect / reactive 家族 / ref 家族 / computed / 工具
 *   - 阶段 2 追加：effectScope、collectionHandlers 特化、shallowRef、customRef、
 *     proxyRefs、triggerRef、markRaw（markRaw/toRaw 已在阶段 1 就位）
 */
export {
  ref,
  shallowRef,
  toRef,
  toRefs,
  isRef,
  unref,
  toValue,
  triggerRef,
  customRef,
  proxyRefs,
} from './ref'
export type {
  Ref,
  RefBase,
  MaybeRef,
  MaybeRefOrGetter,
  ToRefs,
  UnwrapRef,
  UnwrapRefSimple,
  CustomRefFactory,
} from './ref'

export * from './reactive'

export {
  computed,
  ComputedRefImpl,
} from './computed'
export type {
  ComputedRef,
  ComputedGetter,
  ComputedSetter,
  WritableComputedOptions,
} from './computed'

export {
  effect,
  stop,
  ReactiveEffect,
  pauseTracking,
  enableTracking,
  resetTracking,
} from './effect'
export type {
  EffectScheduler,
  ReactiveEffectOptions,
  ReactiveEffectRunner,
} from './effect'

export {
  TrackOpTypes,
  TriggerOpTypes,
  ReactiveFlags,
  ITERATE_KEY,
  MAP_KEY_ITERATE_KEY,
  ARRAY_ITERATE_KEY,
} from './operations'

export { createDep } from './dep'
export type { Dep } from './dep'

export {
  effectScope,
  getCurrentScope,
  onScopeDispose,
  EffectScope,
  recordEffectScope,
  activeEffectScope,
} from './effectScope'

export { warn } from './warning'