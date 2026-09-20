/**
 * KeepAlive.ts —— 缓存组件（mini 简版）
 *
 * 对应真 Vue packages/runtime-core/src/components/KeepAlive.ts 的必要子集。
 *
 * 原理（与真 Vue 一致的行为，渲染器配合）：
 *   1. 每次渲染把「当前子组件」按 key 缓存；
 *   2. 子组件被换掉时，renderer 发现 vnode._deactivate → **隐藏而非卸载**（display:none，stay 树上）；
 *   3. 同一个 key 再回来时，KeepAlive 返回「缓存的同一个 vnode/实例」并标记 _activate → renderer 显示
 *      + 刷新，**不重跑 setup** —— 内部状态得以保留。
 *
 * 简化点：不做 include/exclude/max、不做 deactivated/activated 钩子、不做动态 storage 容器
 * （用 display 显隐替代真实 Vue 的「挪进隐藏容器」）。
 */

export const KeepAlive = {
  name: 'KeepAlive',
  setup(_props: Record<string, any>, { slots }: any) {
    const cache = new Map<any, any>() // key → 缓存的 vnode（含 component 实例）

    return () => {
      const defaultSlot = slots.default && slots.default()
      let child: any =
        Array.isArray(defaultSlot) && defaultSlot.length ? defaultSlot[0] : null
      if (!child) return null
      child = _normalizeVNode(child)

      const key = child.key != null ? child.key : child.type
      const cachedVNode = cache.get(key)

      if (cachedVNode && cachedVNode.component) {
        // 回魂：返回缓存 vnode（同一实例），标记为「需要激活」
        child = cachedVNode
        child._activate = true
      } else {
        cache.set(key, child)
      }
      // 当前渲染的这个子组件，若被换掉 → 隐藏（renderer 读 _deactivate 字段拦截卸载）
      child._deactivate = true
      return child
    }
  },
}

// 局部小工具（避免 keepAlive 造成大量依赖）
function _normalizeVNode(child: any): any {
  if (child == null || typeof child === 'boolean') {
    return { __v_isVNode: true, type: Symbol('comment'), children: '', el: null, shapeFlag: 8, patchFlag: -1, props: null, key: null, dirs: null, transition: null, component: null, appContext: null } as any
  }
  if (typeof child === 'object' && (child as any).__v_isVNode) {
    return child
  }
  // 原始值 → 文本 vnode
  return {
    __v_isVNode: true,
    type: Symbol('text'),
    children: String(child),
    el: null,
    shapeFlag: 8,
    patchFlag: -1,
    props: null,
    key: null,
    dirs: null,
    transition: null,
    component: null,
    appContext: null,
  } as any
}