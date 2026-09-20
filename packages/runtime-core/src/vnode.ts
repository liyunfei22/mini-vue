/**
 * vnode.ts —— 虚拟节点
 *
 * 对应真 Vue packages/runtime-core/src/vnode.ts。
 *
 * vnode 是对「用户描述的一棵树的一格」的纯数据快照：
 *   type       string(元素名)| Function/Option(组件) | Text | Comment | Fragment
 *   props      key/ref/class/style/事件/attr…
 *   key        列表 diff 与组件复用的唯一标识
 *   shapeFlag  位图，标记 vnode 能力（ELEMENT/COMPONENT/TEXT_/ARRAY_ 子级…）
 *   el         挂载后指向真实 DOM/组件根（渲染器的「出物」通道）
 *   component  组件实例（组件 vnode 专用，「vnode.component」是把子树接回实例的钩子）
 *   ctx        创建此 vnode 时的当前渲染组件（供子组件回查父级）
 *
 * 注意 mini 每条注释标注了真 Vue 有但我们暂不实现的字段（dynamicChildren/patchFlag 等
 * 编译期优化在阶段 4/5 引入）。
 */
import {
  isArray,
  isFunction,
  isObject,
  isString,
  ShapeFlags,
} from '@mini-vue/shared'
import type { ComponentInternalInstance } from './component'
import type { Data } from './component'

// 用独立 Symbol（而非 Symbol.for）避免与「同进程里加载的真 Vue」类型撞车
export const Fragment = Symbol('mini-fragment') as any
export const Text = Symbol('mini-text') as any
export const Comment = Symbol('mini-comment') as any
export const Static = Symbol('mini-static') as any

export interface VNodeProps {
  key?: string | number | symbol
  [key: string]: any
}

export type VNodeChildAtom =
  | VNode
  | string
  | number
  | boolean
  | null
  | undefined
  | void
export type VNodeArrayChildren = Array<VNodeArrayChildren | VNodeChildAtom>
export type VNodeChild = VNodeChildAtom | VNodeArrayChildren
export type VNodeNormalizedChildren = string | VNodeArrayChildren | Data | null

export interface VNode<HostNode = any, HostElement = any, ExtraProps = Data> {
  __v_isVNode: true
  __v_skip: true
  type: any
  props: (VNodeProps & ExtraProps) | null
  key: VNodeProps['key'] | null
  ref: any
  children: VNodeNormalizedChildren
  component: ComponentInternalInstance | null
  // DOM/输出物
  el: HostNode | null
  anchor: HostNode | null // Fragment 的尾部锚点
  // 位图与编译优化（mini 阶段 3 只用到 shapeFlag）
  shapeFlag: number
  patchFlag: number
  dynamicProps: string[] | null
  dynamicChildren: (VNode[] & { hasOnce?: boolean }) | null | undefined
  // 应用/组件上下文
  appContext: any
  ctx: ComponentInternalInstance | null
  dirs: any
  transition: any
  scopeId: string | null
  slotScopeIds: string[] | null
  suspense: any
  staticCount: number
}

export const isVNode = (val: any): val is VNode =>
  val ? val.__v_isVNode === true : false

export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  return n1.type === n2.type && n1.key === n2.key
}

/**
 * 低层建 vnode（含 children 归一化）。真 Vue 还在此收集 dynamicChildren 参与 block 树，
 * mini 不做（阶段 4 提到 block 概念，dep 使其透明化即可）。
 */
function createBaseVNode(
  type: any,
  props: Data | null = null,
  children: unknown = null,
  patchFlag = 0,
  dynamicProps: string[] | null = null,
  shapeFlag: number = type === Fragment ? 0 : ShapeFlags.ELEMENT,
  needFullChildrenNormalization = false,
): VNode {
  const vnode: VNode = {
    __v_isVNode: true,
    __v_skip: true,
    type,
    props,
    key: props && props.key != null ? (props.key as any) : null,
    ref: props && props.ref != null ? (props.ref as any) : null,
    children: children as VNodeNormalizedChildren,
    component: null,
    el: null,
    anchor: null,
    shapeFlag,
    patchFlag,
    dynamicProps,
    dynamicChildren: null,
    appContext: null,
    ctx: null, // 由渲染上下文设置（mini 简化，阶段 5 编译器需要再接线）
    dirs: null,
    transition: null,
    scopeId: null,
    slotScopeIds: null,
    suspense: null,
    staticCount: 0,
  }

  if (needFullChildrenNormalization) {
    normalizeChildren(vnode, children)
  } else if (children) {
    // 编译产物路径：children 只能是 string 或 Array
    vnode.shapeFlag |= isString(children)
      ? ShapeFlags.TEXT_CHILDREN
      : ShapeFlags.ARRAY_CHILDREN
  }

  return vnode
}

/**
 * 公开的 createVNode：
 *   h('div', { id: 'a' }, 'hello')
 *   h(Component, props, { default: () => ... })
 * 传入已有 vnode → 克隆并合并 props。
 */
export const createVNode = _createVNode

