/**
 * componentRenderUtils.ts —— 组件渲染根：调用 render 产出子树 vnode
 *
 * 对应真 Vue packages/runtime-core/src/componentRenderUtils.ts。
 *
 * 组件想「长出内容」，就调用它的 render 函数拿到子树 vnode（subTree），
 * 渲染器再 patch 这棵子树。这里做的事：
 *   - 以 proxy 为 this/第一个实参调用 render（render 里读 this.count 就是读 setupState）
 *   - 归一化返回值为单一 vnode（null/数组/字符串都会被 normalizeVNode 兜底）
 *   - 让渲染期间的响应式依赖注册到「当前渲染组件」（供 setup 返回对象的自动解包）
 */
import { normalizeVNode, type VNode } from './vnode'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'
import { getCurrentRenderingInstance, setCurrentRenderingInstance } from './componentRenderContext'
import type { ComponentInternalInstance } from './component'

export function renderComponentRoot(instance: ComponentInternalInstance): VNode {
  const { proxy, render } = instance

  let result
  // 渲染期间维护「当前渲染中的组件」：编译助手（resolveDynamicComponent 等）据此
  // 查找 appContext/scopeId，与真 Vue 的 currentRenderingInstance 语义一致
  const prev = getCurrentRenderingInstance()
  setCurrentRenderingInstance(instance)
  try {
    result = callWithErrorHandling(render!, instance, ErrorCodes.RENDER_FUNCTION, [proxy])
  } finally {
    setCurrentRenderingInstance(prev)
  }

  return normalizeVNode(result)
}

export const __DEV__ = true