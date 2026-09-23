/**
 * componentProps.ts —— 组件 props / attrs 的初始化与候流
 *
 * 对应真 Vue packages/runtime-core/src/componentProps.ts。
 *
 * 职责：
 *   - normalizePropsOptions：把组件的 `props: ['foo']` / `props: { foo: {...} }`
 *     归一化成 `{ foo: true, bar: true }` 形式（mini 不做 prop 类型校验）
 *   - initProps：把 vnode.props 拆成「props（声明过的 key）」和「attrs（其余 + 事件监听）」
 *   - instance.props 用 shallowReactive 包一层：模板/render 里读 props 才能建立响应式联系
 */
import { camelize, hyphenate, hasOwn, EMPTY_OBJ, isFunction, isArray } from '@mini-vue/shared'
import { shallowReactive } from '@mini-vue/reactivity'
import { isEmitListener } from './componentEmits'
import type { ComponentInternalInstance, ConcreteComponent } from './component'
import type { Data } from './component'

export type ComponentPropsOptions = string[] | Record<string, any>

/** 归一化后的 props 声明表：{ camelize(名): 声明 } */
export type NormalizedPropsOptions = Record<string, any> | null

/**
 * props 声明归一化：
 *   props: ['foo-bar'] → { fooBar: null }
 *   props: { foo: { type: String } } → { foo: { type: String } }
 */
export function normalizePropsOptions(comp: ConcreteComponent): NormalizedPropsOptions {
  const raw = comp.props
  if (!raw) return null
  const normalized: Record<string, any> = {}
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      normalized[camelize(raw[i])] = null
    }
  } else {
    for (const key in raw) {
      normalized[camelize(key)] = (raw as Data)[key]
    }
  }
  return normalized
}

/**
 * initProps：把父级传来的 rawProps 拆成 props 与 attrs。
 * 判定一行为「父级声明过这个 key（propsOptions）或它是事件监听 → 进 props」，
 * 否则一律进 attrs（属性透传）。
 */
export function initProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  isStateful: boolean,
): void {
  const props: Data = {}
  const attrs: Data = {}
  setFullProps(instance, rawProps, props, attrs)
  // 补默认值 / Boolean 默认 false / 空串 Boolean 强转。
  // 真 Vue 在 render proxy 访问时 lazily 解析默认值（保证函数默认值的 this 可用），
  // mini 简化成 eager：函数默认值按无参调用（覆盖 `default: () => ({...})` 这种常见形态）。
  const options = instance.propsOptions
  if (options) {
    for (const key in options) {
      const def = options[key]
      if (!(key in props)) {
        // 声明了但父级没传
        if (def && def.default !== undefined) {
          props[key] = isFunction(def.default) ? def.default() : def.default
        } else if (isBooleanProp(def)) {
          props[key] = false
        } else {
          props[key] = undefined
        }
      } else if (isBooleanProp(def) && props[key] === '') {
        // 父级传了空串的 Boolean prop → true（includeBooleanAttr 语义）
        props[key] = true
      }
    }
  }
  instance.props = isStateful ? shallowReactive(props) : props
  instance.attrs = attrs
}

/** 是不是 Boolean 类型（含 [Boolean, String] 这类联合类型里含 Boolean 的） */
function isBooleanProp(def: any): boolean {
  if (!def) return false
  const type = def.type !== undefined ? def.type : def
  return type === Boolean || (isArray(type) && (type as any[]).includes(Boolean))
}

function setFullProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  props: Data,
  attrs: Data,
) {
  const options = instance.propsOptions
  if (rawProps) {
    for (const key in rawProps) {
      // key/ref 是 vnode 身份的保留键（已被 vnode.key/ref 抽走），不能进 props 或 attrs
      if (key === 'key' || key === 'ref') continue
      const value = rawProps[key]
      // 声明表单：camelized 命中 → props
      const camelizedKey = camelize(key)
      if (options && hasOwn(options, camelizedKey)) {
        props[camelizedKey] = value
      } else if (isEmitListener(instance.emitsOptions, key)) {
        // 事件监听也算 props：保留原始 onXxx 键，emit 端用 toHandlerKey(camelize(event)) 反查
        props[key] = value
      } else {
        // 其余全部透传进 attrs
        attrs[key] = value
      }
    }
  }
}

export { EMPTY_OBJ }