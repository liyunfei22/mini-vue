/**
 * compiler.js —— 第三层：极简模板编译器
 * 解决：「模板怎么变成图纸（render 函数）？」
 * 一句话：模板只是 render 的语法糖——parse 扫成小树，generate 拼成调用 h()
 * 的代码字符串，new Function 实例化。
 * 对应 mini-vue：packages/compiler-core/src/（parse/codegen；transform 折叠进
 * generate——语法集够窄，指令展开在生成时逐个 if 即可）；入口对照 vue 包的
 * compileToFunction。
 * 砍掉：v-if（三目可替代，v-if 要分支树与块作用域）、v-model/v-html、
 * 表达式白名单（这里不设防，生产模板要校验——真 Vue 有）。
 *
 * 三条铁律：
 *   1. parse 一律 indexOf/slice + 指针，禁止正则匹配整段结构（正则地狱）
 *   2. 生成代码包在 with(ctx) 里——模板裸名（count/list/Stepper）运行时经
 *      with 解析到渲染上下文（mini-vue with(_ctx) 方案的源头）
 *   3. 函数体绝不能带 'use strict'（with 在严格模式是 SyntaxError；new
 *      Function 创建的函数是 sloppy，ESM 的严格不传染进来）
 */
import { h, Text } from '../runtime-core/index.js' // 唯一的跨层引用：编译产物运行时需要 h

// compile：模板 → render 函数（单根解包；多根/mixin 根 → 数组，renderer 兜底）
export function compile(template) {
  const nodes = parse(template)
  const body =
    nodes.length === 1 && nodes[0].type !== 'mixin' ? gen(nodes[0]) : genChildren(nodes)
  // with(ctx)：裸名解析到渲染上下文；mv 是闭包参数（含 h/Text）
  return new Function('mv', `return function render(ctx) { with (ctx) { return ${body} } }`)({
    h,
    Text,
  })
}

// ---------------------------------------------------------------
// parse：指针扫描，4 态（文本/插值/标签/属性）
// ---------------------------------------------------------------
function parse(template) {
  const nodes = []
  parseBlocks(template, 0, template.length, nodes)
  return nodes
}

/** 通用子节点解析：顶层与元素 children 共用（遇 '</' 停下，交调用方消费） */
function parseBlocks(template, start, end, list) {
  let i = start
  while (i < end) {
    if (template.startsWith('</', i)) break
    if (template.startsWith('<!--', i)) {
      i = skipComment(template, i).end
      continue
    }
    if (template[i] === '<') {
      const r = parseElement(template, i)
      list.push(r.node)
      i = r.end
    } else {
      const r = parseText(template, i)
      // 纯空白文本丢弃（Vue 空白压缩的极简版；插值旁的空格保留）
      if (!(r.node.type === 'text' && !r.node.content.trim())) list.push(r.node)
      i = r.end
    }
  }
  return i
}

/** 标签：元素名 + 属性 + children（自闭合/闭合两种） */
function parseElement(template, start) {
  let i = start + 1
  const tagStart = i
  while (i < template.length && !/[\s/>]/.test(template[i])) i++
  const tag = template.slice(tagStart, i)
  const props = []
  let vFor = null
  let selfClosing = false

  // 属性区：读到 '>' 或 '/>'
  for (;;) {
    while (i < template.length && /\s/.test(template[i])) i++
    const c = template[i]
    if (c === '>') {
      i++
      break
    }
    if (c === '/') {
      selfClosing = true
      i++
      continue
    }
    const nameStart = i
    while (i < template.length && !/[\s=/>]/.test(template[i])) i++
    const name = template.slice(nameStart, i)
    while (i < template.length && /\s/.test(template[i])) i++
    let value = ''
    if (template[i] === '=') {
      i++
      while (i < template.length && /\s/.test(template[i])) i++
      const quote = template[i]
      i++
      const valStart = i
      while (i < template.length && template[i] !== quote) i++
      value = template.slice(valStart, i)
      i++
    }
    if (name === 'v-for') {
      // 'item, index in list'：字符串方法拆分（属性值内不用正则）
      const [lhs, source] = value.split(' in ')
      const [item, index] = lhs.split(',').map((s) => s.trim())
      vFor = { item, index: index || null, source: source.trim() }
    } else {
      props.push({ name, value })
    }
  }

  const node = { type: 'element', tag, props, vFor, children: [] }
  if (!selfClosing) {
    const after = parseBlocks(template, i, template.length, node.children)
    i = after
    const close = template.indexOf('>', i) // 消费 </tag>
    i = close === -1 ? template.length : close + 1
  }
  return { node, end: i }
}

