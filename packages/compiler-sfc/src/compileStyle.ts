/**
 * compileStyle.ts —— scoped 样式编译管线
 *
 * 对应真 Vue compiler-sfc/src/compileStyle.ts（postcss 插件链；mini 手写两阶段）：
 *   1. 顶层规则遍历：按 `{...}` 花括号配对找规则区，选择器区交给 scoped 注入器，
 *      其余（声明体）原文不动；@media/@supports/@layer 递归进体；
 *      @keyframes 跳过（真源码会做 animation-name 改名，mini 不做，文档记差异）
 *   2. trim：删首尾空行（对应真 style/pluginTrim.ts）
 *
 * 不做：cssVars（v-bind() in css）、预处理器（less/sass）。
 */
import { rewriteSelectors } from './style/scoped'

export interface SFCStyleCompileOptions {
  source: string
  filename?: string
  /** scopeId（data-v-xxx）；scoped 样式必需 */
  id: string
  /** 是否为 scoped 样式（决定是否选择器注入） */
  scoped?: boolean
  /** 是否 trim 首尾空行 */
  trim?: boolean
  /** 预处理器 lang（less/scss/sass/stylus）：mini 不支持，探测到即报错 */
  preprocessLang?: string
}

export interface SFCStyleCompileResults {
  code: string
  errors: string[]
}

export function compileStyle(options: SFCStyleCompileOptions): SFCStyleCompileResults {
  const { source, filename = 'anonymous.vue', id, scoped = false, trim = false, preprocessLang } = options

  const errors: string[] = []

  if (preprocessLang) {
    errors.push(
      `[@mini-vue/compiler-sfc] style preprocessors (${preprocessLang}) are not supported by mini-vue compiler-sfc`,
    )
  }

  // id → longId 换算（与 compileTemplate 同款：data-v- 前缀幂等）
  const shortId = id.replace(/^data-v-/, '')
  const longId = `data-v-${shortId}`

  let code = scoped ? transformScoped(source, longId, errors) : source

  if (trim) {
    code = trimBlankLines(code)
  }

  return { code, errors }
}

// ---------------------------------------------------------------
// scoped 变换：顶层规则遍历（只换选择器区，其余原文）
// ---------------------------------------------------------------

function transformScoped(css: string, id: string, errors: string[]): string {
  const acc = { s: '' }
  walkTopLevel(css, 0, css.length, acc, id, errors)
  return acc.s
}

/** 顶层规则遍历：{...} 配对；选择器区重写，声明体原文 */
function walkTopLevel(
  css: string,
  start: number,
  end: number,
  out: { s: string },
  id: string,
  errors: string[],
): void {
  let j = start
  while (j < end) {
    const brace = findNextUnprotected(css, j, end, '{')
    if (brace === -1) {
      out.s += css.slice(j, end)
      return
    }
    // 选择器区 = [j, brace)
    const selectorText = css.slice(j, brace)

    // 配对的 }（花括号计数，含嵌套规则）
    const closeIdx = matchingBrace(css, brace, end)
    const bodyStart = brace + 1
    const bodyEnd = closeIdx === -1 ? end : closeIdx
    const head = selectorText.trim()

    if (head.startsWith('@')) {
      // at-rule：@media/@supports/@layer 递归处理体；@keyframes/@font-face 等整段跳过
      const atName = /^@([a-z-]+)/i.exec(head)?.[1] ?? ''
      if (atName === 'media' || atName === 'supports' || atName === 'layer') {
        out.s += selectorText + '{\n'
        walkTopLevel(css, bodyStart, bodyEnd, out, id, errors)
        out.s += '}\n'
      } else {
        // 原样保留整段（含 body）
        out.s += css.slice(j, bodyEnd + 1)
      }
    } else {
      // 规则：重写选择器区（.a, .b { } → 各自注入）；body 原文
      const rewritten = rewriteSelectors(selectorText, id, (msg) => errors.push(msg))
      out.s += rewritten + css.slice(brace, bodyEnd + 1)
    }

    j = closeIdx === -1 ? end : closeIdx + 1
  }
}

/** 找下一个未被注释/引号包住的字符 */
function findNextUnprotected(s: string, from: number, end: number, target: string): number {
  let i = from
  let quote: string | null = null
  while (i < end) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i++
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const close = s.indexOf('*/', i + 2)
      i = close === -1 || close + 2 > end ? end : close + 2
      continue
    }
    if (c === target) return i
    i++
  }
  return -1
}

/** 花括号配对（从 { 位置开始；跳过注释/引号/字符串） */
function matchingBrace(s: string, openIdx: number, end: number): number {
  let depth = 1
  let i = openIdx + 1
  let quote: string | null = null
  while (i < end) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i++
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const close = s.indexOf('*/', i + 2)
      if (close === -1) return -1
      i = close + 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

function trimBlankLines(code: string): string {
  return code.replace(/^\s*\n/, '').replace(/\n\s*$/, '')
}