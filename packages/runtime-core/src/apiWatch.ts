/**
 * apiWatch.ts —— watch / watchEffect
 *
 * 对应真 Vue packages/runtime-core/src/apiWatch.ts（3.5 把内核迁到 reactivity 的 watch.ts，
 * mini 维持 classic 部署：实现在 runtime-core，依赖方向仍单向）。
 *
 * ## 核心：doWatch(source, cb, options)
 *   1. source 归一化：
 *        ref        → getter = () => source.value
 *        reactive   → getter = () => traverse(source)（deep：读遍所有嵌套属性建立全依赖）
 *        数组       → getter 返回每项的解包/求值结果数组（isMultiSource）
 *        函数+cb    → getter = source；纯函数   → watchEffect：直接跑
 *   2. 建一个 ReactiveEffect(getter, scheduler)，按 flush 分流：
 *        pre（默认）→ queueJob(job)（与组件渲染同队列，父先子）
 *        post        → queuePostFlushCb(job)
 *        sync        → job() 立即同步
 *   3. job：
 *        watch(source,cb) → effect.run() 拿新值 → hasChanged 比较 → 若变了：
 *                              先跑上次的 cleanup，再 callWithErrorHandling(cb, [new, old, onCleanup])
 *        watchEffect      → 直接 effect.run()（fn 内部用 onCleanup 注册清理）
 *   4. cleanup 协议：cb/effect 里可调用 onCleanup(fn)；下次触发前与 stop 时都会执行。
 *
 * ## 为什么 watch 的 effect 几乎总是带 scheduler？
 * 有 cb 的 watch 若同步重算，每次源变化都会立刻触发 cb；scheduler 让它在微任务批量里
 * 只触发一次（并靠 hasChanged 过滤「没变的抖动」）。这与组件渲染的调度是同一个哲学。
 */
import { EMPTY_OBJ, extend, isArray, isFunction, isMap, isObject, isPlainObject, isSet, hasChanged } from '@mini-vue/shared'
import type { Ref } from '@mini-vue/reactivity'
import { isRef, isReactive, isShallow, ReactiveEffect, pauseTracking, resetTracking } from '@mini-vue/reactivity'
import { getCurrentInstance } from './currentInstance'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'
import { queueJob, queuePostFlushCb } from './scheduler'

const INITIAL_WATCHER_VALUE: unique symbol = Symbol('initial')

// ---------------------------------------------------------------
// 四个对外 API
// ---------------------------------------------------------------

export type EffectScheduler = (job: () => void) => void

export function watchEffect(effect: (onCleanup: (fn: () => void) => void) => void, options: WatchOptions = {}): WatchHandle {
  return doWatch(effect, null, options) as any
}

export function watchPostEffect(effect: (onCleanup: (fn: () => void) => void) => void): WatchHandle {
  return doWatch(effect, null, { flush: 'post' }) as any
}

export function watchSyncEffect(effect: (onCleanup: (fn: () => void) => void) => void): WatchHandle {
  return doWatch(effect, null, { flush: 'sync' }) as any
}

export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onCleanup: (fn: () => void) => void,
) => any

export type WatchSource<T = any> = Ref<T> | (() => T)

export function watch<T = any>(
  source: any,
  cb: WatchCallback<T>,
  options: WatchOptions = {},
): WatchHandle {
  return doWatch(source, cb, options)
}

export interface WatchOptions {
  immediate?: boolean
  deep?: boolean | number
  flush?: 'pre' | 'post' | 'sync'
  once?: boolean
}

export interface WatchHandle {
  (): void
  stop: () => void
}

// ---------------------------------------------------------------
// doWatch —— 实现内核
// ---------------------------------------------------------------

