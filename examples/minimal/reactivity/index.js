/**
 * reactivity.js —— 第一层：响应式
 * 解决：「数据变了，世界怎么知道？」
 * 三句话：读数据记账（track），改数据算账（trigger），reactive/ref 只是把
 * 读写劫持进账本的容器，computed 是 lazy 的 effect。
 * 对应 mini-vue：packages/reactivity/src/（effect/dep/reactive/ref/computed）。
 * 砍掉：依赖清理 cleanup（effect.deps 是升级位；旧依赖残留只导致多余触发，
 * 渲染幂等）、ownKeys/has/deleteProperty、Set/Map、readonly/toRaw/watch/effectScope。
 */

// 依赖账本：对象 → 属性 → effect 集合（WeakMap：对象回收账目自动消失）
let activeEffect = null
const targetMap = new WeakMap()

/** 记账：把当前正在执行的 effect 记入（target, key）对应的格子 */
function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let deps = depsMap.get(key)
  if (!deps) depsMap.set(key, (deps = new Set()))
  deps.add(activeEffect)
}

/** 算账：取出格子里的 effect 逐个执行，跳过当前正在执行的自身，有 scheduler 走 scheduler */
function trigger(target, key) {
  const deps = targetMap.get(target)?.get(key)
  if (!deps) return
  for (const effectFn of deps) {
    if (effectFn !== activeEffect) {
      effectFn.scheduler ? effectFn.scheduler() : effectFn()
    }
  }
}

/**
 * 登记 fn 为可触发单元，首次执行完成依赖收集。
 * parentEffect 指针记住外层 effect，嵌套结束时恢复；
 * options.lazy 控制是否立即执行；options.scheduler 接管重跑的调用路径。
 */
function effect(fn, options = {}) {
  const effectFn = () => {
    if (effectFn.stopped) return
    const parent = activeEffect
    activeEffect = effectFn
    try {
      return fn()
    } finally {
      activeEffect = parent
    }
  }
  effectFn.scheduler = options.scheduler
  if (!options.lazy) effectFn()
  return effectFn
}

/** 标记 stopped，后续触发直接跳过（卸载语义）；deps 登记清理留作升级位（mini-vue 有） */
function stop(effectFn) {
  effectFn.stopped = true
}

/** 用 Proxy 把对象的读写劫持进 track/trigger；深度懒代理，缓存保证同一对象恒同一代理 */
const reactiveMap = new WeakMap()
const reactiveSet = new WeakSet()

function reactive(target) {
  if (reactiveSet.has(target)) return target
  const existing = reactiveMap.get(target)
  if (existing) return existing
  const proxy = new Proxy(target, {
    get(target, key, receiver) {
      track(target, key)
      const res = Reflect.get(target, key, receiver)
      return res !== null && typeof res === 'object' ? reactive(res) : res
    },
    set(target, key, value, receiver) {
      const res = Reflect.set(target, key, value, receiver)
      trigger(target, key)
      return res
    },
  })
  reactiveMap.set(target, proxy)
  reactiveSet.add(proxy)
  return proxy
}

/** ref 的容器实现：get 记依赖，set 在值变化时触发 */
class RefImpl {
  constructor(value) {
    this.__isRef = true
    this._value = value
  }
  get value() {
    track(this, 'value')
    return this._value
  }
  set value(v) {
    if (v !== this._value) {
      this._value = v
      trigger(this, 'value')
    }
  }
}

/** 创建原始值容器（reactive 无法包装数字、字符串等原始值） */
function ref(value) {
  return new RefImpl(value)
}

/** 对象读写代理：读 ref 时返回解包后的值，写 ref 时透传给容器自身 */
function proxyRefs(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver)
      return v && v.__isRef ? v.value : v
    },
    set(target, key, value, receiver) {
      const old = target[key]
      if (old && old.__isRef) {
        old.value = value
        return true
      }
      return Reflect.set(target, key, value, receiver)
    },
  })
}

/**
 * lazy 的 effect 加脏位：读取才计算，依赖变化只置脏，下次读取重算；
 * 置脏同时通知下游 effect（读 computed 的一方也要被触发）
 */
function computed(getter) {
  let dirty = true
  let value
  const runner = effect(getter, {
    lazy: true,
    scheduler: () => {
      if (!dirty) {
        dirty = true
        trigger(c, 'value')
      }
    },
  })
  const c = {
    __isRef: true,
    get value() {
      if (dirty) {
        value = runner()
        dirty = false
      }
      track(c, 'value')
      return value
    },
  }
  return c
}

// 出口：ESM import 与浏览器全局双通道
export { effect, stop, reactive, ref, proxyRefs, computed }
if (typeof window !== 'undefined') {
  Object.assign(window, { effect, stop, reactive, ref, proxyRefs, computed })
}