/**
 * patchProp.ts —— 属性打补丁：统一走这个入口处理 class/style/事件/attr/prop
 *
 * 对应真 Vue packages/runtime-dom/src/patchProp.ts + modules/*。
 *
 * 分发逻辑：
 *   class         → className（更快的直接写法）
 *   style         → 内联样式 diff
 *   onXxx         → 事件（阶段 3 朴素 add/removeEventListener，阶段 4 换成 invoker 缓存）
 *   剩下的        → 能作为 DOM property 就赋值（value/checked/selected…），
 *                   否则 setAttribute
 */
import { isArray, isOn, normalizeClass, normalizeStyle, toHandlerKey } from '@mini-vue/shared'

/** vei = vue event invokers：缓存在元素上的事件调用器表 */
const veiKey = '__vei'

const domPropsRE = /[A-Z]|^(value|checked|selected|muted|disabled)$/

export const patchProp = (
  el: Element,
  key: string,
  prevValue: any,
  nextValue: any,
) => {
  switch (key) {
    case 'class':
      patchClass(el, nextValue)
      break
    case 'style':
      patchStyle(el, prevValue, nextValue)
      break
    default:
      if (isOn(key)) {
        patchEvent(el, key, prevValue, nextValue)
      } else if (shouldSetAsProp(el, key, nextValue)) {
        patchDOMProp(el, key, prevValue, nextValue)
      } else {
        patchAttr(el, key, nextValue)
      }
  }
}

// ---- class ----

function patchClass(el: Element, value: unknown) {
  if (value == null) {
    el.removeAttribute('class')
  } else {
    ;(el as HTMLElement).className = normalizeClass(value)
  }
}

// ---- style ----

function patchStyle(el: Element, prev: any, next: any) {
  const style = (el as HTMLElement).style
  if (next == null) {
    el.removeAttribute('style')
  } else {
    const nextStyle = normalizeStyle(next)
    if (typeof nextStyle === 'string') {
      if (nextStyle !== (el as any).__styleString) {
        style.cssText = nextStyle
        ;(el as any).__styleString = nextStyle
      }
      return
    }
    // 对象形态：先删「新里没有的旧键」，再赋新值
    if (prev && typeof prev !== 'string') {
      for (const key in prev) {
        if (!(key in nextStyle)) {
          style.removeProperty(key)
        }
      }
    }
    for (const key in nextStyle) {
      const value = nextStyle[key]
      if (value != null) {
        style.setProperty(key, String(value))
      } else {
        style.removeProperty(key)
      }
    }
  }
}

// ---- 事件（阶段 4：invoker 缓存） ----

/**
 * invoker 机制：每个事件名只 addEventListener 一次，之后更新 handler 只改
 * invoker.value。避免「每次 patch 都 remove + add」（阶段 3 朴素版的短板）。
 *   首次绑定：el.__vei[rawName] = createInvoker(handler) → addEventListener(el, name, invoker)
 *   更新     ：existingInvoker.value = newHandler（零 DOM 操作）
 *   移除     ：removeEventListener + 表里置空
 */
function patchEvent(el: any, rawName: string, _prevValue: unknown, nextValue: unknown) {
  const invokers = el[veiKey] || (el[veiKey] = {})
  const existingInvoker = invokers[rawName]

  if (nextValue && existingInvoker) {
    // patch：只换值
    existingInvoker.value = nextValue
  } else {
    const [name, options] = parseName(rawName)
    if (nextValue) {
      // add
      const invoker = (invokers[rawName] = createInvoker(nextValue))
      el.addEventListener(name, invoker, options)
    } else if (existingInvoker) {
      // remove
      el.removeEventListener(name, existingInvoker, options)
      invokers[rawName] = undefined
    }
  }
}

function createInvoker(initialValue: unknown) {
  const invoker: any = (e: Event) => {
    // handler 每次 patch 时会更新到 invoker.value 上，调用时永远是最新版
    const value = invoker.value
    if (isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const handler = value[i]
        if (handler) handler(e)
      }
    } else if (value) {
      value(e)
    }
  }
  invoker.value = initialValue
  return invoker
}

/** onClick / onClickOnce / onClickCapture / onClickPassive → 真实事件名 + addEventListener options */
function parseName(rawName: string): [string, AddEventListenerOptions | undefined] {
  let options: AddEventListenerOptions | undefined
  let name = rawName.slice(2)
  if (name.endsWith('Once')) {
    options = { once: true }
    name = name.slice(0, -4)
  } else if (name.endsWith('Capture')) {
    options = { capture: true }
    name = name.slice(0, -7)
  } else if (name.endsWith('Passive')) {
    options = { passive: true }
    name = name.slice(0, -7)
  }
  return [name.toLowerCase(), options]
}

// ---- 决定走 property 还是 attribute ----

function shouldSetAsProp(el: Element, key: string, value: any): boolean {
  return key in el || (domPropsRE.test(key) && value != null)
}

function patchDOMProp(el: Element, key: string, prevValue: any, nextValue: any) {
  try {
    let value = nextValue
    // 布尔 DOM 属性（disabled/selected/muted/multiple…）：空串 → true、null/undefined → false。
    // `<input disabled>` 编译成 disabled: ""，直接赋值会把布尔属性设成 false（对齐真 Vue includeBooleanAttr）
    if ((value === '' || value == null) && typeof (el as any)[key] === 'boolean') {
      value = value === '' ? true : false
    }
    ;(el as any)[key] = value == null ? '' : value
  } catch (e) {
    console.warn(`[mini-vue] error setting prop ${key}`, e)
  }
}

function patchAttr(el: Element, key: string, value: unknown) {
  if (value == null || value === false) {
    el.removeAttribute(key)
  } else {
    el.setAttribute(key, value === true ? '' : (value as string))
  }
}