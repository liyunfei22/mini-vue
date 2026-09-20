/**
 * h.ts —— 渲染函数世界里的「createElement」
 *
 * 对应真 Vue packages/runtime-core/src/h.ts。
 * h 只是 createVNode 的语法糖，麻烦在于「参数歧义」：
 *   h('div')                        // 只有 type
 *   h('div', props)                 // 只有 props
 *   h('div', children)              // 第二个参数是 children（数组/字符串/vnode）
 *   h('div', props, children)       // 完整
 *   h('div', props, c1, c2, c3)     // 多余参数 → 合并成 children 数组
 */
import { isArray, isObject } from '@mini-vue/shared'
import { createVNode, isVNode, type VNode } from './vnode'

export function h(type: any, propsOrChildren?: any, children?: any): VNode {
  const l = arguments.length
  if (l === 2) {
    if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
      if (isVNode(propsOrChildren)) {
        // h('div', vnode) → 只有一个 child
        return createVNode(type, null, [propsOrChildren])
      }
      // h('div', { id: 'a' }) → 第二个参数是 props
      return createVNode(type, propsOrChildren)
    } else {
      // h('div', 'hello') / h('div', [vnode…]) → 第二个参数是 children
      return createVNode(type, null, propsOrChildren)
    }
  } else {
    if (l > 3) {
      // h('div', props, c1, c2, c3) → children = [c1, c2, c3]
      children = Array.prototype.slice.call(arguments, 2)
    } else if (l === 3 && isVNode(children)) {
      children = [children]
    }
    return createVNode(type, propsOrChildren, children)
  }
}