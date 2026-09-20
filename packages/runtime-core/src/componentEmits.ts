/**
 * componentEmits.ts —— 组件 emit 机制
 *
 * 对应真 Vue packages/runtime-core/src/componentEmits.ts。
 *
 * 核心是 `emit(instance, event, ...args)`：
 *   1. 事件名 event（例如 'update:title'）→ handler 名（`onUpdate:title` /
 *      `onUpdate_title` 等价物），规则：`on` + 首字母大写 + 驼峰
 *   2. 在父级传来的 vnode.props 里查 handler
 *   3. 找到就以错误兜底方式调用，入参为冒泡到父级的原始参数
 *
 * emitsOptions 的作用：把组件声明的 `emits: ['submit']` 归一化，供
 *   - emit 时防拼错命名（mini 只做归一化不做告警兜底）
 *   - initProps 判断「这个 key 到底算 prop 还是算事件（进 attrs）」
 */
import { camelize, hyphenate, toHandlerKey, EMPTY_OBJ, hasOwn } from '@mini-vue/shared'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'
import type { ComponentInternalInstance } from './component'
import type { ConcreteComponent } from './component'

export type EmitsOptions = ObjectEmitsOptions | string[]
export type ObjectEmitsOptions = Record<string, ((...args: any[]) => any) | null>

/**
 * 归一化组件声明的 emits：
 *   ['click'] → { click: null }
 *   { click: null, submit: (payload) => {} } → 原样对象
 * 返回 null 表示组件没声明 emits。
 */
export function normalizeEmitsOptions(comp: ConcreteComponent): ObjectEmitsOptions | null {
  const raw = comp.emits
  if (!raw) return null
  if (isArray(raw)) {
    const normalized: ObjectEmitsOptions = {}
    for (let i = 0; i < raw.length; i++) {
      normalized[raw[i]] = null
    }
    return normalized
  } else {
    const normalized: ObjectEmitsOptions = {}
    for (const key in raw) {
      normalized[key] = (raw as ObjectEmitsOptions)[key] ?? null
    }
    return normalized
  }
}

/**
 * 判断父级传来的 onXxx attr 是不是一个「已声明的事件监听」。
 * 逻辑链：on('submit') → 把 'submit' 分解 → 检查 camelized / hyphenated / 原样三种形态
 * 是否命中 emitsOptions。是 → 它走 emit 通道；不是 → 它只是普通 attr。
 */
export function isEmitListener(options: ObjectEmitsOptions | null, key: string): boolean {
  if (!options || !isOn(key)) return false
  key = key.slice(2).replace(/Once$/, '')
  return (
    hasOwn(options, key[0].toLowerCase() + key.slice(1)) ||
    hasOwn(options, hyphenate(key)) ||
    hasOwn(options, key)
  )
}

/**
 * 组件内部调 `emit('update:title', payload)` → 找父级 props.onUpdate:title /
 * onUpdate-title → 调用。
 */
export function emit(instance: ComponentInternalInstance, event: string, ...rawArgs: any[]) {
  const props = instance.vnode.props || EMPTY_OBJ

  const handlerName = toHandlerKey(camelize(event))
  const handler = props[handlerName] || props[toHandlerKey(hyphenate(event))]

  if (handler) {
    callWithErrorHandling(handler, instance, ErrorCodes.COMPONENT_EVENT_HANDLER, rawArgs)
  }
}

// ---- 小工具 ----
function isArray(v: unknown): v is any[] {
  return Array.isArray(v)
}
function isOn(key: string): boolean {
  return key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110
}