/**
 * parse.ts —— SFC 分块解析器
 *
 * 对应真 Vue packages/compiler-sfc/src/parse.ts（~485 行）。
 *
 * 真源码的机制：把 source 交给 compiler-dom 以 parseMode:'sfc' 跑一遍——根级遇到
 * 非 template 标签立即进入 RAWTEXT（原始文本，直到 `</tag`），template 走常规解析；
 * 块内容用 innerLoc（开标签 '>' 之后 到 '</tag' 之前）精确切片。mini 用手写扫描器
 * 复刻同样的语义，零第三方依赖：
 *   1. 根级起始标签 + 属性解析（引号配对、无值属性，不做实体解码）
 *   2. RAWTEXT 语义扫 `</tag` 闭合：大小写不敏感、后续必须是空白或 '>'——
 *      字符串/注释里的 `</script>` 同样提前闭合块（HTML 标准行为，真源码同样，
 *      这是教学点而非 bug，文章里专门演示）
 *   3. content = 开标签 '>' 之后 到 闭合区起点 的切片（innerLoc 的零 AST 版）
 *   4. 块分类与守卫照抄真源码：template 只认第一个（重复报错）、script 按 setup
 *      分流（重复报错）、style 全收进 styles[]、其它根级标签进 customBlocks；
 *      错误全部 push 进 errors 不 throw
 *
 * 与真源码的差异（README/文章记录）：
 *   - 无 sourceMap / pad / parseCache / pug dedent / <style vars> 废弃告警
 *   - template 内容不走 HTML 解析器，用「开标签计数」找闭合（处理嵌套 <template v-*>）
 *   - 根级注释/文本/DOCTYPE 一律丢弃（真源码同语义）
 */

const DEFAULT_FILENAME = 'anonymous.vue'

export interface SFCParseOptions {
  /** 文件路径（错误信息/文档用），默认 'anonymous.vue' */
  filename?: string
  /** 与真源码类型对齐但 mini 不产出 sourceMap（裁剪项，传了也被忽略） */
  sourceMap?: boolean
  /** 丢弃空白内容的 script/style/自定义块（template 永远保留），默认 true */
  ignoreEmpty?: boolean
}

// ---------------------------------------------------------------
// 类型模型（与真源码 parse.ts:35-101 对齐，去掉 loc 的 column/ast/map）
// ---------------------------------------------------------------

export interface SourceLocation {
  start: { line: number; offset: number }
  end: { line: number; offset: number }
  source: string
}

export interface SFCBlock {
  type: string
  content: string
  attrs: Record<string, string | true>
  loc: SourceLocation
  /** lang 属性值；无则 undefined */
  lang?: string
  /** src 外链属性值；无则 undefined */
  src?: string
}

export interface SFCTemplateBlock extends SFCBlock {
  /** mini 不建 template AST（compileTemplate 自建），恒 null（真源码有 ast 字段） */
  ast: null
}

export interface SFCScriptBlock extends SFCBlock {
  /** <script setup> 的 setup 属性：无值 true，带值字符串 */
  setup?: string | boolean
}

export interface SFCStyleBlock extends SFCBlock {
  scoped?: boolean
  module?: string | boolean
}

export interface SFCDescriptor {
  filename: string
  source: string
  template: SFCTemplateBlock | null
  script: SFCScriptBlock | null
  scriptSetup: SFCScriptBlock | null
  styles: SFCStyleBlock[]
  customBlocks: SFCBlock[]
  /** cssVars（v-bind() in css）：mini 未实现，恒 []（文档记差异） */
  cssVars: string[]
  /** 是否用到 :slotted()（scoped 样式里匹配到），feed 给 compileTemplate 的 slotted 选项 */
  slotted: boolean
}

export interface SFCParseResult {
  descriptor: SFCDescriptor
  errors: SyntaxError[]
}

// ---------------------------------------------------------------
// parse：入口
// ---------------------------------------------------------------

