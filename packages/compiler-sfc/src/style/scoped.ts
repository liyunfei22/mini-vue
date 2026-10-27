/**
 * style/scoped.ts —— scoped 选择器注入器（手写词法器）
 *
 * 对应真 Vue compiler-sfc/src/style/pluginScoped.ts（postcss + postcss-selector-parser
 * 全家；mini 用手写扫描器复刻 rewriteSelector 的可教学子集，~90% 用例覆盖）。
 *
 * 规则表（全部以真 @vue/compiler-sfc@3.5.43 实测产物为 ground truth）：
 *   .a                      → .a[data-v-x]
 *   .a .b:hover             → .a .b[data-v-x]:hover        （锚点=最后一个可注入复合选择器）
 *   .a :deep(.b)            → .a[data-v-x] .b              （锚点注入在 :deep 之前）
 *   :deep(.c) / :deep(> .d) → [data-v-x] .c / [data-v-x] > .d（独立 :deep → 前缀注入）
 *   .a :slotted(.foo)       → .a .foo[data-v-x-s]          （-s 后缀；外层不再注普通 id）
 *   :global(.h)             → .h                           （真源码：整条选择器替换为内层！
 *                                                            selector.replaceWith(n.nodes[0])）
 *   * .u / .u *             → .u[data-v-x] / .u[data-v-x] *
 *   .a:not(.b)              → .a[data-v-x]:not(.b)
 *   :not(.b)                → [data-v-x]:not(.b)           （无锚点 → 选择器头部前缀注入）
 *   :is(.m, .n)             → :is(.m[data-v-x], .n[data-v-x])（is/where 独立时内层逐项注入）
 *   .container :is(.x, .y)  → .container[data-v-x] :is(.x, .y)
 *   ::before                → [data-v-x]::before
 *   [data-x]                → [data-x][data-v-x]
 *   /deep/                  → 等同 :deep（警告后按 :deep 处理）
 *   >>                      → 保留 + 警告
 *
 * mini 不支持（错误提示 + 文档记录）：容器伪类（:is/:where/:has/:not）内含 :deep、
 * 一条选择器多个 :deep。
 */

/** 对一条 selectors 列表（逗号分隔，顶层）逐条重写；保留首尾空白 */
export function rewriteSelectors(
  selectors: string,
  id: string,
  onError: (msg: string) => void,
): string {
  const leading = /^\s*/.exec(selectors)![0]
  const trailing = /\s*$/.exec(selectors)![0]
  const core = selectors.slice(leading.length, selectors.length - trailing.length)
  const rewritten = splitTopLevel(core, ',')
    .map((sel) => rewriteSelector(sel, id, onError))
    .join(',')
  return leading + rewritten + trailing
}

interface Token {
  isCombinator: boolean
  /** plain 复合 = base + tail（tail 为尾随伪类链）；伪类家族 base 恒 '' */
  base: string
  tail: string
  kind: TokenKind
  inner: string | null
}

type TokenKind = 'plain' | 'pseudo' | 'pseudoElt' | 'container' | 'deep' | 'slotted' | 'global'

const COMBINATOR_CHARS = new Set(['>', '+', '~'])

/**
 * 单条选择器重写。token 化 → 锚点判定 → 注入。
 * 返回重写后的选择器字符串（错误时原样返回并回调 onError）。
 */
