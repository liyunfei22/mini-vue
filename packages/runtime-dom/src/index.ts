/**
 * @mini-vue/runtime-dom —— DOM 平台层：组装 nodeOps + patchProp 驱动 runtime-core
 *
 * 对应真 Vue packages/runtime-dom/src/index.ts。
 * 这里的 createApp 是「DOM 专用的 createApp」。
 */
import { createRenderer } from '@mini-vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp } from './patchProp'

const rendererOptions = { ...nodeOps, patchProp }

let renderer: ReturnType<typeof createRenderer> | undefined

function ensureRenderer() {
  return renderer || (renderer = createRenderer(rendererOptions))
}

export const createApp = (
  rootComponent: any,
  rootProps: Record<string, unknown> | null = null,
): any => {
  return ensureRenderer().createApp(rootComponent, rootProps)
}

/** 低层 render（测试/手动场景可直接调） */
export const render = (vnode: any, container: any) => {
  ensureRenderer().render(vnode, container)
}

export * from '@mini-vue/runtime-core'
export { nodeOps, patchProp }