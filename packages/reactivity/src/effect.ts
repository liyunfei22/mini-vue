/**
 * effect.ts —— 副作用的依赖收集（track）与触发更新（trigger）
 *
 * 对应真 Vue packages/reactivity/src/effect.ts（3.5.x）。
 *
 * ## 数据模型（两张表）
 *   targetMap: WeakMap<target, Map<key, Dep>>
 *   effect.deps: Dep[]                —— 反向索引，用于 stop() 与每次 run() 前 cleanup
 *
 * ## 一次 effect 完整的生命周期
 *   effect(fn) → ReactiveEffect
 *     ├─ 首次 run()：cleanupEffect → 把自身压入 effectStack，成为全局 activeEffect
 *     ├─ fn() 执行：访问响应式属性 → proxy get → track(target, 'get', key)
 *     │     → targetMap 找到/创建 dep → dep.add(activeEffect) → effect.deps.push(dep)
 *     ├─ 返回：出栈，activeEffect 还原为外层 effect
 *     └─ 之后每次 trigger(target, type, key)：取出相关 dep(s) → 对每个订阅 effect
 *        scheduler ? scheduler() : run()
 *
 * ## 为什么每次 run() 前必须 cleanup？
 *   ——「分支切换」。effect 依赖变量 `ok ? a : b`，当 ok 翻转，fn 重跑后旧分支的依赖
 *   不再被访问。若不清理，旧依赖变化仍会触发这个 effect（幽灵依赖）。
 *   cleanup + 重跑收集 = 每轮依赖都是「当前这次执行真正访问过的」，准确而自洽。
 *
 * ## 与 3.5 的差异（读真源码时注意）
 *   3.5 用 `EffectFlags` 位标记（ACTIVE/RUNNING/TRACKING/DIRTY…）+ Link 双向链表 + batch
 *   批处理 + globalVersion 全局版本号。行为与本文等价，这里用最朴素的 Set + effectStack。
 *
 * 学习顺序建议：先反复读 track()/trigger()/ReactiveEffect.run()，其余函数一目了然。
 */
import {
  extend,
  isArray,
  isIntegerKey,
  isMap,
  isSymbol,
} from '@mini-vue/shared'
import { createDep, type Dep } from './dep'
import {
  ARRAY_ITERATE_KEY,
  ITERATE_KEY,
  MAP_KEY_ITERATE_KEY,
  TrackOpTypes,
  TriggerOpTypes,
} from './operations'
import type { ComputedRefImpl } from './computed'
import { activeEffectScope, recordEffectScope, type EffectScope } from './effectScope'

export type EffectScheduler = (...args: any[]) => any

export interface ReactiveEffectOptions {
  /**
   * 惰性 effect：不立刻 run()，等手动调用 runner()
   */
  lazy?: boolean
  /**
   * 调度器：被 trigger 时调用它而不是直接 run()
   *   - computed 用它：只把 _dirty 置位 + 通知下游（真 Vue 的 watch/渲染 effect 换 scheduler
   *     把「同步重算」改成「进微任务队列」，见阶段 3 的 scheduler.ts）
   */
  scheduler?: EffectScheduler
  /**
   * 允许「自己触发自己」。默认 effect 被自己的改动触发会跳过，防止死循环。
   * computed/某些内部 effect 会显式打开（如 `count.value++` 在 effect 里允许）。
   */
  allowRecurse?: boolean
  /**
   * stop() 时的钩子（watch 用它注销清理函数）。
   */
  onStop?: () => void
  /**
   * 显式归属的 effect scope（阶段 2）：不传则按「构造时活跃 scope」自动登记。
   */
  scope?: EffectScope
}

export type ReactiveEffectRunner<T = any> = {
  (): T
  effect: ReactiveEffect
}

/** 当前正在执行的 effect。effect 内同步访问响应式属性时用它建立订阅。 */
export let activeEffect: ReactiveEffect | undefined

/** effect 执行栈：嵌套 effect（effect 里再建 effect/访问计算属性）时外层入栈，内层完成后还原 */
const effectStack: ReactiveEffect[] = []

