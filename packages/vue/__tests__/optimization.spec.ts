// @vitest-environment jsdom
/**
 * 7-3 测试：编译器优化 —— patchFlag 产物标记 / 静态提升复用 / block 树动态子节点
 */
import { describe, expect, it } from 'vitest'
import { compile } from '@mini-vue/compiler-dom'
import { createApp, nextTick, ref } from '../../vue/src'

describe('compiler emits optimization markers', () => {
  it('dynamic text gets TEXT patchFlag (1)', () => {
    const { code } = compile(`<p>{{ x }}</p>`)
    expect(code).toContain(`_toDisplayString(x)`)
    // 根 block：_openBlock() + _createElementBlock(..., 1 /* TEXT */)
    expect(code).toContain(`_openBlock()`)
    expect(code).toContain(`_createElementBlock("p", null, _toDisplayString(x), 1)`)
  })

  it('static subtrees are hoisted to _hoisted_N consts', () => {
    const { code } = compile(`<div><span class="s">static</span><p>{{ x }}</p></div>`)
    expect(code).toContain(`const _hoisted_1 = _createElementVNode("span"`)
    expect(code).toContain(`_hoisted_1, _createElementVNode("p"`)
  })
})

describe('runtime: block + static hoist behavior', () => {
  it('static subtree DOM is reused across renders, dynamic text updates', async () => {
    const x = ref(0)
    const container = document.createElement('div')
    createApp({
      setup: () => ({ x }),
      template: `<div><span class="s">static</span><p>{{ x }}</p></div>`,
    }).mount(container)

    const spanRef = container.querySelector('.s')!
    expect(container.querySelector('p')!.textContent).toBe('0')

    x.value = 42
    await nextTick()
    // 静态 span 未被重建（hoisted vnode 复用 → n1 === n2 直接跳过）
    expect(container.querySelector('.s')).toBe(spanRef)
    // 动态文本已更新
    expect(container.querySelector('p')!.textContent).toBe('42')
  })

  it('block root collects dynamic children (only the dynamic node)', () => {
    const container = document.createElement('div')
    createApp({
      setup: () => ({ x: ref(1) as any }),
      template: `<div><span class="s">static</span><p>{{ x }}</p></div>`,
    }).mount(container)

    const vnode = (container as any)._vnode
    const subTree = vnode.component.subTree
    // 根是 block；dynamicChildren 只含动态的 <p>（静态 span 被提升，不再进块）
    expect(subTree.dynamicChildren).toBeTruthy()
    expect((subTree.dynamicChildren as any[]).length).toBe(1)
    expect((subTree.dynamicChildren as any[])[0].type).toBe('p')
  })

  it('deep dynamic text in nested element still updates (block guard fallback)', async () => {
    const n = ref(1)
    const container = document.createElement('div')
    createApp({
      setup: () => ({ n }),
      template: `<div class="outer"><section><p>{{ n }}</p></section></div>`,
    }).mount(container)

    expect(container.querySelector('p')!.textContent).toBe('1')
    n.value = 9
    await nextTick()
    expect(container.querySelector('p')!.textContent).toBe('9')
  })
})