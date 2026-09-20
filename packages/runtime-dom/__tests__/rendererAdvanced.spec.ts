// @vitest-environment jsdom
/**
 * rendererAdvanced.spec.ts —— invoker / globalProperties / plugin / 动态组件
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createApp,
  h,
  nextTick,
  onUnmounted,
  ref,
  resolveDynamicComponent,
} from '../src'

function mountIn(component: any) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(component)
  app.mount(container)
  return { app, container }
}

describe('event invoker', () => {
  it('always uses the latest handler after re-render (no re-bind needed)', async () => {
    const pushed: number[] = []
    const marker = ref(0)
    const { container } = mountIn({
      render: () => h('button', { onClick: () => pushed.push(marker.value) }, 'btn'),
    })
    const btn = container.querySelector('button')!

    btn.click()
    expect(pushed).toEqual([0])

    marker.value = 5
    await nextTick()
    btn.click()
    expect(pushed).toEqual([0, 5])
  })

  it('event listener is bound only once per event name', async () => {
    const handlers: Array<() => void> = []
    const spy = vi.fn()
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener')

    const { container } = mountIn({
      setup() {
        return { spy }
      },
      render: (ctx: any) => h('button', { onClick: ctx.spy }, 'btn'),
    })

    await nextTick()
    const countAfterFirst = addSpy.mock.calls.filter((c) => c[0] === 'click').length
    expect(countAfterFirst).toBe(1)
    void handlers
    void container
    addSpy.mockRestore()
  })
})

describe('app.config.globalProperties', () => {
  it('should be accessible as a fallback in render context', () => {
    const container = document.createElement('div')
    const app = createApp({
      render: (ctx: any) => h('span', ctx.$t),
    })
    app.config.globalProperties.$t = 'hello'
    app.mount(container)
    expect(container.textContent).toBe('hello')
  })
})

describe('app.use plugins', () => {
  it('installs object plugins with app as arg', () => {
    const install = vi.fn()
    const app = createApp({ render: () => h('div') })
    app.use({ install })
    expect(install).toHaveBeenCalledTimes(1)
    expect(install.mock.calls[0][0]).toBe(app)
  })

  it('installs function plugins', () => {
    const plugin = vi.fn()
    const app = createApp({ render: () => h('div') })
    app.use(plugin)
    expect(plugin).toHaveBeenCalledWith(app)
  })
})

describe('app.unmount', () => {
  it('clears the container and fires component unmounted hooks', async () => {
    const onUnmount = vi.fn()
    const { app, container } = mountIn({
      setup() {
        onUnmounted(onUnmount)
        return () => h('span', 'x')
      },
      render: null,
    })

    expect(container.innerHTML).toBe('<span>x</span>')
    app.unmount()
    await nextTick()
    expect(container.innerHTML).toBe('') // 容器被清空
    expect(onUnmount).toHaveBeenCalledTimes(1)
  })
})

describe('dynamic component (resolveDynamicComponent)', () => {
  it('resolves a globally registered component by name', async () => {
    const Reg = { render: () => h('b', 'registered') }
    const container = document.createElement('div')
    const app = createApp({
      render: () => h(resolveDynamicComponent('MyComp')),
    })
    app.component('MyComp', Reg)
    app.mount(container)
    await nextTick()
    expect(container.innerHTML).toBe('<b>registered</b>')
  })

  it('re-resolves when the :is value changes', async () => {
    const A = { render: () => h('p', 'A') }
    const B = { render: () => h('p', 'B') }
    const which = ref(A)
    const container = document.createElement('div')
    const app = createApp({
      render: () => h(which.value),
    })
    app.mount(container)
    expect(container.innerHTML).toBe('<p>A</p>')

    which.value = B
    await nextTick()
    expect(container.innerHTML).toBe('<p>B</p>')
  })
})