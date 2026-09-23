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
import { EMPTY_ARR, EMPTY_OBJ, isArray, PatchFlags, ShapeFlags } from '@mini-vue/shared'
import { effect } from '@mini-vue/reactivity'
import { createComponentInstance, setupComponent } from './component'
import { renderComponentRoot } from './componentRenderUtils'
import { queueJob, queuePostFlushCb } from './scheduler'
import { updateSlots } from './componentSlots'
import { Text, Comment, Fragment, isSameVNodeType, normalizeVNode } from './vnode'
import { getSequence } from './sequence'
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
  /** KeepAlive 的隐藏/显示（runtime-dom 注入 el.style.toggle） */
  hideNode?(el: HostElement): void
  showNode?(el: HostElement): void
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
    // KeepAlive 隐藏/显示（可选，未注入则使用空操作）
    hideNode: hostHideNode = () => {},
    showNode: hostShowNode = () => {},
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
      const fchildren = isArray(n2.children) ? n2.children : [n2.children as any]
      mountChildren(fchildren, container, n2.anchor, parentComponent)
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
      // 编译路径 createElementVNode 对「单个 vnode children」只打 ARRAY 位不包数组
      // → 统一归一：非数组包装成单元素数组（真 Vue 的 mountChildren 也吃单 vnode）
      const children = isArray(vnode.children) ? vnode.children : [vnode.children as any]
      mountChildren(children, el, null, parentComponent)
    }

    // 属性
    if (props) {
      for (const key in props) {
        if (key !== 'key' && key !== 'ref') {
          hostPatchProp(el, key, null, props[key])
        }
      }
    }

    // Transition：insert 前挂 enter-from 类
    vnode.transition && vnode.transition.beforeEnter(el)
    hostInsert(el, container, anchor)

    // 指令 mounted 钩子（v-model/v-show 等）
    invokeDirectiveHook(vnode, null, parentComponent, 'mounted')

    // Transition：insert 后触发 enter 动画
    vnode.transition && vnode.transition.enter(el)
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
    const patchFlag = n2.patchFlag
    const dynamicProps = n2.dynamicProps

    // ---- 7-3 props 动态路径（编译期标记驱动）----
    if (oldProps !== newProps) {
      const hasDynamicFlag = patchFlag & (PatchFlags.CLASS | PatchFlags.STYLE | PatchFlags.PROPS | PatchFlags.FULL_PROPS)
      if (patchFlag === PatchFlags.BAIL || !hasDynamicFlag) {
        // 无优化标记：朴素全量 diff（回退路径，保证安全）
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
      } else {
        // CLASS / STYLE 独立处理（真 Vue 同款：这两类不住 dynamicProps 名单）
        if (patchFlag & PatchFlags.CLASS) {
          hostPatchProp(el, 'class', oldProps['class'], newProps['class'])
        }
        if (patchFlag & PatchFlags.STYLE) {
          hostPatchProp(el, 'style', oldProps['style'], newProps['style'])
        }
        // PROPS：按编译期声明的名单逐个 diff
        if (patchFlag & PatchFlags.PROPS) {
          const keys = dynamicProps || EMPTY_ARR
          for (const key of keys) {
            if (key === 'class' || key === 'style') continue
            if (newProps[key] !== oldProps[key]) {
              hostPatchProp(el, key, oldProps[key], newProps[key])
            }
          }
          for (const key of keys) {
            if (key === 'class' || key === 'style') continue
            if (!(key in newProps)) {
              hostPatchProp(el, key, oldProps[key], null)
            }
          }
        }
        // FULL_PROPS：全键（但要排除 key/ref/class/style 防重）
        if (patchFlag & PatchFlags.FULL_PROPS) {
          for (const key of new Set([...Object.keys(newProps), ...Object.keys(oldProps)])) {
            if (key === 'key' || key === 'ref' || key === 'class' || key === 'style') continue
            if (newProps[key] !== oldProps[key]) {
              hostPatchProp(el, key, oldProps[key], newProps[key])
            }
          }
        }
      }
    }

    patchChildrenAndBlock(n1, n2, el, parentComponent)

    // 指令 updated 钩子（beforeUpdate 在 patchChildren 前触发更贴合语义，mini 简化到 updated）
    invokeDirectiveHook(n2, n1, parentComponent, 'updated')
  }

  /**
   * 7-3 children 快速路径：
   *   - 块更新：dynamicChildren 都在 → 只 patch 动态节点（跳过整棵 diff）
   *   - TEXT flag：children 是动态文本 → setText
   *   否则回退全量三态 diff
   */
  function patchChildrenAndBlock(
    n1: VNode,
    n2: VNode,
    el: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    const patchFlag = n2.patchFlag

    // 块快速路径（root 与所有有 dynamicChildren 的块）
    // 守卫：dynamicChildren 必须「非空 + 等长」才升，否则回退全量 diff——
    //  `<div>{{x}}</div>` 这类根自身是动态（TEXT 位）但无独立动态子节点的情况，
    //  块快速路径会漏更新根自己的文本；真 Vue 在 dynamicChildren 为空时同样落全量。
    if (
      n1.dynamicChildren &&
      n2.dynamicChildren &&
      (n2.dynamicChildren as any[]).length > 0 &&
      (n1.dynamicChildren as any[]).length === (n2.dynamicChildren as any[]).length
    ) {
      patchBlockChildren(n1, n2, el, parentComponent)
      return
    }

    // TEXT 快速路径
    if ((patchFlag & PatchFlags.TEXT) && typeof n2.children === 'string') {
      if (n1.children !== n2.children) {
        hostSetElementText(el, n2.children)
      }
      return
    }

    patchChildren(n1, n2, el, null, parentComponent)
  }

  function patchBlockChildren(
    n1: VNode,
    n2: VNode,
    fallbackContainer: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    const oldDyn = (n1.dynamicChildren || []) as VNode[]
    const newDyn = (n2.dynamicChildren || []) as VNode[]
    for (let i = 0; i < newDyn.length; i++) {
      patch(oldDyn[i], newDyn[i], fallbackContainer, null, parentComponent)
    }
  }

  /**
   * children diff —— 阶段 4：按「文本/数组/其他」三态分流
   *   文本↔文本 → setText；数组↔数组 → keyed diff（patchKeyedChildren）；
   *   其余 → 卸载旧 + 挂载新
   */
  function patchChildren(
    n1: VNode,
    n2: VNode,
    container: any,
    anchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    const c1 = n1.children as any
    const c2 = n2.children as any
    const prevShapeFlag = n1.shapeFlag
    const nextShapeFlag = n2.shapeFlag

    // 新 children 是文本：全部替换成文本
    if (nextShapeFlag & ShapeFlags.TEXT_CHILDREN) {
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(c1, parentComponent)
      }
      if (c2 !== c1) {
        hostSetElementText(container, c2)
      }
    } else {
      // 新 children 非文本
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        if (nextShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // 编译路径单 vnode children 只打 ARRAY 位不包数组 → 统一转数组（见 mountElement 注）
          const prevArr = isArray(c1) ? c1 : [c1]
          const nextArr = isArray(c2) ? c2 : [c2]
          // 数组 ↔ 数组 → 走 keyed diff
          patchKeyedChildren(prevArr, nextArr, container, anchor, parentComponent)
        } else {
          // 数组 → 空：全卸载（同样考虑单对象形状）
          unmountChildren(isArray(c1) ? c1 : [c1], parentComponent)
        }
      } else {
        // 旧是文本（或空）：先清空再挂新
        if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
          hostSetElementText(container, '')
        }
        if (nextShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(c2, container, anchor, parentComponent)
        }
      }
    }
  }

  function unmountChildren(children: any[], parentComponent: ComponentInternalInstance | null) {
    for (let i = 0; i < children.length; i++) {
      unmount(children[i] as VNode, parentComponent)
    }
  }

  /**
   * keyed children —— 真 Vue 的五步算法：
   *   1. 从头同步（前缀相同节点直接 patch）
   *   2. 从尾同步（后缀相同节点直接 patch）
   *   3. 若「全在尾部新增」→ 顺序挂载锚点之前
   *   4. 若「尾部被删」→ 批量卸载
   *   5. 中间未知区：键表 keyToNewIndexMap + 新老映射 newIndexToOldIndexMap
   *      → moved 判定 → LIS 找出不动节点 → 从后往前移动/挂载
   * 详细图解见 docs/04。
   */
  function patchKeyedChildren(
    c1: VNode[],
    c2: any[],
    container: any,
    parentAnchor: any,
    parentComponent: ComponentInternalInstance | null,
  ) {
    let i = 0
    const l2 = c2.length
    let e1 = c1.length - 1
    let e2 = l2 - 1

    // 1. 同步前缀：左右开头的同型节点直接 patch
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = (c2[i] = normalizeVNode(c2[i]))
      if (isSameVNodeType(n1, n2)) {
        patch(n1, n2, container, null, parentComponent)
      } else {
        break
      }
      i++
    }

    // 2. 同步后缀
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1]
      const n2 = (c2[e2] = normalizeVNode(c2[e2]))
      if (isSameVNodeType(n1, n2)) {
        patch(n1, n2, container, null, parentComponent)
      } else {
        break
      }
      e1--
      e2--
    }

    // 3. 旧节点耗尽：剩余的(新)全是新增 → 挂载
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1
        const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
        while (i <= e2) {
          patch(null, (c2[i] = normalizeVNode(c2[i])), container, anchor, parentComponent)
          i++
        }
      }
    }
    // 4. 新节点耗尽：剩余(旧)全是删除 → 卸载
    else if (i > e2) {
      while (i <= e1) {
        unmount(c1[i], parentComponent)
        i++
      }
    }
    // 5. 中间未知区（乱序）
    else {
      const s1 = i
      const s2 = i

      // 5.1 新 children 的 key → 新下标 映射表
      const keyToNewIndexMap: Map<any, number> = new Map()
      for (i = s2; i <= e2; i++) {
        const nextChild = (c2[i] = normalizeVNode(c2[i]))
        if (nextChild.key != null) {
          keyToNewIndexMap.set(nextChild.key, i)
        }
      }

      // 5.2 遍历旧 children：用 key 或「同型无 key」对新下标
      let j
      let patched = 0
      const toBePatched = e2 - s2 + 1
      let moved = false
      let maxNewIndexSoFar = 0
      // newIndexToOldIndexMap[newIndex-s2] = oldIndex+1（+1 是为了 0 表示“新节点”）
      const newIndexToOldIndexMap = new Array(toBePatched)
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0

      for (i = s1; i <= e1; i++) {
        const prevChild = c1[i]
        if (patched >= toBePatched) {
          // 新节点全 patch 完了，剩下的旧节点只能删除
          unmount(prevChild, parentComponent)
          continue
        }
        let newIndex
        if (prevChild.key != null) {
          newIndex = keyToNewIndexMap.get(prevChild.key)
        } else {
          // 无 key：在新区里找一个「同型且还没被占位」的
          for (j = s2; j <= e2; j++) {
            if (newIndexToOldIndexMap[j - s2] === 0 && isSameVNodeType(prevChild, c2[j])) {
              newIndex = j
              break
            }
          }
        }
        if (newIndex === undefined) {
          unmount(prevChild, parentComponent)
        } else {
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex
          } else {
            moved = true
          }
          patch(prevChild, c2[newIndex] as VNode, container, null, parentComponent)
          patched++
        }
      }

      // 5.3 移动 + 挂载：只有 moved 才算 LIS；从后往前，用「后一个已就位的节点」当锚点
      const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : EMPTY_ARR
      j = increasingNewIndexSequence.length - 1
      for (i = toBePatched - 1; i >= 0; i--) {
        const nextIndex = s2 + i
        const nextChild = c2[nextIndex] as VNode
        const anchor = nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor

        if (newIndexToOldIndexMap[i] === 0) {
          // 新节点 → 挂载
          patch(null, nextChild, container, anchor, parentComponent)
        } else if (moved) {
          // 不在 LIS 里的节点才需要移动
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor)
          } else {
            j--
          }
        }
      }
    }
  }

  /** 把一个已挂载的节点（可能跨组件递归到其根）在 container 里移动到 anchor 前 */
  function move(vnode: VNode, container: any, anchor: any) {
    const { type, shapeFlag } = vnode
    if (shapeFlag & ShapeFlags.COMPONENT) {
      move(vnode.component!.subTree, container, anchor)
      return
    }
    if (type === Fragment) {
      hostInsert(vnode.el!, container, anchor)
      const children = vnode.children
      if (isArray(children)) {
        for (let i = 0; i < (children as any[]).length; i++) {
          move(children[i] as VNode, container, anchor)
        }
      }
      hostInsert(vnode.anchor!, container, anchor)
      return
    }
    // 单节点
    hostInsert(vnode.el!, container, anchor)
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
      // KeepAlive 回魂：缓存实例还在 → 显示 + 刷新，不重跑 setup
      if ((n2 as any)._activate && n2.component) {
        const instance = n2.component
        const rootEl = instance.subTree && instance.subTree.el
        if (rootEl) hostShowNode(rootEl)
        ;(n2 as any)._activate = undefined
        instance.update()
        return
      }
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
      // 渲染 effect 显式归属组件 scope：卸载时 scope.stop() 会一并停掉它。
      // 若不登记，卸载后共享依赖再变化，仍会经 scheduler 把已卸载组件重新 patch 回 DOM（僵尸复活）。
      scope: instance.scope,
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
      // KeepAlive：带 _deactivate 标记 → 隐藏而非卸载
      if ((vnode as any)._deactivate && vnode.component) {
        const rootEl = vnode.component.subTree && vnode.component.subTree.el
        if (rootEl) hostHideNode(rootEl)
        return
      }
      unmountComponent(vnode.component!, parentComponent)
    } else {
      if (vnode.type === Fragment) {
        unmountFragment(vnode, parentComponent)
      } else {
        if (doRemove) {
          if (vnode.transition && vnode.transition.leave) {
            // Transition：动画结束后才真正移除
            vnode.transition.leave(vnode.el, () => {
              invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
              hostRemove(vnode.el)
            })
          } else {
            invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
            hostRemove(vnode.el)
          }
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
    void 0
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
  // 指令钩子（v-model/v-show 的运行时生命周期）
  // -------------------------------------------------------------

  type DirectiveHookName = 'created' | 'mounted' | 'beforeUpdate' | 'updated' | 'beforeUnmount' | 'unmounted'

  function invokeDirectiveHook(
    vnode: VNode,
    prevVNode: VNode | null,
    parentComponent: ComponentInternalInstance | null,
    type: DirectiveHookName,
  ) {
    const bindings = vnode.dirs as any[] | undefined
    const oldBindings = prevVNode && (prevVNode.dirs as any[] | undefined)
    if (bindings) {
      for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i]
        if (type === 'mounted' && binding.dir.created) {
          // created 在挂载前执行（指令自身建监听/初值，v-model 靠它 addEventListener）
          binding.dir.created(binding.el || vnode.el, binding, vnode)
        }
        const hook = binding.dir[type]
        if (hook) {
          // 更新类钩子要带 oldValue
          if (type === 'beforeUpdate' || type === 'updated') {
            binding.oldValue = oldBindings && oldBindings[i] ? oldBindings[i].value : undefined
          }
          hook(binding.el || vnode.el, binding, vnode, prevVNode)
        }
      }
    }
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