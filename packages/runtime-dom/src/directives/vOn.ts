/**
 * vOn.ts —— 事件修饰符的运行时实现（withModifiers / withKeys）
 *
 * 对应真 Vue packages/runtime-dom/src/directives/vOn.ts（去掉 2.x compat / keyCode 兼容）。
 * 编译器把 @click.prevent / @keyup.enter 编译成
 *   onClick: _withModifiers(handler, ["prevent"])
 *   onKeyup: _withKeys(handler, ["enter"])
 * 这里就是那两个包装函数的实现。
 */
import { hyphenate } from '@mini-vue/shared'

/** 运行时守卫：返回 truthy 表示「不通过」，直接拦截、不调用原 fn */
const modifierGuards: Record<string, (e: any, modifiers: string[]) => any> = {
  stop: (e) => e.stopPropagation(),
  prevent: (e) => e.preventDefault(),
  self: (e) => e.target !== e.currentTarget,
  ctrl: (e) => !e.ctrlKey,
  shift: (e) => !e.shiftKey,
  alt: (e) => !e.altKey,
  meta: (e) => !e.metaKey,
  left: (e) => 'button' in e && e.button !== 0,
  middle: (e) => 'button' in e && e.button !== 1,
  right: (e) => 'button' in e && e.button !== 2,
  exact: (e, modifiers) =>
    ['ctrl', 'shift', 'alt', 'meta'].some((m) => e[`${m}Key`] && !modifiers.includes(m)),
}

/** 用运行时守卫包裹事件处理器：任一守卫不通过就跳过调用 */
export function withModifiers(fn: Function, modifiers: string[]): Function {
  if (!fn) return fn
  return function (this: any, event: Event, ...args: any[]) {
    for (let i = 0; i < modifiers.length; i++) {
      const guard = modifierGuards[modifiers[i]]
      if (guard && guard(event, modifiers)) return
    }
    return fn.call(this, event, ...args)
  }
}

/** 按键别名（KeyboardEvent.key 会被 hyphenate 归一，如 ArrowUp → arrow-up） */
const keyNames: Record<string, string> = {
  esc: 'escape',
  space: ' ',
  up: 'arrow-up',
  left: 'arrow-left',
  right: 'arrow-right',
  down: 'arrow-down',
  delete: 'backspace',
}

/** 按键过滤：event.key 命中任一 modifier 才调用原 fn */
export function withKeys(fn: Function, modifiers: string[]): Function {
  if (!fn) return fn
  return function (this: any, event: any, ...args: any[]) {
    if (!('key' in event)) return
    const eventKey = hyphenate(event.key)
    if (modifiers.some((k) => k === eventKey || keyNames[k] === eventKey)) {
      return fn.call(this, event, ...args)
    }
  }
}