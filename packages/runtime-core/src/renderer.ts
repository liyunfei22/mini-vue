/**
 * renderer.ts —— 渲染器
 *
 * 对应真 Vue packages/runtime-core/src/renderer.ts。
 *
 * createRenderer(options)：生产一个「平台无关」的渲染器 —— options 提供所有
 * 宿主操作（createElement/insert/remove/patchProp…）。runtime-dom 组装出 options
 * 再调用它，得到 DOM 版渲染器；这会话副作用等于：renderer 不知 DOM，DOM 也不
 * 管 vnode。传输协议只有 VNode。
 *
 * 核心循环：
 *   render(vnode, container)
 *     → patch(null, vnode, container)         建树（初次）
 *     → patch(n1, n2, container)              对比
 *   patch 按 vnode.type / shapeFlag 分发 6 路：
 *     Text / Comment / Fragment / ELEMENT / COMPONENT / （Teleport etc. mini 无）
 *   每次"长内容"的入口都是 mountComponent：
 *     createComponentInstance → setupComponent → setupRenderEffect
 *   setupRenderEffect = instance.update = effect(componentUpdateFn, { scheduler })
 *     —— 响应式依赖变 → scheduler 把 update 送进 job 队列 → 微任务里重渲染。
 *     「响应式 ↔ 渲染器」的正循环就此咬合。
 *
 * 阶段 3 简化（都写注释，阶段 4 替换）：
 *   - patchChildren 全量重建（不做 keyed diff）
 *   - 事件监听用朴素 add/remove（不做 invoker 缓存）
 *   - 无 keepAlive/teleport/suspense/transition
 */
import { EMPTY_OBJ, isArray, ShapeFlags } from '@mini-vue/shared'
import { effect } from '@mini-vue/reactivity'
import { createComponentInstance, setupComponent } from './component'
import { renderComponentRoot } from './componentRenderUtils'
import { queueJob, queuePostFlushCb } from './scheduler'
import { updateSlots } from './componentSlots'
import { Text, Comment, Fragment, isSameVNodeType, normalizeVNode } from './vnode'
import { createAppAPI } from './apiCreateApp'
import type { ComponentInternalInstance, Data } from './component'
import type { VNode } from './vnode'

// ---------------------------------------------------------------
// 宿主操作接口（平台注入点）
// ---------------------------------------------------------------

export interface RendererOptions<HostNode = any, HostElement = any> {
  patchProp(el: HostElement, key: string, prevValue: any, nextValue: any): void
  insert(child: HostNode, parent: HostElement, anchor?: HostNode | null): void
  remove(child: HostNode): void
  createElement(type: string): HostElement
  createText(text: string): HostNode
  createComment(text: string): HostNode
  setText(node: HostNode, text: string): void
  setElementText(el: HostElement, text: string): void
  parentNode(node: HostNode): HostElement | null
  nextSibling(node: HostNode): HostNode | null
}

type HostNode<T> = T extends RendererOptions<any, infer H> ? H : any

// ---------------------------------------------------------------
// 渲染器组装
// ---------------------------------------------------------------

export function createRenderer<HostNode, HostElement>(
  options: RendererOptions<HostNode, HostElement>,
) {
  return baseCreateRenderer(options)
}

