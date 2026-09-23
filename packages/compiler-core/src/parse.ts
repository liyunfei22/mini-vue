/**
 * parse.ts —— 模板 → AST（状态机解析）
 *
 * 对应真 Vue packages/compiler-core/src/parse.ts（3.5 拆成 tokenizer+parser，行为等价）。
 *
 * ## 架构：一个「光标 + 滚动源字符串」的上下文
 *   ParserContext.source 一直指向「还没解析的部分」。每个解析函数吃掉一段：
 *     advanceBy(n)  —— 光标前进 n
 *     advanceSpaces —— 吃掉空白
 *   解析不同区域的「语法模式」不同，用 TextModes 标注：
 *     DATA        普通 HTML 区域（能遇到 <、{{）
 *     RCDATA      <textarea>/<title>：{{ }} 仍有效
 *     RAWTEXT     <script>/<style>：什么都当纯文本
 *     ATTRIBUTE_VALUE 属性值内部
 *
 * ## 主循环 parseChildren（几乎就是全部逻辑）
 *   每次迭代看 source 开头：
 *     '<' + 注释 / DOCTYPE / </ (错误) / 标签 → parseElement（递归下沉）
 *     '{{'           → parseInterpolation
 *     否则            → parseText
 *   直到 isEnd() 判定结束（遇到 </父标签 或到达 EOF）。
 *
 * mini 简化的地方：不解析实体（decodeEntities 恒等）、注释做基础跳过、无源码映射调试。
 */
import {
  createRoot,
  createText,
  createInterpolation,
  createSimpleExpression,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type RootNode,
  type TemplateChildNode,
} from './ast'
import { ElementTypes, NodeTypes } from './ast'
import { createCompilerError, ErrorCodes } from './errors'

export interface ParserOptions {
  isNativeTag?: (tag: string) => boolean
  isVoidTag?: (tag: string) => boolean
  isPreTag?: (tag: string) => boolean
  getTextMode?: (tag: string, ns: any, parent: ElementNode) => any
  decodeEntities?: (raw: string, asAttr: boolean) => string
  isCustomElement?: (tag: string) => boolean
}

const enum TextModes {
  DATA,
  RCDATA,
  RAWTEXT,
  CDATA,
  ATTRIBUTE_VALUE,
}

export interface ParserContext {
  source: string
  options: ParserOptions
  // 定位信息（mini 简化：只维护 offset）
  offset: number
}

function createParserContext(content: string, options: ParserOptions): ParserContext {
  return {
    options,
    source: content,
    offset: 0,
  }
}

function getCursor(context: ParserContext) {
  return { offset: context.offset, line: 1, column: context.offset + 1 }
}

function advanceBy(context: ParserContext, numberOfCharacters: number): void {
  const { source } = context
  context.source = source.slice(numberOfCharacters)
  context.offset += numberOfCharacters
}

function advanceSpaces(context: ParserContext) {
  const match = /^[ \t\r\n]+/.exec(context.source)
  if (match) {
    advanceBy(context, match[0].length)
  }
}

// ---------------------------------------------------------------
// 解析入口
// ---------------------------------------------------------------

export function baseParse(content: string, options: ParserOptions = {}): RootNode {
  const context = createParserContext(content, options)
  const start = getCursor(context)
  const root = createRoot(parseChildren(context, [], TextModes.DATA), {
    start,
    end: getCursor(context),
    source: content,
  } as any)

  return root
}

// ---------------------------------------------------------------
// children 主循环
// ---------------------------------------------------------------

function parseChildren(
  context: ParserContext,
  ancestors: ElementNode[],
  mode: TextModes,
): TemplateChildNode[] {
  const parent = ancestors[ancestors.length - 1] || null
  const { options } = context
  const children = []

  while (!isEnd(context, ancestors)) {
    const s = context.source
    let node: TemplateChildNode | undefined
    if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
      if (s[0] === '<') {
        // 结束标签前的异常情况
        if (s[1] === '!') {
          // 注释
          if (startsWith(s, '<!--')) {
            advanceBy(context, 4)
            const endIndex = context.source.indexOf('-->')
            // 只前进到 `-->` 之后：不能把注释后的兄弟节点/结束标签一并吞掉
            const content = endIndex === -1 ? context.source : context.source.slice(0, endIndex)
            advanceBy(context, endIndex === -1 ? context.source.length : endIndex + 3)
            node = { type: NodeTypes.COMMENT, content, loc: null as any }
          } else {
            // DOCTYPE
            const locEnd = s.indexOf('>')
            if (locEnd !== -1) advanceBy(context, locEnd + 1)
          }
        } else if (s[1] === '/') {
          // 错误处理到这里就 break
          break
        } else {
          node = parseElement(context, ancestors)
        }
      }
    }
    if (!node) {
      node = parseInterpolation(context, mode) || parseText(context, mode)
    }
    if (node) {
      children.push(node)
    }
  }

  return children.filter((n) => !(n.type === NodeTypes.COMMENT)) as any
}

