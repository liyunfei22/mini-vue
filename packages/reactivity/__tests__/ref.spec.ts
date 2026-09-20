/**
 * ref.spec.ts —— ref 行为镜像测试
 * 对齐真 Vue packages/reactivity/__tests__/ref.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  computed,
  effect,
  isRef,
  reactive,
  readonly,
  ref,
  toRaw,
  toRef,
  toRefs,
  unref,
} from '../src'

describe('ref', () => {
  it('should hold a value', () => {
    const r = ref(1)
    expect(r.value).toBe(1)
    r.value = 2
    expect(r.value).toBe(2)
  })

  it('should be reactive', () => {
    const r = ref(1)
    let dummy
    let calls = 0
    effect(() => {
      calls++
      dummy = r.value
    })
    expect(calls).toBe(1)
    expect(dummy).toBe(1)

    r.value = 2
    expect(calls).toBe(2)
    expect(dummy).toBe(2)

    // same value: no trigger, no re-run
    r.value = 2
    expect(calls).toBe(2)
  })

  it('should make nested properties reactive', () => {
    const r = ref({ count: 1 })
    let dummy
    effect(() => {
      dummy = r.value.count
    })
    expect(dummy).toBe(1)

    r.value.count = 2
    expect(dummy).toBe(2)
  })

  it('should not trigger when the value being set is the same', () => {
    const r = ref(1)
    const spy = vi.fn(() => r.value)
    effect(spy)

    r.value = 1
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should mark ref() as ref and isRef/unref helpers work', () => {
    const r = ref(1)
    expect(isRef(r)).toBe(true)
    expect(isRef(1)).toBe(false)
    expect(unref(r)).toBe(1)
    expect(unref(2)).toBe(2)
  })

  it('readonly ref', () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = ref(1)
    const ro = readonly(r)

    ro.value = 2
    expect(warningSpy).toHaveBeenCalled()
    expect(r.value).toBe(1)
    warningSpy.mockRestore()
  })
})

describe('ref unwrapping in reactive objects', () => {
  it('should unwrap the ref value upon access', () => {
    const a = ref(1)
    const obj = reactive({ a, b: { c: ref(2) } })

    expect(obj.a).toBe(1) // 顶层解包
    expect(obj.b.c).toBe(2) // 深层解包
  })

  it('writing through reactive writes into the ref', () => {
    const a = ref(1)
    const obj = reactive({ a } as any)

    obj.a = 3
    expect(a.value).toBe(3) // 改代理其实改到了 ref 内部
  })

  it('writing the ref directly updates the reactive side', () => {
    const a = ref(1)
    const obj = reactive({ a })
    let dummy
    effect(() => (dummy = obj.a))
    expect(dummy).toBe(1)

    a.value = 5
    expect(dummy).toBe(5)
  })

  it('refs in arrays are not unwrapped', () => {
    const arr = reactive([ref(1)])
    expect(isRef(arr[0])).toBe(true)
    expect(arr[0].value).toBe(1)
  })
})

describe('toRefs / toRef', () => {
  it('toRefs should pair with reactive object properties', () => {
    const obj = reactive({ foo: 1, bar: 2 })
    const { foo, bar } = toRefs(obj)

    expect(foo.value).toBe(1)
    expect(bar.value).toBe(2)

    obj.foo = 3
    expect(foo.value).toBe(3) // 原对象改 → ref 跟着变

    foo.value = 4
    expect(obj.foo).toBe(4) // ref 改 → 原对象跟着变
  })

  it('toRef on an existing ref returns the same ref', () => {
    const r = ref(1)
    expect(toRef(r)).toBe(r)
  })

  it('toRef creates a property ref that stays in sync', () => {
    const obj = reactive({ foo: 1 })
    const foo = toRef(obj, 'foo')

    expect(foo.value).toBe(1)
    obj.foo = 10
    expect(foo.value).toBe(10)
    foo.value = 20
    expect(obj.foo).toBe(20)
  })
})

describe('ref with computed', () => {
  it('computed produces a reads-only ref', () => {
    const count = ref(1)
    const double = computed(() => count.value * 2)

    expect(double.value).toBe(2)
    expect(isRef(double)).toBe(true)
  })

  it('toRaw(ref of object) returns the underlying raw value', () => {
    const original = { count: 1 }
    const r = ref(original)
    const raw = toRaw(r.value)
    expect(raw).toBe(original)
  })
})