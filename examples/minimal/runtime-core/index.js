/**
 * renderer.js —— 第二层：渲染器
 * 解决：「知道了之后，谁来画？」
 * 三句话：vnode 是图纸（h 画图纸），patch 是施工队（挂载、同型就地 diff、
 * 换型时先把旧节点卸载再挂载新节点），组件 = 函数 + 状态 + 自己的渲染
 * effect（微任务队列批量重渲染）。
 * 对应 mini-vue：packages/runtime-core/src/（vnode/h/renderer/scheduler/
 * component）。组件 props 用 reactive 包裹，是 mini-vue applyPreUpdate 的
 * 极简替代：父改 props → trigger → 组件自动重渲染。
 * 砍掉：keyed diff（重排出错正是文章 07 的引入场景）、插槽/生命周期/watch/
 * inject-provide、fragment 类型（多根模板直接用数组）、keep-alive/transition。
 */
import { effect, reactive, ref, proxyRefs, stop } from '../reactivity/index.js'

// ---------------------------------------------------------------
// vnode 与 h：图纸。type: 'div' 元素 / Text 文本 / 对象-函数：组件
// h 负责 children 归一化：裸字符串/数字 → Text vnode；单 vnode → 数组；
// v-for 的 map 结果（数组）→ flatMap 展开。patch 从此只见「数组 of vnode」
// ---------------------------------------------------------------
const Text = 'Text'

/** 生成 vnode 并归一化 children：字符串/数字转 Text vnode，单 vnode 包数组，数组内数组展开 */
function h(type, props = null, children = null) {
  if (type === Text) return { type: Text, children: String(children), el: null, component: null }
  if (children != null && typeof children !== 'object') {
    children = [{ type: Text, children: String(children), el: null, component: null }]
  } else if (Array.isArray(children)) {
    children = children.flatMap((c) =>
      Array.isArray(c)
        ? c
        : c && typeof c === 'object'
          ? c
          : { type: Text, children: String(c), el: null, component: null },
    )
  } else if (children && children.type) {
    children = [children]
  }
  return { type, props, children, el: null, component: null }
}

// ---------------------------------------------------------------
// 宿主操作：渲染器唯一碰 DOM 的地方（= mini-vue 的 rendererOptions）。
// 属性三分类：事件 on* → addEventListener；value/checked/selected → property
//（setAttribute('value') 不更新已有输入框——新手必踩实坑）；其余 setAttribute
// ---------------------------------------------------------------
const host = {
  /** 创建元素节点 */
  createElement: (tag) => document.createElement(tag),
  /** 创建文本节点 */
  createText: (text) => document.createTextNode(text),
  /** 更新文本节点内容 */
  setText: (node, text) => (node.nodeValue = text),
  /** 把节点插到父节点的 anchor 之前 */
  insert: (el, parent, anchor) => parent.insertBefore(el, anchor || null),
  /** 从父节点移除 */
  remove: (el) => el.parentNode && el.parentNode.removeChild(el),
  /** 设置单个属性：事件走 addEventListener，单值属性走 property，其余 setAttribute */
  setProp(el, key, value) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'value' || key === 'checked' || key === 'selected') el[key] = value
    else el.setAttribute(key, value)
  },
  /** 移除单个属性：事件要按登记的 handler 精确解绑 */
  removeProp(el, key) {
    if (key.startsWith('on')) el.removeEventListener(key.slice(2).toLowerCase(), el.__handlers?.[key])
    else el.removeAttribute(key)
  },
}

// 微任务批更新：一次交互多次改动只渲染一次；while+shift 支持 flush 期间追加
const queue = []
let flushing = false

/** 把 job 丢进队列（去重），首次排队启动微任务 flush，flush 期间可继续追加 */
function queueJob(job) {
  if (!queue.includes(job)) queue.push(job)
  if (!flushing) {
    flushing = true
    Promise.resolve().then(() => {
      flushing = false
      while (queue.length) queue.shift()()
    })
  }
}

// ---------------------------------------------------------------
// patch：施工队。n1 空 = 挂载；同型 = 更新；换型 = 先卸载旧节点再挂载新节点
// ---------------------------------------------------------------
/** 决策树入口：数组根走就地 diff；按 type 把旧节点与新节点分派给各处理函数 */
function patch(n1, n2, container) {
  if (Array.isArray(n2)) {
    const c1 = Array.isArray(n1) ? n1 : n1 ? [n1] : []
    patchChildren({ children: c1 }, { children: n2 }, container)
    return
  }
  if (n1 && n1.type !== n2.type) {
    unmount(n1)
    n1 = null
  }
  if (n2.type === Text) processText(n1, n2, container) // Text 也是字符串，必须最先判
  else if (typeof n2.type === 'string') processElement(n1, n2, container)
  else processComponent(n1, n2, container) // object/function：组件
}

/** 文本节点：挂载时创建并插入，更新时内容不同才重写 */
function processText(n1, n2, container) {
  if (!n1) {
    n2.el = host.createText(String(n2.children))
    host.insert(n2.el, container)
  } else {
    n2.el = n1.el
    if (n2.children !== n1.children) host.setText(n2.el, String(n2.children))
  }
}

/** 元素分派：旧节点为空走挂载，否则走更新 */
function processElement(n1, n2, container) {
  if (!n1) mountElement(n2, container)
  else patchElement(n1, n2)
}

