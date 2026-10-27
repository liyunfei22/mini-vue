// @vitest-environment jsdom
/**
 * minimal.spec.js —— 最小闭环的行为契约
 *
 * 定位：行为文档，不是守门员。demo 能看到的（点按钮、DOM 变）少测，
 * 重点测 demo 观测不到的边界（惰性、缓存、防自触发、调度合并、卸载停止）。
 * 分组与 examples/minimal 的文件一一对应；本文件跨 commit 渐进补齐。
 */
import { describe, expect, it } from 'vitest'
import { effect, stop, reactive, ref, proxyRefs, computed } from '../reactivity.js'

describe('reactivity: 账本与 effect', () => {
  it('effect 首跑收集依赖，改依赖后重跑', () => {
    const state = reactive({ count: 0 })
    let n = 0
    effect(() => {
      n = state.count * 2
    })
    expect(n).toBe(0)
    state.count = 5
    expect(n).toBe(10)
  })

  it('reactive 缓存：同一对象恒同一代理（保引用相等）', () => {
    const raw = { a: 1 }
    expect(reactive(raw)).toBe(reactive(raw))
  })

  it('深度懒代理：读到的子对象才是代理，且缓存', () => {
    const state = reactive({ nested: { v: 1 } })
    let read
    effect(() => {
      read = state.nested.v
    })
    state.nested.v = 2
    expect(read).toBe(2)
    expect(reactive(state.nested)).toBe(state.nested)
  })

  it('trigger 跳过自身：effect 里改自己的依赖不死循环', () => {
    const state = reactive({ n: 0 })
    let runs = 0
    effect(() => {
      runs++
      if (state.n < 3) state.n++ // 改的就是自己读的 key
    })
    expect(runs).toBe(1) // 只跑一次首跑，没有循环
  })

  it('嵌套 effect：内层结束后 activeEffect 指回外层', () => {
    const outer = reactive({ o: 1 })
    const inner = reactive({ i: 0 })
    let seen = []
    effect(() => {
      seen.push(`o:${outer.o}`)
      effect(() => {
        seen.push(`i:${inner.i}`)
      })
    })
    expect(seen).toEqual(['o:1', 'i:0'])
    inner.i = 9 // 内层 effect 独立重跑，不连累外层
    expect(seen).toEqual(['o:1', 'i:0', 'i:9'])
    outer.o = 7 // 外层重跑会重建内层；此时 inner.i 已是 9，新内层首跑读到 9
    expect(seen).toEqual(['o:1', 'i:0', 'i:9', 'o:7', 'i:9'])
  })

  it('无 cleanup 的设计内局限：旧内层 effect 残留依赖，多余重跑一次（渲染幂等，可接受）', () => {
    // 与上一测试同构，但预期是「幽灵重跑确实发生」：
    // 外层 effect 重跑会重建内层 B，而旧内层 A 仍挂在 inner.i 的账本上
    const outer = reactive({ o: 0 })
    const inner = reactive({ i: 0 })
    let seen = []
    effect(() => {
      void outer.o
      effect(() => seen.push(`i:${inner.i}`))
    })
    outer.o = 1 // 外层重跑 → 重建内层 B（A 残留依赖）
    seen = []
    inner.i = 1 // 旧内层（残留）+ 新内层 都被触发 —— 两次 push
    expect(seen).toEqual(['i:1', 'i:1'])
    // mini-vue 的 effect.deps 清理（cleanup）正是为消灭这种多余触发而存在；
    // 渲染幂等：看到两次 push 无害。这里不修，文章 02 是它完整主题。
  })

  it('scheduler：不立即重跑，把更新交给调度器', () => {
    const state = reactive({ n: 0 })
    let runs = 0
    let scheduled = 0
    effect(
      () => {
        runs++
        void state.n
      },
      {
        scheduler() {
          scheduled++
        },
      },
    )
    expect(runs).toBe(1)
    state.n = 1
    expect(runs).toBe(1) // 没有直接重跑
    expect(scheduled).toBe(1) // 而是调度了一次
  })

  it('stop 后不再重跑（卸载语义）', () => {
    const state = reactive({ n: 0 })
    let runs = 0
    const runner = effect(() => {
      runs++
      void state.n
    })
    stop(runner)
    state.n = 5
    expect(runs).toBe(1) // 首跑之后没有重跑
  })
})

describe('reactivity: ref / proxyRefs', () => {
  it('ref 读写触发 effect', () => {
    const count = ref(0)
    let seen
    effect(() => {
      seen = count.value
    })
    count.value = 3
    expect(seen).toBe(3)
  })

  it('ref 相同值不触发', () => {
    const count = ref(1)
    let runs = 0
    effect(() => {
      runs++
      void count.value
    })
    count.value = 1
    expect(runs).toBe(1)
  })

  it('proxyRefs 解包顶层 ref：读裸值、写回 ref', () => {
    const setup = proxyRefs({ count: ref(0), fixed: 1 })
    expect(setup.count).toBe(0)
    setup.count = 5
    expect(setup.count).toBe(5)
    expect(setup.fixed).toBe(1)
    // 写回触发依赖（模板侧 v-model 语义的根基）
    let seen
    effect(() => {
      seen = setup.count
    })
    setup.count = 7
    expect(seen).toBe(7)
  })
})

describe('reactivity: computed 惰性与缓存', () => {
  it('不读不计算；读两次只算一次（脏位缓存）', () => {
    let calls = 0
    const c = computed(() => {
      calls++
      return 42
    })
    expect(calls).toBe(0) // lazy
    expect(c.value).toBe(42)
    expect(c.value).toBe(42)
    expect(calls).toBe(1) // 缓存
  })

  it('依赖变化置脏，下次读重算；下游 effect 同步得知', () => {
    const state = reactive({ a: 1, b: 2 })
    const c = computed(() => state.a + state.b)
    let seen
    effect(() => {
      seen = c.value
    })
    expect(seen).toBe(3)
    state.a = 10
    expect(seen).toBe(12) // 不读 c 也触发下游——scheduler 里 trigger 的功劳
    expect(c.value).toBe(12)
    state.b = 10
    expect(c.value).toBe(20)
  })
})