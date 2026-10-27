/**
 * parse.spec.ts —— SFC 分块解析器
 *
 * 对应真 Vue compiler-sfc/__tests__/parse.spec.ts 的教学子集。
 * 断言风格：块 content 精确切片 + 属性抽取 + 错误收集（不 throw）。
 */
import { describe, expect, it } from 'vitest'
import { parse } from '../src'

const FULL = `<template>
  <div class="a">{{ msg }}</div>
</template>

<script setup lang="ts">
const msg = 'hi'
</script>

<script>
export default { name: 'App' }
</script>

<style scoped>
.a { color: red }
</style>

<i18n>
{ "a": 1 }
</i18n>
`

describe('parse: 基本形态', () => {
  it('拆分 template/script setup/script/style/custom block', () => {
    const { descriptor, errors } = parse(FULL, { filename: 'App.vue' })
    expect(errors).toHaveLength(0)

    expect(descriptor.filename).toBe('App.vue')
    expect(descriptor.template!.type).toBe('template')
    expect(descriptor.template!.content).toContain('<div class="a">')
    // content 不含开/闭标签本身（innerLoc 切片语义）；模板内容前有换行，先 trim
    expect(descriptor.template!.content.trim().startsWith('<div')).toBe(true)
    expect(descriptor.template!.content.endsWith('</template>')).toBe(false)

    expect(descriptor.scriptSetup!.content.trim()).toBe(`const msg = 'hi'`)
    expect(descriptor.scriptSetup!.setup).toBe(true)
    expect(descriptor.scriptSetup!.lang).toBe('ts')

    expect(descriptor.script!.content).toContain("export default { name: 'App' }")
    expect(descriptor.script!.setup).toBeUndefined()

    const style = descriptor.styles[0]
    expect(style.type).toBe('style')
    expect(style.scoped).toBe(true)
    expect(style.content.trim()).toBe('.a { color: red }')

    const custom = descriptor.customBlocks[0]
    expect(custom.type).toBe('i18n')
    expect(custom.content.trim()).toBe('{ "a": 1 }')
  })

  it('块 content 切片精确：开标签 > 之后 到 </tag 之前，含空白块', () => {
    const { descriptor } = parse(`<template>  </template>\n<script>\n</script>`)
    expect(descriptor.template!.content).toBe('  ')
    // ignoreEmpty 默认丢弃空白 script —— 这里直接验证切片源：用非空格验证
    const { descriptor: d2 } = parse(`<template> x </template>`)
    expect(d2.template!.content).toBe(' x ')
  })

  it('loc 给出 offset 与行号', () => {
    // '# line0\n' 8 字符；<template> 的 '>' 在 17，内容从 18 开始，到 '</template' 前的 28
    const { descriptor } = parse(`# line0\n<template>\n  <div/>\n</template>`)
    const loc = descriptor.template!.loc
    expect(loc.start.offset).toBe(18)
    expect(loc.start.line).toBe(2)
    expect(loc.end.offset).toBe(28)
    expect(loc.source).toBe(`# line0\n<template>\n  <div/>\n</template>`)
  })
})

describe('parse: 属性', () => {
  it('无值属性得 true（<script setup>）', () => {
    // 注意：空内容 script 会被 ignoreEmpty 丢弃，但 attrs 是在丢弃判定前解析的，
    // 这里给非空内容验证属性本身
    const { descriptor } = parse(`<script setup>\nconst a = 1\n</script>`)
    expect(descriptor.scriptSetup!.attrs.setup).toBe(true)
  })

  it('带值属性精确读取（lang/src/scoped/module），含单引号', () => {
    const { descriptor } = parse(
      `<script lang='js' src="/x.js"></script>\n<style scoped module="foo"></style>`,
      { ignoreEmpty: false },
    )
    expect(descriptor.script!.lang).toBe('js')
    expect(descriptor.script!.src).toBe('/x.js')
    const style = descriptor.styles[0]
    expect(style.scoped).toBe(true)
    expect(style.module).toBe('foo')
    // style module 无值 → true
    const { descriptor: d2 } = parse(`<style module></style>`, { ignoreEmpty: false })
    expect(d2.styles[0].module).toBe(true)
  })

  it('属性值内含 > 不影响标签结束', () => {
    const { descriptor, errors } = parse(
      `<template><span :title="a > b">{{ x }}</span></template>`,
      { ignoreEmpty: false },
    )
    expect(errors).toHaveLength(0)
    expect(descriptor.template!.content).toBe(`<span :title="a > b">{{ x }}</span>`)
  })
})

