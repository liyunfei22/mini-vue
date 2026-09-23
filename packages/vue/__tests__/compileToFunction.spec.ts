// @vitest-environment jsdom
/**
 * compileToFunction.spec.ts —— 「模板 → 编译 → 运行时挂载」端到端闭环测试
 * 这是阶段 5 的验收：模板字符串编译出的 render 跑通整个 runtime（响应式/事件/指令/插槽）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createApp, ref, nextTick, compileToFunction, inject, provide } from '../src'

function mountTpl(template: string, setup?: () => Record<string, any>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp({
    setup: setup ? () => setup() : undefined,
    template,
  })
  app.mount(container)
  return { app, container }
}

describe('template compile → runtime (end-to-end)', () => {
  it('compiles and mounts an element with interpolation', async () => {
    const count = ref(0)
    const { container } = mountTpl(
      `<div class="counter">{{ count }}</div>`,
      () => ({ count }),
    )
    expect(container.innerHTML).toBe('<div class="counter">0</div>')

    count.value = 42
    await nextTick()
    expect(container.innerHTML).toBe('<div class="counter">42</div>')
  })

  it('binds attributes and class reactively', async () => {
    const cls = ref('red')
    const { container } = mountTpl(
      `<p :class="cls" :data-n="n">{{ msg }}</p>`,
      () => ({ cls, n: 1, msg: 'hello' }),
    )
    expect(container.innerHTML).toBe('<p class="red" data-n="1">hello</p>')

    cls.value = 'blue'
    await nextTick()
    expect(container.innerHTML).toBe('<p class="blue" data-n="1">hello</p>')
  })

  it('handles v-if / v-else branches', async () => {
    const ok = ref(true)
    const { container } = mountTpl(
      `<div><span v-if="ok">YES</span><span v-else>NO</span></div>`,
      () => ({ ok }),
    )
    expect(container.innerHTML).toBe('<div><span>YES</span></div>')

    ok.value = false
    await nextTick()
    expect(container.innerHTML).toBe('<div><span>NO</span></div>')
  })

  it('handles v-for with keys and updates', async () => {
    const list = ref([1, 2, 3])
    const { container } = mountTpl(
      `<ul><li v-for="item in list" :key="item">{{ item }}</li></ul>`,
      () => ({ list }),
    )
    expect(container.innerHTML).toBe('<ul><li>1</li><li>2</li><li>3</li></ul>')

    list.value.push(4)
    await nextTick()
    expect(container.innerHTML).toBe('<ul><li>1</li><li>2</li><li>3</li><li>4</li></ul>')
  })

  it('binds v-on click handlers', async () => {
    const clicks = vi.fn()
    const { container } = mountTpl(
      `<button @click="onClick">go</button>`,
      () => ({ onClick: () => clicks() }),
    )
    container.querySelector('button')!.dispatchEvent(new Event('click'))
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  it('v-on .prevent calls preventDefault and still runs the handler', () => {
    const spy = vi.fn()
    const { container } = mountTpl(
      `<button @click.prevent="onClick">go</button>`,
      () => ({ onClick: spy }),
    )
    const ev = new Event('click', { cancelable: true })
    container.querySelector('button')!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('v-on .stop prevents propagation to parent handlers', () => {
    const parentSpy = vi.fn()
    const childSpy = vi.fn()
    const { container } = mountTpl(
      `<div @click="onParent"><button @click.stop="onChild">go</button></div>`,
      () => ({ onParent: parentSpy, onChild: childSpy }),
    )
    container
      .querySelector('button')!
      .dispatchEvent(new Event('click', { bubbles: true }))
    expect(childSpy).toHaveBeenCalledTimes(1)
    expect(parentSpy).not.toHaveBeenCalled()
  })

  it('v-on .enter only fires for the Enter key', () => {
    const spy = vi.fn()
    const { container } = mountTpl(
      `<input @keyup.enter="onEnter" />`,
      () => ({ onEnter: spy }),
    )
    const input = container.querySelector('input')!
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }))
    expect(spy).not.toHaveBeenCalled()
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('v-on .once fires the handler only once', () => {
    const spy = vi.fn()
    const { container } = mountTpl(
      `<button @click.once="onClick">go</button>`,
      () => ({ onClick: spy }),
    )
    const btn = container.querySelector('button')!
    btn.dispatchEvent(new Event('click'))
    btn.dispatchEvent(new Event('click'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('v-model binds input two-way', async () => {
    const name = ref('mini')
    const { container } = mountTpl(
      `<input v-model="name" />`,
      () => ({ name }),
    )
    const input = container.querySelector('input')!
    expect((input as HTMLInputElement).value).toBe('mini')

    ;(input as HTMLInputElement).value = 'vue'
    input.dispatchEvent(new Event('input'))
    expect(name.value).toBe('vue')
  })

  it('v-model reflects programmatic model changes (dynamicProps fast path)', async () => {
    const name = ref('mini')
    const { container } = mountTpl(`<input v-model="name" />`, () => ({ name }))
    const input = container.querySelector('input')! as HTMLInputElement
    expect(input.value).toBe('mini')

    name.value = 'programmatic'
    await nextTick()
    expect(input.value).toBe('programmatic')
  })

  it('works with setup returning computed + external ref', async () => {
    const n = ref(2)
    const { container } = mountTpl(
      `<div>double = {{ n * 2 }}</div>`,
      () => ({ n }),
    )
    expect(container.textContent).toBe('double = 4')

    n.value = 5
    await nextTick()
    expect(container.textContent).toBe('double = 10')
  })

  it('compiles and renders named slots at runtime', () => {
    const Child = {
      template: `<section><h2><slot name="title"/></h2><slot/></section>`,
    }
    const Parent = {
      components: { Child },
      template: `<Child><template #title>标题</template>正文</Child>`,
    }
    const container = document.createElement('div')
    createApp(Parent).mount(container)
    expect(container.innerHTML).toBe(
      '<section><h2>标题</h2>正文</section>',
    )
  })

  it('provide/inject work inside compiled components', async () => {
    const Theme = Symbol('theme')
    const DeepComp = {
      template: `<b>{{ theme }}</b>`,
      setup() {
        const theme = inject(Theme)
        return { theme }
      },
    }
    const Root = {
      components: { DeepComp },
      template: `<DeepComp/>`,
      setup() {
        provide(Theme, 'dark')
        return {}
      },
    }
    const container = document.createElement('div')
    createApp(Root).mount(container)
    await nextTick()
    expect(container.innerHTML).toBe('<b>dark</b>')
  })
})

describe('compileToFunction output', () => {
  it('produces a callable render function directly (not just code)', () => {
    const render = compileToFunction(`<p>{{ a }}</p>`)
    expect(typeof render).toBe('function')
  })
})