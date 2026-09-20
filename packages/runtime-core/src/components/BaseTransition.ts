/**
 * BaseTransition.ts —— 过渡的公共辅助
 *
 * 对应真 Vue packages/runtime-core/src/components/BaseTransition.ts 的必要子集。
 *
 * 设计：Transition 是「给单个元素子 vnode 挂 transition 钩子的包装组件」。
 * 渲染器在 mount/unmount 时调用 vnode.transition：
 *   beforeEnter(el)  —— insert 前（设置 enter-from 样式类）
 *   enter(el)        —— insert 后（下一帧切 enter-to，动画结束清类）
 *   leave(el, done)  —— 卸载时（加 leave 类，动画/超时后才真正 remove）
 *
 * 由于 jsdom/测试环境没有真实 CSS transitionend，用 timeout 兜底（真 Vue 也有 timeout 机制）。
 */

export interface TransitionHooks<HostElement = any> {
  beforeEnter(el: HostElement): void
  enter(el: HostElement): void
  leave(el: HostElement, done: () => void): void
}

export function nextFrame(cb: () => void) {
  // jsdom 无真实 rAF 压力：统一用双 setTimeout 近似「下一帧」
  setTimeout(() => {
    setTimeout(cb, 0)
  }, 0)
}

/** 过渡结束判定：transitionend 事件或超时（Element 无 addEventListener 特性时直接超时） */
export function whenTransitionEnds(
  el: Element | null,
  done: () => void,
  timeout: number,
) {
  if (!el) {
    done()
    return
  }
  let resolved = false
  const finish = () => {
    if (!resolved) {
      resolved = true
      cleanup()
      done()
    }
  }
  const cleanup = () => {
    el.removeEventListener('transitionend', finish)
    clearTimeout(timer as any)
  }
  el.addEventListener('transitionend', finish)
  const timer = setTimeout(finish, timeout)
}

// 过渡相关 CSS 类名（真 Vue 同款）
const TRANSITION_BASE = '-leave-active' // 哨兵；真正类名组装见 Transition.ts
export { TRANSITION_BASE }