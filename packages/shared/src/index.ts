/**
 * @mini-vue/shared —— 跨包共享的运行时工具与常量
 *
 * 对应真 Vue 仓库里的 packages/shared/src/index.ts。
 * 这里只收录「类型/工具函数 + 常量」，原则：
 *   1. 符合直觉、无副作用；
 *   2. 名与语义和真 Vue 保持一致（方便对照源码）；
 *   3. 按需扩展——当前只放响应式阶段（Stage 1）需要的。
 */

export { ShapeFlags } from './shapeFlags'

// ---------------------------------------------------------------
// 构建标记
// 真 Vue 在构建期通过 definePlugin 注入开发/生产两个版本；
// mini 实现所有环境都带 dev 检查与 console.warn，这里固定为 true。
// ---------------------------------------------------------------
export const __DEV__ = true

// ---------------------------------------------------------------
// 类型判断
// ---------------------------------------------------------------

const objectToString = Object.prototype.toString

/** 判断任意值是不是对象（含数组/函数，因为 typeof null 是 'object' 需先排除 null） */
export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

/** 判断任意值是不是普通对象 `{}`（排除数组/Map/Date/正则等，靠 toString 打标） */
export const isPlainObject = (val: unknown): val is Record<any, any> => {
  return toTypeString(val) === '[object Object]'
}

/** 返回 `[object Xxx]` 形式的类型打标，用于 isPlainObject 一类判型 */
export const toTypeString = (value: unknown): string =>
  objectToString.call(value)

/** 去掉 `[object Xxx]` 的前后缀，得到内建类型名：'Object' / 'Map' / 'Set' / 'Symbol' … */
export const toRawType = (value: unknown): string => {
  return toTypeString(value).slice(8, -1)
}

export const isFunction = (val: unknown): val is Function =>
  typeof val === 'function'

export const isString = (val: unknown): val is string => typeof val === 'string'

export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'

export const isArray = Array.isArray

export const isMap = (val: unknown): val is Map<any, any> =>
  toTypeString(val) === '[object Map]'

export const isSet = (val: unknown): val is Set<any> =>
  toTypeString(val) === '[object Set]'

/** 是不是「数组的整数下标」这种字符串 key（'0'、'3'…），供 set prop / ref 解包用 */
export const isIntegerKey = (key: unknown) =>
  isString(key) &&
  key !== 'NaN' &&
  key[0] !== '-' &&
  '' + parseInt(key, 10) === key

export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
  return isObject(val) && isFunction((val as any).then) && isFunction((val as any).catch)
}

// ---------------------------------------------------------------
// 对象 / 属性工具
// ---------------------------------------------------------------

const hasOwnProperty = Object.prototype.hasOwnProperty

export const hasOwn = (val: object, key: string | symbol): key is keyof typeof val =>
  hasOwnProperty.call(val, key)

/** 浅比较两个值是否不同（Object.is 语义，NaN 视为相同） */
export const hasChanged = (value: any, oldValue: any): boolean =>
  !Object.is(value, oldValue)

/** 以非枚举方式给对象定义属性 —— reactive markRaw 打 SKIP 标就用它 */
export const def = (obj: object, key: string | symbol, value: any) => {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: false,
    value,
  })
}

export const extend = Object.assign

/** 根据一组 key 生成「包含判断函数」的高阶工厂（编译器/事件系统大量用到） */
export const makeMap = (str: string, expectsLowerCase?: boolean): ((key: string) => boolean) => {
  const map: Record<string, boolean> = Object.create(null)
  const list: string[] = str.split(',')
  for (let i = 0; i < list.length; i++) {
    map[list[i]] = true
  }
  return expectsLowerCase ? (val) => !!map[val.toLowerCase()] : (val) => !!map[val]
}

// ---------------------------------------------------------------
// 常量（语义与真 Vue 对齐，避免各处魔法值/魔法对象）
// ---------------------------------------------------------------

export const EMPTY_OBJ: { readonly [key: string]: any } = __DEV__ ? Object.freeze({}) : {}

export const EMPTY_ARR: readonly any[] = __DEV__ ? Object.freeze([]) : []

/** 空函数，作为默认值（NOOP = No OPeration） */
export const NOOP = () => {}