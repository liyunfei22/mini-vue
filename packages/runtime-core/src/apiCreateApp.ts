/**
 * apiCreateApp.ts —— createApp
 *
 * 对应真 Vue packages/runtime-core/src/apiCreateApp.ts。
 *
 * createAppAPI(render) 生成工厂：绑定具体的渲染器后，产出『应用』对象。
 * 应用 vs 组件渲染器的关系：
 *   app.mount(container) 就是「把根组件 vnode 交给 render 打进容器」。
 * app 同时是几个全局能力的聚会点（mini 阶段 3 只实现核心子集）：
 *   provide —— 应用级注入（所有组件都能 inject）
 *   use     —— 插件协议（生态库通过它向应用安装自己）
 *   component —— 全局组件注册
 *   config.globalProperties —— 阶段 4
 */
import { createVNode } from './vnode'
import { warn } from './warning'
import { EMPTY_OBJ } from '@mini-vue/shared'
import type { AppContext, Data } from './component'
import type { VNode } from './vnode'

/**
 * 运行时编译器注册表：@mini-vue/vue 聚合包把 compileToFunction 注入进来，
 * 组件 `template: "..."` 选项由此编译成渲染函数（runtime-core 不直接依赖 compiler）。
 */
let runtimeCompiler: ((template: string, options?: any) => any) | undefined
export function registerRuntimeCompiler(fn: (template: string, options?: any) => any) {
  runtimeCompiler = fn
}
export function getRuntimeCompiler() {
  return runtimeCompiler
}

export interface App<HostElement = any> {
  _component: any
  _props: any
  _container: HostElement | null
  _context: AppContext
  config: AppContext['config']
  mount(rootContainer: HostElement): any
  unmount(): void
  provide(key: string | symbol, value: unknown): App
  use(plugin: any, ...options: any[]): App
  component(name: string, component?: any): App | any
}

export function createAppAPI<HostElement>(
  render: (vnode: VNode | null, container: HostElement) => void,
) {
  return function createApp(rootComponent: any, rootProps: Record<string, unknown> | null = null): App {
    const context = createContext()
    let isMounted = false

    const app: App = {
      _component: rootComponent,
      _props: rootProps,
      _container: null,
      _context: context,
      // 暴露 app.config（globalProperties / errorHandler 的入口）
      config: context.config,

      provide(key: string | symbol, value: unknown) {
        context.provides[key] = value
        return app
      },

      use(plugin: any, ...options: any[]) {
        if (plugin && typeof plugin.install === 'function') {
          plugin.install(app, ...options)
        } else if (typeof plugin === 'function') {
          plugin(app, ...options)
        } else {
          warn(`[mini-vue] a plugin must either be a function or an object with an "install" function.`)
        }
        return app
      },

      component(name: string, component?: any) {
        if (component) {
          context.components[name] = component
          return app
        }
        return context.components[name]
      },

      mount(rootContainer: HostElement): any {
        if (!isMounted) {
          const vnode = createVNode(rootComponent, rootProps)
          // 根组件能看到 app 级 provides（inject 的顶层兜底）
          vnode.appContext = context

          render(vnode, rootContainer)

          isMounted = true
          app._container = rootContainer
          return vnode.component!.proxy
        } else if (__DEV__) {
          warn(`[mini-vue] App has already been mounted. If you want to remount the same app, move your createApp call inside of the render function.`)
        }
        return app._container as any
      },

      unmount() {
        if (isMounted) {
          render(null, app._container!)
          app._container = null
          isMounted = false
        }
      },
    }

    return app
  }
}

function createContext(): AppContext {
  return {
    app: null as any,
    config: { errorHandler: undefined, globalProperties: {} as Data, compiler: getRuntimeCompiler() },
    provides: Object.create(null),
    components: {},
  }
}

export const __DEV__ = true
export { EMPTY_OBJ }