/** 文本与插值：扫到下一个 '<'，拆 {{ }}；多段合成 mixin 由 genChildren 展开 */
function parseText(template, start) {
  // 关键：indexOf 找不到时返回 -1，必须归一化成 template.length——
  // 否则返回的 end=-1 会让外层 i=-1 死循环（多行模板尾部换行必踩的坑）
  let end = template.indexOf('<', start)
  if (end === -1) end = template.length
  const raw = template.slice(start, end)
  const parts = []
  let i = 0
  while (i < raw.length) {
    const open = raw.indexOf('{{', i)
    if (open === -1) {
      parts.push({ type: 'text', content: raw.slice(i) })
      break
    }
    if (open > i) parts.push({ type: 'text', content: raw.slice(i, open) })
    const close = raw.indexOf('}}', open + 2)
    parts.push({ type: 'interp', exp: raw.slice(open + 2, close === -1 ? raw.length : close).trim() })
    i = close === -1 ? raw.length : close + 2
  }
  return { node: parts.length === 1 ? parts[0] : { type: 'mixin', parts }, end }
}

function skipComment(template, i) {
  const end = template.indexOf('-->', i)
  return { node: null, end: end === -1 ? template.length : end + 3 }
}

// ---------------------------------------------------------------
// generate：小树 → 代码字符串（transform 的折叠位：指令在这里展开）
// ---------------------------------------------------------------
function genChildren(nodes) {
  const arr = []
  for (const node of nodes) {
    if (node.type === 'mixin') for (const part of node.parts) arr.push(gen(part))
    else arr.push(gen(node))
  }
  return `[${arr.join(', ')}]`
}

function gen(node) {
  switch (node.type) {
    case 'text':
      return `mv.h(mv.Text, null, ${JSON.stringify(node.content)})`
    case 'interp':
      // 表达式原样内嵌——JS 引擎帮我们算（极简真义：不解析表达式）
      return `mv.h(mv.Text, null, String(${node.exp}))`
    case 'element':
      return genElement(node)
    default:
      return 'null'
  }
}

function genElement(node) {
  // 首字母大写 → 组件标签（with(ctx) 里裸名解析到 ctx.Stepper）
  const tagCode = /^[A-Z]/.test(node.tag) ? node.tag : JSON.stringify(node.tag)
  const propsCode = genProps(node.props)
  const childrenCode = genChildren(node.children)
  const call = `mv.h(${tagCode}, ${propsCode}, ${childrenCode})`
  if (node.vFor) {
    // v-for = list.map((item, index) => ...)：item 是箭头参数，天然在
    // with(ctx) 的捕获作用域内（无需作用域栈——数组形态的福利）
    const params = node.vFor.index ? `${node.vFor.item}, ${node.vFor.index}` : node.vFor.item
    return `${node.vFor.source}.map((${params}) => ${call})`
  }
  return call
}

function genProps(props) {
  const entries = props.map((p) => {
    if (p.name.startsWith('@')) {
      // 事件 onXxx: () => (表达式)，触发时才执行。与 Vue 的差异：@click="fn"
      // 请写 @click="fn()"（isMemberExpression 判别是 mini-vue 的事）
      const event = p.name.slice(1)
      const key = `on${event[0].toUpperCase()}${event.slice(1)}`
      return `${JSON.stringify(key)}: () => (${p.value})`
    }
    if (p.name.startsWith(':')) {
      // 动态绑定：值 = 原样表达式（with(ctx) 运行时求值）
      return `${JSON.stringify(p.name.slice(1))}: (${p.value})`
    }
    if (p.name === 'key') return null // 就地 diff 无 key 语义（keyed diff 在 mini-vue）
    return `${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`
  })
  const list = entries.filter(Boolean)
  return `{ ${list.join(', ')} }`
}

// 浏览器全局双通道（compile 已在顶部 export function 导出）
if (typeof window !== 'undefined') {
  window.compile = compile
}