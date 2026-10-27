/**
 * renderSlot.ts —— 渲染插槽的辅助函数
 *
 * 对应真 Vue packages/runtime-core/src/helpers/renderSlot.ts。
 *
 * 子组件模板/渲染里的 `<slot :msg="..." />` 编译后调用它：
 *   renderSlot(slots, 'default', { msg }, fallback, noSlotted)
 * 即：取 slots 里的函数插槽 → 喂 props（scoped slot 数据）→ 归一化成 vnode。
 *
 * noSlotted（编译产物第 5 参）由 transformSlotOutlet 在「scoped 且模板没用 :slotted」
 * 时输出 true：省掉多余的 data-v-xxx-s 属性（真实 Vue 的优化路径，见 transformSlotOutlet）。
 */
import { normalizeVNode, createVNode, Comment, Fragment, type VNode } from '../vnode'
import type { Slots } from '../componentSlots'
import type { VNodeProps } from '../vnode'
import { currentScopeId } from '../componentRenderContext'

export function renderSlot(
  slots: Slots,
  name: string,
  props: VNodeProps | null = null,
  fallback?: VNode[],
  noSlotted?: boolean,
): VNode {
  const slot = slots[name]

  if (slot) {
    // 函数插槽：把 scoped 数据传进去，得到 vnode 数组
    // （编译产物的插槽函数已被 withCtx 包过——执行期间渲染上下文切回父组件，
    //  插槽内容 vnode 带的是父组件的 scopeId，而不是当前子组件的）
    const slotContent = slot(props || {})
    // 单子节点不加 Fragment 锚点（与真 Vue 单插槽行为一致）
    const rendered = normalizeVNode(
      slotContent.length === 1 ? slotContent[0] : slotContent,
    )

    // :slotted() 链路的运行时半段：把「当前渲染组件（=子组件）的 scopeId + '-s'」
    // 挂到插槽内容容器上。mount 时 setScopeId 会把它打成 data-v-子-s=""，
    // 子组件的 :slotted(.x) scoped 规则（编译成 .x[data-v-子-s]）才能命中。
    //
    // 真 Vue 对单内容也恒包 Fragment（-s 挂在 Fragment 上、随 mountChildren 参数线程
    // 化传导到全部后代元素）；mini 单内容返回裸 vnode，-s 直接挂 vnode.slotScopeIds
    // 字段，只有容器元素自己携带（后代不携带的差异已文档化，见 juejin2 对应文章）。
    if (!noSlotted && currentScopeId) {
      rendered.slotScopeIds = [currentScopeId + '-s']
    }
    return rendered
  }

  // 没有这个插槽 → 渲染 fallback（如果编译期给了）
  if (fallback) {
    return normalizeVNode(fallback)
  }

  return createVNode(Comment, null, 'v-if') as any
}