function isEnd(context: ParserContext, ancestors: ElementNode[]): boolean {
  const s = context.source
  if (s.startsWith('</')) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (startsWithEndTagOpen(s, ancestors[i].tag)) {
        return true
      }
    }
  }
  return !s
}

// ---------------------------------------------------------------
// 元素
// ---------------------------------------------------------------

function parseElement(context: ParserContext, ancestors: ElementNode[]): ElementNode | undefined {
  const start = getCursor(context)
  const parent = ancestors[ancestors.length - 1] || null
  const { options } = context
  const element = parseTag(context, { isRoot: parent === null })

  if (element.isSelfClosing || options.isVoidTag?.(element.tag)) {
    // 自闭合 / void 元素没有 children
    return element
  }

  ancestors.push(element)
  const mode = getRawTextOrRcDataMode(element.tag) || TextModes.DATA
  element.children = parseChildren(context, ancestors, mode) as any
  ancestors.pop()

  // 结束标签
  if (startsWithEndTagOpen(context.source, element.tag)) {
    parseTag(context, { isRoot: parent === null })
  } else {
    throw createCompilerError(ErrorCodes.X_MISSING_END_TAG, {
      start,
      end: getCursor(context),
      source: context.source,
    })
  }

  return element
}

function parseTag(context: ParserContext, _: { isRoot: boolean }): ElementNode & { isSelfClosing: boolean } {
  const start = getCursor(context)
  const match = /^<\/?([a-z][^\t\r\n\f />]*)/i.exec(context.source)!
  const tag = match[1]
  advanceBy(context, match[0].length)
  advanceSpaces(context)

  const props: Array<AttributeNode | DirectiveNode> = []
  const directives: DirectiveNode[] = []
  let isSelfClosing = false

  while (context.source.length > 0) {
    if (context.source[0] === '>') {
      advanceBy(context, 1)
      break
    }
    if (/^\/>/.test(context.source)) {
      advanceBy(context, 2)
      isSelfClosing = true
      break
    }
    let attr
    try {
      attr = parseAttribute(context)
    } catch (e) {
      break
    }
    if (attr.type === NodeTypes.DIRECTIVE) {
      directives.push(attr as DirectiveNode)
    }
    props.push(attr)
    advanceSpaces(context)
  }

  const isComponent = !!props.find(
      (p) =>
        p.type === NodeTypes.DIRECTIVE &&
        (p as DirectiveNode).name === 'is' &&
        (p as DirectiveNode).exp,
    ) || (context.options.isNativeTag ? !context.options.isNativeTag(tag) : true)

  const tagType: ElementTypes = isComponent ? ElementTypes.COMPONENT : ElementTypes.ELEMENT

  return {
    type: NodeTypes.ELEMENT,
    tag,
    tagType,
    props,
    directives,
    children: [],
    loc: { start, end: getCursor(context), source: context.source },
    isSelfClosing,
  } as any
}

const directiveRE = /^v-([a-zA-Z0-9-_]+)/

/** 解析一个属性：普通属性 或 指令（v-xxx / :arg / @event / #slot） */
function parseAttribute(context: ParserContext): AttributeNode | DirectiveNode {
  const start = getCursor(context)
  const match = /^[^\t\r\n\f />][^\t\r\n\f />=]*/.exec(context.source)!
  const name = match[0]
  advanceBy(context, name.length)
  advanceSpaces(context)

  // 值（可省略：v-if 之类的布尔/无值指令）
  let value: AttributeNode['value']
  if (context.source[0] === '=') {
    advanceBy(context, 1)
    advanceSpaces(context)
    value = parseAttributeValue(context)
  }

  const isDirective =
    name[0] === ':' || name[0] === '@' || name[0] === '#' || directiveRE.test(name)

  if (isDirective) {
    let dirName: string
    let argContent = ''
    let modifiers: string[] = []

    if (name[0] === ':') {
      dirName = 'bind'
      argContent = name.slice(1)
    } else if (name[0] === '@') {
      dirName = 'on'
      argContent = name.slice(1)
    } else if (name[0] === '#') {
      dirName = 'slot'
      argContent = name.slice(1)
    } else {
      const m = directiveRE.exec(name)!
      dirName = m[1]
      // 解析 arg 与 modifiers：v-on:click.once → name 'on', arg 'click', modifiers ['once']
      const afterDirective = name.slice(m[0].length) // ':click.once'
      const colonIndex = /^:([^:]+)/.exec(afterDirective)
      if (colonIndex) {
        argContent = colonIndex[1]
      }
      const modifiersMatch = /^:([^.]+)(.*)/.exec(afterDirective)
      if (modifiersMatch) {
        modifiers = modifiersMatch[2]
          .split('.')
          .filter(Boolean)
      } else {
        const mods = afterDirective.split('.')
        if (mods.length > 1) {
          modifiers = mods.slice(1)
          // arg 若在冒号内
        }
      }
    }

    // 若 arg 里带了 modifiers（:click.once 的 once 已在上面处理），
    // 这里兜底从 . 分段里再拆一遍
    if (argContent.includes('.')) {
      const parts = argContent.split('.')
      argContent = parts[0]
      modifiers = parts.slice(1)
    }

    return {
      type: NodeTypes.DIRECTIVE,
      name: dirName,
      exp: value ? createSimpleExpression(value.content, false, undefined, 0) : undefined,
      arg: argContent ? createSimpleExpression(argContent, true, undefined, 1) : undefined,
      modifiers,
      loc: { start, end: getCursor(context), source: name },
    } as any
  }

  return {
    type: NodeTypes.ATTRIBUTE,
    name,
    value: value as any,
    loc: { start, end: getCursor(context), source: name },
  } as any
}

