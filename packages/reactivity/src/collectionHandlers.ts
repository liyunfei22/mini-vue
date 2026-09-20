/**
 * collectionHandlers.ts —— Map / Set / WeakMap / WeakSet 的专属 Proxy get 拦截
 *
 * 对应真 Vue packages/reactivity/src/collectionHandlers.ts。
 *
 * ## 为什么集合不能用 baseHandlers？
 * 1. **内部槽（internal slot）**：Map.prototype.get 等读 `this` 的 [[MapData]] 内部槽，
 *    而 proxy 转发时 `this` 是代理不是真实 Map —— 直接反射调用会抛
 *    “Method get Map.prototype.get called on incompatible receiver”。
 * 2. **结构操作需要翻译成 track/trigger**：`size` 读 → track ITERATE_KEY；
 *    `set(k,v)`/`add(v)` → 按「是否已存在」定 ADD or SET；迭代器要包一层以便
 *    每个 next() 都被 `wrap` 成响应式值且被追踪。
 *
 * ## 实现策略（与真 Vue 一致）
 *   拦截器只实现 `get`：把「方法/属性访问」从 真实集合 改道到一个叫
 *   `instrumentations`（仪器表）的对象上 —— 上面挂着换过血的方法版本（叫 instrumented）。
 *   例如 `map.get(k)` → get trap 发现 key='get' 且真实 target 上也有 'get' →
 *   `Reflect.get(instrumentations, 'get', receiver)` 返回 instrumented get，
 *   用 `this = map 代理` 再次调用。
 */
import {
  capitalize,
  extend,
  hasChanged,
  hasOwn,
  isMap,
} from '@mini-vue/shared'
import {
  isReadonly,
  isShallow,
  toRaw,
  toReactive,
  toReadonly,
  type Target,
} from './reactive'
import { track, trigger } from './effect'
import {
  ITERATE_KEY,
  MAP_KEY_ITERATE_KEY,
  ReactiveFlags,
  TrackOpTypes,
  TriggerOpTypes,
} from './operations'
import { warn } from './warning'

// 类型别名（可读性用）
type IterableCollections = (Map<any, any> | Set<any>) & Target
type WeakCollections = (WeakMap<any, any> | WeakSet<any>) & Target
type CollectionTypes = IterableCollections | WeakCollections
type MapTypes = (Map<any, any> | WeakMap<any, any>) & Target
type SetTypes = (Set<any> | WeakSet<any>) & Target

const toShallow = <T extends unknown>(value: T): T => value

const getProto = <T extends CollectionTypes>(v: T): any =>
  Reflect.getPrototypeOf(v) as {
    has: (key: unknown) => boolean
    get: (key: unknown) => unknown
  }

/**
 * 迭代器方法工厂（keys/values/entries/[Symbol.iterator]）。
 * 包一层外壳迭代器：外层 `next()` 时用 wrap 把吐出的每个值转成对应的
 * 代理形态（reactive/readonly/shallow），并在此前 track 一次：
 *   - Map 的 keys()       → track MAP_KEY_ITERATE_KEY（只关心键集合变化）
 *   - 其余（含 Set）       → track ITERATE_KEY
 */
function createIterableMethod(
  method: string | symbol,
  isReadonly: boolean,
  isShallow: boolean,
) {
  return function (
    this: IterableCollections,
    ..._args: unknown[]
  ): Iterable<unknown> & Iterator<unknown> {
    const target = this[ReactiveFlags.RAW]
    const rawTarget = toRaw(target)
    const targetIsMap = isMap(rawTarget)
    const isPair =
      method === 'entries' || (method === Symbol.iterator && targetIsMap)
    const isKeyOnly = method === 'keys' && targetIsMap
    const innerIterator = (target as any)[method](..._args)
    const wrap = isShallow
      ? toShallow
      : isReadonly
        ? toReadonly
        : toReactive

    !isReadonly &&
      track(
        rawTarget,
        TrackOpTypes.ITERATE,
        isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY,
      )

    return extend(Object.create(innerIterator), {
      next() {
        const { value, done } = innerIterator.next()
        return done
          ? { value, done }
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
              done,
            }
      },
    })
  }
}

/** 只读集合的写方法：警告 + 按操作类型返回“安全值” */
function createReadonlyMethod(type: TriggerOpTypes): Function {
  return function (this: CollectionTypes, ...args: unknown[]) {
    const key = args[0] ? `on key "${String(args[0])}" ` : ``
    warn(
      `${capitalize(type)} operation ${key}failed: target is readonly.`,
      toRaw(this),
    )
    return type === TriggerOpTypes.DELETE
      ? false
      : type === TriggerOpTypes.CLEAR
        ? undefined
        : this
  }
}

type Instrumentations = Record<string | symbol, Function | number>

/**
 * 仪器表：所有换过血的集合方法。readonly/shallow 两个开关决定
 * wrap 用 toReadonly/toShallow 还是 toReactive，以及 `get` 是否还是纯读。
 */
