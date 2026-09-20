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
import { isOn, normalizeClass, normalizeStyle, toHandlerKey } from '@mini-vue/shared'

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

// ---- 事件（阶段 3 朴素版） ----

function patchEvent(el: Element, rawName: string, prevValue: unknown, nextValue: unknown) {
  // 手写 add/remove —— 阶段 4 会换成 invoker 缓存（el._vei）
  if (nextValue) {
    const eventName = rawName.slice(2).toLowerCase()
    if (prevValue) {
      el.removeEventListener(eventName, prevValue as any)
    }
    el.addEventListener(eventName, nextValue as any)
  } else if (prevValue) {
    const eventName = rawName.slice(2).toLowerCase()
    el.removeEventListener(eventName, prevValue as any)
  }
}

// ---- 决定走 property 还是 attribute ----

function shouldSetAsProp(el: Element, key: string, value: any): boolean {
  return key in el || (domPropsRE.test(key) && value != null)
}

function patchDOMProp(el: Element, key: string, prevValue: any, nextValue: any) {
  try {
    ;(el as any)[key] = nextValue == null ? '' : nextValue
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