/**
 * effect.spec.ts —— 副作用行为镜像测试
 *
 * 用例行为对齐真 Vue packages/reactivity/__tests__/effect.spec.ts 的经典子集
 * （mini 不做 3.5 内部优化，只保证「外部行为」一致）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  effect,
  pauseTracking,
  reactive,
  ref,
  resetTracking,
  stop,
} from '../src'

describe('effect', () => {
  it('should run the passed function once (wrapped by a effect)', () => {
    const fnSpy = vi.fn(() => {})
    effect(fnSpy)
    expect(fnSpy).toHaveBeenCalledTimes(1)
  })

  it('should observe basic properties', () => {
    let dummy
    const counter = reactive({ num: 0 })
    effect(() => (dummy = counter.num))

    expect(dummy).toBe(0)
    counter.num = 7
    expect(dummy).toBe(7)
  })

  it('should observe multiple properties', () => {
    let dummy
    const counter = reactive({ num1: 0, num2: 0 })
    effect(() => (dummy = counter.num1 + counter.num1 + counter.num2))

    expect(dummy).toBe(0)
    counter.num1 = counter.num2 = 7
    expect(dummy).toBe(21)
  })

  it('should handle multiple effects', () => {
    let dummy1, dummy2
    const counter = reactive({ num: 0 })
    effect(() => (dummy1 = counter.num))
    effect(() => (dummy2 = counter.num))

    expect(dummy1).toBe(0)
    expect(dummy2).toBe(0)
    counter.num++
    expect(dummy1).toBe(1)
    expect(dummy2).toBe(1)
  })

  it('should observe nested properties', () => {
    let dummy
    const counter = reactive({ nested: { num: 0 } })
    effect(() => (dummy = counter.nested.num))

    expect(dummy).toBe(0)
    counter.nested.num = 8
    expect(dummy).toBe(8)
  })

  it('should observe delete operations', () => {
    let dummy
    const obj = reactive<{ prop?: string }>({ prop: 'value' })
    effect(() => (dummy = obj.prop!))

    expect(dummy).toBe('value')
    delete obj.prop
    expect(dummy).toBe(undefined)
  })

  it('should observe has operations', () => {
    let dummy
    const obj = reactive<Record<string, number>>({})
    effect(() => (dummy = 'key' in obj))

    expect(dummy).toBe(false)
    obj.key = 1
    expect(dummy).toBe(true)
  })

  it('should observe properties on the prototype chain', () => {
    let dummy = 0
    const counter = reactive<{ num: number; bonus?: number }>({ num: 0 })
    const parent = reactive({ bonus: 2 })
    Object.setPrototypeOf(counter, parent)
    effect(() => (dummy = counter.num + counter.bonus!))

    expect(dummy).toBe(2)
    counter.num = 7
    expect(dummy).toBe(9)
    parent.bonus = 5
    expect(dummy).toBe(12)
  })

  it('should observe array length mutations', () => {
    let dummy
    const arr = reactive(['build'])
    effect(() => (dummy = arr.length))

    expect(dummy).toBe(1)
    arr.push('preact')
    expect(dummy).toBe(2)
  })

  it('should observe symbol properties', () => {
    const key = Symbol('prop')
    let dummy
    const obj = reactive({ [key]: 'value' })
    effect(() => (dummy = obj[key]))

    expect(dummy).toBe('value')
    obj[key] = 'newValue'
    expect(dummy).toBe('newValue')
  })

  // Map/Set 的 collection 特化 handler 在阶段 2 实现，其行为测试届时补充
  //（阶段 1 的 baseHandlers 无法正确处理 Set 的 size/迭代器内部槽）

  // ---- 分支切换（gate：为什么必须 cleanup 的实证）----
  it('should remove old dependencies after branch switch', () => {
    let dummy
    const obj = reactive({ ok: true, a: 1, b: 2 })
    const spy = vi.fn(() => {
      dummy = obj.ok ? obj.a : obj.b
    })
    effect(spy)

    expect(dummy).toBe(1)
    obj.ok = false // 切到 b 分支：现在依赖的是 b
    expect(dummy).toBe(2)
    spy.mockClear()

    obj.a = 10 // a 已不在依赖里 → 不应触发
    expect(spy).not.toHaveBeenCalled()
    expect(dummy).toBe(2)

    obj.b = 20
    expect(spy).toHaveBeenCalledTimes(1)
    expect(dummy).toBe(20)
  })

  it('should not be triggered by mutating a used-but-unchanged property', () => {
    let dummy
    const obj = reactive({ prop: 'value' })
    const spy = vi.fn(() => (dummy = true ? obj.prop : 'other'))
    effect(spy)
    expect(spy).toHaveBeenCalledTimes(1)

    obj.prop = 'value' // 值没变，hasChanged 为 false
    expect(spy).toHaveBeenCalledTimes(1)
    expect(dummy).toBe('value')
  })

  // ---- 自触发守卫 ----
  it('should avoid infinite loops when using effects on itself', () => {
    const counter = reactive({ num: 0 })
    const counterSpy = vi.fn(() => {
      counter.num++
    })
    effect(counterSpy)

    expect(counter.num).toBe(1)
    expect(counterSpy).toHaveBeenCalledTimes(1)

    counter.num = 4
    expect(counter.num).toBe(5)
    expect(counterSpy).toHaveBeenCalledTimes(2)
  })

  it('should not trigger an effect when overriding an effect before stopping', () => {
    const counter = reactive({ num: 0 })
    const runner = effect(() => counter.num)
    stop(runner)
    counter.num = 1
    expect(counter.num).toBe(1)
  })

  // ---- 嵌套 ----
  it('should allow nested effects', () => {
    const obj = reactive({ a: 1, b: 2 })
    const effects: number[] = []
    effect(() => {
      void obj.a
      effect(() => {
        effects.push(obj.b)
      })
    })

    expect(effects).toEqual([2])
    obj.b = 3
    expect(effects).toEqual([2, 3])
    obj.a = 9 // 外层重建 → 产生一个新内层 effect（读到当前 b=3）
    expect(effects).toEqual([2, 3, 3])
  })

  // ---- scheduler ----
  it('should call the scheduler on trigger and run only on manual run', () => {
    let dummy
    let run: any
    const schedulerSpy = vi.fn(() => {
      run = runner
    })
    const obj = reactive({ foo: 1 })
    const runner = effect(
      () => {
        dummy = obj.foo
      },
      { scheduler: schedulerSpy },
    )

    expect(schedulerSpy).not.toHaveBeenCalled()
    expect(dummy).toBe(1)

    obj.foo++
    expect(schedulerSpy).toHaveBeenCalledTimes(1)
    // 有 scheduler 时不立即重跑
    expect(dummy).toBe(1)

    run()
    expect(dummy).toBe(2)
  })

  // ---- lazy ----
  it('should not run the effect immediately when lazy is true', () => {
    const spy = vi.fn(() => {})
    const runner = effect(spy, { lazy: true })
    expect(spy).not.toHaveBeenCalled()

    runner()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // ---- stop / onStop ----
  it('should stop the effect and not observe changes', () => {
    let dummy
    const obj = reactive({ prop: 1 })
    const runner = effect(() => {
      dummy = obj.prop
    })
    obj.prop = 2
    expect(dummy).toBe(2)

    stop(runner)
    obj.prop = 3
    expect(dummy).toBe(2)

    // stopped effect 仍可手动执行，但不再收集
    runner()
    expect(dummy).toBe(3)

    obj.prop = 4
    expect(dummy).toBe(3)
  })

  it('should call onStop when stopped', () => {
    const onStop = vi.fn()
    const runner = effect(() => {}, { onStop })
    stop(runner)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('should stop the effect when stop is called multiple times', () => {
    const onStop = vi.fn()
    const runner = effect(() => {}, { onStop })
    stop(runner)
    stop(runner)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  // ---- pause / resume tracking ----
  it('should allow pausing tracking', () => {
    let dummy
    const obj = reactive({ foo: 1 })
    const spy = vi.fn(() => {
      pauseTracking()
      dummy = obj.foo
      resetTracking()
    })
    effect(spy)

    expect(dummy).toBe(1)
    expect(spy).toHaveBeenCalledTimes(1)

    // obj.foo 是在暂停追踪时读的 → 没建立依赖 → 不触发
    obj.foo = 2
    expect(spy).toHaveBeenCalledTimes(1)
    expect(dummy).toBe(1)
  })

  // ---- ref 的订阅 ----
  it('should observe refs', () => {
    let dummy
    const r = ref(1)
    effect(() => (dummy = r.value))
    expect(dummy).toBe(1)

    r.value = 5
    expect(dummy).toBe(5)
  })
})