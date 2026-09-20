/**
 * resolveAssets.ts —— 资源解析：组件/指令的注册表查找
 *
 * 对应真 Vue packages/runtime-core/src/helpers/resolveAssets.ts。
 *
 * <component :is="x"> 和 <div v-[name]> 这类「运行时才知道名字」的场景，
 * 编译器会生成对 resolveComponent / resolveDirective / resolveDynamicComponent 的调用。
 *
 * 查找顺序（组件）：当前组件 setupState.xxx → 全局注册（app.component）→ 原生标签白名单
 * mini 只为 h() 世界提供能力：字符串名字 → 全局注册表；函数/对象 → 直接使用。
 */
import { isObject, isString } from '@mini-vue/shared'
import { createVNode, Comment, type VNode } from '../vnode'
import { getCurrentRenderingInstance } from '../componentRenderContext'

/** 原生元素标签名集合（来自 compiler-dom 的 PATTERN；mini 先放常用子集） */
const NATIVE_TAGS = new Set([
  'div', 'span', 'p', 'a', 'button', 'input', 'textarea', 'select',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'section', 'header', 'footer',
  'img', 'br', 'hr', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'form',
])

export function resolveComponent(name: string, appContext?: any): any {
  // 1. 当前组件的局部 components 选项（<template><Child/></template> 场景）
  const inst = getCurrentRenderingInstance()
  if (inst && inst.type && inst.type.components) {
    const local = inst.type.components[name]
    if (local) return local
  }
  // 2. 应用级 app.component 注册表
  const ctx = appContext || (inst && inst.appContext)
  const appComponents = ctx && ctx.components
  if (appComponents && appComponents[name]) {
    return appComponents[name]
  }
  return name // 未识别 → 原样返回字符串（渲染器当元素用）
}

export function resolveDirective(name: string): null {
  // mini 阶段 4 暂无运行时指令注册表（withDirectives 支持硬编码，阶段 6 补）
  return null
}

/**
 * 动态组件：
 *   - 对象/函数 → 直接是组件定义
 *   - 字符串   → 全局注册表 → 原生标签
 *   - 其它     → 空占位
 */
export function resolveDynamicComponent(component: any, appContext?: any): any {
  // 未显式传 appContext 时，回退到「当前渲染组件」的应用上下文（模板编译产物用法）
  const inst = getCurrentRenderingInstance()
  const ctx = appContext || (inst && inst.appContext)
  if (isString(component)) {
    // 全局注册的组件名
    const resolved = resolveComponent(component, ctx)
    if (resolved !== component) {
      return resolved
    }
    // 原生标签名
    if (isNativeTag(component)) {
      return component
    }
    // 都不认识 → 警告 + 空占位
    console.warn(
      `[mini-vue] Failed to resolve dynamic component: ${component} ` +
        `(did you register it via app.component?)`,
    )
    return Comment
  }
  if (isObject(component) || typeof component === 'function') {
    return component
  }
  return Comment
}

export function isNativeTag(tag: string): boolean {
  return NATIVE_TAGS.has(tag)
}

export { createVNode }