// @vitest-environment jsdom
/**
 * rendererKeyedChildren.spec.ts —— keyed children diff（LIS）镜像测试
 * 对齐真 Vue packages/runtime-core/__tests__/rendererChildren.spec.ts 的 keyed 子集。
 * 断言规则：用列表各项的文本顺序断言 DOM 里的真实顺序。
 */
import { describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from '../src'

/** 渲染一个 keyed 列表的辅助组件工厂 */
function mountKeyedList() {
  const list = ref<Array<{ id: number; text: string }>>([
    { id: 1, text: 'a' },
    { id: 2, text: 'b' },
    { id: 3, text: 'c' },
  ])
  const container = document.createElement('div')
  document.body.appendChild(container)

  createApp({
    render: () =>
      h(
        'div',
        list.value.map((item) => h('span', { key: item.id }, item.text)),
      ),
  }).mount(container)

  const order = () =>
    Array.from(container.querySelectorAll('span')).map((el) => el.textContent)

  return { list, order }
}

describe('keyed children diff', () => {
  it('appends to the end (new tail)', async () => {
    const { list, order } = mountKeyedList()
    list.value.push({ id: 4, text: 'd' })
    await nextTick()
    expect(order()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('prepends to the start (new head)', async () => {
    const { list, order } = mountKeyedList()
    list.value.unshift({ id: 0, text: 'z' })
    await nextTick()
    expect(order()).toEqual(['z', 'a', 'b', 'c'])
  })

  it('removes from the tail', async () => {
    const { list, order } = mountKeyedList()
    list.value.pop()
    await nextTick()
    expect(order()).toEqual(['a', 'b'])
  })

  it('removes from the head', async () => {
    const { list, order } = mountKeyedList()
    list.value.shift()
    await nextTick()
    expect(order()).toEqual(['b', 'c'])
  })

  it('moves one node to the end (basic reorder)', async () => {
    const { list, order } = mountKeyedList()
    const [first] = list.value.splice(0, 1)
    list.value.push(first) // a b c → b c a
    await nextTick()
    expect(order()).toEqual(['b', 'c', 'a'])
  })

  it('moves one node to the front', async () => {
    const { list, order } = mountKeyedList()
    const last = list.value.pop()!
    list.value.unshift(last) // a b c → c a b
    await nextTick()
    expect(order()).toEqual(['c', 'a', 'b'])
  })

  it('reverses the whole list (max moves)', async () => {
    const { list, order } = mountKeyedList()
    list.value.reverse() // a b c → c b a
    await nextTick()
    expect(order()).toEqual(['c', 'b', 'a'])
  })

  it('rotates: remove middle + insert new middle', async () => {
    const { list, order } = mountKeyedList()
    list.value.splice(1, 1, { id: 9, text: 'x' }) // a b c → a x c
    await nextTick()
    expect(order()).toEqual(['a', 'x', 'c'])
  })

  it('inserts multiple nodes in the middle', async () => {
    const { list, order } = mountKeyedList()
    list.value.splice(1, 0, { id: 4, text: 'd' }, { id: 5, text: 'e' })
    await nextTick()
    expect(order()).toEqual(['a', 'd', 'e', 'b', 'c'])
  })

  it('starts with empty list then mounts all', async () => {
    const list = ref<Array<{ id: number; text: string }>>([])
    const container = document.createElement('div')
    createApp({
      render: () =>
        h(
          'div',
          list.value.map((item) => h('span', { key: item.id }, item.text)),
        ),
    }).mount(container)
    const order = () =>
      Array.from(container.querySelectorAll('span')).map((el) => el.textContent)

    list.value = [
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]
    await nextTick()
    expect(order()).toEqual(['a', 'b'])
  })

  it('double swap with equal keys stays in sync', async () => {
    // a b c → b a c（两次移动，LIS 保持 a c 不动）
    const { list, order } = mountKeyedList()
    const [a, b] = list.value
    list.value = [b, a, list.value[2]]
    await nextTick()
    expect(order()).toEqual(['b', 'a', 'c'])
  })

  it('reuses the same DOM elements for unmoved nodes (no remount churn)', async () => {
    const { list, order } = mountKeyedList()
    const spansBefore = Array.from(document.querySelectorAll('span')) as HTMLElement[]
    const bEl = spansBefore[1]

    list.value.push({ id: 4, text: 'd' })
    await nextTick()

    // b 没动 → 还是同一个 span
    const bAfter = Array.from(document.querySelectorAll('span'))[1]
    expect(bAfter).toBe(bEl)
    expect(order()).toEqual(['a', 'b', 'c', 'd'])
  })
})