function baseCreateRenderer(options: RendererOptions) {
  const {
    patchProp: hostPatchProp,
    insert: hostInsert,
    remove: hostRemove,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
  } = options

  // /** post-flush 生命周期钩子（onMounted 等） */
  const queuePostRenderEffect = queuePostFlushCb

  // -------------------------------------------------------------
  // 入口：把 vnode 渲染进容器
  // -------------------------------------------------------------

  const render: (vnode: VNode | null, container: any) => void = (vnode, container) => {
    if (vnode == null) {
      // 卸载旧树
      if (container._vnode) {
        unmount(container._vnode)
      }
    } else {
      patch(container._vnode || null, vnode, container, null, null)
    }
    container._vnode = vnode
  }

  // -------------------------------------------------------------
  // patch：同层比较的入口
  // -------------------------------------------------------------

  function patch(
    n1: VNode | null,
    n2: VNode,
    container: any,
    anchor: any = null,
    parentComponent: ComponentInternalInstance | null = null,
    isSVG = false,
  ) {
    if (n1 === n2) return

    const { type, shapeFlag } = n2

    // 类型或 key 变了 → 丢弃旧节点整树，当新节点处理
    // 关键：先在「旧节点的位置」算出锚点再卸载 —— 卸载后旧节点已从 DOM 摘除，
    // 拿它的 nextSibling/el 做 anchor 会抛 NotFoundError（真 Vue 同样先取 anchor）
    if (n1 && !isSameVNodeType(n1, n2)) {
      anchor = getNextHostNode(n1)
      unmount(n1, parentComponent)
      n1 = null
    }

    switch (type) {
      case Text:
        processText(n1, n2, container, anchor)
        break
      case Comment:
        processCommentNode(n1, n2, container, anchor)
        break
      case Fragment:
        processFragment(n1, n2, container, anchor, parentComponent)
        break
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          processElement(n1, n2, container, anchor, parentComponent, isSVG)
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          processComponent(n1, n2, container, anchor, parentComponent)
        }
    }
  }

  // -------------------------------------------------------------
  // 文本 / 注释 / 片段
  // -------------------------------------------------------------

  function processText(n1: VNode | null, n2: VNode, container: any, anchor: any) {
    if (n1 == null) {
      n2.el = hostCreateText(n2.children as string)
      hostInsert(n2.el, container, anchor)
    } else {
      const el = (n2.el = n1.el!)
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }

  function processCommentNode(n1: VNode | null, n2: VNode, container: any, anchor: any) {
    if (n1 == null) {
      n2.el = hostCreateComment((n2.children as string) ?? '')
      hostInsert(n2.el, container, anchor)
    } else {
      // 注释节点不做内容 diff
      n2.el = n1.el
    }
  }

  function processFragment(
    n1: VNode | null,
    n2: VNode,
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    if (n1 == null) {
      // startAnchor + endAnchor 围起真实内容
      n2.el = hostCreateComment('')
      n2.anchor = hostCreateComment('')
      hostInsert(n2.el, container, anchor)
      hostInsert(n2.anchor, container, anchor)
      mountChildren(n2.children as any[], container, n2.anchor, parentComponent)
    } else {
      n2.el = n1.el
      n2.anchor = n1.anchor
      patchChildren(n1, n2, container, n2.anchor, parentComponent)
    }
  }

  // -------------------------------------------------------------
  // 元素
  // -------------------------------------------------------------

  function processElement(
    n1: VNode | null,
    n2: VNode,
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
    _isSVG: boolean,
  ) {
    if (n1 == null) {
      mountElement(n2, container, anchor, parentComponent)
    } else {
      patchElement(n1, n2, parentComponent)
    }
  }

  function mountElement(
    vnode: VNode,
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    let el = (vnode.el = hostCreateElement(vnode.type as string))
    const { props, shapeFlag } = vnode

    // 子节点：文本 or 数组
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      hostSetElementText(el, vnode.children as string)
    } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      mountChildren(vnode.children as any[], el, null, parentComponent)
    }

    // 属性
    if (props) {
      for (const key in props) {
        if (key !== 'key' && key !== 'ref') {
          hostPatchProp(el, key, null, props[key])
        }
      }
    }

    hostInsert(el, container, anchor)
  }

  function mountChildren(
    children: any[],
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    for (let i = 0; i < children.length; i++) {
      const child = normalizeVNode(children[i])
      children[i] = child
      patch(null, child, container, anchor, parentComponent, false)
    }
  }

  function patchElement(
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
  ) {
    const el = (n2.el = n1.el!)
    const oldProps = (n1.props || EMPTY_OBJ) as Data
    const newProps = (n2.props || EMPTY_OBJ) as Data

    // props diff —— 阶段 3 用朴素逐 key 比较（阶段 4 引入 invoker 与更多优化）
    if (oldProps !== newProps) {
      for (const key of Object.keys(newProps)) {
        if (key !== 'key' && key !== 'ref' && newProps[key] !== oldProps[key]) {
          hostPatchProp(el, key, oldProps[key], newProps[key])
        }
      }
      for (const key of Object.keys(oldProps)) {
        if (key !== 'key' && key !== 'ref' && !(key in newProps)) {
          hostPatchProp(el, key, oldProps[key], null)
        }
      }
    }

    patchChildren(n1, n2, el, null, parentComponent)
  }

  /**
   * children diff —— 阶段 3 简化：全量重建。
   * （阶段 4 会替换为真正的 keyed diff + LIS）
   */
  function patchChildren(
    n1: VNode,
    n2: VNode,
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    const c1 = n1.children
    const c2 = n2.children

    // 旧子树卸载
    if (isArray(c1)) {
      for (let i = 0; i < (c1 as any[]).length; i++) {
        unmount((c1 as any[])[i] as VNode, parentComponent)
      }
    }

    // 新子树挂载
    if (isArray(c2)) {
      mountChildren(c2 as any[], container, anchor, parentComponent)
    } else if (typeof c2 === 'string') {
      if (c1 !== c2) {
        hostSetElementText(container, c2)
      }
    }
  }

  // -------------------------------------------------------------
  // 组件
  // -------------------------------------------------------------

  function processComponent(
    n1: VNode | null,
    n2: VNode,
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    if (n1 == null) {
      mountComponent(n2, container, anchor, parentComponent)
    } else {
      updateComponent(n1, n2)
    }
  }

  function mountComponent(
    initialVNode: VNode,
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    const instance = (initialVNode.component = createComponentInstance(initialVNode, parentComponent))

    setupComponent(instance)

    setupRenderEffect(instance, initialVNode, container, anchor)
  }

  function setupRenderEffect(
    instance: ComponentInternalInstance,
    initialVNode: VNode,
    container: any,
    anchor: any,
  ) {
    const componentUpdateFn = () => {
      if (!instance.isMounted) {
        // ---------- MOUNT ----------
        // beforeMount 钩子
        invokeHooks(instance, 'bm')

        const subTree = (instance.subTree = renderComponentRoot(instance))
        patch(null, subTree, container, anchor, instance)
        initialVNode.el = subTree.el

        // onMounted：等渲染完（post flush）统一执行
        queuePostRenderEffect(() => invokeHooks(instance, 'm'))

        instance.isMounted = true
      } else {
        // ---------- UPDATE ----------
        // 关键是：响应式依赖变 → 触发 instance.update （经 scheduler 进队列）
        if (instance.next) {
          // 父级驱动更新：把 next vnode 的 props/attrs/slots 应用到实例
          applyPreUpdate(instance, instance.next)
        }

        const prevTree = instance.subTree
        const nextTree = renderComponentRoot(instance)
        instance.subTree = nextTree

        // beforeUpdate 钩子
        invokeHooks(instance, 'bu')

        patch(
          prevTree,
          nextTree,
          hostParentNode(prevTree.el!),
          getNextHostNode(prevTree),
          instance,
        )
        ;(nextTree as VNode).el = nextTree.el as any

        // onUpdated 钩子
        queuePostRenderEffect(() => invokeHooks(instance, 'u'))
      }
    }

    const update: SchedulerJob = (instance.update = effect(componentUpdateFn, {
      // 重要：调度器让它走 job 队列（微任务批量刷新），而不是同步重渲染
      scheduler: () => queueJob(update),
      allowRecurse: true,
    }) as any)

    update.id = instance.uid
  }

  /** 父驱动更新：把 next vnode 并入 instance（props/attrs/slots 重算） */
  function applyPreUpdate(instance: ComponentInternalInstance, nextVNode: VNode) {
    instance.vnode = nextVNode
    instance.next = null

    // 1. props 原地 diff（保留 shallowReactive 身份：读旧 props 的依赖才能被触发）
    const props = instance.props as Data
    const nextProps = (nextVNode.props || EMPTY_OBJ) as Data
    for (const key in nextProps) {
      if (props[key] !== nextProps[key]) {
        props[key] = nextProps[key]
      }
    }
    for (const key in props) {
      if (key !== 'key' && !(key in nextProps)) {
        delete props[key]
      }
    }

    // 2. attrs 重建（未声明为 prop 的父级属性）
    const options = instance.propsOptions
    const attrs: Data = {}
    for (const key in nextProps) {
      if (key === 'key' || key === 'ref') continue
      if (options && key in props) continue
      attrs[key] = nextProps[key]
    }
    instance.attrs = attrs

    // 3. slots 更新
    updateSlots(instance, nextVNode.children)
  }

  function updateComponent(n1: VNode, n2: VNode) {
    const instance = (n2.component = n1.component!) as ComponentInternalInstance
    if (shouldUpdateComponent(n1, n2)) {
      // 有变化：挂 next，触发更新（经 scheduler 异步执行）
      instance.next = n2
      instance.update()
    } else {
      // 无变化：直接透传 el
      n2.el = n1.el
      instance.vnode = n2
    }
  }

  /** mini 版判断是否需要更新（真 Vue 还有 patchFlag/优化位通道） */
  function shouldUpdateComponent(prevVNode: VNode, nextVNode: VNode): boolean {
    const prevProps = prevVNode.props || EMPTY_OBJ
    const nextProps = nextVNode.props || EMPTY_OBJ
    return !shallowEqualProps(prevProps, nextProps)
  }

  // -------------------------------------------------------------
  // 卸载
  // -------------------------------------------------------------

  function unmount(
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null = null,
    doRemove = true,
  ) {
    const { shapeFlag } = vnode

    if (shapeFlag & ShapeFlags.COMPONENT) {
      unmountComponent(vnode.component!, parentComponent)
    } else {
      if (vnode.type === Fragment) {
        unmountFragment(vnode, parentComponent)
      } else {
        if (doRemove) {
          hostRemove(vnode.el)
        }
      }
    }
  }

  function unmountComponent(
    instance: ComponentInternalInstance,
    parentComponent: ComponentInternalInstance | null = null,
  ) {
    // beforeUnmount 钩子（unmounted 走 post flush）
    invokeHooks(instance, 'bum')
    // 停止实例 scope：连带停掉 setup 期创建的 effect/computed
    instance.scope.stop()

    const { subTree, um } = instance
    unmount(subTree, instance)

    if (um && um.length) {
      queuePostRenderEffect(() => invokeHooks(instance, 'um'))
    }

    instance.isMounted = false
  }

  function unmountFragment(vnode: VNode, parentComponent: ComponentInternalInstance | null) {
    const children = vnode.children
    if (isArray(children)) {
      for (let i = 0; i < (children as any[]).length; i++) {
        unmount((children as any[])[i] as VNode, parentComponent)
      }
    }
    if (vnode.el) hostRemove(vnode.el)
    if (vnode.anchor) hostRemove(vnode.anchor)
  }

  // -------------------------------------------------------------
  // 图形工具
  // -------------------------------------------------------------

  function invokeHooks(instance: ComponentInternalInstance, type: 'bm' | 'm' | 'bu' | 'u' | 'bum' | 'um') {
    const hooks = instance[type]
    if (hooks && hooks.length) {
      for (let i = 0; i < hooks.length; i++) {
        ;(hooks[i] as Function)()
      }
    }
  }

  /** 找「prevTree 后面紧邻的宿主锚点」：组件递归下钻，片段取 anchor */
  function getNextHostNode(vnode: VNode): any {
    if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      return getNextHostNode(vnode.component!.subTree)
    }
    // 返回「紧随其后的兄弟节点」而非自身 —— 因为调用方要先取 anchor 再卸载旧节点，
    // 旧节点卸载后自已已不在 DOM，兄弟节点才仍然有效（真 Vue 同逻辑）
    return hostNextSibling((vnode.anchor || vnode.el)!)
  }

  // -------------------------------------------------------------
  // createApp 装配
  // -------------------------------------------------------------

  return {
    render,
    createApp: createAppAPI(render),
  }
}

// ---- 模块级小工具 ----

function shallowEqualProps(a: Data, b: Data): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false
  }
  return true
}

type SchedulerJob = { id?: number; flags?: number } & ((...args: any[]) => any)