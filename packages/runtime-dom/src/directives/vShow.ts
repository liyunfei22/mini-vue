/**
 * vShow.ts —— v-show 运行时指令
 * 对应真 Vue packages/runtime-dom/src/directives/vShow.ts。
 * 用 display 显隐，不销毁 DOM（与 v-if 的区别）。
 */
import type { ObjectDirective } from './vModel'

export const vShow: ObjectDirective<HTMLElement> = {
  mounted(el, { value }, _vnode) {
    if (!value) {
      el.style.display = 'none'
    }
  },
  updated(el, { value }, _vnode, prevVNode) {
    // 只有值变化才动样式
    if (value !== prevVNode.props?.['v-show-value'] && value) {
      el.style.display = '' // 恢复
    } else if (!value) {
      el.style.display = 'none'
    }
  },
}