function rewriteSelector(
  selector: string,
  id: string,
  onError: (msg: string) => void,
): string {
  const leading = /^\s*/.exec(selector)![0]
  const trailing = /\s*$/.exec(selector)![0]
  const core = selector.slice(leading.length, selector.length - trailing.length)
  if (!core.trim()) return selector

  // ---- 废弃写法警告 ----
  if (/\/deep\/|\s>>\s/.test(core)) {
    onError(`the >>> and /deep/ combinators have been deprecated. Use :deep() instead.`)
  }
  // /deep/ 归一成 deep 标记（>> 原样保留）；占位 inner 为空 → 注入后只剩尾随部分
  const norm = core.replace(/\/deep\//g, ':deep()')

  const tokens = tokenize(norm)
  if (tokens.length === 0) return selector

  // 判断出现次数（>1 个 :deep 不支持）
  const deepCount = tokens.filter((t) => t.kind === 'deep').length
  if (deepCount > 1) {
    onError(`mini-vue compiler-sfc: multiple :deep() in one selector is not supported`)
    return selector
  }

  // ---- :global 出现 → 整条选择器替换为最后一次的内层（真源码 replaceWith 语义） ----
  for (const t of tokens) {
    if (t.kind === 'global') {
      return leading + (t.inner || '') + trailing
    }
  }

  // ---- 容器伪类内含 :deep → 不支持 ----
  for (const t of tokens) {
    if (t.kind === 'container' && t.inner && t.inner.includes(':deep')) {
      onError(
        `mini-vue compiler-sfc: :deep() inside :is()/:where()/:has()/:not() is not supported ` +
          `(read the real splitSelectorForNestedDeep)`,
      )
      return selector
    }
  }

  // ---- 锚点判定与注入 ----
  const deepIdx = tokens.findIndex((t) => t.kind === 'deep')
  const slottedIdx = tokens.findIndex((t) => t.kind === 'slotted')
  let out: string

  if (deepIdx !== -1) {
    const deep = tokens[deepIdx]
    const anchor = lastAnchorIndex(tokens.slice(0, deepIdx))
    const inner = (deep.inner || '').trim()
    // /deep/ 占位（inner 为空）时：尾随的空格组合器剥掉前导空白，避免双空格
    const tail = reassembleTail(tokens, deepIdx)
    const tailClean = !inner ? tail.replace(/^\s+/, '') : tail
    if (anchor >= 0) {
      // 注入在 :deep 之前的锚点后；尾随空格组合器不再补空格
      const before = tokens.slice(0, deepIdx)
      const hasSpace = before.length > 0 && before[before.length - 1].isCombinator && /^\s+$/.test(before[before.length - 1].base)
      out = reassemble(before, anchor, `[${id}]`) + (hasSpace || !inner ? '' : ' ') + inner + tailClean
    } else {
      out = `[${id}]` + (inner.startsWith(':') || !inner ? '' : ' ') + inner + tailClean
    }
  } else if (slottedIdx !== -1) {
    // :slotted：-s 注入内层各顶层项；外层（:slotted 之前的部分）不再注入普通 id
    const slotted = tokens[slottedIdx]
    const innerId = `${id}-s`
    const innerRaw = (slotted.inner || '').trim()
    const inner = innerRaw
    let innerText: string
    if (/^[>+~]/.test(inner)) {
      // 首部组合器保留：:slotted(> .x) → [data-v-s] > .x
      innerText = `[${innerId}] ` + inner
    } else {
      innerText = splitTopLevel(inner, ',')
        .map((part) => injectAnchor(part, innerId))
        .join(',')
    }
    out = exportTokens(tokens.slice(0, slottedIdx)) + innerText + reassembleTail(tokens, slottedIdx)
  } else {
    // 常规：锚点 = 最后一个可注入复合选择器（base 注入）；无锚 →
    //   is/where 独立时递归内层逐项注入（真源码 insertAfter 语义）；否则头部前缀
    const anchor = lastAnchorIndex(tokens)
    if (anchor >= 0) {
      out = reassemble(tokens, anchor, `[${id}]`)
    } else {
      const containerToken = tokens.find((t) => t.kind === 'container' && /^:(is|where)\(/.test(t.base + t.tail))
      if (containerToken && containerToken.inner) {
        // :is(.m, .n) → :is(.m[data-v], .n[data-v])：递归内层逐项
        const rewrittenInner = splitTopLevel(containerToken.inner.trim(), ',')
          .map((part) => injectAnchor(part, id))
          .join(',')
        const before = exportTokens(tokens.slice(0, tokens.indexOf(containerToken)))
        const after = exportTokens(tokens.slice(tokens.indexOf(containerToken) + 1))
        const tailText = containerToken.tail
        const open = tailText.indexOf('(')
        const close = tailText.lastIndexOf(')')
        const rewrittenContainer = tailText.slice(0, open + 1) + rewrittenInner + tailText.slice(close)
        out = before + rewrittenContainer + after
      } else {
        // 前缀注入：后随 ':' 开头的 token（伪类/伪元素/容器）时不补空格
        const first = tokens[0]
        const nextText = first ? first.base + first.tail : ''
        const sep = first && !first.isCombinator && nextText.startsWith(':') ? '' : ' '
        out = `[${id}]` + sep + exportTokens(tokens)
      }
    }
  }

  return leading + out + trailing
}

// ---------------------------------------------------------------
// 核心辅助
// ---------------------------------------------------------------

/**
 * 锚点：最后一个「可注入」的 plain 复合选择器（base 非空、不是首位/末位的 universal）。
 * is/where 独立形态由调用方特判。
 */
function lastAnchorIndex(tokens: Token[]): number {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]
    if (t.isCombinator) continue
    if (t.kind !== 'plain') continue
    if (!t.base) continue
    if (t.base === '*') continue
    return i
  }
  return -1
}

