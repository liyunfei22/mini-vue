/**
 * reactive.spec.ts —— 代理工厂行为镜像测试
 * 对齐真 Vue packages/reactivity/__tests__/reactive.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  effect,
  isProxy,
  isReactive,
  markRaw,
  reactive,
  readonly,
  toRaw,
} from '../src'

describe('reactive', () => {
  it('should return a same proxy when the object is reactive again', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    expect(reactive(original)).toBe(observed)
  })

  it('should return a different proxy object', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    expect(observed).not.toBe(original)
  })

  it('should cache and reuse the proxy when nested objects are accessed multiple times', () => {
    const original = { nested: { foo: 1 } }
    const observed = reactive(original)
    expect(observed.nested).toBe(reactive(original.nested))
  })

  it('should lazily convert nested objects to reactive on access', () => {
    const original = { nested: { foo: 1 } }
    const observed = reactive(original)
    // 不访问时，嵌套对象还没被代理
    expect(isReactive(observed)).toBe(true)
    expect(isReactive(original.nested)).toBe(false)
    // 一经访问，惰性变成 reactive
    expect(isReactive(observed.nested)).toBe(true)
  })

  it('toRaw() returns the original object', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    expect(toRaw(observed)).toBe(original)
  })

  it('reactive on a proxy returns the proxy itself', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    expect(reactive(observed)).toBe(observed)
  })

  it('reactive on a readonly proxy returns the readonly proxy itself', () => {
    const original = { foo: 1 }
    const ro = readonly(original)
    expect(reactive(ro)).toBe(ro)
  })

  it('should not make non-object values reactive', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(reactive(1 as any)).toBe(1)
    expect(reactive('str' as any)).toBe('str')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('markRaw avoids proxies', () => {
    const raw = markRaw({ foo: 1 })
    expect(reactive(raw)).toBe(raw)
    expect(isReactive(reactive(raw))).toBe(false)
  })

  it('markRaw objects nested in reactive do not get proxied', () => {
    const rawInner = markRaw({ foo: 1 })
    const observed = reactive({ raw: rawInner })
    expect(observed.raw).toBe(rawInner)
    expect(isReactive(observed.raw)).toBe(false)
  })

  it('should expose isReactive/isProxy', () => {
    const observed = reactive({})
    expect(isReactive(observed)).toBe(true)
    expect(isProxy(observed)).toBe(true)
    expect(isReactive({})).toBe(false)
    expect(isProxy({})).toBe(false)
  })

  it('should trigger iteration effects when a new key is added', () => {
    const observed = reactive<Record<string, number>>({ a: 1 })
    let dummy = 0
    effect(() => {
      let s = 0
      for (const k in observed) s += observed[k]
      dummy = s
    })

    expect(dummy).toBe(1)
    observed.b = 4 // 新增 key → ADD → ITERATE 收集者被触发
    expect(dummy).toBe(5)
  })
})

describe('reactive arrays', () => {
  it('should observe numeric index mutations', () => {
    let dummy
    const arr = reactive([1, 2])
    effect(() => (dummy = arr[0]))
    expect(dummy).toBe(1)

    arr[0] = 3
    expect(dummy).toBe(3)
  })

  it('should observe length changes (push)', () => {
    let dummy
    const arr = reactive(['build'])
    effect(() => (dummy = arr.length))

    expect(dummy).toBe(1)
    arr.push('preact')
    expect(dummy).toBe(2)
  })
})