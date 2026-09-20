// @vitest-environment jsdom
/**
 * 7-2 测试：Transition（CSS 类过渡 + 延迟卸载） / KeepAlive（隐藏式缓存、状态保留）/ 动态组件 <component :is>
 */
import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, nextTick, ref } from '../../vue/src'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('Transition (mini)', () => {
  it('enter: applies v-enter classes then cleans up', async () => {
    const show = ref(true)
    const container = document.createElement('div')
    createApp({
      setup: () => ({ show }),
      template: `<div><Transition :duration="200"><p v-if="show">x</p></Transition></div>`,
    }).mount(container)

    const p = container.querySelector('p')!
    // insert 前挂上 enter-from + enter-active
    expect(p.classList.contains('v-enter-active')).toBe(true)
    expect(p.classList.contains('v-enter-from')).toBe(true)

    // 2 帧后切到 enter-to、摘 from
    await tick(20)
    expect(p.classList.contains('v-enter-from')).toBe(false)
    expect(p.classList.contains('v-enter-to')).toBe(true)

    // duration 经过后清干净
    await tick(300)
    expect(p.classList.contains('v-enter-active')).toBe(false)
    expect(p.classList.contains('v-enter-to')).toBe(false)
  })

  it('leave: defers removal until transition timeout', async () => {
    const show = ref(true)
    const container = document.createElement('div')
    createApp({
      setup: () => ({ show }),
      template: `<div><Transition :duration="200"><p v-if="show">x</p></Transition></div>`,
    }).mount(container)

    let p = container.querySelector('p')!
    show.value = false
    await nextTick()
    // 还挂着，带 leave 类
    p = container.querySelector('p')!
    expect(p).not.toBeNull()
    expect(p!.classList.contains('v-leave-active')).toBe(true)

    await tick(300)
    expect(container.querySelector('p')).toBeNull() // 超时后才真正移除
  })
})

describe('dynamic component <component :is>', () => {
  it('switches components via :is', async () => {
    const cur = ref('A')
    const A = defineComponent({ template: `<p class="a">A</p>` })
    const B = defineComponent({ template: `<p class="b">B</p>` })
    const container = document.createElement('div')
    createApp({
      components: { A, B },
      setup: () => ({ cur }),
      template: `<component :is="cur"/>`,
    }).mount(container)

    expect(container.innerHTML).toBe('<p class="a">A</p>')
    cur.value = 'B'
    await nextTick()
    expect(container.innerHTML).toBe('<p class="b">B</p>')
  })
})

describe('KeepAlive (mini)', () => {
  it('switching away hides A, switching back preserves A state', async () => {
    const cur = ref('A')
    const A = defineComponent({
      data() {
        return { count: 0 }
      },
      methods: {
        up() {
          ;(this as any).count++
        },
      },
      template: `<div class="a"><span>{{ count }}</span><button @click="up">+</button></div>`,
    })
    const B = defineComponent({ template: `<div class="b">B</div>` })
    const container = document.createElement('div')
    createApp({
      components: { A, B },
      setup: () => ({ cur }),
      template: `<KeepAlive><component :is="cur"/></KeepAlive>`,
    }).mount(container)

    // A 挂载，点击 count → 1
    expect(container.querySelector('.a')).not.toBeNull()
    container.querySelector('button')!.dispatchEvent(new Event('click'))
    await nextTick()
    expect(container.querySelector('.a span')!.textContent).toBe('1')

    // 切到 B：A 被隐藏（display:none）而非卸载
    cur.value = 'B'
    await nextTick()
    expect(container.querySelector('.b')).not.toBeNull()
    expect((container.querySelector('.a') as HTMLElement).style.display).toBe('none')

    // 切回 A：状态保留（count 仍是 1）
    cur.value = 'A'
    await nextTick()
    expect(container.querySelector('.a span')!.textContent).toBe('1')
    expect((container.querySelector('.a') as HTMLElement).style.display).toBe('')
  })
})