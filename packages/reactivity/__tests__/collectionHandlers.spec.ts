/**
 * collectionHandlers.spec.ts —— Map / Set 专化拦截器行为镜像测试
 * 对齐真 Vue packages/reactivity/__tests__/{reactiveMap,reactiveSet}.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  effect,
  isReactive,
  markRaw,
  reactive,
  readonly,
  toRaw,
} from '../src'

describe('reactive Map', () => {
  it('should be reactive via get() / size', () => {
    const map = reactive(new Map() as Map<string, number>)
    let dummy = 0
    effect(() => {
      dummy += map.get('key') ?? 0
    })
    expect(dummy).toBe(0)

    map.set('key', 1)
    expect(dummy).toBe(1)
    map.set('key', 2)
    expect(dummy).toBe(3)
    map.delete('key')
    expect(dummy).toBe(3)
  })

  it('should observe size', () => {
    const map = reactive(new Map() as Map<string, unknown>)
    let dummy
    effect(() => (dummy = map.size))
    expect(dummy).toBe(0)

    map.set('key', 'value')
    expect(dummy).toBe(1)
    map.set('key', 'value2')
    expect(dummy).toBe(1) // 改值不改 size
    map.delete('key')
    expect(dummy).toBe(0)
  })

  it('should observe has()', () => {
    const map = reactive(new Map() as Map<string, number>)
    let dummy
    effect(() => (dummy = map.has('key')))
    expect(dummy).toBe(false)

    map.set('key', 1)
    expect(dummy).toBe(true)
    map.delete('key')
    expect(dummy).toBe(false)
  })

  it('should observe forEach', () => {
    const map = reactive(new Map<string, number>())
    let dummy = 0
    effect(() => {
      dummy = 0
      map.forEach((v) => (dummy += v))
    })
    expect(dummy).toBe(0)

    map.set('a', 1)
    map.set('b', 2)
    expect(dummy).toBe(3)
    map.delete('a')
    expect(dummy).toBe(2)
  })

  it('should observe iteration (for...of/keys/values/entries)', () => {
    const map = reactive(new Map<string, number>([['a', 1]]))
    let seen: Array<[string, number]> = []
    effect(() => {
      seen = []
      for (const [k, v] of map) seen.push([k, v])
    })
    expect(seen).toEqual([['a', 1]])

    map.set('b', 2)
    expect(seen).toEqual([
      ['a', 1],
      ['b', 2],
    ])

    // keys() 只关心键集变化
    let keys: string[] = []
    effect(() => {
      keys = [...map.keys()]
    })
    expect(keys).toEqual(['a', 'b'])
    map.set('a', 10) // 值变了，键集没变 → 不触发 keys 订阅者
    expect(keys).toEqual(['a', 'b'])
  })

  it('should return reactive values from get/iteration', () => {
    const map = reactive(new Map<string, object>())
    map.set('nested', { foo: 1 })

    const nested = map.get('nested')!
    expect(isReactive(nested)).toBe(true) // 读出来是 reactive 视图

    const vals = [...map.values()]
    expect(isReactive(vals[0])).toBe(true)
  })

  it('should not trigger when setting the same value', () => {
    const map = reactive(new Map<string, number>())
    map.set('key', 1)
    const spy = vi.fn(() => map.get('key'))
    effect(spy)

    map.set('key', 1)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should observe clear', () => {
    const map = reactive(new Map<string, number>([['a', 1]]))
    let dummy
    effect(() => (dummy = map.size))
    map.clear()
    expect(dummy).toBe(0)
  })

  it('raw/reactive key consistency', () => {
    const rawKey = { id: 1 }
    const map = reactive(new Map<object, number>())
    map.set(rawKey, 1)
    expect(map.get(rawKey)).toBe(1)
    // 用 reactive 包裹的 key 也能命中
    expect(map.get(reactive(rawKey as any))).toBe(1)
  })

  it('toRaw / isReactive on collection proxies', () => {
    const raw = new Map([['k', 1]])
    const observed = reactive(raw)
    expect(toRaw(observed)).toBe(raw)
    expect(isReactive(observed)).toBe(true)
  })

  it('markRaw value stays raw', () => {
    const rawObj = markRaw({})
    const map = reactive(new Map())
    map.set('k', rawObj)
    expect(map.get('k')).toBe(rawObj)
    expect(isReactive(map.get('k'))).toBe(false)
  })

  it('readonly map: mutations warn and do not apply', () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ro = readonly(new Map() as Map<string, number>)
    ro.set('key', 1)
    expect(warningSpy).toHaveBeenCalled()
    expect(ro.has('key')).toBe(false)
    warningSpy.mockRestore()
  })
})

describe('reactive Set', () => {
  it('should observe add / has / size / delete', () => {
    const set = reactive(new Set<number>())
    let has, size
    effect(() => {
      has = set.has(1)
      size = set.size
    })
    expect(has).toBe(false)
    expect(size).toBe(0)

    set.add(1)
    expect(has).toBe(true)
    expect(size).toBe(1)

    set.delete(1)
    expect(has).toBe(false)
    expect(size).toBe(0)
  })

  it('should not trigger on adding an existing item', () => {
    const set = reactive(new Set<number>([1]))
    const spy = vi.fn(() => set.size)
    effect(spy)

    set.add(1)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should observe iteration / forEach', () => {
    const set = reactive(new Set<number>([1, 2]))
    let sum = 0
    effect(() => {
      sum = 0
      for (const v of set) sum += v
    })
    expect(sum).toBe(3)

    set.add(3)
    expect(sum).toBe(6)
  })

  it('should observe values()', () => {
    const set = reactive(new Set<number>([1]))
    let seen: number[] = []
    effect(() => {
      seen = [...set.values()]
    })
    expect(seen).toEqual([1])
    set.add(2)
    expect(seen).toEqual([1, 2])
  })

  it('should observe clear', () => {
    const set = reactive(new Set<number>([1, 2]))
    let dummy
    effect(() => (dummy = set.size))
    set.clear()
    expect(dummy).toBe(0)
  })
})