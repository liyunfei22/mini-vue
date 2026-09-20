/**
 * @mini-vue/runtime-core 入口
 *
 * 阶段 3 导出的核心：渲染器、vnode/h、组件协议、注入、生命周期、调度器。
 * 与真 Vue 一致，这里把 @mini-vue/reactivity 的公共 API 一并 re-export ——
 * 用户（及下游的 runtime-dom / vue 聚合包）从一层拿到 ref/reactive/effect 等。
 */
export * from '@mini-vue/reactivity'

export { toDisplayString } from '@mini-vue/shared'

export { renderComponentRoot } from './componentRenderUtils'

export {
  createVNode,
  createElementVNode,
  cloneVNode,
  createTextVNode,
  createCommentVNode,
  isVNode,
  isSameVNodeType,
  normalizeVNode,
  normalizeChildren,
  guardReactiveProps,
  withDirectives,
  Fragment,
  Text,
  Comment,
  Static,
} from './vnode'
export type { VNode, VNodeProps, VNodeChild, VNodeArrayChildren } from './vnode'

export { h } from './h'

export { createRenderer } from './renderer'
export type { RendererOptions } from './renderer'

export {
  createAppContext,
  createComponentInstance,
  setupComponent,
  handleSetupResult,
} from './component'
export type {
  AppContext,
  ComponentInternalInstance,
  SetupContext,
  ConcreteComponent,
  Data,
} from './component'

export {
  provide,
  inject,
} from './apiInject'
export type { InjectionKey } from './apiInject'

export {
  getCurrentInstance,
  setCurrentInstance,
  unsetCurrentInstance,
} from './currentInstance'

export {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
} from './lifecycle'

export {
  nextTick,
  queueJob,
  queuePostFlushCb,
  queuePreFlushCb,
} from './scheduler'
export type { SchedulerJob, SchedulerJobs } from './scheduler'

export {
  callWithErrorHandling,
  callWithArrayAsErrorHandling,
  handleError,
  ErrorCodes,
} from './errorHandling'

export {
  watch,
  watchEffect,
  watchPostEffect,
  watchSyncEffect,
  traverse,
} from './apiWatch'
export type { WatchCallback, WatchOptions, WatchHandle, WatchSource } from './apiWatch'

export { createAppAPI, registerRuntimeCompiler } from './apiCreateApp'
export type { App } from './apiCreateApp'

export { renderSlot } from './helpers/renderSlot'

export {
  resolveComponent,
  resolveDynamicComponent,
  resolveDirective,
  isNativeTag,
} from './helpers/resolveAssets'

export { renderList } from './helpers/renderList'

export { warn } from './warning'