/** 重组到锚点后注入：attr 插在 ANCHOR 的 base 与尾随伪类链之间（.b:hover → .b[id]:hover） */
function reassemble(tokens: Token[], anchorIdx: number, attr: string): string {
  let out = ''
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    out += t.base
    if (i === anchorIdx) out += attr
    out += t.tail
  }
  return out
}

/** 从 deep/slotted/global 之后的部分原样拼接（当前只支持单个标记：之后一般为空） */
function reassembleTail(tokens: Token[], markerIdx: number): string {
  let out = ''
  for (let i = markerIdx + 1; i < tokens.length; i++) {
    out += exportToken(tokens[i])
  }
  return out
}

/** 整段 token 文本（base + tail） */
function exportTokens(tokens: Token[]): string {
  let out = ''
  for (const t of tokens) out += exportToken(t)
  return out
}

function exportToken(t: Token): string {
  return t.isCombinator ? t.base : t.base + t.tail
}

/** 单条复合内注入（:slotted 内层项用）：.foo:hover → .foo[data-v-s]:hover */
function injectAnchor(partRaw: string, id: string): string {
  const leading = /^\s*/.exec(partRaw)![0]
  const trailing = /\s*$/.exec(partRaw)![0]
  const core = partRaw.slice(leading.length, partRaw.length - trailing.length)
  if (!core) return partRaw
  const tokens = tokenize(core)
  const anchor = lastAnchorIndex(tokens)
  if (anchor === -1) {
    return leading + `[${id}] ` + core + trailing
  }
  return leading + reassemble(tokens, anchor, `[${id}]`) + trailing
}

// ---------------------------------------------------------------
// token 化：组合器 + 复合选择器（base/尾部伪类链拆分）
// ---------------------------------------------------------------