/**
 * 收集是否应该生效（导出：ref.ts 的 trackRefValue 也要读它）。
 * pauseTracking/enableTracking 配合在「只是取值不觉察」的场景临时关闭收集。
 */
export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export class ReactiveEffect<T = any> {
  /**
   * 该 effect 订阅过的所有 dep。每次 run() 前按这个列表全量清理，再重新收集
   * —— 见头部「为什么必须 cleanup」。
   */
  deps: Dep[] = []

  /** effect 是否存活。stop() 后为 false，不再收集，trigger 时跳过 */
  active = true

  /** 见 ReactiveEffectOptions.allowRecurse */
  allowRecurse = false

  onStop?: () => void

  /** computed 会把自己的引用挂过来（用于 devtools/dirty 判定，mini 仅类型约定） */
  computed?: ComputedRefImpl<T>

  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | undefined,
  ) {
    // 自动登记进「构造时的活跃 effect scope」：scope.run() 里创建的 effect，
    // 会随 scope.stop() 一起被停掉（阶段 2 新增，对应真 Vue 3.5 行为）
    if (activeEffectScope) {
      if (activeEffectScope.active) {
        activeEffectScope.effects.push(this)
      } else {
        // 父 scope 已停止，这个 effect 一出生就失活（防止孤儿订阅）
        this.active = false
      }
    }
  }

  run(): T | undefined {
    // 已 stop 的 effect：直接跑一次 fn，但不做任何收集
    if (!this.active) {
      return this.fn()
    }
    // 防止递归 run（自身 guard：effect 的调度器/依赖把自身触发时跳过重入）
    if (!effectStack.includes(this)) {
      cleanupEffect(this)
      try {
        // 进入执行区：无条件开启收集（把外层 pauseTracking 状态压栈保护）
        enableTracking()
        effectStack.push(this)
        activeEffect = this
        return this.fn()
      } finally {
        effectStack.pop()
        // 恢复外层追踪状态
        resetTracking()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  }

  stop() {
    if (this.active) {
      cleanupEffect(this)
      if (this.onStop) this.onStop()
      this.active = false
    }
  }
}

/**
 * 清理：把 effect 从它订阅过的每个 dep 里摘除，并清空反向列表。
 * 必须在每次 run() 之前调用，否则「分支切换」后旧分支依赖会残留（幽灵依赖）。
 */
function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

// ---------------------------------------------------------------
// 收集（track）
// ---------------------------------------------------------------

const targetMap: WeakMap<any, Map<any, Dep>> = new WeakMap()

/**
 * 依赖收集入口：在属性被读时，把当前 activeEffect 记入 target 的 key 对应的 dep。
 *
 * 内部是两个 Map 的懒创建：
 *   targetMap.get(target)         → depsMap（该对象所有 key → dep）
 *   depsMap.get(key)              → dep（订阅者们）
 *
 * 注意 depsMap 用普通 Map、targetMap 用 WeakMap —— 原对象若被回收，整张表能跟着被 GC。
 */
export function track(target: object, type: TrackOpTypes, key: unknown) {
  // !!! 关键条件：没有正在执行的 effect，或者追踪被挂起，直接返回 —— 这就是
  // `reactive({}).foo` 裸读不产生任何副作用的原因。
  if (!shouldTrack || !activeEffect) {
    return
  }

  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = createDep()))
  }

  trackEffects(dep)
}

/**
 * 真正把 activeEffect 写进 dep 的地方。ref / computed 的 value getter 也复用同一个入口
 * （见 ref.ts 的 trackRefValue）。
 */
export function trackEffects(dep: Dep) {
  if (activeEffect) {
    if (!dep.has(activeEffect)) {
      dep.add(activeEffect)
      activeEffect.deps.push(dep)
    }
  }
}

// ---------------------------------------------------------------
// 触发（trigger）
// ---------------------------------------------------------------

