// @vitest-environment jsdom
/**
 * vModelDirectives.spec.ts —— 阶段 6：v-model 指令形态 / v-show / 自定义指令 / useSlots / defineComponent
 */
import { describe, expect, it } from 'vitest'
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  useSlots,
  withDirectives,
} from '../../vue/src'

function mountTpl(template: string, setup?: () => Record<string, any>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp({ setup: setup ? () => setup() : undefined, template })
  app.mount(container)
  return { app, container }
}

describe('v-model directive forms', () => {
  it('checkbox: checked reflects model and change writes back', async () => {
    const agree = ref(false)
    const { container } = mountTpl(
      `<input type="checkbox" v-model="agree" />`,
      () => ({ agree }),
    )
    const box = container.querySelector('input') as HTMLInputElement
    expect(box.checked).toBe(false)

    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(agree.value).toBe(true)

    agree.value = false
    await nextTick()
    expect(box.checked).toBe(false)
  })

  it('radio: selected value drives checked, change writes back', async () => {
    const pick = ref('a')
    const { container } = mountTpl(
      `<div>
         <input type="radio" value="a" v-model="pick" />
         <input type="radio" value="b" v-model="pick" />
       </div>`,
      () => ({ pick }),
    )
    const radios = container.querySelectorAll('input') as unknown as HTMLInputElement[]
    expect(radios[0].checked).toBe(true)
    expect(radios[1].checked).toBe(false)

    radios[1].checked = true
    radios[1].dispatchEvent(new Event('change'))
    expect(pick.value).toBe('b')
  })

  it('select: value prop drives selection, change writes back', async () => {
    const sel = ref('one')
    const { container } = mountTpl(
      `<select v-model="sel"><option value="one">1</option><option value="two">2</option></select>`,
      () => ({ sel }),
    )
    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('one')

    select.value = 'two'
    select.dispatchEvent(new Event('change'))
    expect(sel.value).toBe('two')
  })

  it('v-model on text input still works (regression)', async () => {
    const name = ref('mini')
    const { container } = mountTpl(`<input v-model="name" />`, () => ({ name }))
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('mini')

    input.value = 'vue'
    input.dispatchEvent(new Event('input'))
    expect(name.value).toBe('vue')
  })
})

describe('v-show', () => {
  it('toggles display without unmounting', async () => {
    const show = ref(true)
    const { container } = mountTpl(`<p v-show="show">shown</p>`, () => ({ show }))
    const p = container.querySelector('p')!
    expect(p.style.display).toBe('')

    show.value = false
    await nextTick()
    expect(p.style.display).toBe('none')

    show.value = true
    await nextTick()
    expect(p.style.display).toBe('')
  })
})

describe('custom directives via withDirectives', () => {
  it('runs mounted/updated/unmounted hooks', async () => {
    const calls: string[] = []
    const myDir = {
      mounted(el: Element) {
        calls.push('mounted')
        el.setAttribute('data-dir', 'on')
      },
      updated() {
        calls.push('updated')
      },
      unmounted() {
        calls.push('unmounted')
      },
    }
    const show = ref(true)
    const container = document.createElement('div')
    createApp({
      render: () =>
        show.value
          ? withDirectives(h('p', 'x'), [[myDir, 'value']])
          : null,
    }).mount(container)

    expect(calls).toEqual(['mounted'])
    expect(container.querySelector('p')!.getAttribute('data-dir')).toBe('on')

    show.value = false
    await nextTick()
    expect(calls).toEqual(['mounted', 'unmounted'])
  })
})

describe('useSlots / defineComponent', () => {
  it('useSlots in setup returns the slots object', () => {
    const Box = defineComponent({
      setup(_props: any, _ctx: any) {
        const slots = useSlots()
        return () => h('article', slots.default())
      },
    })
    const App = {
      render: () => h(Box, null, { default: () => h('b', 'slot-content') }),
    }
    const container = document.createElement('div')
    createApp(App).mount(container)
    expect(container.innerHTML).toBe('<article><b>slot-content</b></article>')
  })
})