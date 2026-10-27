/**
 * renderer.js —— 第二层：渲染器
 * 解决：「知道了之后，谁来画？」
 * 三句话：vnode 是图纸（h 画图纸），patch 是施工队（挂载/同型就地 diff/换型
 * 先拆后建），组件 = 函数 + 状态 + 自己的渲染 effect（微任务队列批量重渲染）。
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
  createElement: (tag) => document.createElement(tag),
  createText: (text) => document.createTextNode(text),
  setText: (node, text) => (node.nodeValue = text),
  insert: (el, parent, anchor) => parent.insertBefore(el, anchor || null),
  remove: (el) => el.parentNode && el.parentNode.removeChild(el),
  setProp(el, key, value) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'value' || key === 'checked' || key === 'selected') el[key] = value
    else el.setAttribute(key, value)
  },
  removeProp(el, key) {
    if (key.startsWith('on')) el.removeEventListener(key.slice(2).toLowerCase(), el.__handlers?.[key])
    else el.removeAttribute(key)
  },
}

// 微任务批更新：一次交互多次改动只渲染一次；while+shift 支持 flush 期间追加
const queue = []
let flushing = false

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
// patch：施工队。n1 空 = 挂载；同型 = 更新；换型 = 先拆后建
// ---------------------------------------------------------------
function patch(n1, n2, container) {
  if (Array.isArray(n2)) {
    // 数组根 = Fragment 极简版（多根模板），复用就地 diff
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

function processText(n1, n2, container) {
  if (!n1) {
    n2.el = host.createText(String(n2.children))
    host.insert(n2.el, container)
  } else {
    n2.el = n1.el
    if (n2.children !== n1.children) host.setText(n2.el, String(n2.children))
  }
}

function processElement(n1, n2, container) {
  if (!n1) mountElement(n2, container)
  else patchElement(n1, n2)
}

function mountElement(vnode, container) {
  const el = (vnode.el = host.createElement(vnode.type))
  const { props, children } = vnode
  el.__handlers = {} // 记一手事件 handler，供换绑时移除
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

function patchElement(n1, n2) {
  const el = (n2.el = n1.el)
  const oldProps = n1.props || {}
  const newProps = n2.props || {}
  // 属性全量重设 + 旧属性清理（不 diff；事件换绑靠 __handlers 记名）
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
function processComponent(n1, n2, container) {
  if (!n1) mountComponent(n2, container)
  else updateComponent(n1, n2)
}

function mountComponent(vnode, container) {
  const type = vnode.type
  const instance = (vnode.component = {
    vnode,
    type,
    props: reactive({ ...(vnode.props || {}) }), // props 响应式化：父更新自动触发
    setupState: {},
    ctx: null,
    update: null,
    subTree: null,
  })

  // emit：找 props 上的 onXxx 处理器调用
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

  // 渲染 effect：首跑 = 挂载（旧树空），重跑 = 更新。
  // scheduler 送进微任务队列（一次交互多次改动只渲染一次）
  instance.update = effect(
    () => {
      // 先存旧树再渲染新树——否则 patch(新, 新) 白跑（首版踩过）
      const prevTree = instance.subTree
      instance.subTree = render(instance.ctx)
      patch(prevTree, instance.subTree, container)
    },
    { scheduler: () => queueJob(instance.update) },
  )
}

function updateComponent(n1, n2) {
  const instance = (n2.component = n1.component)
  instance.vnode = n2
  // 父渲染出新 props → 原地 merge 进 reactive 的 props → trigger → 组件自动重渲染
  for (const key in n2.props) {
    if (instance.props[key] !== n2.props[key]) instance.props[key] = n2.props[key]
  }
  for (const key in instance.props) {
    if (!(key in n2.props)) delete instance.props[key]
  }
}

function unmount(vnode) {
  if (Array.isArray(vnode)) {
    for (const child of vnode) unmount(child)
    return
  }
  if (typeof vnode.type === 'object' || typeof vnode.type === 'function') {
    // 组件卸载：停掉渲染 effect——否则卸载后共享状态变化会复活 DOM
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