/** 挂载元素：创建节点、设置属性（事件登记进 __handlers 供换绑）、递归挂载子节点、插入 */
function mountElement(vnode, container) {
  const el = (vnode.el = host.createElement(vnode.type))
  const { props, children } = vnode
  el.__handlers = {}
  if (props) {
    for (const key in props) {
      if (key.startsWith('on')) el.__handlers[key] = props[key]
      host.setProp(el, key, props[key])
    }
  }
  if (Array.isArray(children)) {
    for (const child of children) patch(null, child, el)
  }
  host.insert(el, container)
}

/** 更新元素：属性全量重设加旧属性清理，事件换绑靠 __handlers 记名移除旧监听 */
function patchElement(n1, n2) {
  const el = (n2.el = n1.el)
  const oldProps = n1.props || {}
  const newProps = n2.props || {}
  for (const key in newProps) {
    if (newProps[key] !== oldProps[key]) {
      if (key.startsWith('on') && oldProps[key]) {
        el.removeEventListener(key.slice(2).toLowerCase(), el.__handlers[key])
      }
      if (key.startsWith('on')) el.__handlers[key] = newProps[key]
      host.setProp(el, key, newProps[key])
    }
  }
  for (const key in oldProps) {
    if (!(key in newProps)) {
      host.removeProp(el, key)
      delete el.__handlers[key]
    }
  }
  patchChildren(n1, n2, el)
}

// 同位置就地 diff + 长度增减。重排会错位（无 key）——「危险重排」按钮就是
// 为演示这个设计内局限而存在（想重排正确 → 文章 07 的 keyed diff）
/** 子节点数组就地比较：同位置 patch，多出的补挂载，多余的卸载 */
function patchChildren(n1, n2, el) {
  const c1 = Array.isArray(n1.children) ? n1.children : []
  const c2 = Array.isArray(n2.children) ? n2.children : []
  const len = Math.max(c1.length, c2.length)
  for (let i = 0; i < len; i++) {
    if (i < c1.length && i < c2.length) patch(c1[i], c2[i], el)
    else if (i < c2.length) patch(null, c2[i], el)
    else unmount(c1[i])
  }
}

// ---------------------------------------------------------------
// 组件：函数 + 状态 + 自己的渲染 effect
// ---------------------------------------------------------------
/** 组件分派：旧节点为空走挂载，否则把新 props 合并进实例 */
function processComponent(n1, n2, container) {
  if (!n1) mountComponent(n2, container)
  else updateComponent(n1, n2)
}

/**
 * 挂载组件：创建实例（props 响应式化），执行 setup 得到 render 与状态，
 * 用渲染 effect 包住 render（scheduler 走微任务队列）
 */
function mountComponent(vnode, container) {
  const type = vnode.type
  const instance = (vnode.component = {
    vnode,
    type,
    props: reactive({ ...(vnode.props || {}) }),
    setupState: {},
    ctx: null,
    update: null,
    subTree: null,
  })

  /** 在 props 里找 onXxx 处理器并调用（子组件向父组件发事件的通道） */
  const emit = (event, ...args) => {
    const handler = instance.props[`on${event[0].toUpperCase()}${event.slice(1)}`]
    handler && handler(...args)
  }

  let render
  if (typeof type === 'function') {
    render = type // 函数组件：本身就是 render
  } else {
    const setupResult = type.setup ? type.setup(instance.props, { emit }) : null
    if (typeof setupResult === 'function') render = setupResult
    else {
      instance.setupState = setupResult || {}
      render = type.render
    }
  }
  instance.ctx = proxyRefs({ ...instance.setupState, props: instance.props })
  instance.render = render

  // 渲染 effect：先存旧树再渲染新树，首跑旧树为空即挂载，重跑即更新
  instance.update = effect(
    () => {
      const prevTree = instance.subTree
      instance.subTree = render(instance.ctx)
      patch(prevTree, instance.subTree, container)
    },
    { scheduler: () => queueJob(instance.update) },
  )
}

/** 父驱动更新：新 props 原地 merge 进 reactive 的 props，trigger 自动触发子组件重渲染 */
function updateComponent(n1, n2) {
  const instance = (n2.component = n1.component)
  instance.vnode = n2
  for (const key in n2.props) {
    if (instance.props[key] !== n2.props[key]) instance.props[key] = n2.props[key]
  }
  for (const key in instance.props) {
    if (!(key in n2.props)) delete instance.props[key]
  }
}

/** 递归卸载：组件停止渲染 effect，元素与数组分别清理子结构与 DOM 节点 */
function unmount(vnode) {
  if (Array.isArray(vnode)) {
    for (const child of vnode) unmount(child)
    return
  }
  if (typeof vnode.type === 'object' || typeof vnode.type === 'function') {
    stop(vnode.component.update)
    unmount(vnode.component.subTree)
    vnode.component = null
    return
  }
  if (vnode.type === Text) {
    host.remove(vnode.el)
    return
  }
  if (Array.isArray(vnode.children)) {
    for (const child of vnode.children) unmount(child)
  }
  host.remove(vnode.el)
}

/** 创建根应用：mount 把根组件 vnode patch 进给定容器，返回根组件实例 */
function createApp(rootComponent, rootProps = {}) {
  const rootVNode = h(rootComponent, rootProps)
  return {
    mount(container) {
      patch(null, rootVNode, container)
      return rootVNode.component
    },
  }
}

// 出口：ESM import 与浏览器全局双通道
export { h, Text, patch, createApp, queueJob }
if (typeof window !== 'undefined') {
  Object.assign(window, { h, createApp, queueJob })
}