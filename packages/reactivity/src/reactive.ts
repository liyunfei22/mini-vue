/**
 * reactive.ts —— 代理工厂：把原始对象包成 Proxy
 *
 * 对应真 Vue packages/reactivity/src/reactive.ts。
 *
 * 核心是 createReactiveObject：一个「该不该代理」的完整判断管线 + 缓存表。
 * 四条缓存表（WeakMap）保证：同一原始对象只产出「一个」代理，多次调用返回同一个
 * —— 这是 toRefs 解构仍保持响应式的根基（ref 指向的还是那一个代理的属性）。
 */
import {
  def,
  hasOwn,
  isObject,
  toRawType,
} from '@mini-vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers,
} from './baseHandlers'
import { ReactiveFlags } from './operations'
import { warn } from './warning'

export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.IS_SHALLOW]?: boolean
  [ReactiveFlags.RAW]?: unknown
}

// ---- 四张「原始对象 → 代理」缓存表（WeakMap 让原始对象被回收时整条记录可回收）----
export const reactiveMap: WeakMap<Target, any> = new WeakMap()
export const shallowReactiveMap: WeakMap<Target, any> = new WeakMap()
export const readonlyMap: WeakMap<Target, any> = new WeakMap()
export const shallowReadonlyMap: WeakMap<Target, any> = new WeakMap()

// 可观察目标类型：COMMON=普通对象/数组，COLLECTION=Map/Set（阶段2特化 handler），INVALID=不可观察
enum TargetType {
  INVALID = 0,
  COMMON = 1,
  COLLECTION = 2,
}

function targetTypeMap(rawType: string): TargetType {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

// ---------------------------------------------------------------
// 四个工厂函数
// ---------------------------------------------------------------

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T> {
  // 对 readonly 代理再 reactive → 直接还它自己（readonly 优先级更高）
  if (isReadonly(target)) {
    return target as any
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableHandlers, // TODO(stage2): 集合特化 collectionHandlers 在阶段 2 接入
    reactiveMap,
  )
}

export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowReactiveHandlers, // TODO(stage2)
    shallowReactiveMap,
  )
}

export function readonly<T extends object>(target: T): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyHandlers, // TODO(stage2)
    readonlyMap,
  )
}

export function shallowReadonly<T extends object>(target: T): Readonly<T> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyHandlers, // TODO(stage2)
    shallowReadonlyMap,
  )
}

/**
 * 三层防火墙，逐关放行才真正 new Proxy：
 *   1. 不是对象 → 警告并原样返回
 *   2. 已经是某个代理（`target[RAW]` 有值），除非「对 reactive 做 readonly」这种合法包装
 *   3. 被 markRaw 打了 SKIP 标，或不可扩展（Object.freeze 等）→ 原样返回
 *   4. 类型不在 Observable 名单（Date/RegExp 等）→ 原样返回
 */
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>,
) {
  if (!isObject(target)) {
    warn(
      `value cannot be made ${isReadonly ? 'readonly' : 'reactive'}: ${String(target)}`,
    )
    return target
  }

  // 已代理对象直接复用；唯一例外：readonly() 包 reactive() 是合法升级
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }

  if (target[ReactiveFlags.SKIP] || !Object.isExtensible(target)) {
    return target
  }

  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }

  const targetType = targetTypeMap(toRawType(target))
  if (targetType === TargetType.INVALID) {
    return target
  }

  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers,
  )
  proxyMap.set(target, proxy)
  return proxy
}

// ---------------------------------------------------------------
// 类型判定与脱壳
// ---------------------------------------------------------------

export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) {
    // readonly(proxy) 内部语义仍是 reactive（它包的 raw 是 reactive 代理）
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

export function isShallow(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

export function isProxy(value: unknown): boolean {
  return value ? !!((value as Target)[ReactiveFlags.RAW]) : false
}

/**
 * 递归脱壳：proxy → 原始对象。
 * `const raw = observed && observed[RAW]` 读一次可能还套着（readonly(reactive(...))），
 * 所以递归到没有 RAW 为止。
 */
export function toRaw<T>(observed: T): T {
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw as unknown as T) : observed
}

/** markRaw：打 SKIP 标，让 reactive()/readonly() 永远不再代理它 */
export function markRaw<T extends object>(value: T): T {
  if (!hasOwn(value, ReactiveFlags.SKIP) && Object.isExtensible(value)) {
    def(value, ReactiveFlags.SKIP, true)
  }
  return value
}

// ---------------------------------------------------------------
// 值转换工具（供 ref / 阶段2 使用）
// ---------------------------------------------------------------

/** 对象 → reactive；非对象原样返回 */
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? (reactive(value as object) as unknown as T) : value

/** 对象 → readonly；非对象原样返回 */
export const toReadonly = <T extends unknown>(value: T): DeepReadonly<T> =>
  isObject(value)
    ? (readonly(value as object) as unknown as DeepReadonly<T>)
    : (value as DeepReadonly<T>)

// ---------------------------------------------------------------
// 便于类型具名的类型（行文注释用，不做真 Vue 那样完善的泛型推导）
// ---------------------------------------------------------------
export type UnwrapNestedRefs<T> = T
export type DeepReadonly<T> = T