export function doWatch(
  source: any,
  cb: WatchCallback | null,
  { immediate, deep, flush, once }: WatchOptions = EMPTY_OBJ,
): WatchHandle {
  const instance = getCurrentInstance()
  // 预/后置刷新的挂载时机：组件/根 app 的渲染 effect已经在队列前头
  let getter: () => any
  let isMultiSource = false
  let flushMode: 'pre' | 'post' | 'sync' = flush || 'pre'
  // reactive 对象当 source 时，任何属性的变化都应该触发（forceTrigger 允许“同一引用”也触发）
  let forceTrigger = false

  // ---- 1. source 归一化 ----
  if (isRef(source)) {
    getter = () => (source as Ref).value
    forceTrigger = isShallow(source)
  } else if (isReactive(source)) {
    // 默认深遍历（读遍全部嵌套属性建立依赖）；deep:false 只遍历浅层
    getter = () => (deep === false ? traverse(source, 1) : traverse(source))
    forceTrigger = true
  } else if (isArray(source)) {
    isMultiSource = true
    forceTrigger = (source as any[]).some((s) => isReactive(s) || isShallow(s))
    getter = () =>
      (source as any[]).map((s) => {
        if (isRef(s)) return (s as Ref).value
        if (isReactive(s)) return deep === false ? traverse(s, 1) : traverse(s)
        if (isFunction(s)) return s()
      })
  } else if (isFunction(source)) {
    if (cb) {
      // watch(getter, cb)
      getter = source
    } else {
      // watchEffect(fn)：fn 每次执行前先跑 cleanup；fn 可通过 onCleanup 注册下次清理
      getter = () => {
        if (cleanup) {
          pauseTracking()
          try {
            cleanup()
          } finally {
            resetTracking()
          }
        }
        return source(onCleanup)
      }
    }
  } else {
    getter = () => {}
  }

  if (cb && deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter(), deep === true ? Infinity : (deep as number))
  }

  // ---- 2. cleanup 协议 ----
  let cleanup: (() => void) | undefined
  const onCleanup = (fn: () => void) => {
    cleanup = effect.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  // ---- 3. job：与渲染共用队列，只跑一次 ----
  let oldValue: any = isMultiSource
    ? new Array((source as any[]).length).fill(INITIAL_WATCHER_VALUE)
    : INITIAL_WATCHER_VALUE

  const job: SchedulerJob = () => {
    if (!effect.active) return
    if (cb) {
      // watch(source, cb)
      const newValue = effect.run()
      if (
        deep ||
        forceTrigger ||
        isMultiSource ||
        hasChanged(newValue, oldValue) ||
        (isMultiSource && (newValue as any[]).some((v, i) => hasChanged(v, oldValue[i])))
      ) {
        if (cleanup) {
          cleanup()
        }
        const args = [
          newValue,
          oldValue === INITIAL_WATCHER_VALUE
            ? undefined
            : isMultiSource && (oldValue as any[])[0] === INITIAL_WATCHER_VALUE
              ? []
              : oldValue,
          onCleanup,
        ]
        callWithErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, args)
        oldValue = newValue
        if (once) {
          // once：首次触发（含 immediate）后自停止，之后不再响应
          effect.stop()
        }
      }
    } else {
      // watchEffect
      effect.run()
    }
  }

  // 组件内 watch 的 job 挂实例 uid，保证「父组件的 watch 先于子」的队列次序（与渲染同序）
  if (instance && flushMode === 'pre') {
    ;(job as any).id = instance.uid
  }

  // ---- 4. 建 effect（scheduler 决定刷新时机）----
  const effect = new ReactiveEffect(getter, undefined)
  effect.allowRecurse = !!cb // watch 回调允许自触发（用户显式递归）
  effect.scheduler = () => {
    if (flushMode === 'post') {
      queuePostFlushCb(job)
    } else if (flushMode === 'sync') {
      job()
    } else {
      queueJob(job)
    }
  }

  // ---- 5. 初始跑 ----
  if (cb) {
    if (immediate) {
      job()
    } else {
      oldValue = effect.run()
    }
  } else if (flushMode === 'post') {
    // watchEffect with post flush: 首次也延后
    queuePostFlushCb(job)
  } else {
    // watchEffect / watchSyncEffect：立即跑
    effect.run()
  }

  // ---- 6. 返回停止句柄 ----
  const unsubscribe: WatchHandle = () => {
    effect.stop()
  }
  unsubscribe.stop = unsubscribe
  return unsubscribe
}

// 供 job 使用（ReactiveEffect 类型）
type SchedulerJob = () => void

// ---------------------------------------------------------------
// traverse —— 深遍历：读出对象全部嵌套属性，为其建立依赖
// 用于 deep watch：只有主动读一遍，track 才会收集到深层依赖。
// ---------------------------------------------------------------

export function traverse(value: unknown, depth: number = Infinity) {
  if (depth <= 0) {
    return value
  }
  if (!isObject(value)) {
    return value
  }
  const seen = new Set<unknown>()
  _traverse(value, depth, seen)
  return value
}

function _traverse(value: unknown, depth: number, seen: Set<unknown>) {
  if (isObject(value)) {
    if (seen.has(value)) {
      return
    }
    seen.add(value)
    if (depth > 0) {
      if (isRef(value)) {
        _traverse((value as any).value, depth - 1, seen)
      } else if (isArray(value)) {
        for (let i = 0; i < (value as any[]).length; i++) {
          _traverse((value as any[])[i], depth - 1, seen)
        }
      } else if (isSet(value)) {
        ;(value as Set<unknown>).forEach((v) => _traverse(v, depth - 1, seen))
      } else if (isMap(value)) {
        ;(value as Map<any, any>).forEach((v, k) => {
          _traverse(v, depth - 1, seen)
          _traverse(k, depth - 1, seen)
        })
      } else if (isPlainObject(value)) {
        for (const key in value as Record<string, any>) {
          _traverse((value as Record<string, any>)[key], depth - 1, seen)
        }
      } else {
        // 其它对象（Date/RegExp…）：读一次即可
        void value
      }
    }
  }
}