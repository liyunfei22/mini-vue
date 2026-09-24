/**
 * compiler.spec.ts —— 编译器结构镜像测试
 * 对齐真 Vue compiler-core/__tests__/{parse,codegen}.spec.ts 的必要子集，
 * 端到端行为测试见 packages/vue/__tests__/compileToFunction.spec.ts。
 */
import { describe, expect, it } from 'vitest'
import { baseParse, transform, generate, NodeTypes } from '../src'
import { transformIf, transformFor, transformElement, transformText, transformSlotOutlet, transformExpression } from '../src'

const KNOWN_TAGS = ['div', 'span', 'li', 'input', 'ul', 'p', 'section']

function compileCode(template: string) {
  // 裸 compiler-core 测试：给 isNativeTag 让 div/span 判定为元素（DOM 能力在 compiler-dom）
  const ast: any = baseParse(template, { isNativeTag: (t) => KNOWN_TAGS.includes(t) })
  transform(ast, {
    nodeTransforms: [transformIf, transformFor, transformExpression, transformSlotOutlet, transformElement, transformText],
  })
  return generate(ast as any)
}

const NT = NodeTypes

describe('parse', () => {
  it('parses a simple element tree', () => {
    const ast: any = baseParse(`<div><p>hi</p></div>`)
    const div = ast.children[0]
    expect(div.type).toBe(NT.ELEMENT)
    expect(div.tag).toBe('div')
    expect(div.children[0].type).toBe(NT.ELEMENT)
    expect(div.children[0].tag).toBe('p')
    expect(div.children[0].children[0].type).toBe(NT.TEXT)
    expect(div.children[0].children[0].content).toBe('hi')
  })

  it('parses attributes and directives', () => {
    const ast: any = baseParse(`<div id="x" :class="c" @click="h" v-if="ok">t</div>`)
    const props = ast.children[0].props
    expect(props.length).toBe(4)
    expect(props[0].type).toBe(NT.ATTRIBUTE)
    expect(props[0].name).toBe('id')
    expect(props[1].type).toBe(NT.DIRECTIVE)
    expect(props[1].name).toBe('bind')
    expect(props[1].arg.content).toBe('class')
    expect(props[2].name).toBe('on')
    expect(props[2].arg.content).toBe('click')
    expect(props[3].name).toBe('if')
    expect(props[3].exp.content).toBe('ok')
  })

  it('parses interpolation content', () => {
    const ast: any = baseParse(`<p>{{ x + 1 }}</p>`)
    const interp = ast.children[0].children[0]
    expect(interp.type).toBe(NT.INTERPOLATION)
    expect(interp.content.content).toBe('x + 1')
  })

  it('parses v-for alias', () => {
    const ast: any = baseParse(`<li v-for="(item, idx) in list">{{ item }}</li>`)
    const dir = ast.children[0].props[0]
    expect(dir.exp.content).toBe('(item, idx) in list')
  })

  it('parses comments without swallowing following siblings', () => {
    const ast: any = baseParse(`<div><!-- c --><span>x</span></div>`)
    const div = ast.children[0]
    expect(div.type).toBe(NT.ELEMENT)
    expect(div.tag).toBe('div')
    // 注释被 parseChildren 过滤，其后的 span 兄弟节点保留（修复前会吞掉 source 抛 X_MISSING_END_TAG）
    expect(div.children).toHaveLength(1)
    expect(div.children[0].tag).toBe('span')
  })

  it('throws (not hangs) on unterminated interpolation', () => {
    // 修复前 `{{` 无 `}}` 会让 parse 同步死循环 OOM；现在应迅速抛编译错误
    expect(() => baseParse(`<div>{{ msg</div>`)).toThrow(/compiler error/)
  })

  it('throws on missing closing tag', () => {
    expect(() => baseParse(`<div>`)).toThrow()
  })
})

describe('compile (transform + codegen)', () => {
  it('generates element vnode with props', () => {
    const { code } = compileCode(`<div class="a">{{ n }}</div>`)
    expect(code).toContain(`with (_ctx)`)
    // 7-3：根节点成为 block → _openBlock() + _createElementBlock("div"...)
    expect(code).toContain(`_openBlock(), _createElementBlock("div"`)
    expect(code).toContain(`{class: "a"}`)
    expect(code).toContain(`_toDisplayString(n)`)
  })

  it('compiles v-if to a conditional expression', () => {
    const { code } = compileCode(`<span v-if="ok">Y</span><span v-else>N</span>`)
    expect(code).toContain(`(ok) ?`)
    expect(code).toContain(`: _createElementVNode("span"`)
  })

  it('compiles v-for to renderList', () => {
    const { code } = compileCode(`<li v-for="item in list">{{ item }}</li>`)
    expect(code).toContain(`_renderList(list, (item) =>`)
  })

  it('compiles v-model to value + onInput', () => {
    const { code } = compileCode(`<input v-model="name" />`)
    expect(code).toContain(`value: name`)
    expect(code).toContain(`onInput: ($event) => (name = $event.target.value)`)
  })

  it('compiles empty boolean attributes to an empty-string value', () => {
    const { code } = compileCode(`<input disabled />`)
    // 空属性应编译成 disabled: ""，而非 disabled: "\"\""（双引号字符串）
    expect(code).toContain(`disabled: ""`)
  })

  it('resolves component tags via resolveComponent', () => {
    const { code } = compileCode(`<Child/>`)
    expect(code).toContain(`_resolveComponent("Child")`)
    // 组件根以 block 化（createElementBlock 内部走 createVNode 计算 shapeFlag）
    expect(code).toContain(`_createElementBlock(_resolveComponent("Child")`)
  })
})