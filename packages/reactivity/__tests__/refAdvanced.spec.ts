/**
 * refAdvanced.spec.ts —— shallowRef / triggerRef / customRef / proxyRefs
 * 对齐真 Vue packages/reactivity/__tests__/ref.spec.ts 相关子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  computed,
  customRef,
  effect,
  isReactive,
  isRef,
  proxyRefs,
  reactive,
  ref,
  shallowRef,
  triggerRef,
} from '../src'

describe('shallowRef', () => {
  it('should hold a value', () => {
    const r = shallowRef(1)
    expect(r.value).toBe(1)
    r.value = 2
    expect(r.value).toBe(2)
  })

  it('should not make nested properties reactive', () => {
    const r = shallowRef({ count: 1 })
    let dummy
    effect(() => (dummy = r.value.count))
    expect(dummy).toBe(1)

    r.value.count = 2 // 深改：不触发
    expect(dummy).toBe(1)

    r.value = { count: 3 } // 换对象：触发
    expect(dummy).toBe(3)
  })

  it('is shallow-not-reactive internally', () => {
    expect(isReactive(shallowRef({}).value)).toBe(false)
  })
})

describe('triggerRef', () => {
  it('should force trigger after deep mutation on a shallowRef', () => {
    const shallow = shallowRef({ greet: 'hello' })
    let calls = 0
    let dummy
    effect(() => {
      calls++
      dummy = shallow.value.greet
    })
    expect(calls).toBe(1)

    // 深改不触发
    shallow.value.greet = 'hi'
    expect(calls).toBe(1)

    // 手动强制触发
    triggerRef(shallow)
    expect(calls).toBe(2)
    expect(dummy).toBe('hi')
  })
})

describe('customRef', () => {
  it('should delegate get/set to the factory while tracking', () => {
    let value = 1
    const r = customRef<number>((track, trigger) => ({
      get() {
        track()
        return value
      },
      set(newVal: number) {
        value = newVal
        trigger()
      },
    }))

    let dummy
    effect(() => (dummy = r.value))
    expect(dummy).toBe(1)

    r.value = 2
    expect(dummy).toBe(2)
  })

  it('should support a debounced-like custom ref', () => {
    let target = 0
    let pending: number | undefined
    const r = customRef<number>((track, trigger) => ({
      get() {
        track()
        return target
      },
      set(newVal: number) {
        pending = newVal // 写入只更新 pending，不立即生效
        // 这里用同步模拟「防抖后的触发」：下一轮才提交
        setTimeout(() => {
          target = pending!
          trigger()
        }, 10)
      },
    }))

    let dummy = -1
    effect(() => (dummy = r.value))
    expect(dummy).toBe(0)

    r.value = 5
    expect(dummy).toBe(0) // 尚未生效

    return new Promise((resolve) =>
      setTimeout(() => {
        expect(dummy).toBe(5)
        resolve(undefined)
      }, 30),
    )
  })
})

describe('proxyRefs', () => {
  it('should unwrap refs on read', () => {
    const obj = proxyRefs({ count: ref(1), name: 'mini' })
    expect(obj.count).toBe(1)
    expect(obj.name).toBe('mini')
  })

  it('should write through to refs on assignment', () => {
    const count = ref(1)
    const obj = proxyRefs({ count })
    obj.count = 2
    expect(count.value).toBe(2)
    expect(obj.count).toBe(2)
  })

  it('should set a plain value as-is if the old value is not a ref', () => {
    const obj = proxyRefs({ name: 'old' } as any)
    obj.name = 'new'
    expect(obj.name).toBe('new')
  })

  it('isReactive objects are returned as-is', () => {
    const reactiveObj = reactive({ a: ref(1) })
    expect(proxyRefs(reactiveObj)).toBe(reactiveObj)
  })

  it('isRef still true for the underlying refs (they come unwrapped by the proxy)', () => {
    const count = ref(1)
    const obj = proxyRefs({ count })
    expect(isRef(obj.count)).toBe(false) // 读出来已被解包
    expect(isRef(count)).toBe(true)
  })

  it('computed inside proxyRefs also unwraps', () => {
    const count = ref(1)
    const double = computed(() => count.value * 2)
    const obj = proxyRefs({ count, double })
    expect(obj.double).toBe(2)
  })
})