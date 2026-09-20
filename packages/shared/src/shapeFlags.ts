/**
 * ShapeFlags —— VNode 类型的位运算标记
 *
 * 用「位或」组合出 vnode 同时具备的多个属性（比如既是 ELEMENT 又有 TEXT_CHILDREN），
 * 运行时用「位与」做 O(1) 判定。这是 Vue 用位运算做性能优化的经典例子，
 * 真源码在 runtime-core/src/vnode.ts。阶段 3（runtime-core）才会用到它，
 * 阶段 1 只需要 placeholder，先放在 shared 供共享。
 *
 * 位说明（从低到高）：
 *   1  << 0 = ELEMENT            普通 DOM 元素
 *   1  << 1 = FUNCTIONAL         函数式组件（mini 不实现，保留位）
 *   1  << 2 = STATEFUL_COMPONENT 有状态组件
 *   1  << 3 = TEXT_CHILDREN      children 是文本
 *   1  << 4 = ARRAY_CHILDREN     children 是数组
 *   1  << 5 = SLOTS_CHILDREN     组件 children 是插槽对象
 *   1  << 6 = TELEPORT           Teleport（mini 不实现）
 *   1  << 7 = SUSPENSE           Suspense（mini 不实现）
 *   ... 后续位为编译期优化标记
 */

export const enum ShapeFlags {
  ELEMENT = 1,
  FUNCTIONAL_COMPONENT = 1 << 1,
  STATEFUL_COMPONENT = 1 << 2,
  TEXT_CHILDREN = 1 << 3,
  ARRAY_CHILDREN = 1 << 4,
  SLOTS_CHILDREN = 1 << 5,
  TELEPORT = 1 << 6,
  SUSPENSE = 1 << 7,
  COMPONENT_SHOULD_KEEP_ALIVE = 1 << 8,
  COMPONENT_KEPT_ALIVE = 1 << 9,
  COMPONENT = ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.FUNCTIONAL_COMPONENT,
}