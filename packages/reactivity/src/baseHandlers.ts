/**
 * baseHandlers.ts —— 「普通对象/数组」的 Proxy 拦截器
 *
 * 对应真 Vue packages/reactivity/src/baseHandlers.ts（3.5.x）。
 *
 * 设计核心是两对工厂：
 *   createGetter(isReadonly, shallow) —— 决定「读」时要不要收集依赖
 *   createSetter(isShallow)           —— 决定「写」时要不要触发、用 ADD 还是 SET
 *
 * 四种 handler 就是这四个开关的组合：
 *   mutableHandlers   (false, false) —— 深，可写可改
 *   readonlyHandlers  (true,  false) —— 深，只读
 *   shallowReactive   (false, true)  —— 浅，可改
 *   shallowReadonly   (true,  true)  —— 浅，只读
 *
 * 【防火墙要点】
 *   - get 里对 ReactiveFlags 那几个暗号 key 直接短路返回，不走真实属性
 *   - set 里 `target === toRaw(receiver)` 守卫：原型链上的子对象只会命中父 setter —
 *     receiver 是子对象而非 target，这时不触发父对象的响应式更新
 *   - set 里「新值是对象」先 toRaw(value) 再写入：reactive 对象只存裸对象，
 *     「读时再惰性包代理」保证同一对象永远是同一个代理
 *   - 数组整数下标的新增用 ADD（附带 length），已存在下标用 SET
 */
import {
  hasChanged,
  hasOwn,
  isArray,
  isIntegerKey,
  isObject,
  isSymbol,
  makeMap,
} from '@mini-vue/shared'
import { isRef } from './ref'
import { ITERATE_KEY, ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './operations'
import { track, trigger } from './effect'
import {
  reactive,
  readonly,
  shallowReadonlyMap,
  shallowReactiveMap,
  readonlyMap,
  reactiveMap,
  isReadonly,
  isShallow,
  toRaw,
  type Target,
} from './reactive'
import { warn } from './warning'

/** 这些字符串 key 不做收集（原型访问/内部标记） */
const isNonTrackableKeys = /*#__PURE__*/ makeMap('__proto__,__v_isRef,__isVue')

/** JS 内建符号（Symbol.iterator…）：不追踪 */
const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .filter((key) => key !== 'arguments' && key !== 'caller') // ios Safari 的坑，防 TypeError
    .map((key) => (Symbol as any)[key])
    .filter(isSymbol),
)

// ---------------------------------------------------------------
// 读拦截
// ---------------------------------------------------------------

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

function createGetter(isReadonly = false, isShallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    // ---- 暗号区: ReactiveFlags 直接短路 ----
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return isShallow
    } else if (key === ReactiveFlags.RAW) {
      // toRaw(proxy) 的秘密通道：只有当 receiver 就是「这个原始对象缓存的代理」时才给
      if (
        receiver ===
        (isReadonly
          ? isShallow
            ? shallowReadonlyMap
            : readonlyMap
          : isShallow
            ? shallowReactiveMap
            : reactiveMap
        ).get(target)
      ) {
        return target
      }
      return
    }

    const targetIsArray = isArray(target)
    const res = Reflect.get(
      target,
      key,
      // 代理包着 ref 时，方法调用以「裸 ref」为 this，避免解包歧义
      isRef(target) ? target : receiver,
    )

    // symbol key：只跳过内建符号；其它 symbol 也要收集
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    if (isShallow) {
      return res
    }

    // ---- ref 解包 ----
    // reactive({ inner: ref(0) }) 时 `state.inner` 读到裸值 0；
    // 数组+整数下标不解包（保持元素引用，配合遍历收集）。
    if (isRef(res)) {
      const value = targetIsArray && isIntegerKey(key) ? res : (res as any).value
      return isReadonly && isObject(value) ? readonly(value) : value
    }

    // ---- 惰性深度代理：只有「被访问到」的嵌套对象才包 Proxy，且缓存同代理 ----
    if (isObject(res)) {
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

// ---------------------------------------------------------------
// 写拦截
// ---------------------------------------------------------------

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

function createSetter(isShallowFlag = false) {
  return function set(target: Record<string | symbol, any>, key: string | symbol, value: any, receiver: object) {
    let oldValue = target[key]
    const isArrayWithIntegerKey = isArray(target) && isIntegerKey(key)

    if (!isShallowFlag) {
      const isOldValueReadonly = isReadonly(oldValue)
      // 统一归位成「裸值」：reactive 里永远只存 raw 对象（读时再惰性包）
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      // 属性原本是 ref：直接写进 ref（保持 ref 身份与依赖链）。数组整数下标豁免。
      if (!isArrayWithIntegerKey && isRef(oldValue) && !isRef(value)) {
        if (isOldValueReadonly) {
          warn(
            `Set operation on key "${String(key)}" failed: target is readonly.`,
            target[key],
          )
          return true
        }
        oldValue.value = value
        return true
      }
    }
    // shallow 模式：对象按原样存储（不脱壳、不解包）

    // 是否已存在下标（数组 ADD vs SET 的判定）
    const hadKey = isArrayWithIntegerKey
      ? Number(key) < target.length
      : hasOwn(target, key)

    const result = Reflect.set(
      target,
      key,
      value,
      isRef(target) ? target : receiver,
    )

    // 原型链守卫 + 写真的成功才触发
    if (target === toRaw(receiver) && result) {
      if (!hadKey) {
        // 新增 key → ADD（迭代者、数组 length、Map 键集都要卷到）
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // 值真的变了 → SET
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

// ---------------------------------------------------------------
// 删除 / 存在性 / 键枚举
// ---------------------------------------------------------------

function deleteProperty(target: Target, key: string | symbol) {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as Record<string | symbol, any>)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: Target, key: string | symbol) {
  const result = Reflect.has(target, key)
  // `key in obj` 等查询也要收集（将来 key 可能被增删）
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

function ownKeys(target: Target) {
  // 枚举 key 时，对象整体结构可能变化 → 追踪 ITERATE_KEY（数组特化为 'length'）
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}

// ---------------------------------------------------------------
// 只读拦截器（写 → 警告 + 静默成功）
// ---------------------------------------------------------------

function readonlySet(target: object, key: string | symbol, value: unknown): boolean {
  warn(
    `Set operation on key "${String(key)}" failed: target is readonly.`,
    target,
  )
  return true
}

function readonlyDelete(target: object, key: string | symbol): boolean {
  warn(
    `Delete operation on key "${String(key)}" failed: target is readonly.`,
    target,
  )
  return true
}

// ---------------------------------------------------------------
// 四件套导出
// ---------------------------------------------------------------

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys,
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set: readonlySet,
  deleteProperty: readonlyDelete,
  has,
  ownKeys,
}

export const shallowReactiveHandlers: ProxyHandler<object> = {
  get: shallowGet,
  set: shallowSet,
  deleteProperty,
  has,
  ownKeys,
}

export const shallowReadonlyHandlers: ProxyHandler<object> = {
  get: shallowReadonlyGet,
  set: readonlySet,
  deleteProperty: readonlyDelete,
  has,
  ownKeys,
}