describe('parse: 守卫与错误收集（不 throw）', () => {
  it('script 与 scriptSetup 可并存', () => {
    const { descriptor, errors } = parse(`<script>export default {}</script>\n<script setup>const a = 1</script>`)
    expect(errors).toHaveLength(0)
    expect(descriptor.script).not.toBeNull()
    expect(descriptor.scriptSetup).not.toBeNull()
  })

  it('重复 template / 重复普通 script / 重复 script setup 报错', () => {
    const dupTpl = parse(`<template>a</template>\n<template>b</template>`)
    expect(dupTpl.errors[0].message).toContain('only one <template> element')

    const dupScript = parse(`<script>a</script>\n<script>b</script>`)
    expect(dupScript.errors[0].message).toContain('only one <script> element')

    const dupSetup = parse(`<script setup>a</script>\n<script setup>b</script>`)
    expect(dupSetup.errors[0].message).toContain('only one <script setup> element')
  })

  it('空文件与纯 style 文件报「At least one <template> or <script>」', () => {
    const empty = parse('')
    expect(empty.errors[0].message).toContain('At least one <template> or <script>')
    const styleOnly = parse(`<style scoped>.a {}</style>`)
    expect(styleOnly.errors[0].message).toContain('At least one <template> or <script>')
    expect(styleOnly.descriptor.styles).toHaveLength(1)
  })

  it('多个 style 块全保留', () => {
    const { descriptor } = parse(`<template>a</template>\n<style>.a{}</style>\n<style scoped>.b{}</style>`)
    expect(descriptor.styles).toHaveLength(2)
    expect(descriptor.styles[1].scoped).toBe(true)
  })

  it('scriptSetup 带 src 报错并置 null', () => {
    const { descriptor, errors } = parse(
      `<script setup src="./a.ts">const a = 1</script>\n<template>t</template>`,
    )
    expect(errors.some((e) => e.message.includes('cannot use the "src" attribute'))).toBe(true)
    expect(descriptor.scriptSetup).toBeNull()
  })

  it('script 带 src 且与 scriptSetup 并存 → script 置 null 并报错', () => {
    const { descriptor, errors } = parse(
      `<script src="./a.js">export default {}</script>\n<script setup>const a = 1</script>\n<template>t</template>`,
    )
    expect(errors.some((e) => e.message.includes('must be processed together'))).toBe(true)
    expect(descriptor.script).toBeNull()
    expect(descriptor.scriptSetup).not.toBeNull()
  })

  it('无 template 纯 script 合法', () => {
    const { errors } = parse(`<script>export default { render: () => null }</script>`)
    expect(errors).toHaveLength(0)
  })

  it('根级注释 / 文本 / 杂散标签被丢弃', () => {
    const { descriptor, errors } = parse(
      `<!-- comment -->\nhello world\n<template>\n  <div/>\n</template>`,
    )
    expect(errors).toHaveLength(0)
    expect(descriptor.template!.content).toBe('\n  <div/>\n')
    expect(descriptor.customBlocks).toHaveLength(0)
  })
})

describe('parse: RAWTEXT 语义（教学点）', () => {
  it("字符串里的 '</script>' 会提前闭合块（HTML 标准行为，真源码同样）", () => {
    const src = `const s = '</script>'\nconst a = 1`
    const { descriptor, errors } = parse(`<script>${src}</script>\n<template><i18n/></template>`)
    // 块在字符串内的 </script> 处截断
    expect(descriptor.script!.content).toBe(`const s = '`)
    // 后续内容按根级扫描：'const a = 1' 是文本被丢弃，</script> 是闭合标签被跳过
    expect(descriptor.template).not.toBeNull()
    expect(errors).toHaveLength(0)
  })

  it('template 内的嵌套 template 用计数配对（v-if/v-for 形态）', () => {
    const { descriptor, errors } = parse(
      `<template>\n  <template v-for="x in list">\n    {{ x }}\n  </template>\n</template>`,
    )
    expect(errors).toHaveLength(0)
    expect(descriptor.template!.content).toContain('v-for="x in list"')
    // 外层 template 的内容包含了内层完整块（没有被内层 </template> 截断）
    expect(descriptor.template!.content.endsWith('\n  </template>\n')).toBe(true)
  })

  it('ignoreEmpty：空白 script/style 块被丢弃，template 永远保留', () => {
    const { descriptor } = parse(`<template></template>\n<script>\n</script>\n<style>\n</style>`)
    expect(descriptor.template).not.toBeNull()
    expect(descriptor.script).toBeNull()
    expect(descriptor.styles).toHaveLength(0)
    // src 外链的空块保留（不读内容也有意义）
    const { descriptor: d2 } = parse(`<script src="./a.js"></script>\n<template/>`)
    expect(d2.script).not.toBeNull()
  })
})

describe('parse: descriptor.slotted', () => {
  it('scoped 样式用到 :slotted() 时为 true（feed compileTemplate 的 slotted 选项）', () => {
    const { descriptor } = parse(
      `<template>t</template>\n<style scoped>.a :slotted(.b) { color: red }</style>`,
    )
    expect(descriptor.slotted).toBe(true)
  })

  it('非 scoped 样式 / 无 :slotted 时为 false', () => {
    const { descriptor: d1 } = parse(
      `<template>t</template>\n<style>.a :slotted(.b) { color: red }</style>`,
    )
    expect(d1.slotted).toBe(false)
    const { descriptor: d2 } = parse(
      `<template>t</template>\n<style scoped>.a { color: red }</style>`,
    )
    expect(d2.slotted).toBe(false)
  })
})