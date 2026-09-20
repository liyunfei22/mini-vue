/**
 * computed.ts —— 计算属性：lazy + 缓存 + 派生值自动失效
 *
 * 对应真 Vue packages/reactivity/src/computed.ts（经典实现）。
 *
 * ## 三层身份
 *   ComputedRefImpl 同时是：
 *   1. 一个 Ref —— 有 `.value`，isRed(computed) 为 true；
 *   2. 一个订阅者（ReactiveEffect）——getter 执行时收集它依赖的响应式源；
 *   3. 一个发布源 —— 自己也有 dep，出现依赖变化时通知「读过它的 effect」。
 *
 * ## lazy + 只重算一次（gate：回答问题2）
 *   - _dirty 初始 true；第一次读 `.value` 才 effect.run() 真正计算，结果缓存到 _value；
 *   - 依赖变化时，它的源 dep 触发这个 computed 的 effect：scheduler（不是 run）只做两件事：
 *     `_dirty = true` + `triggerRefValue(this)`（告诉外层读者「我脏了，重新读我」）；
 *   - 读者 effect 重新执行 → 再次读 `.value` → track 到这个 computed 的 dep →
 *     _dirty 为 true → 重算。若这一轮没人读它，就保持脏位，下一次读时再算 —— 这就是
 *     「只在被需要时重算一次」的惰性来源。
 */
import { isFunction } from '@mini-vue/shared'
import type { Dep } from './dep'
import { ReactiveEffect } from './effect'
import { ReactiveFlags } from './operations'
import { toRaw } from './reactive'
import { trackRefValue, triggerRefValue, type Ref, type RefBase } from './ref'
import { warn } from './warning'

export type ComputedGetter<T> = (oldValue?: T) => T
export type ComputedSetter<T> = (newValue: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

export interface ComputedRef<T = any> extends RefBase<T>, Ref<T> {}

export class ComputedRefImpl<T = any> {
  _dirty = true
  dep?: Dep
  private _value!: T
  readonly [ReactiveFlags.IS_REF] = true
  readonly [ReactiveFlags.IS_READONLY]: boolean

  /** computed 自己的「计算 effect」：源依赖变化只进 scheduler，不直接重算 */
  public readonly effect: ReactiveEffect<T>

  constructor(
    getter: ComputedGetter<T>,
    private readonly setter: ComputedSetter<T> | undefined,
    isReadonly: boolean,
  ) {
    this[ReactiveFlags.IS_READONLY] = isReadonly
    this.effect = new ReactiveEffect(getter, () => {
      // scheduler：源变化时，把脏位置起并通知「本 computed 的读者」
      if (!this._dirty) {
        this._dirty = true
        triggerRefValue(this)
      }
    })
  }

  get value(): T {
    // 迅护到 toRaw：可能被 readonly() 包一层（真实场景 #3376），track/dirty 都要落在裸 computed 上
    const self = toRaw(this) as ComputedRefImpl<T>
    // 1. 收集「当前 activeEffect」进本 computed 的 dep（读者成订阅者）
    trackRefValue(self)
    // 2. 脏才重算；算完缓存到 _value
    if (self._dirty) {
      self._dirty = false
      self._value = self.effect.run()!
    }
    return self._value
  }

  set value(newValue) {
    if (this.setter) {
      this.setter(newValue)
    } else {
      warn('Write operation failed: computed value is readonly')
    }
  }
}

// ---------------------------------------------------------------
// computed() 工厂
// ---------------------------------------------------------------

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(options: WritableComputedOptions<T>): ComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
): ComputedRef<T> {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T> | undefined

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 只读判定：没有 setter 的 computed 是 readonly 的（isReadonly(computed) === true）
  return new ComputedRefImpl(getter, setter, !setter) as any
}