// @vitest-environment jsdom
/**
 * renderer.spec.ts —— runtime-dom 渲染器行为镜像测试（jsdom）
 * 对齐真 Vue packages/runtime-dom/__tests__/rendererElement.spec.ts、
 * runtime-core 的 rendererComponent/rendererProps/rendererEmits 等的经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createApp,
  h,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  onUpdated,
  provide,
  ref,
} from '../src'

function mount(component: any) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(component)
  const instance = app.mount(container)
  return { app, container, instance }
}

describe('renderer: mount', () => {
  it('should mount element with props and text', () => {
    const { container } = mount(() => h('div', { id: 'app' }, 'hello'))
    expect(container.innerHTML).toBe('<div id="app">hello</div>')
  })

  it('should mount nested children', () => {
    const { container } = mount(() => h('div', [h('span', 'a'), h('span', 'b')]))
    expect(container.innerHTML).toBe('<div><span>a</span><span>b</span></div>')
  })

  it('should mount function components', () => {
    const Comp = () => h('p', 'fn')
    const { container } = mount(Comp)
    expect(container.innerHTML).toBe('<p>fn</p>')
  })
})

describe('renderer: lifecycle', () => {
  it('should run parent/child onMounted in depth-first order', async () => {
    const calls: string[] = []
    const Child = {
      setup() {
        onMounted(() => calls.push('child:mounted'))
      },
      render: () => h('span', 'child'),
    }
    const App = {
      setup() {
        onMounted(() => calls.push('parent:mounted'))
      },
      render: () => h('div', [h(Child)]),
    }
    mount(App)
    await nextTick()
    expect(calls).toEqual(['child:mounted', 'parent:mounted'])
  })

  it('should fire onUpdated after a reactive re-render', async () => {
    const onUpd = vi.fn()
    const count = ref(0)
    const App = {
      setup() {
        onUpdated(onUpd)
        return () => h('p', String(count.value))
      },
    }
    const { container } = mount(App)
    expect(container.textContent).toBe('0')

    count.value = 1
    await nextTick()
    expect(container.textContent).toBe('1')
    expect(onUpd).toHaveBeenCalledTimes(1)
  })

  it('should fire onUnmounted when component is removed', async () => {
    const onUnmount = vi.fn()
    const show = ref(true)
    const Child = {
      setup() {
        onUnmounted(onUnmount)
      },
      render: () => h('span', 'child'),
    }
    const App = {
      render: () => (show.value ? h(Child) : null),
    }
    mount(App)

    show.value = false
    await nextTick()
    expect(onUnmount).toHaveBeenCalledTimes(1)
  })

  it('unmounted component stays gone when shared state changes', async () => {
    const shared = ref(0)
    const show = ref(true)
    const Child = {
      render: () => h('p', `child:${shared.value}`),
    }
    const App = {
      render: () => (show.value ? h(Child) : null),
    }
    const { container } = mount(App)
    expect(container.textContent).toBe('child:0')

    show.value = false
    await nextTick()
    expect(container.textContent).toBe('')

    // 共享依赖变化：已卸载组件的渲染 effect 若未被 scope.stop() 停掉，会把 DOM 复活
    shared.value = 1
    await nextTick()
    expect(container.textContent).toBe('')
  })
})

describe('renderer: reactivity-driven updates', () => {
  it('should re-render text when ref changes', async () => {
    const count = ref(0)
    const { container } = mount({ render: () => h('p', String(count.value)) })
    expect(container.textContent).toBe('0')

    count.value = 1
    await nextTick()
    expect(container.textContent).toBe('1')
  })

  it('should hot-swap element type when template toggles', async () => {
    const toggle = ref(true)
    const { container } = mount({
      render: () => (toggle.value ? h('div', 'A') : h('span', 'B')),
    })
    expect(container.innerHTML).toBe('<div>A</div>')

    toggle.value = false
    await nextTick()
    expect(container.innerHTML).toBe('<span>B</span>')
  })

  it('should update props on the same element', async () => {
    const cls = ref('a')
    const { container } = mount({
      render: () => h('div', { class: cls.value }, 'x'),
    })
    expect(container.innerHTML).toBe('<div class="a">x</div>')

    cls.value = 'b'
    await nextTick()
    expect(container.innerHTML).toBe('<div class="b">x</div>')
  })
})

describe('renderer: props & emits', () => {
  it('props flow parent → child and update', async () => {
    const msg = ref('a')
    const Child = {
      props: ['msg'],
      render: (ctx: any) => h('p', ctx.msg),
    }
    const App = {
      render: () => h(Child, { msg: msg.value }),
    }
    const { container } = mount(App)
    expect(container.textContent).toBe('a')

    msg.value = 'b'
    await nextTick()
    expect(container.textContent).toBe('b')
  })

  it('emit flows child → parent', () => {
    const seen: string[] = []
    const Child = {
      setup(_props: any, { emit }: any) {
        return { emit }
      },
      render: (ctx: any) =>
        h('button', { onClick: () => ctx.emit('go', 'hi') }, 'btn'),
    }
    const App = {
      render: () => h(Child, { onGo: (v: string) => seen.push(v) }),
    }
    const { container } = mount(App)
    const btn = container.querySelector('button')!
    btn.dispatchEvent(new Event('click'))
    expect(seen).toEqual(['hi'])
  })
})

describe('renderer: attrs fallthrough', () => {
  it('passes undeclared attrs to the root element and merges class', () => {
    const Child = {
      props: ['msg'],
      render: (ctx: any) => h('div', { class: 'inner' }, ctx.msg),
    }
    const App = {
      render: () => h(Child, { msg: 'hi', class: 'outer', 'data-id': '1' }),
    }
    const { container } = mount(App)
    expect(container.innerHTML).toBe('<div class="inner outer" data-id="1">hi</div>')
  })

  it('respects inheritAttrs: false', () => {
    const Child = {
      inheritAttrs: false,
      props: ['msg'],
      render: (ctx: any) => h('div', { class: 'inner' }, ctx.msg),
    }
    const App = {
      render: () => h(Child, { msg: 'hi', class: 'outer' }),
    }
    const { container } = mount(App)
    expect(container.innerHTML).toBe('<div class="inner">hi</div>')
  })
})

describe('renderer: provide/inject', () => {
  it('inject resolves through the prototype chain across 3 levels', async () => {
    const Theme = Symbol('theme')
    const C = {
      setup() {
        const t = inject(Theme)
        return () => h('i', String(t))
      },
    }
    const B = {
      setup() {
        return () => h(C)
      },
    }
    const A = {
      setup() {
        provide(Theme, 'dark')
        return () => h(B)
      },
    }
    const { container } = mount(A)
    await nextTick()
    expect(container.textContent).toBe('dark')
  })

  it('app.provide reaches all components', async () => {
    const Count = Symbol('count')
    const Comp = {
      setup() {
        const n = inject(Count)
        return () => h('span', String(n))
      },
    }
    const container = document.createElement('div')
    createApp(Comp)
      .provide(Count, 42)
      .mount(container)
    expect(container.textContent).toBe('42')
  })
})

describe('renderer: slots', () => {
  // 注：App 是根组件，实际挂载的是 App 的子树（Child 的渲染结果），所以容器里只有一层 div
  it('renders default slot', () => {
    const Child = {
      setup(_p: any, { slots }: any) {
        return () => h('div', slots.default())
      },
    }
    const App = {
      render: () => h(Child, null, { default: () => h('span', 'hello') }),
    }
    const { container } = mount(App)
    expect(container.innerHTML).toBe('<div><span>hello</span></div>')
  })

  it('renders named slots', () => {
    const Child = {
      setup(_p: any, { slots }: any) {
        return () => h('div', [h('header', slots.header()), h('footer', slots.footer())])
      },
    }
    const App = {
      render: () =>
        h(Child, null, {
          header: () => h('b', 'H'),
          footer: () => h('i', 'F'),
        }),
    }
    const { container } = mount(App)
    expect(container.innerHTML).toBe(
      '<div><header><b>H</b></header><footer><i>F</i></footer></div>',
    )
  })
})