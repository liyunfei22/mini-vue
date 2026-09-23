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

/**
 * PatchFlags —— 编译期标记「该 vnode 哪些部分是动态的」
 * （真 Vue packages/shared/src/patchFlags.ts；mini 用到的子集）
 * 渲染器据此跳过静态 diff：
 *   TEXT(1)     —— children 是动态文本（{{ x }}）
 *   CLASS(2)    —— class 动态
 *   STYLE(4)    —— style 动态
 *   PROPS(8)    —— 部分 props 动态（dynamicProps 列具体键）
 *   FULL_PROPS(16) —— 全部 props 动态
 *   HOISTED(-1) —— 静态提升，永不再 patch
 *   BAIL(-2)    —— 编译失败，回退全量 diff
 */
export const enum PatchFlags {
  TEXT = 1,
  CLASS = 1 << 1,
  STYLE = 1 << 2,
  PROPS = 1 << 3,
  FULL_PROPS = 1 << 4,
  NEED_HYDRATION = 1 << 5,
  STABLE_FRAGMENT = 1 << 6,
  KEYED_FRAGMENT = 1 << 7,
  UNKEYED_FRAGMENT = 1 << 8,
  DYNAMIC_SLOTS = 1 << 9,
  HOISTED = -1,
  BAIL = -2,
}

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

/** 'foo' → 'Foo'（警告文案等场合用） */
export const capitalize = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1)

/** 'foo-bar' → 'fooBar'（事件/attribute 名驼峰化） */
export const camelize = (str: string): string =>
  str.replace(/-(\w)/g, (_, c) => (c ? c.toUpperCase() : ''))

/** 'fooBar' → 'foo-bar'（驼峰转中线） */
export const hyphenate = (str: string): string =>
  str.replace(/\B([A-Z])/g, '-$1').toLowerCase()

/** 'click' → 'onClick'（事件 handler 名） */
export const toHandlerKey = (str: string): string => (str ? `on${capitalize(str)}` : ``)

/** 是不是 onXxx 形式的事件名 */
export const isOn = (key: string): boolean =>
  key.charCodeAt(0) === 111 /* o */ &&
  key.charCodeAt(1) === 110 /* n */ &&
  // uppercase letter
  (key.charCodeAt(2) > 122 || key.charCodeAt(2) < 97)

/** 宽松转数字：v-model.number 用（parseFloat NaN 时返回原值，与真 Vue 一致） */
export const looseToNumber = (val: any): any => {
  const n = parseFloat(val)
  return isNaN(n) ? val : n
}

export const toDisplayString = (val: unknown): string => {
  return val == null
    ? ''
    : isObject(val)
      ? JSON.stringify(val, replacer, 2)
      : String(val)
}

const replacer = (_key: string, val: unknown) => {
  if (isMap(val)) {
    return {
      [`Map(${val.size})`]: [...val.entries()].reduce(
        (entries, [key, val2], i) => {
          ;(entries as any)[`${i}`] = { key, value: val2 }
          return entries
        },
        {},
      ),
    }
  } else if (isSet(val)) {
    return {
      [`Set(${val.size})`]: [...val.values()],
    }
  } else {
    // 普通对象/数组/标量：原样返回，交给外层 JSON.stringify 的自然递归，
    // 绝不能在这里再 stringify —— 否则 replacer 对根对象再进一次 stringify，无限递归栈溢出。
    return val
  }
}

/** 把字符串/数组/对象形式的 class 归一化成字符串 */
export function normalizeClass(value: unknown): string {
  let res = ''
  if (isString(value)) {
    res = value
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const normalized = normalizeClass(value[i])
      if (normalized) res += normalized + ' '
    }
  } else if (isObject(value)) {
    for (const name in value) {
      if (value[name]) res += name + ' '
    }
  }
  return res.trim()
}

/** 把对象/字符串形式的 style 归一化成对象（数组形式简化拼接） */
export function normalizeStyle(value: unknown): Record<string, any> | string {
  if (isArray(value)) {
    const res: Record<string, any> = {}
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      const normalized = isString(item) ? parseStringStyle(item) : item
      if (normalized) extend(res, normalized)
    }
    return res
  }
  if (isString(value)) {
    return parseStringStyle(value)
  }
  return value as Record<string, any>
}

export function parseStringStyle(cssText: string): Record<string, any> {
  const ret: Record<string, any> = {}
  cssText.split(';').forEach((item) => {
    if (item) {
      const single = item.split(':')
      const key = single.shift()!.trim()
      const value = single.join(':').trim()
      if (key && value) ret[key] = value
    }
  })
  return ret
}

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