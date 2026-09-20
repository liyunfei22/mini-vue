/**
 * effectScope.spec.ts —— 作用域容器行为镜像测试
 * 对齐真 Vue packages/reactivity/__tests__/effectScope.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  computed,
  effect,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
} from '../src'

describe('effectScope', () => {
  it('should run the fn and capture effects created inside', () => {
    let run = 0
    const counter = reactive({ num: 1 })
    const scope = effectScope()

    scope.run(() => {
      const c = computed(() => counter.num + 1)
      effect(() => (run = c.value))
    })

    expect(run).toBe(2)
    // scope 里创建了 effect + computed
    expect(scope.effects.length).toBe(2)

    counter.num = 3
    expect(run).toBe(4)
  })

  it('should stop all effects inside after scope.stop()', () => {
    let dummy = 0
    const counter = reactive({ num: 1 })
    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
    })
    expect(dummy).toBe(1)

    scope.stop()
    counter.num = 100
    // 已停止：不再触发
    expect(dummy).toBe(1)
    expect(scope.active).toBe(false)
  })

  it('should not create orphan effects after stop (inactive scope effects die at birth)', () => {
    const scope = effectScope()
    scope.stop()
    let dummy = 0
    const counter = reactive({ num: 1 })
    // scope 已停，里面 new 的 effect 一出生就失活
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runner = scope.run(() => {
      effect(() => (dummy = counter.num))
    })
    expect(runner).toBeUndefined()
    expect(dummy).toBe(0)
    counter.num = 2
    expect(dummy).toBe(0)
  })

  it('should stop chained scopes recursively', () => {
    const scope = effectScope()
    let dummy = 0
    const counter = reactive({ num: 1 })
    scope.run(() => {
      const child = effectScope()
      child.run(() => {
        effect(() => (dummy = counter.num))
      })
      scope.scopes!.push(child as any)
    })
    expect(dummy).toBe(1)

    scope.stop()
    counter.num = 42
    expect(dummy).toBe(1) // 子 scope 的 effect 也被一并停掉
  })

  it('detached scope should survive parent scope stop', () => {
    let dummy = 0
    const num = ref(1)
    const scope = effectScope()
    const detached = effectScope(true)

    scope.run(() => {
      detached.run(() => effect(() => (dummy = num.value)))
    })

    expect(dummy).toBe(1)
    scope.stop() // 父 scope 停了
    num.value = 2
    expect(dummy).toBe(2) // detached 的 effect 还活着
  })

  it('should call onScopeDispose callbacks on stop, in registration order', () => {
    const scope = effectScope()
    const order: string[] = []
    scope.run(() => {
      onScopeDispose(() => order.push('first'))
      onScopeDispose(() => order.push('second'))
    })

    scope.stop()
    expect(order).toEqual(['first', 'second'])
  })

  it('getCurrentScope inside run() returns the scope', () => {
    const scope = effectScope()
    let current: any
    scope.run(() => {
      current = getCurrentScope()
    })
    expect(current).toBe(scope)
    expect(getCurrentScope()).toBeUndefined() // run 结束后还原
  })

  it('should warn when running an inactive scope', () => {
    const scope = effectScope()
    scope.stop()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    scope.run(() => {})
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('nested onScopeDispose belongs to the nearest scope', () => {
    const root = effectScope()
    const nested = effectScope()
    const disposeRoot = vi.fn()
    const disposeNested = vi.fn()

    root.run(() => {
      onScopeDispose(disposeRoot)
      nested.run(() => {
        onScopeDispose(disposeNested)
      })
    })

    // 停内层 scope：只清内层
    nested.stop()
    expect(disposeNested).toHaveBeenCalledTimes(1)
    expect(disposeRoot).not.toHaveBeenCalled()

    root.stop()
    expect(disposeRoot).toHaveBeenCalledTimes(1)
  })
})