export function parse(
  source: string,
  options: SFCParseOptions = {},
): SFCParseResult {
  const filename = options.filename || DEFAULT_FILENAME
  const ignoreEmpty = options.ignoreEmpty !== false
  const errors: SyntaxError[] = []
  const descriptor: SFCDescriptor = {
    filename,
    source,
    template: null,
    script: null,
    scriptSetup: null,
    styles: [],
    customBlocks: [],
    cssVars: [],
    slotted: false,
  }

  let i = 0
  while (i < source.length) {
    // 根级扫描：找下一个 '<'；注释/DOCTYPE/处理指令/杂散文本一律跳过（真源码丢弃非元素根节点）
    const lt = source.indexOf('<', i)
    if (lt === -1) break
    const after = source[lt + 1]
    if (after === '!' || after === '/') {
      i = lt + 2
      continue
    }
    const tagMatch = /^[a-z][a-z0-9-]*/.exec(source.slice(lt + 1))
    if (!tagMatch) {
      i = lt + 1
      continue
    }
    const tag = tagMatch[0]
    const tagNameStart = lt + 1

    // ---- 属性解析：name (=["'"]...["'"]|=\S+)? 到 '>' 或 '/>' ----
    const attrs: Record<string, string | true> = {}
    let pos = tagNameStart + tag.length
    let selfClosing = false
    let tagEnd = -1 // '>' 的位置（开标签结束）
    // 这里手动行内解析（不拆函数），保持「单扫描器」的阅读连贯性
    while (pos < source.length) {
      // 跳过空白
      while (pos < source.length && /\s/.test(source[pos])) pos++
      const c = source[pos]
      if (c === '>') {
        tagEnd = pos
        break
      }
      if (c === '/') {
        // '/>' 自闭合
        if (source[pos + 1] === '>') {
          tagEnd = pos + 1
          selfClosing = true
          break
        }
        pos++
        continue
      }
      // 属性名
      const nameMatch = /^[^\s=/>]+/.exec(source.slice(pos))
      if (!nameMatch) {
        pos++
        continue
      }
      const name = nameMatch[0]
      pos += name.length
      // 可选 = 值
      while (pos < source.length && /\s/.test(source[pos])) pos++
      if (source[pos] === '=') {
        pos++
        while (pos < source.length && /\s/.test(source[pos])) pos++
        const q = source[pos]
        if (q === '"' || q === "'") {
          // 引号配对（含转义字符）
          const endQuote = source.indexOf(q, pos + 1)
          if (endQuote === -1) {
            errors.push(makeError(source, `Attribute "${name}" is missing a closing quote`, pos))
            pos = source.length
            break
          }
          attrs[name] = source.slice(pos + 1, endQuote)
          pos = endQuote + 1
        } else {
          // 无引号值：到空白或 '>' 为止（真 HTML tokenizer 同语义）
          const valMatch = /^[^\s>]+/.exec(source.slice(pos))
          attrs[name] = valMatch ? valMatch[0] : ''
          pos += valMatch ? valMatch[0].length : 0
        }
      } else {
        // 无值属性 → true（<script setup> 即此形态，真 parse.ts:334 同款）
        attrs[name] = true
      }
    }
    if (tagEnd === -1) {
      // 没找到开标签的 '>'（文件截断/畸形）
      errors.push(makeError(source, `Unexpected end of file in <${tag}> tag`, lt))
      break
    }

    // ---- 块内容定位 ----
    const contentStart = tagEnd + 1

    if (!selfClosing) {
      const closeAt =
        tag === 'template'
          ? findCloseTagBalanced(source, contentStart) // template 允许嵌套，括号计数
          : findCloseTagRaw(source, contentStart, tag) // 其它块 RAWTEXT：第一个 </tag 即闭合
      if (closeAt === -1) {
        errors.push(makeError(source, `Unexpected end of file while parsing <${tag}>`, tagEnd + 1))
        break
      }
      const contentEnd = closeAt
      const closeTagEnd = findCloseTagEnd(source, closeAt, tag)
      if (!ignoreEmpty || tag === 'template' || attrs.src || source.slice(contentStart, contentEnd).trim() !== '') {
        pushBlock(descriptor, tag, source, attrs, contentStart, contentEnd, errors)
      }
      i = closeTagEnd
    } else {
      // 自闭合：空内容块（<template/> 是合法的空根；<script/> 等奇异用法同样得到空块）
      pushBlock(descriptor, tag, source, attrs, contentStart, contentStart, errors)
      i = tagEnd + 1
    }
  }

  // ---- 后处理与守卫（真 parse.ts:226-251 同款文案） ----
  if (!descriptor.template && !descriptor.script && !descriptor.scriptSetup) {
    errors.push(
      makeError(
        source,
        `At least one <template> or <script> is required in a single file component. ${filename}`,
        0,
      ),
    )
  }
  if (descriptor.scriptSetup) {
    if (descriptor.scriptSetup.src) {
      errors.push(
        makeError(
          source,
          `<script setup> cannot use the "src" attribute because ` +
            `its syntax will be ambiguous outside of the component.`,
          0,
        ),
      )
      descriptor.scriptSetup = null
    }
    if (descriptor.script && descriptor.script.src) {
      errors.push(
        makeError(
          source,
          `<script> cannot use the "src" attribute when <script setup> is ` +
            `also present because they must be processed together.`,
          0,
        ),
      )
      descriptor.script = null
    }
  }
  // 是否用到 :slotted()（真 parse.ts:288-291 同款正则，只查 scoped 样式）
  const slottedRE = /(?:::v-|:)slotted\(/
  descriptor.slotted = descriptor.styles.some(
    (s) => s.scoped && slottedRE.test(s.content),
  )

  return { descriptor, errors }
}

// ---------------------------------------------------------------
// 块建树与分类（真 parse.ts:166-232 对照）
// ---------------------------------------------------------------

function pushBlock(
  descriptor: SFCDescriptor,
  tag: string,
  source: string,
  attrs: Record<string, string | true>,
  contentStart: number,
  contentEnd: number,
  errors: SyntaxError[],
) {
  const block: SFCBlock = {
    type: tag,
    content: source.slice(contentStart, contentEnd),
    attrs,
    loc: {
      start: offsetToLoc(source, contentStart),
      end: offsetToLoc(source, contentEnd),
      source,
    },
  }
  // lang / src 抽取（真 parse.ts:336-339）
  if (typeof attrs.lang === 'string') block.lang = attrs.lang
  if (typeof attrs.src === 'string') block.src = attrs.src

  if (tag === 'template') {
    if (!descriptor.template) {
      const tpl = block as SFCTemplateBlock
      tpl.ast = null
      descriptor.template = tpl
    } else {
      errors.push(makeError(source, `Single file component can contain only one <template> element`, contentStart))
    }
    return
  }
  if (tag === 'script') {
    const isSetup = !!attrs.setup
    if (isSetup) {
      ;(block as SFCScriptBlock).setup = attrs.setup
    }
    if (isSetup && !descriptor.scriptSetup) {
      descriptor.scriptSetup = block as SFCScriptBlock
    } else if (!isSetup && !descriptor.script) {
      descriptor.script = block as SFCScriptBlock
    } else {
      errors.push(
        makeError(
          source,
          `Single file component can contain only one <script${isSetup ? ` setup` : ``}> element`,
          contentStart,
        ),
      )
    }
    return
  }
  if (tag === 'style') {
    const style = block as SFCStyleBlock
    if (attrs.scoped !== undefined) style.scoped = true // 真源码：scoped 只看有无
    if (attrs.module !== undefined) style.module = attrs.module
    descriptor.styles.push(style)
    return
  }
  // 自定义块（i18n 等）：原样保留，多个同类均保留
  descriptor.customBlocks.push(block)
}

// ---------------------------------------------------------------
// 闭合标签扫描
// ---------------------------------------------------------------

/**
 * RAWTEXT 闭合：逐位置找 `</tag`（大小写不敏感），后续必须是 '>' 或空白才确认。
 * 内容字符串里的 `</script>` 同样会闭合——HTML 标准行为（真 tokenizer.ts:425-473
 * 序列匹配器同款），教学文章里专门演示。
 */
function findCloseTagRaw(source: string, from: number, tag: string): number {
  const lower = tag.toLowerCase()
  let j = from
  while (j < source.length) {
    const lt = source.indexOf('<', j)
    if (lt === -1) return -1
    if (source[lt + 1] === '/') {
      let k = lt + 2
      let m = 0
      while (m < lower.length && k < source.length) {
        if (source[k].toLowerCase() !== lower[m]) break
        k++
        m++
      }
      if (m === lower.length) {
        const next = source[k]
        if (next === undefined || next === '>' || /\s/.test(next)) {
          return lt
        }
      }
    }
    j = lt + 1
  }
  return -1
}

/**
 * template 内容里允许嵌套 <template v-if/v-for/v-slot>，不能用「第一个 </template>」
 * 截断；用「开标签计数」找配对的闭合（真源码走完整 HTML 解析器天然处理）。
 * 文本里含字面 "<template" 的角落会错配——文档记差异。
 */
function findCloseTagBalanced(source: string, from: number): number {
  let depth = 1
  let j = from
  while (j < source.length) {
    const lt = source.indexOf('<', j)
    if (lt === -1) return -1
    if (source[lt + 1] === '!') {
      j = lt + 2
      continue
    }
    const tagMatch = /^[a-z][a-z0-9-]*/.exec(source.slice(lt + 1))
    if (tagMatch && tagMatch[0] === 'template') {
      // 开着（非闭合）= 内容里「模板标签」或注释文本，保守当开标签计
      depth++
      j = lt + 1 + tagMatch[0].length
      continue
    }
    if (source[lt + 1] === '/') {
      const closeMatch = /^\/\s*([a-z][a-z0-9-]*)/.exec(source.slice(lt + 1))
      if (closeMatch && closeMatch[1] === 'template') {
        depth--
        if (depth === 0) return lt
      }
    }
    j = lt + 1
  }
  return -1
}

/** 跳到闭合标签的结尾（'</tag' + 空白游移到 '>' 之后），供继续扫描 */
function findCloseTagEnd(source: string, closeAt: number, tag: string): number {
  let j = closeAt + 2 + tag.length
  if (source[j] === '>') return j + 1
  while (j < source.length && /\s/.test(source[j])) j++
  return source[j] === '>' ? j + 1 : source.length
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

function offsetToLoc(source: string, offset: number): { line: number; offset: number } {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line++
  }
  return { line, offset }
}

function makeError(source: string, message: string, offset: number): SyntaxError {
  const err = new SyntaxError(message) as SyntaxError & { loc?: { start: { line: number; offset: number } } }
  ;(err as any).loc = { start: offsetToLoc(source, offset) }
  return err
}