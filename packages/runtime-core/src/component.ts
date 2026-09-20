/**
 * component.ts —— 组件实例的创建与 setup 执行
 *
 * 对应真 Vue packages/runtime-core/src/component.ts。
 *
 * 组件实例 = 一棵组件的「运行态小宇宙」：
 *   - 上游：vnode（当前的）、parent、root、appContext
 *   - 自身：props/attrs/slots/emitsOptions、setupState、render
 *   - 输出：proxy（公共 this）、subTree（渲染结果 vnode）、update（渲染 effect）
 *   - 生命周期：bm/m/bu/u/bum/um 数组 + scope（effect 归属）
 *   - 协议：setup(setupContext) 的执行与结果归一化
 */
import { isFunction, isObject, EMPTY_OBJ } from '@mini-vue/shared'
import { proxyRefs, EffectScope } from '@mini-vue/reactivity'
import {
  initProps,
  normalizePropsOptions,
  type NormalizedPropsOptions,
} from './componentProps'
import {
  emit,
  normalizeEmitsOptions,
  type ObjectEmitsOptions,
} from './componentEmits'
import { initSlots, type InternalSlots, type Slots } from './componentSlots'
import { setCurrentInstance, unsetCurrentInstance } from './currentInstance'
import { PublicInstanceProxyHandlers } from './componentPublicInstance'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'
import { applyOptions, isOptionComponent } from './componentOptions'
import type { VNode } from './vnode'

// ---------------------------------------------------------------
// 基础类型
// ---------------------------------------------------------------

export type Data = Record<string, unknown>
export type ConcreteComponent = Record<string, any>

export interface AppContext {
  app: any | null
  config: {
    errorHandler?: (err: unknown, instance: any) => void
    globalProperties: Record<string, any>
    compiler?: (template: string, options?: any) => any
  }
  provides: Record<string | symbol, any>
  components: Record<string, any>
}

let uid = 0

export interface ComponentInternalInstance {
  /** 全局唯一 id（scheduler 按 id 排序 / 调试用） */
  uid: number
  /** 当前组件对应的 vnode */
  vnode: VNode
  /** 组件定义（options） */
  type: any
  /** 父实例 */
  parent: ComponentInternalInstance | null
  /** 根实例 */
  root: ComponentInternalInstance
  /** 应用级上下文（provides 的根源） */
  appContext: AppContext

  // 头部数据
  props: Data
  attrs: Data
  /** Options API 的 data/computed/methods 命名空间（setup 优先） */
  data: Data
  slots: InternalSlots
  emitsOptions: ObjectEmitsOptions | null
  propsOptions: NormalizedPropsOptions
  setupState: Data
  setupContext: SetupContext | null
  /** 渲染函数（setup 返回的函数 或 options.render） */
  render: ((ctx: any, ...args: any[]) => any) | null

  // 输出
  proxy: any
  subTree: VNode
  update: any
  next: VNode | null

  // 生命周期钩子数组（短键存：bm/m/bu/u/bum/um）
  bm?: Function[]
  m?: Function[]
  bu?: Function[]
  u?: Function[]
  bum?: Function[]
  um?: Function[]

  /** 本组件专属 effect scope：setCurrentInstance 时激活 */
  scope: EffectScope

  isMounted: boolean
  /** 父级 provide 的注入面（见 apiInject，原型链实现） */
  provides: Record<string | symbol, any>
  ctx: Data
  exposed: Record<string, any> | null
}

export type SetupContext = {
  attrs: Data
  slots: Slots
  emit: (event: string, ...args: any[]) => void
  expose: (exposed: Record<string, any>) => void
}

/**
 * defineComponent —— 类型层面的组件定义助手（mini 恒等包装）。
 * 真 Vue 在此协调 TS 类型推导（props/emits/slots 泛型），运行期原样返回。
 */
export function defineComponent(options: Record<string, any>) {
  return options
}

export function createAppContext(): AppContext {
  return {
    app: null,
    config: { errorHandler: undefined, globalProperties: {} },
    provides: Object.create(null),
    components: {},
  }
}

// ---------------------------------------------------------------
// 实例创建
// ---------------------------------------------------------------