function createInstrumentations(
  readonly: boolean,
  shallow: boolean,
): Instrumentations {
  const instrumentations: Instrumentations = {
    // map.get(key)：读值 → track 并返回「被代理的值」
    get(this: MapTypes, key: unknown) {
      const target = this[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const rawKey = toRaw(key)
      if (!readonly) {
        // 传入的是 reactive key 时，key 与 rawKey 都要追踪（跟真 Vue 一致）
        if (hasChanged(key, rawKey)) {
          track(rawTarget, TrackOpTypes.GET, key)
        }
        track(rawTarget, TrackOpTypes.GET, rawKey)
      }
      const proto = getProto(rawTarget)
      const wrap = shallow ? toShallow : readonly ? toReadonly : toReactive
      if (proto.has.call(rawTarget, key)) {
        return wrap(target.get(key))
      } else if (proto.has.call(rawTarget, rawKey)) {
        return wrap(target.get(rawKey))
      } else if (target !== rawTarget) {
        // readonly(reactive(map))：让里层 reactive Map 自己再做一次 get（自行追踪）
        target.get(key)
      }
    },
    // map.size：追踪整个集合的变化（任何增删都影响 size）
    get size() {
      const target = (this as unknown as IterableCollections)[ReactiveFlags.RAW]
      !readonly && track(toRaw(target), TrackOpTypes.ITERATE, ITERATE_KEY)
      return target.size
    },
    has(this: CollectionTypes, key: unknown) {
      const target = this[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const rawKey = toRaw(key)
      if (!readonly) {
        if (hasChanged(key, rawKey)) {
          track(rawTarget, TrackOpTypes.HAS, key)
        }
        track(rawTarget, TrackOpTypes.HAS, rawKey)
      }
      // 键可能是 reactive 包裹过，也有可能是裸对象 → 两个都查
      return key === rawKey
        ? target.has(key)
        : target.has(key) || target.has(rawKey)
    },
    forEach(this: IterableCollections, callback: Function, thisArg?: unknown) {
      const observed = this
      const target = observed[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const wrap = shallow ? toShallow : readonly ? toReadonly : toReactive
      !readonly && track(rawTarget, TrackOpTypes.ITERATE, ITERATE_KEY)
      return target.forEach((value: unknown, key: unknown) => {
        // 回调收到的是「被代理的值 + 被代理的键」，且 this/第三个参数是响应式集合
        return callback.call(thisArg, wrap(value), wrap(key), observed)
      })
    },
  }

  extend(
    instrumentations,
    readonly
      ? {
          add: createReadonlyMethod(TriggerOpTypes.ADD),
          set: createReadonlyMethod(TriggerOpTypes.SET),
          delete: createReadonlyMethod(TriggerOpTypes.DELETE),
          clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
        }
      : {
          // set.add(value)：有则不再触达，无则 ADD 并 trigger
          add(this: SetTypes, value: unknown) {
            const target = toRaw(this)
            const proto = getProto(target)
            const rawValue = toRaw(value)
            const valueToAdd =
              !shallow && !isShallow(value) && !isReadonly(value)
                ? rawValue
                : value
            const hadKey =
              proto.has.call(target, valueToAdd) ||
              (hasChanged(value, valueToAdd) &&
                proto.has.call(target, value)) ||
              (hasChanged(rawValue, valueToAdd) &&
                proto.has.call(target, rawValue))
            if (!hadKey) {
              target.add(valueToAdd)
              trigger(target, TriggerOpTypes.ADD, valueToAdd, valueToAdd)
            }
            return this
          },
          // map.set(k,v)：ADD（新增键）或 SET（覆盖值），并保证键用裸对象
          set(this: MapTypes, key: unknown, value: unknown) {
            if (!shallow && !isShallow(value) && !isReadonly(value)) {
              value = toRaw(value)
            }
            const target = toRaw(this)
            const { has, get } = getProto(target)

            let hadKey = has.call(target, key)
            if (!hadKey) {
              key = toRaw(key)
              hadKey = has.call(target, key)
            }

            const oldValue = get.call(target, key)
            target.set(key, value)
            if (!hadKey) {
              trigger(target, TriggerOpTypes.ADD, key, value)
            } else if (hasChanged(value, oldValue)) {
              trigger(target, TriggerOpTypes.SET, key, value, oldValue)
            }
            return this
          },
          delete(this: CollectionTypes, key: unknown) {
            const target = toRaw(this)
            const proto = getProto(target)
            let hadKey = proto.has.call(target, key)
            if (!hadKey) {
              key = toRaw(key)
              hadKey = proto.has.call(target, key)
            }
            const oldValue = proto.get
              ? proto.get.call(target, key)
              : undefined
            const result = target.delete(key)
            if (hadKey) {
              trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
            }
            return result
          },
          clear(this: IterableCollections) {
            const target = toRaw(this)
            const hadItems = target.size !== 0
            const result = target.clear()
            if (hadItems) {
              trigger(target, TriggerOpTypes.CLEAR)
            }
            return result
          },
        },
  )

  // 迭代方法统一挂仪器表
  const iteratorMethods = [
    'keys',
    'values',
    'entries',
    Symbol.iterator,
  ] as const
  iteratorMethods.forEach((method) => {
    instrumentations[method] = createIterableMethod(method, readonly, shallow)
  })

  return instrumentations
}

/**
 * 集合 get 拦截器：短路 ReactiveFlags 后，命中仪器表就返回仪器表上的
 * 方法（this 保持 receiver = 代理）；否则原样反射 target（如 map.foo）。
 */
function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
  const instrumentations = createInstrumentations(isReadonly, shallow)

  return (target: CollectionTypes, key: string | symbol, receiver: any) => {
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.RAW) {
      return target
    }
    return Reflect.get(
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver,
    )
  }
}

export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(false, false),
}

export const shallowCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(false, true),
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(true, false),
}

export const shallowReadonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(true, true),
}