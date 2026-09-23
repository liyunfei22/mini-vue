// @vitest-environment jsdom
/**
 * 阶段 7-1：Options API（data/computed/methods/watch/生命周期） + v-model 修饰符
 */
import { describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from '../../vue/src'

describe('Options API', () => {
  it('data + computed + methods + template', async () => {
    const container = document.createElement('div')
    createApp({
      data() {
        return { count: 0 }
      },
      computed: {
        double() {
          return (this as any).count * 2
        },
      },
      methods: {
        inc() {
          ;(this as any).count++
        },
      },
      template: `<div><p>{{ count }} / {{ double }}</p><button @click="inc">+</button></div>`,
    }).mount(container)

    expect(container.innerHTML).toBe(
      '<div><p>0 / 0</p><button>+</button></div>',
    )
    container.querySelector('button')!.dispatchEvent(new Event('click'))
    await nextTick()
    expect(container.innerHTML).toBe(
      '<div><p>1 / 2</p><button>+</button></div>',
    )
  })

  it('watch option fires on data change', async () => {
    const spy = vi.fn()
    const container = document.createElement('div')
    const app = createApp({
      data() {
        return { n: 1 }
      },
      watch: {
        n(a: number, b: number) {
          spy(a, b)
        },
      },
      methods: {
        bump() {
          ;(this as any).n = 5
        },
      },
      template: `<p @click="bump">{{ n }}</p>`,
    })
    app.mount(container)
    container.querySelector('p')!.dispatchEvent(new Event('click'))
    await nextTick()
    expect(spy).toHaveBeenCalledWith(5, 1)
  })

  it('lifecycle: created runs before mounted', async () => {
    const order: string[] = []
    const container = document.createElement('div')
    createApp({
      data() {
        return { ready: false }
      },
      created() {
        order.push('created')
        ;(this as any).ready = true
      },
      mounted() {
        order.push('mounted')
      },
      template: `<p>{{ ready }}</p>`,
    }).mount(container)

    await nextTick()
    expect(order).toEqual(['created', 'mounted'])
    expect(container.textContent).toBe('true')
  })

  it('mixes with setup (setup wins on same key)', () => {
    const container = document.createElement('div')
    createApp({
      setup() {
        return { count: 999 }
      },
      data() {
        return { count: 0, other: 'x' }
      },
      render: (ctx: any) => h('p', `${ctx.count}:${ctx.other}`),
    }).mount(container)
    expect(container.textContent).toBe('999:x')
  })

  it('supports methods without a data() option (no frozen EMPTY_OBJ crash)', () => {
    const container = document.createElement('div')
    createApp({
      methods: {
        twice(n: number) {
          return n * 2
        },
      },
      render(ctx: any): any {
        return h('p', String(ctx.twice(21)))
      },
    }).mount(container)
    expect(container.textContent).toBe('42')
  })
})

describe('v-model modifiers', () => {
  function mountInput(template: string, key: string, value: any) {
    const container = document.createElement('div')
    createApp({ setup: () => ({ [key]: value }), template }).mount(container)
    return container.querySelector('input') as HTMLInputElement
  }

  it('.trim trims whitespace', () => {
    const name = ref('')
    const input = mountInput(`<input v-model.trim="name" />`, 'name', name)
    input.value = '  hi  '
    input.dispatchEvent(new Event('input'))
    expect(name.value).toBe('hi')
  })

  it('.number parses to number, NaN stays raw', () => {
    const age = ref(0)
    const input = mountInput(`<input v-model.number="age" />`, 'age', age)
    input.value = '42'
    input.dispatchEvent(new Event('input'))
    expect(age.value).toBe(42)

    input.value = 'abc'
    input.dispatchEvent(new Event('input'))
    expect(age.value).toBe('abc')
  })

  it('.lazy uses change instead of input', () => {
    const name = ref('mini')
    const input = mountInput(`<input v-model.lazy="name" />`, 'name', name)
    input.value = 'vue'
    input.dispatchEvent(new Event('input'))
    expect(name.value).toBe('mini')

    input.dispatchEvent(new Event('change'))
    expect(name.value).toBe('vue')
  })
})

it('stub', () => {})