export function createComponentInstance(
  vnode: VNode,
  parent: ComponentInternalInstance | null,
): ComponentInternalInstance {
  const type = vnode.type

  const appContext =
    (parent ? parent.appContext : vnode.appContext) || createAppContext()

  const instance: ComponentInternalInstance = {
    uid: uid++,
    vnode,
    type,
    parent,
    root: null as any, // 下方设
    appContext,
    props: EMPTY_OBJ,
    attrs: EMPTY_OBJ,
    // Options API 数据容器（无 data 选项时也为 {}，method/computed 可挂）
    data: EMPTY_OBJ as any,
    // slots 必须用可变空对象（initSlots 会往里写 key）
    slots: {},
    emitsOptions: normalizeEmitsOptions(type),
    propsOptions: normalizePropsOptions(type),
    setupState: EMPTY_OBJ,
    setupContext: null,
    render: null,
    proxy: null as any,
    subTree: null as any,
    update: null as any,
    next: null,
    // 非 detached：新实例会作为子 scope 挂到「当前活跃 scope」（父实例 scope）下，
    // 组件卸载时 scope.stop() 即可连带停掉内部所有 effect
    scope: new EffectScope(),
    isMounted: false,
    provides: parent ? parent.provides : Object.create(appContext.provides),
    // ctx 是公共代理的 target，必须带 `_` 反指实例（PublicInstanceProxyHandlers.get 靠它解构）
    ctx: { _: undefined as any },
    exposed: null,
  }
  instance.root = parent ? parent.root : instance
  instance.ctx._ = instance
  return instance
}

// ---------------------------------------------------------------
// setup 执行
// ---------------------------------------------------------------

export function setupComponent(instance: ComponentInternalInstance) {
  const { props, children } = instance.vnode
  const isStateful = isStatefulComponent(instance)
  initProps(instance, props as Data, isStateful)
  initSlots(instance, children)

  if (isStateful) {
    setupStatefulComponent(instance)
  } else {
    // 函数组件：无 setup，直接装配 render
    finishComponentSetup(instance)
  }
}

function isStatefulComponent(instance: ComponentInternalInstance): boolean {
  return isObject(instance.type)
}

function setupStatefulComponent(instance: ComponentInternalInstance) {
  const Component = instance.type
  instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)

  const { setup } = Component

  if (setup) {
    const setupContext = (instance.setupContext = createSetupContext(instance))
    setCurrentInstance(instance)
    // 同步执行 setup（async setup 的恢复逻辑 mini 不做，文档注明）
    const setupResult = callWithErrorHandling(
      setup,
      instance,
      ErrorCodes.SETUP_FUNCTION,
      [instance.props, setupContext],
    )
    unsetCurrentInstance()
    handleSetupResult(instance, setupResult)
  } else {
    finishComponentSetup(instance)
  }

  // Options API 追加：setup（Composition）之后合并 data/computed/methods/watch/生命周期选项
  if (isOptionComponent(Component)) {
    applyOptions(instance, Component)
  }
}

/**
 * setup 返回值归一化：
 *   函数 → 渲染函数
 *   对象 → setupState（经 proxyRefs 浅解包：模板/render 里读裸值）
 *   其它 → 组件自身只剩 options 层面的能力
 */
export function handleSetupResult(instance: ComponentInternalInstance, setupResult: unknown) {
  if (isFunction(setupResult)) {
    instance.render = setupResult as any
  } else if (isObject(setupResult)) {
    instance.setupState = proxyRefs(setupResult as Data)
    finishComponentSetup(instance)
  } else {
    finishComponentSetup(instance)
  }
}

function finishComponentSetup(instance: ComponentInternalInstance) {
  const Component = instance.type

  // 渲染函数来源优先级：setup 返回的函数 > options.render > 函数组件本身 > 空占位
  if (!instance.render) {
    if (Component.render) {
      instance.render = Component.render
    } else if (isFunction(Component)) {
      // 函数组件：整个函数就是 render
      instance.render = Component
    } else if (Component.template && instance.appContext.config.compiler) {
      // 模板字符串 → 运行时编译（@mini-vue/vue 注入的 compiler）
      instance.render = instance.appContext.config.compiler(Component.template)
    } else {
      // 连 render 都没有 → 渲染空占位
      instance.render = () => null
    }
  }
}

function createSetupContext(instance: ComponentInternalInstance): SetupContext {
  return {
    get attrs() {
      return instance.attrs
    },
    get slots() {
      return instance.slots as Slots
    },
    emit: (event: string, ...args: any[]) => emit(instance, event, ...args),
    expose: (_exposed) => {},
  }
}