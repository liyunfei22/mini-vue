/**
 * ref.ts —— 单值响应式：把「一个值」变成带上 `.value` 的响应式容器
 *
 * 对应真 Vue packages/reactivity/src/ref.ts。
 *
 * ref 与 reactive 的本质区别：
 *   - reactive 面向「对象」：Proxy 可以在不引入新对象的前提下给整张图注入响应式；
 *   - ref 面向「任意值」：原始类型（number/string/…）无法被 Proxy 代理，
 *     只能包一层容器对象（RefImpl），把读/写收敛到 `value` 这个属性上。
 *
 * RefImpl 内部：
 *   - _rawValue：上一次写入的原始值（用于 hasChanged 判断「值真变了没有」）
 *   - _value：实际对外提供的值。对象会被 toReactive 深代理
 *   - dep：这个 ref 自己的订阅者集合（读 value → trackRefValue，写 value → triggerRefValue）
 *
 * toRef / toRefs 是「连回已有属性」的壳（ObjectRefImpl），不改写原对象。
 */
import { hasChanged, isArray, isFunction, isObject, isSymbol } from '@mini-vue/shared'
import { createDep, type Dep } from './dep'
import { activeEffect, shouldTrack, trackEffects, triggerEffects } from './effect'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './operations'
import { isProxy, isReadonly, reactive, toRaw, toReactive } from './reactive'
import { warn } from './warning'

export interface Ref<T = any> {
  value: T
  [ReactiveFlags.IS_REF]: true
}

/** ref 需要的最小接口（computed 等其它 ref 形态共用） */
export interface RefBase<T> {
  dep?: Dep
  value: T
}

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T> {
  return r ? (r as { [ReactiveFlags.IS_REF]: boolean })[ReactiveFlags.IS_REF] === true : false
}

export function ref<T>(value: T): Ref<UnwrapRef<T>> {
  return createRef(value, false) as any
}

export function shallowRef<T>(value: T): Ref<T> {
  return createRef(value, true) as any
}

/** 统一创建入口；shallow 参数阶段 2 正式启用（先留位，保证构造语义一致） */
function createRef(rawValue: unknown, shallow: boolean) {
  if (isRef(rawValue)) {
    return rawValue
  }
  return new RefImpl(rawValue, shallow)
}

class RefImpl<T = any> {
  _value: T
  private _rawValue: T
  dep?: Dep
  // ReactiveFlags.IS_REF 就是 '__v_isRef'：一个字段同时充当 isRef 标记
  readonly [ReactiveFlags.IS_REF] = true

  constructor(value: T, private readonly shallow: boolean) {
    // _rawValue 存「原始值」：传入的若已是 reactive 代理，先脱壳再存
    // —— 这样 `ref(reactiveObj)` 再 set 同一个对象时 hasChanged 才能判「没变」
    this._rawValue = shallow ? value : toRaw(value)
    this._value = shallow ? value : toReactive(value)
  }

  get value() {
    // 读 → 收集当前 activeEffect 进这个 ref 的 dep
    trackRefValue(this)
    return this._value
  }

  set value(newVal) {
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal
      this._value = toReactive(newVal)
      // 写 → 触发所有订阅者
      triggerRefValue(this, newVal)
    }
  }
}

// ---------------------------------------------------------------
// ref 的 track/trigger（computed 也复用这两个函数）
// ---------------------------------------------------------------

export function trackRefValue(ref: RefBase<any>) {
  if (shouldTrack && activeEffect) {
    ref = toRaw(ref)
    trackEffects(ref.dep || (ref.dep = createDep()))
  }
}

export function triggerRefValue(ref: RefBase<any>, newVal?: any) {
  ref = toRaw(ref)
  const dep = ref.dep
  if (dep) {
    triggerEffects(dep)
  }
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

export function unref<T>(ref: MaybeRef<T> | T): T {
  return isRef(ref) ? (ref as Ref<T>).value : (ref as T)
}

export type MaybeRef<T = any> = T | Ref<T>

/** 兼容 ref / getter / 普通值（watch 归一化阶段会用到） */
export function toValue<T>(source: MaybeRefOrGetter<T>): T {
  return isFunction(source) ? source() : unref(source as any)
}
export type MaybeRefOrGetter<T = any> = MaybeRef<T> | (() => T)

// ---------------------------------------------------------------
// toRef / toRefs：把「响应式对象上的某个属性」做成引用壳
// ---------------------------------------------------------------

/**
 * toRef(object, key[, default])：
 *   - 属性本来就是个 ref → 直接还它
 *   - 否则返回 ObjectRefImpl：读/写都透传到 原对象.key
 * 关键收益：`const { foo } = toRefs(state)` 解构出的是「活的引用」，
 * 解构后改 foo.value 等价于改 state.foo。
 * 注意对普通对象 toRef 只有「引用透传」这一层（读时 track），写回时原对象若不是
 * reactive 就没有副作用——所以 toRefs 文档要求传入 reactive 对象。
 */
export function toRef<T extends object, K extends keyof T>(
  object: T,
  key?: K,
  defaultValue?: T[K],
): Ref<T[K]> {
  // 传进来的本身是个 ref → 直接返回（`toRef(existingRef)` 单参数形态）
  if (isRef(object)) {
    return object as any
  }
  const val = object[key!]
  return isRef(val)
    ? (val as Ref<T[K]>)
    : (new ObjectRefImpl(object, key!, defaultValue) as any)
}

export type ToRefs<T = any> = {
  [K in keyof T]: Ref<T[K]>
}

export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (!isProxy(object)) {
    warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = isArray(object) ? new Array(object.length) : {}
  for (const key in object) {
    ret[key] = toRef(object, key as keyof T)
  }
  return ret
}

class ObjectRefImpl<T extends object, K extends keyof T> {
  readonly [ReactiveFlags.IS_REF] = true

  private readonly _key: K

  constructor(
    private readonly _object: T,
    key: K,
    private readonly _defaultValue?: T[K],
  ) {
    this._key = (isSymbol(key) ? key : String(key)) as K
  }

  get value(): T[K] {
    const val = this._object[this._key]
    return val === undefined ? (this._defaultValue as T[K]) : val
  }

  set value(newVal) {
    this._object[this._key] = newVal
  }
}

// ---------------------------------------------------------------
// 简化的类型工具（阶段1够用；pinia 的泛型推导在阶段8再细化）
// UnwrapRef：ref(0).value 的类型推导 → number；ref({a:1}).value → { a: number }
// ---------------------------------------------------------------

type BaseTypes = string | number | boolean | symbol | bigint | undefined | null
type CollectionTypes = Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any>
/* eslint-disable @typescript-eslint/no-unused-vars */
type RefUnwrapBailTypes = never

export type UnwrapRef<T> = T extends Ref<infer V> ? UnwrapRefSimple<V> : UnwrapRefSimple<T>
export type UnwrapRefSimple<T> = T extends
  | Function
  | CollectionTypes
  | BaseTypes
  | Ref
  | RefUnwrapBailTypes
  ? T
  : T extends Array<any>
    ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
    : T extends object
      ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
      : T