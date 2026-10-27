/**
 * compileTemplate.spec.ts —— SFC 模板编译包装
 *
 * 大部分行为（scopeId 关提升、noSlotted 第 5 参、_withCtx）已在
 * compiler-core/__tests__/scopeId.spec.ts 直接测过编译器；这里验证
 * compileTemplate 这个 SFC 层包装的参数换算与结果形态。
 */
import { describe, expect, it, vi } from 'vitest'
import { compileTemplate } from '../src'
import * as Vue from '@mini-vue/vue'

describe('compileTemplate', () => {
  it('id → longId 换算（data-v-前缀幂等）', () => {
    const r1 = compileTemplate({ source: `<div class="a"/>`, id: 'abc123', scoped: true })
    // scoped 关提升，产物无 _hoisted_；scopeId 本体不在 code 里（运行时链路）
    expect(r1.code).toContain(`_createElementBlock("div"`)
    expect(r1.code).not.toContain('data-v-')
    expect(r1.errors).toHaveLength(0)
    // data-v- 前缀幂等：同一模板产物一致
    const r2 = compileTemplate({ source: `<div class="a"/>`, id: 'data-v-abc123', scoped: true })
    expect(r2.code).toBe(r1.code)
  })

  it('模板编译错误进 errors 不 throw', () => {
    const r = compileTemplate({ source: `<div>{{ unclosed</div>`, id: 'x' })
    expect(r.errors.length).toBeGreaterThan(0)
    expect(typeof r.code).toBe('string')
  })

  it('scoped && !slotted → <slot> 第 5 参 noSlotted；slotted → 不带', () => {
    const r1 = compileTemplate({ source: `<div><slot/></div>`, id: 'data-v-abc', scoped: true })
    expect(r1.code).toContain(`_renderSlot(_ctx.$slots, "default", {}, undefined, true)`)
    const r2 = compileTemplate({
      source: `<div><slot/></div>`,
      id: 'data-v-abc',
      scoped: true,
      slotted: true,
    })
    expect(r2.code).toContain(`_renderSlot(_ctx.$slots, "default", {})`)
  })

  it('缺 id 时告警一次并继续（真源码 warnOnce 同款）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    compileTemplate({ source: `<div/>`, id: '' })
    compileTemplate({ source: `<div/>`, id: '' }) // 第二次不再告警
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('产物仍是 with(_ctx) 形态，可直接 new Function 实例化', () => {
    const { code } = compileTemplate({ source: `<p>{{ msg }}</p>`, id: 'x' })
    // 用真正的 @mini-vue/vue 实例化（helpers 齐全且纯 JS，不碰 DOM）
    const render = new Function('Vue', code)(Vue)
    expect(typeof render).toBe('function')
    // 模拟 renderContext 代理：只拦截模板引用的键（with 语义：has → get 联动）
    const proxy = new Proxy(
      {},
      {
        has: (_t, k) => k === 'msg',
        get: (_t, k) => (k === 'msg' ? 'hi' : undefined),
      },
    )
    const vnode = render(proxy, [])
    expect(vnode).not.toBeNull()
  })
})