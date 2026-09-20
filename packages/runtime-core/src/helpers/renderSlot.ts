/**
 * renderSlot.ts —— 渲染插槽的辅助函数
 *
 * 对应真 Vue packages/runtime-core/src/helpers/renderSlot.ts。
 *
 * 子组件模板/渲染里的 `<slot :msg="..." />` 编译后调用它：
 *   renderSlot(slots, 'default', { msg }, fallback)
 * 即：取 slots 里的函数插槽 → 喂 props（scoped slot 数据）→ 归一化成 vnode。
 */
import { normalizeVNode, createVNode, Comment, Fragment, type VNode } from '../vnode'
import type { Slots } from '../componentSlots'
import type { VNodeProps } from '../vnode'

export function renderSlot(
  slots: Slots,
  name: string,
  props: VNodeProps | null = null,
  fallback?: VNode[],
): VNode {
  const slot = slots[name]

  if (slot) {
    // 函数插槽：把 scoped 数据传进去，得到 vnode 数组
    const slotContent = slot(props || {})
    // 单子节点不加 Fragment 锚点（与真 Vue 单插槽行为一致）
    return normalizeVNode(slotContent.length === 1 ? slotContent[0] : slotContent)
  }

  // 没有这个插槽 → 渲染 fallback（如果编译期给了）
  if (fallback) {
    return normalizeVNode(fallback)
  }

  return createVNode(Comment, null, 'v-if') as any
}