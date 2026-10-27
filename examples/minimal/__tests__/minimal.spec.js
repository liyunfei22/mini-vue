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
import { h, Text, createApp, queueJob } from '../renderer.js'

/** 等待微任务队列 flush（渲染更新是异步的） */
const flush = () => new Promise((r) => queueMicrotask(r))

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

describe('renderer: h 与 mount', () => {
  it('h 归一化：裸字符串/数字/单 vnode 全部变成 Text vnode 数组', () => {
    expect(h('p', null, 'hi').children).toEqual([{ type: Text, children: 'hi', el: null, component: null }])
    expect(h('p', null, 42).children[0].children).toBe('42')
    expect(h('p', null, h('b', null, 'x')).children).toHaveLength(1)
  })

  it('mount 元素与文本：innerHTML 形状正确', () => {
    const container = document.createElement('div')
    createApp({
      setup: () => ({}),
      render: () => h('div', { id: 'app', class: 'x' }, [h('p', null, 'hello'), h('i', null, 'world')]),
    }).mount(container)
    expect(container.innerHTML).toBe('<div id="app" class="x"><p>hello</p><i>world</i></div>')
  })

  it('状态变更 → 微任务 flush 后 DOM 更新', async () => {
    const count = ref(0)
    const container = document.createElement('div')
    createApp({
      setup: () => ({ count }),
      render: (ctx) => h('p', null, `计数：${ctx.count}`),
    }).mount(container)
    expect(container.innerHTML).toBe('<p>计数：0</p>')
    count.value = 1
    expect(container.innerHTML).toBe('<p>计数：0</p>') // 还没 flush
    await flush()
    expect(container.innerHTML).toBe('<p>计数：1</p>')
  })

  it('批更新：一次任务多次改状态，render 只重跑一次', async () => {
    const count = ref(0)
    let renders = 0
    const container = document.createElement('div')
    createApp({
      setup: () => ({ count }),
      render: (ctx) => {
        renders++
        return h('p', null, ctx.count)
      },
    }).mount(container)
    expect(renders).toBe(1) // 首跑一次
    count.value = 1
    count.value = 2
    count.value = 3
    await flush()
    expect(container.innerHTML).toBe('<p>3</p>')
    expect(renders).toBe(2) // 三次改动只补跑一次
  })

  it('事件绑定与换绑：旧 handler 解绑，新 handler 生效', async () => {
    const container = document.createElement('div')
    const a = () => calls.push('a')
    const b = () => calls.push('b')
    const calls = []
    const state = ref(0)
    createApp({
      setup: () => ({ state, a, b }),
      render: (ctx) => h('button', { onClick: ctx.state === 0 ? ctx.a : ctx.b }, 'go'),
    }).mount(container)
    const btn = container.querySelector('button')
    btn.dispatchEvent(new MouseEvent('click'))
    expect(calls).toEqual(['a'])
    state.value = 1
    await flush()
    btn.dispatchEvent(new MouseEvent('click'))
    expect(calls).toEqual(['a', 'b']) // a 已解绑，没有重复触发
  })

  it('就地 diff：增删都在正确位置', async () => {
    const list = ref(['a', 'b'])
    const container = document.createElement('div')
    createApp({
      setup: () => ({ list }),
      render: (ctx) => h('ul', null, ctx.list.map((t) => h('li', null, t))),
    }).mount(container)
    list.value = ['x', 'a', 'b'] // 头部插入
    await flush()
    expect(container.innerHTML).toBe('<ul><li>x</li><li>a</li><li>b</li></ul>')
    list.value = ['x'] // 尾部删除
    await flush()
    expect(container.innerHTML).toBe('<ul><li>x</li></ul>')
  })

  it('换型即重建：type 变化时旧节点卸载、新节点挂载', async () => {
    const toggle = ref(true)
    const container = document.createElement('div')
    createApp({
      setup: () => ({ toggle }),
      render: (ctx) => (ctx.toggle ? h('div', null, 'div 形态') : h('p', null, 'p 形态')),
    }).mount(container)
    expect(container.innerHTML).toBe('<div>div 形态</div>')
    toggle.value = false
    await flush()
    expect(container.innerHTML).toBe('<p>p 形态</p>')
  })

  it.todo('重排 = 设计内局限：无 key 就地 diff 让勾选状态跟着位置走（不做 keyed diff，文章 07 的主题）')
})

describe('renderer: 组件', () => {
  it('props 下传：父更新 props → 子组件自动重渲染（props 响应式化）', async () => {
    const step = ref(1)
    const container = document.createElement('div')
    const Child = {
      setup(props) {
        return { read: () => props.step }
      },
      render: (ctx) => h('span', null, `step=${ctx.props.step}`),
    }
    createApp({
      setup: () => ({ step }),
      render: (ctx) => h(Child, { step: ctx.step }),
    }).mount(container)
    expect(container.innerHTML).toBe('<span>step=1</span>')
    step.value = 5
    await flush()
    expect(container.innerHTML).toBe('<span>step=5</span>')
  })

  it('emit 上抛：子组件事件驱动父组件状态', async () => {
    const container = document.createElement('div')
    const Child = {
      setup(_props, { emit }) {
        return { go() { emit('update', 42) } }
      },
      render: (ctx) => h('button', { onClick: ctx.go }, 'go'),
    }
    const total = ref(0)
    createApp({
      setup: () => ({ total, Child }),
      render: (ctx) => h('div', null, [h('p', null, ctx.total), h(ctx.Child, { onUpdate: (n) => (total.value += n) })]),
    }).mount(container)
    container.querySelector('button').dispatchEvent(new MouseEvent('click'))
    await flush()
    expect(container.querySelector('p').textContent).toBe('42')
  })

  it('组件卸载 stop：卸载后共享状态变化不复活 DOM', async () => {
    const shared = ref(0)
    const show = ref(true)
    const container = document.createElement('div')
    const Child = {
      setup: () => ({ shared }),
      render: (ctx) => h('p', null, `shared:${ctx.shared}`),
    }
    const app = createApp({
      setup: () => ({ show, Child }),
      render: (ctx) => (ctx.show ? h(ctx.Child) : h('div', null, 'gone')),
    })
    app.mount(container)
    show.value = false
    await flush()
    expect(container.innerHTML).toBe('<div>gone</div>')
    shared.value = 999
    await flush()
    expect(container.innerHTML).toBe('<div>gone</div>') // 没有复活
  })
})