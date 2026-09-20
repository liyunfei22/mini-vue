/**
 * componentPublicInstance.ts —— 公共实例代理（模板里的 `this`）
 *
 * 对应真 Vue packages/runtime-core/src/componentPublicInstance.ts。
 *
 * instance.proxy 是「组件向自己代码/模板暴露的公共面」：
 *   this.count      → 优先 setupState（setup 返回的对象）
 *   this.msg        → 其次 props
 *   this.attrs      → attrs
 *   this.ctx        → 自定义 ctx
 * 读写都打到 instance 对应字段上，避免把内部实现（如 instance.update）漏出去。
 * mini 只实现 setupState/props/ctx 三个优先级的读写 + has 拦截；
 * 真 Vue 还有 data/computed/methods/globalProperties 等（阶段 4 补 globalProperties）。
 */
import { hasOwn } from '@mini-vue/shared'
import type { ComponentInternalInstance, Data } from './component'

export const PublicInstanceProxyHandlers: ProxyHandler<{ _: ComponentInternalInstance }> = {
  get({ _: instance }, key: string) {
    const { ctx, setupState, props } = instance

    // 内部标记
    if (key === '__isVue') {
      return true
    }

    // 访问优先级：setupState → props → ctx → app.config.globalProperties
    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
      return setupState[key]
    } else if (props !== EMPTY_OBJ && hasOwn(props, key)) {
      return props[key]
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      return ctx[key]
    } else if (instance.appContext && instance.appContext.config.globalProperties) {
      const globalProps = instance.appContext.config.globalProperties
      if (hasOwn(globalProps, key)) {
        return globalProps[key]
      }
    }

    return undefined
  },

  set({ _: instance }, key: string, value): boolean {
    const { ctx, setupState } = instance

    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
      setupState[key] = value
      return true
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      ctx[key] = value
    }
    return true
  },

  has({ _: { setupState, props, ctx } }, key: string) {
    return (
      (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) ||
      (props !== EMPTY_OBJ && hasOwn(props, key)) ||
      (ctx !== EMPTY_OBJ && hasOwn(ctx, key))
    )
  },
}

const EMPTY_OBJ: Record<string, any> = {}

export type { Data }