function parseAttributeValue(context: ParserContext) {
  const start = getCursor(context)
  const quote = context.source[0]
  if (quote === '"' || quote === "'") {
    advanceBy(context, 1)
    const endIndex = context.source.indexOf(quote)
    const content = context.source.slice(0, endIndex !== -1 ? endIndex : context.source.length)
    advanceBy(context, content.length + (endIndex !== -1 ? 1 : 0))
    return {
      type: NodeTypes.TEXT,
      content,
      loc: { start, end: getCursor(context), source: content },
    } as any
  } else {
    // 无引号
    const match = /^[^\t\r\n\f >]+/.exec(context.source)!
    const content = match[0] || ''
    advanceBy(context, content.length)
    return {
      type: NodeTypes.TEXT,
      content,
      loc: { start, end: getCursor(context), source: content },
    } as any
  }
}

// ---------------------------------------------------------------
// 文本与插值
// ---------------------------------------------------------------

export type { ElementTypes }

function parseInterpolation(
  context: ParserContext,
  mode: TextModes,
): TemplateChildNode | undefined {
  // mini 阶段 5 的欠账修复（对齐真 Vue）：插值只应在 DATA/RCDATA 区解析，
  // RAWTEXT（<script>/<style>）里 {{ }} 是纯文本
  if (mode !== TextModes.DATA && mode !== TextModes.RCDATA) {
    return undefined
  }
  const [open, close] = ['{{', '}}']
  // 必须先以 open 开头才可能是插值
  if (!context.source.startsWith(open)) {
    return undefined
  }
  const closeIndex = context.source.indexOf(close, open.length)
  if (closeIndex === -1) {
    return undefined
  }
  const start = getCursor(context)
  // closeIndex 是在「尚未 advance」的源串上算的；advance 掉 `{{` 后
  // close 的实际位置是 closeIndex - open.length（经典 mini-vue 也踩过这坑）
  advanceBy(context, open.length)
  const rawContent = context.source.slice(0, closeIndex - open.length)
  const preTrimContent = rawContent.trim()
  advanceBy(context, rawContent.length)
  const end = getCursor(context)
  advanceBy(context, close.length)

  return {
    type: NodeTypes.INTERPOLATION,
    content: createSimpleExpression(preTrimContent, false, {
      start,
      end,
      source: preTrimContent,
    }),
    loc: { start, end: getCursor(context), source: open + rawContent + close },
  } as any
}

function parseText(context: ParserContext, mode: TextModes): TemplateChildNode {
  const endTokens =
    mode === TextModes.RAWTEXT
      ? ['</'] // RAWTEXT：直到关闭标签前的整段都是文本（'{{'、'<' 视为普通字符）
      : mode === TextModes.RCDATA
        ? ['{{', '</', '<']
        : ['<', '{{'] // DATA：标签 / 插值切
  if (mode === TextModes.RCDATA) {
    endTokens.push('</')
  }
  let endIndex = context.source.length
  for (const token of endTokens) {
    const index = context.source.indexOf(token)
    if (index !== -1 && index < endIndex) {
      endIndex = index
    }
  }
  const start = getCursor(context)
  const content = context.source.slice(0, endIndex)
  advanceBy(context, content.length)
  return createText(content, {
    start,
    end: getCursor(context),
    source: content,
  })
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

/** '<TAG' 开头且是结束标签开始 */
function startsWithEndTagOpen(source: string, tag: string): boolean {
  const open = '</'
  return (
    source.startsWith(open) &&
    source.slice(2, 2 + tag.length).toLowerCase() === tag.toLowerCase() &&
    /[\t\r\n\f />]/.test(source[2 + tag.length] || '>')
  )
}

function startsWith(source: string, searchString: string): boolean {
  return source.startsWith(searchString)
}

function getRawTextOrRcDataMode(tag: string): TextModes | undefined {
  if (tag === 'textarea' || tag === 'title') {
    return TextModes.RCDATA
  }
  if (tag === 'style' || tag === 'script') {
    return TextModes.RAWTEXT
  }
  return undefined
}

export { TextModes }