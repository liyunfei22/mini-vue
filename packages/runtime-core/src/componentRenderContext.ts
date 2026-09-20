/**
 * componentRenderContext.ts —— 渲染上下文（当前渲染组件指针）
 *
 * 对应真 Vue packages/runtime-core/src/componentRenderContext.ts。
 * 与 currentInstance（setup 期间）相对：currentRenderingInstance 标识
 * 「此刻正在跑 render 函数的组件」，供编译助手在渲染期间查 appContext。
 */
import type { ComponentInternalInstance } from './component'

export let currentRenderingInstance: ComponentInternalInstance | null = null

export function setCurrentRenderingInstance(
  instance: ComponentInternalInstance | null,
) {
  const prev = currentRenderingInstance
  currentRenderingInstance = instance
  return prev
}

export function getCurrentRenderingInstance() {
  return currentRenderingInstance
}