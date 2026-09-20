/**
 * renderList.ts —— v-for 的运行时助手
 * 对应真 Vue packages/runtime-core/src/helpers/renderList.ts。
 * 编译器输出 `_renderList(list, (item, index) => ...)`，运行时迭代 source 产出 vnode 数组。
 */
import { extend, isArray, isString, isObject } from '@mini-vue/shared'
import { createVNode, Fragment, type VNode, type VNodeChild } from '../vnode'

export function renderList(
  source: any,
  renderItem: (...args: any[]) => VNodeChild,
  cache?: any[],
  index?: number,
): VNode[] {
  let ret: VNode[] = []
  let i: any, l: number, keys: string[]

  if (isArray(source) || isString(source)) {
    for (i = 0, l = source.length; i < l; i++) {
      ret.push(renderItem(source[i], i, i) as VNode)
    }
  } else if (typeof source === 'number') {
    for (i = 0; i < source; i++) {
      ret.push(renderItem(i + 1, i) as VNode)
    }
  } else if (isObject(source)) {
    const iterable = (source as any)[Symbol.iterator]
    if (typeof iterable === 'function') {
      ret = extend([], [...(source as Iterable<any>)], true as any) as any
      ;(ret as any).forEach((item: any, i: number) => {
        if (typeof item === 'string' || typeof item === 'object') {
          ret[i] = renderItem(item, i, i) as any
        } else {
          throw new TypeError(`Invalid v-for range value.`)
        }
      })
    } else {
      keys = Object.keys(source)
      for (i = 0, l = keys.length; i < l; i++) {
        const key = keys[i]
        ret.push(renderItem(source[key], key, i) as VNode)
      }
    }
  }

  return ret
}

export { Fragment, createVNode }