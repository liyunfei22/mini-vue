/**
 * vShow.ts —— v-show 运行时指令
 * 对应真 Vue packages/runtime-dom/src/directives/vShow.ts。
 * 用 display 显隐，不销毁 DOM（与 v-if 的区别）。
 */
import type { ObjectDirective } from './vModel'

/** 记住元素的原始 display，恢复时用（避免 style="display:flex" 这类显式 display 被覆盖成空串） */
const vShowOriginalDisplay = Symbol('_vod')

function setDisplay(el: HTMLElement, value: unknown) {
  el.style.display = value ? (el as any)[vShowOriginalDisplay] : 'none'
}

export const vShow: ObjectDirective<HTMLElement> = {
  mounted(el, { value }) {
    // 原始 display 是 none 的记为空串（尊重 CSS 里的 display 规则）
    ;(el as any)[vShowOriginalDisplay] = el.style.display === 'none' ? '' : el.style.display
    setDisplay(el, value)
  },
  updated(el, { value, oldValue }) {
    if (value === oldValue) return
    setDisplay(el, value)
  },
  beforeUnmount(el) {
    setDisplay(el, true)
  },
}