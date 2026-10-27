/**
 * compileStyle.spec.ts —— scoped 样式编译
 *
 * 规则表断言全部以真 @vue/compiler-sfc@3.5.43 compileStyle 实测输出为 ground truth
 * （含 :global 整条替换、:is 独立内层注入、/deep/ 视作 :deep 等「反直觉」行为）。
 */
import { describe, expect, it } from 'vitest'
import { compileStyle } from '../src'

const scoped = (source: string) => compileStyle({ source, id: 'data-v-abc', scoped: true })

describe('compileStyle: scoped 注入规则表（真源码 ground truth 对照）', () => {
  it('单条选择器：锚点 = 最后一个复合选择器', () => {
    expect(scoped(`.a { }`).code).toContain(`.a[data-v-abc] {`)
  })

  it('后代 + 伪类：锚点在尾部伪类之前', () => {
    expect(scoped(`.a .b:hover { color: blue }`).code).toContain(`.a .b[data-v-abc]:hover {`)
  })

  it(':deep 前缀形态：注入在 :deep 之前', () => {
    expect(scoped(`.a :deep(.b) { }`).code).toContain(`.a[data-v-abc] .b {`)
  })

  it(':deep 独立形态：前缀注入（含首部组合器保留）', () => {
    expect(scoped(`:deep(.c) { }`).code).toContain(`[data-v-abc] .c {`)
    expect(scoped(`:deep(> .d) { }`).code).toContain(`[data-v-abc] > .d {`)
  })

  it('::v-deep 老写法别名等同 :deep', () => {
    expect(scoped(`::v-deep(.legacy) { }`).code).toContain(`[data-v-abc] .legacy {`)
  })

  it(':slotted：-s 后缀注入内层，外层不再注入普通 id', () => {
    expect(scoped(`.a :slotted(.foo) { }`).code).toContain(`.a .foo[data-v-abc-s] {`)
    expect(scoped(`.a :slotted(.foo) { }`).code).not.toContain(`.a[data-v-abc]`)
    expect(scoped(`:slotted(.bar) { }`).code).toContain(`.bar[data-v-abc-s] {`)
  })

  it(':global：整条选择器替换为内层（真源码 selector.replaceWith 语义）', () => {
    expect(scoped(`.a :global(.g) { }`).code).toContain(`.g {`)
    expect(scoped(`:global(.h) { }`).code).toContain(`.h {`)
  })

  it('universal 特例：首位剥除，末位跳过', () => {
    expect(scoped(`* .u { }`).code).toContain(`.u[data-v-abc] {`)
    expect(scoped(`.u * { }`).code).toContain(`.u[data-v-abc] * {`)
  })

  it('容器伪类：有前置锚点注入外层；:is/:where 独立时内层逐项注入', () => {
    expect(scoped(`.container :is(.x, .y) { }`).code).toContain(`.container[data-v-abc] :is(.x, .y) {`)
    expect(scoped(`:is(.m, .n) { }`).code).toContain(`:is(.m[data-v-abc], .n[data-v-abc]) {`)
    expect(scoped(`:where(.p, .q) { }`).code).toContain(`:where(.p[data-v-abc], .q[data-v-abc]) {`)
  })

  it(':not 形态：有锚点在锚点后，无锚点前缀注入', () => {
    expect(scoped(`.a:not(.b) { }`).code).toContain(`.a[data-v-abc]:not(.b) {`)
    expect(scoped(`:not(.b) { }`).code).toContain(`[data-v-abc]:not(.b) {`)
  })

  it('伪元素/属性选择器/多级：与 ground truth 一致', () => {
    expect(scoped(`::before { }`).code).toContain(`[data-v-abc]::before {`)
    expect(scoped(`[data-x] { }`).code).toContain(`[data-x][data-v-abc] {`)
    expect(scoped(`html body { }`).code).toContain(`html body[data-v-abc] {`)
    expect(scoped(`.a [data-b] .c { }`).code).toContain(`.a [data-b] .c[data-v-abc] {`)
  })

  it('组合器链：锚点总在最后复合选择器之后', () => {
    expect(scoped(`.a.active > span { }`).code).toContain(`.a.active > span[data-v-abc] {`)
    expect(scoped(`.a > .b + .c ~ .d { }`).code).toContain(`.a > .b + .c ~ .d[data-v-abc] {`)
  })

  it('/deep/ 视作 :deep（注入在替换点之前）；>> 保留并警告', () => {
    const r1 = scoped(`.a /deep/ .old { }`)
    expect(r1.code).toContain(`.a[data-v-abc] .old {`)
    expect(r1.errors.length).toBeGreaterThan(0)
    const r2 = scoped(`.a >> .older { }`)
    expect(r2.code).toContain(`.a >> .older[data-v-abc] {`)
    expect(r2.errors.length).toBeGreaterThan(0)
  })

  it('注释原样保留且不参与注入', () => {
    const r = scoped(`/* .a comment { } */\n.a { color: red }`)
    expect(r.code).toContain(`/* .a comment { } */`)
    expect(r.code).toContain(`.a[data-v-abc] { color: red`)
  })

  it('逗号选择器列表逐条独立注入', () => {
    expect(scoped(`.x, .y:hover { }`).code).toContain(`.x[data-v-abc], .y[data-v-abc]:hover {`)
  })

  it('@media 内部规则照常注入，媒体查询本身不动', () => {
    const r = scoped(`@media (min-width: 100px) {\n  .media .a { color: green }\n}`)
    expect(r.code).toContain(`@media (min-width: 100px) {`)
    expect(r.code).toContain(`.media .a[data-v-abc] { color: green`)
  })

  it('@keyframes 整段跳过（mini 不做 animation-name 改名，文档记差异）', () => {
    const r = scoped(`@keyframes spin {\n  from { transform: rotate(0) }\n  to { transform: rotate(360deg) }\n}\n.a { }`)
    expect(r.code).toContain(`from { transform: rotate(0) }`)
    expect(r.code).toContain(`.a[data-v-abc] {`)
  })
})

describe('compileStyle: 选项与边界', () => {
  it('非 scoped：原样返回', () => {
    const r = compileStyle({ source: `.a { color: red }`, id: 'data-v-abc' })
    expect(r.code).toBe(`.a { color: red }`)
    expect(r.errors).toHaveLength(0)
  })

  it('trim 删除首尾空行', () => {
    const r = compileStyle({ source: `\n.a { }\n\n`, id: 'x', scoped: true, trim: true })
    expect(r.code.startsWith('\n')).toBe(false)
    expect(r.code.endsWith('\n')).toBe(false)
  })

  it('preprocessLang 报不支持（不 throw）', () => {
    const r = compileStyle({ source: `.a { }`, id: 'x', scoped: true, preprocessLang: 'scss' })
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.code).toBe(`.a[data-v-x] { }`)
  })

  it('容器伪类内含 :deep 报「mini 不支持」并原样返回', () => {
    const r = scoped(`.a :is(:deep(.b), .c) { }`)
    expect(r.errors.some((e) => e.includes('not supported'))).toBe(true)
    expect(r.code).toContain(`.a :is(:deep(.b), .c)`)
  })

  it('多 :deep 报错', () => {
    const r = scoped(`:deep(.a) :deep(.b) { }`)
    expect(r.errors.some((e) => e.includes('not supported'))).toBe(true)
  })
})