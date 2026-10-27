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

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let deps = depsMap.get(key)
  if (!deps) depsMap.set(key, (deps = new Set()))
  deps.add(activeEffect)
}

function trigger(target, key) {
  const deps = targetMap.get(target)?.get(key)
  if (!deps) return
  for (const effectFn of deps) {
    // 跳过自身：effect 里改自己的依赖（count++）会死循环
    if (effectFn !== activeEffect) {
      // scheduler 与直接执行二选一：渲染器用 scheduler 把更新送进微任务队列
      effectFn.scheduler ? effectFn.scheduler() : effectFn()
    }
  }
}

// effect：把「函数 + 重跑规则」登记成可触发单元。
// parentEffect 指针链（而非栈数组）：嵌套 effect 记住外层，跑完指回
function effect(fn, options = {}) {
  const effectFn = () => {
    if (effectFn.stopped) return // stop 后不再重跑（卸载语义）
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

function stop(effectFn) {
  effectFn.stopped = true
  // 完整版（mini-vue）在这里清空 effectFn.deps 里的登记；省略后旧依赖残留，
  // 改动仍会触发但被 stopped 挡在门外——语义等价，文档记差异
}

// reactive：Proxy 劫持 → track/trigger。
// 深度懒代理：读到的子对象才包代理；缓存保引用相等（reactive(raw) 恒同一代理）
const reactiveMap = new WeakMap()
const reactiveSet = new WeakSet()

function reactive(target) {
  if (reactiveSet.has(target)) return target // 已是代理：防「代理套代理」破坏引用相等
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

// ref：原始值的响应式容器（reactive 包不了数字/字符串）；proxyRefs 解包顶层
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

function ref(value) {
  return new RefImpl(value)
}

function proxyRefs(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver)
      return v && v.__isRef ? v.value : v // 解包：模板里写 count 而不是 count.value
    },
    set(target, key, value, receiver) {
      const old = target[key]
      if (old && old.__isRef) {
        old.value = value // 写回 ref，走它的 trigger
        return true
      }
      return Reflect.set(target, key, value, receiver)
    },
  })
}

// computed：lazy 的 effect + 脏位。不读不计算；依赖变化只置脏（scheduler），
// 下次读才重算；置脏同时 trigger 下游（读 computed 的 effect 也要被通知）
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
        value = runner() // 执行 getter，期间内部依赖记到 runner 名下
        dirty = false
      }
      track(c, 'value') // 读 computed 的 effect 记账到 computed 名下
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