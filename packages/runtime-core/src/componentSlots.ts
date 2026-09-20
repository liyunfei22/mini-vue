/**
 * componentSlots.ts —— 插槽初始化与归一化
 *
 * 对应真 Vue packages/runtime-core/src/componentSlots.ts。
 *
 * 父组件把 children 传成「插槽对象」：
 *   h(Child, null, { header: () => h('div', '标题'), default: 'hello' })
 * 子组件 instance.slots 里固定存「函数形态」的插槽：
 *   slots.default(props?) => vnode[]
 * 这样渲染端统一用 `renderSlot(slots, name, props)` 取用；静态插槽也被包成函数
 * 以统一「scoped slot 可能有 props」的形态。
 */
import { isArray, isFunction, ShapeFlags } from '@mini-vue/shared'
import { normalizeVNode, type VNode, type VNodeArrayChildren, type VNodeChild } from './vnode'
import type { ComponentInternalInstance } from './component'
import type { Data } from './component'

/** 归一化后的插槽表：key → (props?) => VNode[] */
export type Slots = Readonly<Record<string, Slot>>
export type Slot = (...args: any[]) => VNode[]
export type InternalSlots = Record<string, Slot | undefined>
export type RawSlots = Data & {
  $stable?: boolean
  _ctx?: any
}

/**
 * 组件 vnode 的 children 若是「插槽对象」（shapeFlag & SLOTS_CHILDREN），
 * 逐项折叠成函数形态存入 instance.slots。
 */
export function initSlots(instance: ComponentInternalInstance, children: unknown): void {
  if (instance.vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    normalizeObjectSlots(children as RawSlots, (instance.slots as InternalSlots))
  }
}

/**
 * 子组件更新时刷新 slots（父组件重渲染传来的新插槽对象结构可能变了。
 * mini：直接重建。真 Vue 还做了 dynamic/stable 优化）。
 */
export function updateSlots(instance: ComponentInternalInstance, children: unknown): void {
  const { vnode, slots } = instance
  if (vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    normalizeObjectSlots(children as RawSlots, slots as InternalSlots)
  } else {
    // 不再是插槽形态 → 清空
    const keys = Object.keys(slots)
    for (let i = 0; i < keys.length; i++) {
      delete slots[keys[i]]
    }
    delete slots._default
  }
}

function normalizeObjectSlots(rawSlots: RawSlots, slots: InternalSlots) {
  for (const key in rawSlots) {
    const value = rawSlots[key]
    if (isFunction(value)) {
      // scoped slot：已经是函数，直接收下（renderSlot 调用它时传 props）
      slots[key] = (props?: any) => normalizeSlotValue(value(props))
    } else if (value != null) {
      // 静态插槽：包成函数，不接收 props
      const normalized = normalizeSlotValue(value as VNodeChild)
      slots[key] = () => normalized
    }
  }
}

/** vnode / vnode[] → 统一成 vnode[] */
export function normalizeSlotValue(value: VNodeChild): VNode[] {
  return isArray(value) ? (value as VNodeArrayChildren).map(normalizeVNode) : [normalizeVNode(value)]
}