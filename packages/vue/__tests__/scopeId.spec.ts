// @vitest-environment jsdom
/**
 * scopeId.spec.ts —— SFC scoped 的运行时链路端到端（C1）
 *
 * 验证「编译产物里搜不到 data-v」背后的运行时机制：
 *   currentScopeId（来自组件 type.__scopeId）→ vnode.scopeId（创建期快照）
 *   → setScopeId（挂载期落 data-v-xxx="" 属性，含子组件根继承）→ -s 插槽标记。
 *
 * 注意：compileToFunction 是 with(_ctx) 运行时编译。SFC 路径下 compileTemplate
 * 会传 scopeId 编译选项（压制模块级提升并影响 noSlotted 参数）——测试里与
 * __scopeId 配套传同样的 scopeId，模拟 compileTemplate 的调用方式。
 */
import { describe, expect, it } from 'vitest'
import { createApp, ref } from '../src'
import { compileToFunction, getComponentPublicInstance } from '../src'

function mount(comp: any) {
  const container = document.createElement('div')
  createApp(comp).mount(container)
  return {
    container,
    rootInstance: (container as any)._vnode.component,
  }
}

describe('scopeId runtime chain', () => {
  it('scoped 组件的每个元素都落 data-v-xxx="" 属性', () => {
    const Comp = {
      __scopeId: 'data-v-abc',
      setup: () => ({}),
      // scopeId 编译选项 = SFC compileTemplate(scoped) 的等效调用：压制静态提升，
      // 所有元素都在渲染上下文里创建（currentScopeId 生效）
      render: compileToFunction(`<div class="a"><span>s</span><i>{{ 1 }}</i></div>`, {
        scopeId: 'data-v-abc',
      }),
    }
    const { container } = mount(Comp)
    expect(container.innerHTML).toBe(
      '<div data-v-abc="" class="a"><span data-v-abc="">s</span><i data-v-abc="">1</i></div>',
    )
  })

  it('子组件根元素继承父组件 scopeId（非根元素不继承）', () => {
    const Child = {
      setup: () => ({}),
      render: compileToFunction(`<div class="inner"><b>c</b></div>`),
    }
    const Parent = {
      __scopeId: 'data-v-par',
      components: { Child },
      setup: () => ({}),
      render: compileToFunction(`<main><Child/></main>`),
    }
    const { container } = mount(Parent)
    const main = container.firstChild as HTMLElement
    expect(main.getAttribute('data-v-par')).toBe('')
    const childRoot = main.firstChild as HTMLElement
    expect(childRoot.tagName).toBe('DIV')
    // 父的 scoped 样式要能命中子的根元素（data-v-par 继承）
    expect(childRoot.getAttribute('data-v-par')).toBe('')
    // 但子根的内部元素不继承
    expect((childRoot.firstChild as HTMLElement).getAttribute('data-v-par')).toBeNull()
  })

  it('插槽内容元素带父 scopeId；子组件 :slotted 时内容额外带 -s 后缀', () => {
    const Child = {
      __scopeId: 'data-v-child',
      setup: () => ({}),
      // SFC 路径：模板 scoped 样式里用了 :slotted → descriptor.slotted=true 传给编译
      render: compileToFunction(`<div><slot/></div>`, {
        scopeId: 'data-v-child',
        slotted: true,
      }),
    }
    const Parent = {
      __scopeId: 'data-v-par',
      components: { Child },
      setup: () => ({}),
      render: compileToFunction(`<main><Child><span class="s">x</span></Child></main>`),
    }
    const { container } = mount(Parent)
    const childRoot = (container.firstChild as HTMLElement).firstChild as HTMLElement
    // 子组件自己的元素带自己的 scopeId（+ 父继承，见上一用例）
    expect(childRoot.getAttribute('data-v-child')).toBe('')
    const slotContent = childRoot.firstChild as HTMLElement
    // 插槽内容属于父组件：带父 scopeId（withCtx 切换作用域的产物）
    expect(slotContent.getAttribute('data-v-par')).toBe('')
    // 子组件 :slotted(.s) 编译成 .s[data-v-child-s] → 内容还要带 -s 后缀
    expect(slotContent.getAttribute('data-v-child-s')).toBe('')
  })

  it('子组件未用 :slotted（noSlotted=true）→ 不做多余的 -s 标记', () => {
    const Child = {
      __scopeId: 'data-v-child',
      setup: () => ({}),
      render: compileToFunction(`<div><slot/></div>`, { scopeId: 'data-v-child' }),
    }
    const Parent = {
      __scopeId: 'data-v-par',
      components: { Child },
      setup: () => ({}),
      render: compileToFunction(`<main><Child><span>x</span></Child></main>`),
    }
    const { container } = mount(Parent)
    const childRoot = (container.firstChild as HTMLElement).firstChild as HTMLElement
    const slotContent = childRoot.firstChild as HTMLElement
    expect(slotContent.getAttribute('data-v-par')).toBe('')
    expect(slotContent.getAttribute('data-v-child-s')).toBeNull()
  })

  it('expose() 之后 getComponentPublicInstance 只暴露列出的键（含 ref 解包）', () => {
    const Closed = {
      setup(_: any, { expose }: any) {
        expose({ hello: 'hi', count: ref(1) })
        return { secret: 42 }
      },
      render: compileToFunction(`<div>c</div>`),
    }
    const { rootInstance } = mount(Closed)
    const pub = getComponentPublicInstance(rootInstance)
    expect(pub.hello).toBe('hi')
    // expose 里的 ref 经 proxyRefs 解包（与真 Vue 一致）
    expect(pub.count).toBe(1)
    // 未 expose 的键被关闭
    expect(pub.secret).toBeUndefined()
  })

  it('未调用 expose 时保持全公开', () => {
    const Open = {
      setup: () => ({ secret: 42 }),
      render: compileToFunction(`<div>c</div>`),
    }
    const { rootInstance } = mount(Open)
    expect(getComponentPublicInstance(rootInstance).secret).toBe(42)
  })
})