function _createVNode(
  type: any,
  props: Data | null = null,
  children: unknown = null,
  patchFlag = 0,
  dynamicProps: string[] | null = null,
  isBlockNode = false,
): VNode {
  if (!type) {
    type = Comment
  }

  if (isVNode(type)) {
    // <component :is="vnode"/> —— 克隆已有 vnode 合并 props
    const cloned = cloneVNode(type as VNode, props, true)
    if (children) {
      normalizeChildren(cloned, children)
    }
    return cloned
  }

  // class/style 归一化（真 Vue 还处理 reactive props 克隆）
  if (props) {
    props = guardReactiveProps(props)
  }

  // 位图编码：string → 元素；object/function → 组件
  const shapeFlag = isString(type)
    ? ShapeFlags.ELEMENT
    : isObject(type)
      ? ShapeFlags.STATEFUL_COMPONENT
      : isFunction(type)
        ? ShapeFlags.STATEFUL_COMPONENT // mini 不区分函数式组件
        : 0

  return createBaseVNode(
    type,
    props,
    children,
    patchFlag,
    dynamicProps,
    shapeFlag,
    true,
  )
}

/** props 若是响应式代理，克隆一份普通对象（避免把 proxy 直接挂进 vnode） */
export function guardReactiveProps(props: Data | null): Data | null {
  if (!props) return null
  return isReactiveProxy(props) ? { ...props } : props
}
function isReactiveProxy(val: any): boolean {
  // 简单判型：真 Vue 用 isProxy；mini 从 shared 直接看 __v_raw（避免依赖环）
  return !!(val && val.__v_raw)
}

export function cloneVNode<T>(vnode: VNode, extraProps?: Data | null, _mergeRef = false): VNode<T> {
  const { props, children, type } = vnode
  const mergedProps = extraProps ? { ...props, ...extraProps } : props
  const cloned: VNode = {
    __v_isVNode: true,
    __v_skip: true,
    type,
    props: mergedProps,
    key: mergedProps && mergedProps.key != null ? mergedProps.key : vnode.key,
    ref: vnode.ref,
    children,
    component: vnode.component,
    el: vnode.el,
    anchor: vnode.anchor,
    shapeFlag: vnode.shapeFlag,
    patchFlag: vnode.patchFlag,
    dynamicProps: vnode.dynamicProps,
    dynamicChildren: vnode.dynamicChildren,
    appContext: vnode.appContext,
    ctx: vnode.ctx,
    dirs: vnode.dirs,
    transition: vnode.transition,
    scopeId: vnode.scopeId,
    slotScopeIds: vnode.slotScopeIds,
    suspense: vnode.suspense,
    staticCount: vnode.staticCount,
  }
  return cloned as any
}

export function createTextVNode(text = ' ', flag = 0): VNode {
  return createVNode(Text, null, text, flag)
}

export function createCommentVNode(text = '', _asBlock = false): VNode {
  return createVNode(Comment, null, text)
}

/**
 * children 归一化：统一 vnode.children 的形态并打上对应 shapeFlag 位。
 *   string/number → TEXT_CHILDREN
 *   array         → ARRAY_CHILDREN
 *   object/函数   → 组件时视为插槽对象 SLOTS_CHILDREN；元素时归一成单个 vnode
 */
export function normalizeChildren(vnode: VNode, children: unknown): void {
  let type = 0
  const { shapeFlag } = vnode
  if (children == null) {
    children = null
  } else if (isArray(children)) {
    type = ShapeFlags.ARRAY_CHILDREN
  } else if (typeof children === 'object') {
    if (shapeFlag & ShapeFlags.ELEMENT) {
      // 元素：对象 children 先归一成 vnode 再按数组处理
      normalizeVNode(children as VNodeChild)
      type = ShapeFlags.ARRAY_CHILDREN
      ;(children as any) = [children]
    } else {
      // 组件：对象 = 插槽（若 entry 都是 vnode，则视同数组）
      type = ShapeFlags.SLOTS_CHILDREN
    }
  } else if (isFunction(children)) {
    // 组件：函数 children = scoped slot 的默认插槽
    type = ShapeFlags.SLOTS_CHILDREN
  } else {
    children = String(children)
    type = ShapeFlags.TEXT_CHILDREN
  }
  vnode.children = children as VNodeNormalizedChildren
  vnode.shapeFlag |= type
}

/**
 * child 归一化成 vnode：
 *   null/boolean → Comment（占位）
 *   array        → Fragment
 *   string/number→ Text
 *   已归一 vnode → 原样（或 clone）
 */
export function normalizeVNode(child: VNodeChild): VNode {
  if (child == null || typeof child === 'boolean') {
    return createVNode(Comment)
  } else if (isArray(child)) {
    return createVNode(Fragment, null, child.slice())
  } else if (typeof child === 'object') {
    return child as VNode
  } else {
    return createVNode(Text, null, String(child))
  }
}

/**
 * 空 children 归一化：把用户给的「slots 对象」逐项折叠成函数形态，
 * 让渲染阶段统一 `renderSlot(slots, name, props)` 调用。
 */
export function isVNodeArrayChildren(v: unknown): v is VNodeArrayChildren {
  return isArray(v) && (v.length === 0 || isVNode(v[0]))
}