function tokenize(s: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let buf = ''
  const flushCompound = () => {
    if (buf) {
      tokens.push(classifyCompound(buf))
      buf = ''
    }
  }
  while (i < s.length) {
    const c = s[i]
    // 注释整体跳过（夹在组合器间隙，当作空白处理；原文保留在组合器 token 里）
    if (c === '/' && s[i + 1] === '*') {
      flushCompound()
      const close = s.indexOf('*/', i + 2)
      const j = close === -1 ? s.length : close + 2
      const chunk = s.slice(i, j)
      const last = tokens[tokens.length - 1]
      if (last && last.isCombinator && /^\s+$/.test(last.base)) {
        last.base += chunk // 并入前一个空格组合器（保持原文顺序）
      } else {
        tokens.push({ isCombinator: true, kind: 'plain', base: chunk, tail: '', inner: null })
      }
      i = j
      continue
    }
    // 组合器：空白串与 > + ~（原文保留）
    if (/\s/.test(c)) {
      flushCompound()
      let j = i
      while (j < s.length && /\s/.test(s[j])) j++
      tokens.push({ isCombinator: true, kind: 'plain', base: s.slice(i, j), tail: '', inner: null })
      i = j
      continue
    }
    if (COMBINATOR_CHARS.has(c)) {
      flushCompound()
      tokens.push({ isCombinator: true, kind: 'plain', base: c, tail: '', inner: null })
      i++
      continue
    }
    // 复合选择器：引号/括号/方括号整体消费，直到顶层遇组合器
    const start = i
    let quote: string | null = null
    let paren = 0
    let bracket = 0
    while (i < s.length) {
      const ch = s[i]
      if (quote) {
        if (ch === quote) quote = null
        i++
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        i++
        continue
      }
      if (ch === '[') bracket++
      else if (ch === ']') bracket--
      else if (ch === '(') paren++
      else if (ch === ')') paren--
      if (bracket === 0 && paren === 0 && (/\s/.test(ch) || COMBINATOR_CHARS.has(ch))) {
        break // 顶层组合器：不消费，留给外层循环
      }
      i++
    }
    buf += s.slice(start, i)
    flushCompound()
  }
  flushCompound()
  // 首位 universal 特例：* .foo → .foo（去掉 * 与紧随的空格组合器）
  if (
    tokens.length >= 2 &&
    tokens[0].kind === 'plain' &&
    tokens[0].base === '*' &&
    !tokens[0].isCombinator &&
    tokens[1].isCombinator &&
    /^\s+$/.test(tokens[1].base)
  ) {
    tokens.splice(0, 2)
  }
  return tokens
}

/** 复合选择器分类 + 尾部伪类链拆分（.b:hover → base .b / tail :hover） */
function classifyCompound(text: string): Token {
  // 伪类家族：整体以 ':' 开头 → base 空
  if (text.startsWith(':')) {
    const deep = /^:{1,2}v-deep\(/i.test(text) || /^:deep\(/i.test(text)
    const slotted = /^:slotted\(/i.test(text)
    const global = /^:global\(/i.test(text) || /^::v-global\(/i.test(text)
    const container = /^:(is|where|has|not)\(/i.test(text)
    const pseudoElt = /^::/.test(text)
    let kind: TokenKind = deep ? 'deep' : slotted ? 'slotted' : global ? 'global' : container ? 'container' : pseudoElt ? 'pseudoElt' : 'pseudo'
    let inner: string | null = null
    if (deep || slotted || global || container) {
      const open = text.indexOf('(')
      const close = text.lastIndexOf(')')
      if (open !== -1 && close > open) inner = text.slice(open + 1, close)
    }
    return { isCombinator: false, base: '', tail: text, kind, inner }
  }
  // plain：base = 第一个顶层 ':' 之前的部分；tail = 尾随伪类链
  let colon = -1
  let quote: string | null = null
  let paren = 0
  let bracket = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '[') bracket++
    else if (c === ']') bracket--
    else if (c === '(') paren++
    else if (c === ')') paren--
    if (c === ':' && bracket === 0 && paren === 0) {
      colon = i
      break
    }
  }
  return {
    isCombinator: false,
    base: colon === -1 ? text : text.slice(0, colon),
    tail: colon === -1 ? '' : text.slice(colon),
    kind: 'plain',
    inner: null,
  }
}

// ---------------------------------------------------------------
// 词法工具：顶层逗号拆分 / 注释与引号保护
// ---------------------------------------------------------------

/** 括号/方括号/引号感知的顶层逗号拆分 */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let bracket = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const close = s.indexOf('*/', i + 2)
      const j = close === -1 ? s.length : close + 2
      cur += s.slice(i, j)
      i = j - 1
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === '[') bracket++
    if (c === ']') bracket--
    if (c === sep && depth === 0 && bracket === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  parts.push(cur)
  return parts
}

/** 注释感知：splitTopLevel 与 tokenize 都整体跳过块注释（原文保留在输出里） */