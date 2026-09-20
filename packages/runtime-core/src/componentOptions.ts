/**
 * componentOptions.ts —— Options API 支持
 *
 * 对应真 Vue packages/runtime-core/src/componentOptions.ts 的必要子集。
 *
 * mini 支持：data / computed / methods / watch / 生命周期选项（created…unmounted）。
 * 优先级（与真 Vue 一致）：Composition API（setup）优先，options 在 setup 之后合并进公共面。
 * 存放：data/computed/methods 统一落到 instance.data（真 Vue 也是 data 一个命名空间）。
 */
import { reactive, computed } from '@mini-vue/reactivity'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'
import { doWatch } from './apiWatch'
import { injectHook } from './lifecycle'
import type { ComponentInternalInstance, Data } from './component'

export function applyOptions(instance: ComponentInternalInstance, rawOptions: Record<string, any>) {
  const { proxy } = instance
  const options = rawOptions

  // ---- data：reactive 化（无 data 也保持容器，method/computed 挂载用）----
  if (options.data) {
    instance.data = reactive(options.data.call(proxy, proxy) as Data)
  } else if (!instance.data) {
    instance.data = {}
  }

  // ---- methods：绑定 this=proxy ----
  if (options.methods) {
    for (const key in options.methods) {
      const methodHandler = options.methods[key]
      if (typeof methodHandler === 'function') {
        instance.data[key] = methodHandler.bind(proxy)
      }
    }
  }

  // ---- computed：转换进 instance.data（读时解包由 reactive getter 完成）----
  if (options.computed) {
    for (const key in options.computed) {
      const userDef = options.computed[key]
      const rawGetter = typeof userDef === 'function' ? userDef : userDef.get
      const rawSetter = typeof userDef === 'function' ? undefined : userDef.set
      // 与真 Vue 一致：getter/setter 的 this 指向公共实例 proxy
      const getter = () => rawGetter.call(proxy)
      const setter = rawSetter ? (v: any) => rawSetter.call(proxy, v) : undefined
      instance.data[key] = setter ? (computed({ get: getter, set: setter }) as any) : (computed(getter) as any)
    }
  }

  // ---- watch -> doWatch（source 为字符串时按 proxy 路径取）----
  if (options.watch) {
    for (const key in options.watch) {
      const rawWatcher = options.watch[key]
      const getter =
        typeof key === 'string' && key.includes('.')
          ? createPathGetter(proxy, key)
          : key === ''
            ? () => {}
            : () => proxy[key]
      const watcherExec = (cb: Function, opts?: any) =>
        doWatch(getter, cb as any, opts) as any

      if (typeof rawWatcher === 'function') {
        watcherExec(rawWatcher.bind(proxy))
      } else if (typeof rawWatcher === 'object') {
        const { handler, immediate, deep } = rawWatcher
        watcherExec(
          typeof handler === 'function' ? handler.bind(proxy) : handler,
          { immediate, deep },
        )
      }
    }
  }

  // ---- 生命周期选项：created 同步执行，其余登记实例钩子 ----
  if (options.beforeCreate) {
    callWithErrorHandling(options.beforeCreate.bind(proxy), instance, ErrorCodes.COMPONENT_UPDATE)
  }
  if (options.created) {
    callWithErrorHandling(options.created.bind(proxy), instance, ErrorCodes.COMPONENT_UPDATE)
  }
  if (options.beforeMount) injectHook('bm' as any, options.beforeMount.bind(proxy), instance)
  if (options.mounted) injectHook('m' as any, options.mounted.bind(proxy), instance)
  if (options.beforeUpdate) injectHook('bu' as any, options.beforeUpdate.bind(proxy), instance)
  if (options.updated) injectHook('u' as any, options.updated.bind(proxy), instance)
  if (options.beforeUnmount) injectHook('bum' as any, options.beforeUnmount.bind(proxy), instance)
  if (options.unmounted) injectHook('um' as any, options.unmounted.bind(proxy), instance)
}

function createPathGetter(ctx: Record<string, any>, path: string) {
  const segments = path.split('.')
  return () => {
    let cur = ctx
    for (let i = 0; i < segments.length && cur; i++) {
      cur = cur[segments[i]]
    }
    return cur
  }
}

export function isOptionComponent(options: Record<string, any>): boolean {
  return !!(
    options.data ||
    options.computed ||
    options.methods ||
    options.watch ||
    options.created ||
    options.beforeCreate ||
    options.beforeMount ||
    options.mounted ||
    options.beforeUpdate ||
    options.updated ||
    options.beforeUnmount ||
    options.unmounted
  )
}

export {}