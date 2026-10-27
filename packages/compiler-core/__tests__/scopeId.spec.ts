/**
 * scopeId.spec.ts —— SFC scoped 模式的编译器侧行为（C1）
 *
 * 对应真 Vue compiler-core/__tests__/scopeId.spec.ts 的职责，但 mini 与真 v3.5 的
 * 机制差异要写清楚：
 *   - 真 v3.5：scopeId 选项 + mode:'module' → 静态内容收进 render 内的 _cache
 *     （cacheStatic 取代了旧的模块级提升）；mini 的等价物 = 传给 codegen 的
 *     scopeId 存在时直接不做模块级提升（提升物在 currentScopeId 为空的模块顶层
 *     创建，会漏 data-v 属性）。
 *   - 插槽函数恒包 _withCtx（真 v3.5 无论是否 scoped 都包）。
 *   - <slot> 出口第 5 参 noSlotted：scoped 且未用 :slotted 时输出 true。
 *
 * 注意 baseCompile 不带 parserOptions 时所有标签都会当组件（与真 compiler-core
 * 单测一致），需要 isNativeTag 显式声明。
 */
import { describe, expect, it } from 'vitest'
import { baseCompile } from '../src'

const PARSER_OPTIONS = { isNativeTag: (tag: string) => tag !== 'Child' }

describe('scopeId compiler support', () => {
  it('scoped（scopeId 存在）关闭模块级静态提升', () => {
    const { code } = baseCompile(`<div class="a"><span>s</span><i>t</i></div>`, {
      ...PARSER_OPTIONS,
      scopeId: 'data-v-x',
    })
    // 提升物在模块顶层创建（currentScopeId=null），会漏 data-v；scoped 下必须现场创建。
    // 注：单子节点形态本就不提升（collectHoistedNodes 只遍历数组 children），
    // 用两个静态子节点才能验证「本可提升却因 scoped 放弃」。
    expect(code).not.toContain('_hoisted_')
  })

  it('非 scoped 保持模块级静态提升', () => {
    const { code } = baseCompile(`<div class="a"><span>s</span><i>t</i></div>`, PARSER_OPTIONS)
    expect(code).toContain(`const _hoisted_1 = _createElementVNode("span"`)
    expect(code).toContain(`const _hoisted_2 = _createElementVNode("i"`)
  })

  it('scoped 且未用 :slotted → <slot> 出口带第 5 参 noSlotted', () => {
    const { code } = baseCompile(`<div><slot name="x"/></div>`, {
      ...PARSER_OPTIONS,
      scopeId: 'data-v-x',
    })
    // 真 Vue transformSlotOutlet 同款：_renderSlot($slots, name, props, undefined, true)
    expect(code).toContain(`_renderSlot(_ctx.$slots, "x", {}, undefined, true)`)
  })

  it('scoped 且用了 :slotted → 不带 noSlotted（插槽内容需要保留 -s 标记）', () => {
    const { code } = baseCompile(`<div><slot/></div>`, {
      ...PARSER_OPTIONS,
      scopeId: 'data-v-x',
      slotted: true,
    })
    expect(code).toContain(`_renderSlot(_ctx.$slots, "default", {})`)
    expect(code).not.toContain('undefined, true')
  })

  it('<slot> 默认内容编译成第 4 参 fallback 函数', () => {
    const { code } = baseCompile(`<slot>hi</slot>`, {
      ...PARSER_OPTIONS,
      scopeId: 'data-v-x',
    })
    expect(code).toMatch(/_renderSlot\(_ctx\.\$slots, "default", \{\}, \(\) => \[/)
  })

  it('组件插槽函数恒包 _withCtx（真 v3.5 无论是否 scoped 都包）', () => {
    const { code } = baseCompile(`<Child><div/></Child>`, PARSER_OPTIONS)
    expect(code).toContain(`default: _withCtx(() => [`)
  })

  it('多个具名插槽各自包 _withCtx', () => {
    const { code } = baseCompile(
      `<Child><template #a><i/></template><template #b><b/></template></Child>`,
      PARSER_OPTIONS,
    )
    expect(code).toContain(`a: _withCtx(() => [`)
    expect(code).toContain(`b: _withCtx(() => [`)
  })
})