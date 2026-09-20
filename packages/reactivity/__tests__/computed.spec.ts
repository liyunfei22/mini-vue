/**
 * computed.spec.ts —— 计算属性行为镜像测试
 * 对齐真 Vue packages/reactivity/__tests__/computed.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  computed,
  effect,
  isReadonly,
  isRef,
  reactive,
  ref,
} from '../src'

describe('computed', () => {
  it('should return updated value', () => {
    const value = reactive<{ foo?: number }>({})
    const c = computed(() => (value.foo ?? 0) + 1)
    expect(c.value).toBe(1)

    value.foo = 2
    expect(c.value).toBe(3)
  })

  it('should compute lazily — not run until .value is accessed', () => {
    const value = reactive({ foo: 1 })
    const getter = vi.fn(() => value.foo)
    const c = computed(getter)

    expect(getter).not.toHaveBeenCalled()
    expect(c.value).toBe(1)
    expect(getter).toHaveBeenCalledTimes(1)
  })

  it('should not re-compute when the value does not change', () => {
    const value = reactive({ foo: 1 })
    const getter = vi.fn(() => value.foo)
    const c = computed(getter)

    expect(c.value).toBe(1)
    expect(getter).toHaveBeenCalledTimes(1)

    value.foo = 1 // 值没变 → 不会让 computed 重算（hasChanged 判定）
    expect(getter).toHaveBeenCalledTimes(1)
  })

  it('should cache computed value until deps change', () => {
    const value = reactive({ foo: 1 })
    const getter = vi.fn(() => value.foo + 1)
    const c = computed(getter)

    expect(c.value).toBe(2)
    expect(c.value).toBe(2) // 缓存命中
    expect(getter).toHaveBeenCalledTimes(1)

    value.foo = 2 // 依赖变化 → 置脏
    expect(c.value).toBe(3) // 重新计算一次
    expect(c.value).toBe(3) // 又缓存
    expect(getter).toHaveBeenCalledTimes(2)
  })

  it('should trigger the effect when dependencies change', () => {
    const value = reactive({ foo: 1 })
    const c = computed(() => value.foo)
    let dummy
    const spy = vi.fn(() => (dummy = c.value))
    effect(spy)

    expect(spy).toHaveBeenCalledTimes(1)
    value.foo = 2
    expect(spy).toHaveBeenCalledTimes(2)
    expect(dummy).toBe(2)
  })

  it('should chain computations and propagate', () => {
    const value = reactive({ foo: 1 })
    const c1 = computed(() => value.foo)
    const c2 = computed(() => c1.value + 1)
    const c3 = computed(() => c2.value * 2)
    let dummy
    const spy = vi.fn(() => (dummy = c3.value))
    effect(spy)

    expect(dummy).toBe(4) // (1+1)*2
    value.foo = 3
    expect(dummy).toBe(8) // (3+1)*2
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('should be mark as readonly and isRef for getter-only computed', () => {
    const c = computed(() => 1)
    expect(isRef(c)).toBe(true)
    expect(isReadonly(c)).toBe(true)
  })

  it('should warn on writing to a getter-only computed', () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c: any = computed(() => 1)
    c.value = 10
    expect(warningSpy).toHaveBeenCalled()
    expect(c.value).toBe(1)
    warningSpy.mockRestore()
  })

  it('should support a writable computed', () => {
    const count = ref(1)
    const plusOne = computed<number>({
      get: () => count.value + 1,
      set: (val) => {
        count.value = val - 1
      },
    })

    expect(plusOne.value).toBe(2)
    plusOne.value = 3
    expect(count.value).toBe(2)
  })

  it('should not trigger a computed that is not tracked (lazy across deps)', () => {
    // 核心：computed 只在「有订阅者 + 依赖变了」时失效回流，
    // 没人读它，就保持缓存值不动。
    const a = ref(1)
    const c = computed(() => a.value)
    const noTracker = c.value
    expect(noTracker).toBe(1)

    a.value = 2
    // 没有任何 effect 订阅 c → 不需要重算，也无人触发
    expect(c.value).toBe(2)
  })

  it('should compute on demand after being untracked', () => {
    const a = ref(1)
    let b
    const c = computed(() => {
      b = a.value + 1
      return a.value + 1
    })
    effect(() => (b = c.value))
    expect(b).toBe(2)

    a.value = 5
    expect(c.value).toBe(6)
    expect(b).toBe(6)
  })
})