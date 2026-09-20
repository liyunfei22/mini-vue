/**
 * readonly.spec.ts —— 只读代理行为镜像测试
 * 对齐真 Vue packages/reactivity/__tests__/readonly.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  effect,
  isReadonly,
  isReactive,
  reactive,
  readonly,
  ref,
  shallowReadonly,
  toRaw,
} from '../src'

describe('readonly', () => {
  it('should not be reactive', () => {
    const r = readonly({})
    expect(isReactive(r)).toBe(false)
    expect(isReadonly(r)).toBe(true)
  })

  it('should make nested values readonly', () => {
    const original = { nested: { foo: 1 } }
    const wrapped = readonly(original)

    expect(wrapped.nested).not.toBe(original.nested)
    expect(isReadonly(wrapped.nested)).toBe(true)
    expect(isReadonly(wrapped)).toBe(true)
  })

  it('should warn when mutating a readonly object', () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ro = readonly({ foo: 1 } as any)
    ro.foo = 2
    expect(warningSpy).toHaveBeenCalled()
    // 值没有被写进去
    expect(ro.foo).toBe(1)
    warningSpy.mockRestore()
  })

  it('should warn when deleting a readonly property', () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ro = readonly({ foo: 1 } as any)
    delete ro.foo
    expect(warningSpy).toHaveBeenCalled()
    warningSpy.mockRestore()
  })

  it('should warn when adding a property to readonly', () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ro = readonly({} as any)
    ro.bar = 2
    expect(warningSpy).toHaveBeenCalled()
    expect('bar' in ro).toBe(false)
    warningSpy.mockRestore()
  })

  it('should not trigger effects when mutating a readonly object', () => {
    const obj = reactive({ foo: 1 })
    const ro = readonly(obj)
    const spy = vi.fn(() => ro.foo)
    effect(spy)

    expect(spy).toHaveBeenCalledTimes(1)
    // 改只读代理 → 不触发
    ;(ro as any).foo = 2
    expect(spy).toHaveBeenCalledTimes(1)
    // 改原始对象 → 触发（readonly 是与 reactive 共享底层对象的视图）
    obj.foo = 2
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('readonly(reactive(obj)) keeps original reactive behavior', () => {
    const original = reactive({ count: 0 })
    const copy = readonly(original)
    const spy = vi.fn(() => copy.count)
    effect(spy)

    expect(spy).toHaveBeenCalledTimes(1)
    original.count++ // 改原始 reactive 对象 → 只读视图同步更新
    expect(spy).toHaveBeenCalledTimes(2)
    expect(copy.count).toBe(1)
  })

  it('should return same proxy on repeated readonly calls', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    expect(readonly(original)).toBe(wrapped)
  })

  it('should expose raw as original when accessed', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    expect(toRaw(wrapped)).toBe(original)
  })

  it('readonly(ref) — reading works, mutation warns and no-ops', () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = ref(1)
    const ro = readonly(r) as any
    expect(ro.value).toBe(1)
    ro.value = 2
    expect(warningSpy).toHaveBeenCalled()
    expect(ro.value).toBe(1)
    warningSpy.mockRestore()
  })

  it('shallowReadonly only guards the top level', () => {
    const r = shallowReadonly({ nested: { foo: 1 } } as any)
    expect(isReadonly(r)).toBe(true)
    // 深层不拦截
    expect(isReadonly(r.nested)).toBe(false)
  })
})