/**
 * runtimeHelpers.ts —— 编译器产物依赖的运行时助手常量
 *
 * 对应真 Vue packages/compiler-core/src/runtimeHelpers.ts。
 * codegen 阶段「import { helperName as _helperName } from 'Vue'」的信息来源；
 * 编译器不知道运行时长什么样，只用这么多 ID 与名字 —— 运行时补齐同名函数即可。
 */
export const WITH_CTX = Symbol('withCtx')
export const TO_DISPLAY_STRING = Symbol('toDisplayString')
export const CREATE_ELEMENT_VNODE = Symbol('createElementVNode')
export const CREATE_TEXT_VNODE = Symbol('createTextVNode')
export const CREATE_COMMENT = Symbol('createCommentVNode')
export const RENDER_LIST = Symbol('renderList')
export const RENDER_SLOT = Symbol('renderSlot')
export const WITH_DIRECTIVES = Symbol('withDirectives')
export const V_ON_WITH_MODIFIERS = Symbol('withModifiers')
export const V_ON_WITH_KEYS = Symbol('withKeys')
export const RESOLVE_COMPONENT = Symbol('resolveComponent')
export const RESOLVE_DYNAMIC_COMPONENT = Symbol('resolveDynamicComponent')
export const TO_HANDLER_KEY = Symbol('toHandlerKey')
export const LOOSE_TO_NUMBER = Symbol('looseToNumber')
export const V_MODEL_CHECKBOX = Symbol('vModelCheckbox')
export const V_MODEL_RADIO = Symbol('vModelRadio')
export const V_MODEL_SELECT = Symbol('vModelSelect')
export const V_SHOW = Symbol('vShow')
export const FRAGMENT = Symbol('Fragment')
export const SET_BLOCK_TRACKING = Symbol('setBlockTracking')
export const OPEN_BLOCK = Symbol('openBlock')
export const CREATE_VNODE = Symbol('createVNode')
export const CREATE_ELEMENT_BLOCK = Symbol('createElementBlock')
export const HYDRATE_ELEMENT = Symbol('hydrateElement')

export const helperNameMap: Record<symbol, string> = {
  [WITH_CTX]: 'withCtx',
  [TO_DISPLAY_STRING]: 'toDisplayString',
  [CREATE_ELEMENT_VNODE]: 'createElementVNode',
  [CREATE_TEXT_VNODE]: 'createTextVNode',
  [CREATE_COMMENT]: 'createCommentVNode',
  [RENDER_LIST]: 'renderList',
  [RENDER_SLOT]: 'renderSlot',
  [WITH_DIRECTIVES]: 'withDirectives',
  [V_ON_WITH_MODIFIERS]: 'withModifiers',
  [V_ON_WITH_KEYS]: 'withKeys',
  [RESOLVE_COMPONENT]: 'resolveComponent',
  [RESOLVE_DYNAMIC_COMPONENT]: 'resolveDynamicComponent',
  [TO_HANDLER_KEY]: 'toHandlerKey',
  [LOOSE_TO_NUMBER]: 'looseToNumber',
  [V_MODEL_CHECKBOX]: 'vModelCheckbox',
  [V_MODEL_RADIO]: 'vModelRadio',
  [V_MODEL_SELECT]: 'vModelSelect',
  [V_SHOW]: 'vShow',
  [CREATE_VNODE]: 'createVNode',
  [OPEN_BLOCK]: 'openBlock',
  [FRAGMENT]: 'Fragment',
  [CREATE_ELEMENT_BLOCK]: 'createElementBlock',
}

/** 设置已使用 helpers 的调试名（devtools/测试断言用） */
export function registerRuntimeHelpers(helpers: Record<string, symbol>) {
  for (const name in helpers) {
    helperNameMap[helpers[name]] = name
  }
}