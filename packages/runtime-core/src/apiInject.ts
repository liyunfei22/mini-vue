/**
 * apiInject.ts —— provide / inject
 *
 * 对应真 Vue packages/runtime-core/src/apiInject.ts。
 *
 * 核心数据结构：instance.provides。默认继承父级：
 *   instance.provides 初始 = parent.provides（同一引用）
 * 一旦本组件第一次 provide(key)，就「以父 provides 为原型」新造一个：
 *   instance.provides = Object.create(parentProvides)
 * 于是 inject(key) 只需从「自己的 provides 开始沿原型链查找」——
 * 祖先链上每一层 provide 过的 key 都是可访问的，且创建成本 O(1)。
 * （这就是「原型链注入」。）
 *
 * 为什么会话初衷：库用 provide(Symbol, 实例) 注入内部对象，任意深层组件 inject 即得
 * （如路由/状态库给组件注入当前路由与 store 实例）。
 */
import type { ComponentInternalInstance } from './component'
import { getCurrentInstance } from './currentInstance'
import { isFunction } from '@mini-vue/shared'

export type InjectionKey<T> = symbol & { __isInjectionKey?: true }

export interface AppProvides {
  [key: string | symbol]: any
}

export function provide<T>(key: InjectionKey<T> | string | number, value: T): void {
  const instance = getCurrentInstance()
  if (instance) {
    let provides = instance.provides
    const parentProvides = instance.parent && instance.parent.provides

    // 首次 provide：以父 provides 为原型新建一个（否则会污染父级）
    if (parentProvides === provides) {
      provides = instance.provides = Object.create(parentProvides)
    }

    provides[key as string] = value
  } else if (__DEV__) {
    console.warn(`[mini-vue] provide() can only be used inside setup().`)
  }
}

export function inject<T>(key: InjectionKey<T> | string): T | undefined
export function inject<T>(key: InjectionKey<T> | string, defaultValue: T): T
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: () => T,
  treatDefaultAsFactory: true,
): T
export function inject(
  key: InjectionKey<any> | string,
  defaultValue?: unknown,
  treatDefaultAsFactory = false,
): unknown {
  const instance = getCurrentInstance()

  if (instance) {
    // 从根级的 instance.vnode.appContext 兜底（真 Vue：root 的 app-level provides）
    const provides =
      instance.parent == null
        ? instance.vnode.appContext && instance.vnode.appContext.provides
        : instance.parent.provides

    if (provides && (key as string | symbol) in provides) {
      return provides[key as string]
    } else if (arguments.length > 1) {
      // 工厂默认值：treatDefaultAsFactory=true 时调用函数取结果（对象/数组默认值每次独立实例）
      return treatDefaultAsFactory && isFunction(defaultValue)
        ? (defaultValue as (proxy: any) => unknown)(instance.proxy)
        : defaultValue
    }
  }
  // mini：inject 在外面调用静默返回 undefined（真 Vue 会 warn）
  return undefined
}

export const __DEV__ = true