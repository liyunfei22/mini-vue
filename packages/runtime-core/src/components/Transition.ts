/**
 * Transition.ts —— 过渡组件（mini 简版）
 *
 * 用法：<Transition><div v-if="show">…</div></Transition>
 *
 * 简版只处理「单个元素子节点」的 CSS class 过渡（真 Vue 还有组件/多节点/Fragment、
 * 查出离开/进入组合、JS 钩子等，均在此裁剪）。
 * 类名约定（与真 Vue 一致）：v-enter-from / v-enter-active / v-enter-to /
 *                              v-leave-from / v-leave-active / v-leave-to
 */
import {
  normalizeVNode,
  type VNode,
} from '../vnode'
import type { TransitionHooks } from './BaseTransition'
import { nextFrame, whenTransitionEnds } from './BaseTransition'

export interface TransitionProps {
  name?: string
  duration?: number
}

export const Transition = {
  name: 'Transition',
  props: {
    name: { type: String, default: 'v' },
    duration: { type: Number, default: 300 },
  },
  setup(props: TransitionProps, { slots }: any) {
    return () => {
      const children = slots.default && slots.default()
      const child = Array.isArray(children) && children.length === 1 ? children[0] : undefined
      const el = child && (child as VNode)

      // 只给「单元素」挂过渡钩子；组件/多节点简版不处理
      if (el && typeof el.type === 'string') {
        el.transition = createTransitionHooks(props as TransitionProps)
      }

      return el || null
    }
  },
}

function createTransitionHooks(props: TransitionProps): TransitionHooks {
  const prefix = props.name || 'v'
  const duration = props.duration ?? 300

  const classNames = {
    enterFrom: `${prefix}-enter-from`,
    enterActive: `${prefix}-enter-active`,
    enterTo: `${prefix}-enter-to`,
    leaveFrom: `${prefix}-leave-from`,
    leaveActive: `${prefix}-leave-active`,
    leaveTo: `${prefix}-leave-to`,
  }

  return {
    beforeEnter(el: HTMLElement) {
      el.classList.add(classNames.enterFrom, classNames.enterActive)
    },
    enter(el: HTMLElement) {
      const done = () => {
        el.classList.remove(classNames.enterTo, classNames.enterActive, classNames.enterFrom)
      }
      nextFrame(() => {
        el.classList.remove(classNames.enterFrom)
        el.classList.add(classNames.enterTo)
        whenTransitionEnds(el, done, duration)
      })
    },
    leave(el: HTMLElement, done: () => void) {
      el.classList.add(classNames.leaveFrom, classNames.leaveActive)
      const finish = () => {
        el.classList.remove(classNames.leaveFrom, classNames.leaveActive, classNames.leaveTo)
        done()
      }
      nextFrame(() => {
        el.classList.remove(classNames.leaveFrom)
        el.classList.add(classNames.leaveTo)
        whenTransitionEnds(el, finish, duration)
      })
    },
  }
}

export function normalizeTransitionChild(vnode: VNode): VNode | null {
  return normalizeVNode(vnode) as VNode
}