/**
 * 触发更新入口：在属性被改时，找出依赖它的所有 dep，依次执行其中每个 effect。
 *
 * 难点在于「一次改动可能要打中多个 dep」：
 *   - 改普通 key        → 命中 depsMap.get(key)
 *   - ADD 新 key        → 还要命中 ITERATE_KEY（迭代者）和 length（数组越界新增时下标变化）
 *   - 数组改下标/长度    → 命中 length 与 ARRAY_ITERATE_KEY
 *   - Map SET           → 还要命中 ITERATE_KEY（值变了，但迭代集没错）—— 真 Vue 连 key 集也要 trigger
 */
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: unknown,
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // 这个对象从来没被追踪过，改动自然没有人关心
    return
  }

  let deps: (Dep | undefined)[] = []

  if (type === TriggerOpTypes.CLEAR) {
    // 集合被清空：所有 dep 全部命中
    deps = [...depsMap.values()]
  } else if (key === 'length' && isArray(target)) {
    // 数组长度变化：length 相关 + 所有「越界下标」的 key（因为设短 length 等于删了一堆）
    const newLength = Number(newValue)
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key === ARRAY_ITERATE_KEY || (!isSymbol(key) && key >= newLength)) {
        deps.push(dep)
      }
    })
  } else {
    // 常规路径：先命中改动本身的那个 key
    if (key !== void 0) {
      deps.push(depsMap.get(key))
    }

    switch (type) {
      case TriggerOpTypes.ADD:
        // 新增 key：遍历者（for...in / Object.keys / forEach）也要更新
        if (!isArray(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // 数组新增一个下标 → 长度隐式变化，length 的订阅者要通知
          deps.push(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          // Map 的 set 不改结构，但值变化 → ITERATE_KEY 上的 forEach 订阅者重新执行
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  // !!! 稳定遍历的关键：一个 effect 可能同时被多个 dep 命中（比如既订阅了 key 又订阅了
  // ITERATE_KEY）。先去重（保持 dep 存入顺序 = 稳定的执行顺序），再统一执行。
  const effects: ReactiveEffect[] = []
  for (const dep of deps) {
    if (dep && dep.size) {
      for (const effect of dep) {
        // 跳过「正在执行并且没开 allowRecurse」的那个 effect，防止自触发死循环
        if (effect !== activeEffect || effect.allowRecurse) {
          if (!effects.includes(effect)) {
            effects.push(effect)
          }
        }
      }
    }
  }

  for (const effect of effects) {
    if (effect.scheduler) {
      // 有调度器（computed / watch / 组件渲染）：交给它决定何时重算
      effect.scheduler()
    } else {
      // 普通副作用：同步立即重跑
      effect.run()
    }
  }
}

/**
 * 对某个 dep 的所有订阅者触发更新。ref / computed 的 set 路径复用（见 ref.ts 的 triggerRefValue）。
 */
export function triggerEffects(dep: Dep) {
  // ...dep 拷贝：trigger 过程中 effect 的 cleanup 可能改动集合，遍历副本避免错乱
  for (const effect of [...dep]) {
    if (effect !== activeEffect || effect.allowRecurse) {
      if (effect.scheduler) {
        effect.scheduler()
      } else {
        effect.run()
      }
    }
  }
}

// ---------------------------------------------------------------
// 对外工厂：effect() / stop()
// ---------------------------------------------------------------

/**
 * 创建并（默认）立即执行一个副作用，返回可再次调用的 runner。
 * runner 上挂着 `.effect`，便于 stop(runner)。
 */
export function effect<T = any>(fn: () => T, options?: ReactiveEffectOptions): ReactiveEffectRunner<T> {
  // 兼容 `effect(fn)` 里传入的 fn 其实是上一个 runner 的情况（提取出原始 fn）
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const _effect = new ReactiveEffect(fn, options && options.scheduler)
  if (options) {
    extend(_effect, options)
    // 显式指定 scope 时额外登记（options.scope 优先级高于构造时的活跃 scope）
    if (options.scope) {
      recordEffectScope(_effect, options.scope)
    }
  }

  if (!options || !options.lazy) {
    _effect.run()
  }

  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

/** 停止一个副作用：解除所有订阅，不再响应触发 */
export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}