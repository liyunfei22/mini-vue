/**
 * componentRenderContext.ts —— 渲染上下文（当前渲染组件指针 + scopeId）
 *
 * 对应真 Vue packages/runtime-core/src/componentRenderContext.ts。
 * 与 currentInstance（setup 期间）相对：currentRenderingInstance 标识
 * 「此刻正在跑 render 函数的组件」，供编译助手在渲染期间查 appContext。
 *
 * scopeId（SFC scoped 样式的 data-v-xxx）同源：
 *   currentScopeId = 正在渲染组件的 type.__scopeId（由集成层如 vite 插件挂到组件对象上）。
 *   vnode 创建时把它记到 vnode.scopeId（见 vnode.ts），渲染器挂载时经 setScopeId
 *   落成元素的 data-v-xxx="" 属性——这就是「编译产物里搜不到 data-v」的机制。
 */
import type { ComponentInternalInstance } from './component'

export let currentRenderingInstance: ComponentInternalInstance | null = null
export let currentScopeId: string | null = null

export function setCurrentRenderingInstance(
  instance: ComponentInternalInstance | null,
) {
  const prev = currentRenderingInstance
  currentRenderingInstance = instance
  // 真 Vue 还有 __COMPAT__ 形态的 _scopeId 回退，mini 不需要
  currentScopeId = (instance && instance.type.__scopeId) || null
  return prev
}

export function getCurrentRenderingInstance() {
  return currentRenderingInstance
}

/**
 * 编译产物助手：包一层插槽函数，调用时把渲染上下文切回「定义插槽的组件」。
 * 插槽内容在子组件渲染期执行，若不切回，vnode 会带上子组件的 scopeId、
 * 组件解析会找到子组件的作用域——语义全错。
 *
 * 真 Vue 的完整版还做：_d 标志（disable block tracking，防止手动调用插槽污染
 * block 树）与块栈兜底。mini 无 block 收编语义依赖，只做上下文切换；文档记录差异。
 */
export function withCtx(
  fn: Function,
  ctx: ComponentInternalInstance | null = currentRenderingInstance,
): Function {
  if (!ctx) return fn
  // 已包装过（编译产物/嵌套）→ 直接返回
  if ((fn as any)._n) return fn

  const renderFnWithContext: any = (...args: any[]) => {
    const prev = setCurrentRenderingInstance(ctx)
    try {
      return fn(...args)
    } finally {
      setCurrentRenderingInstance(prev)
    }
  }
  renderFnWithContext._n = true // 已归一化
  renderFnWithContext._c = true // 编译产物插槽（renderSlot 识别用）
  return renderFnWithContext
}