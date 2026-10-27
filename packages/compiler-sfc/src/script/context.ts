/**
 * context.ts —— ScriptCompileContext：compileScript 的状态容器
 *
 * 对应真 Vue compiler-sfc/src/script/context.ts（~200 行）。
 *
 * 核心教学点——两套坐标系：
 *   - babel 解析的是「script 块内容」（本地 offset）
 *   - MagicString 操作的是「整份 .vue 源码」（全局 offset）
 *   中间差一个 startOffset = scriptSetup 内容在 source 里的起点。
 * 所有改写一律经 ctx.getString/ctx.loc 换算，杜绝手工加减偏移。
 */
import MagicString from 'magic-string'
import { parse as babelParse } from '@babel/parser'
import type { Program } from '@babel/types'
import type { SFCDescriptor } from '../parse'
import { isJS } from './utils'

export class ScriptCompileContext {
  readonly descriptor: SFCDescriptor
  readonly filename: string
  readonly source: string
  readonly s: MagicString
  /** scriptSetup 内容在整份源码里的起点（两套坐标系的桥） */
  readonly startOffset: number
  readonly isJS: boolean
  readonly isTS: boolean
  /** babel 解析后的两个块 AST（offset 均为块内本地值） */
  scriptAst: Program | null
  scriptSetupAst: Program | null

  /** setup 顶层绑定：名字 → 是否 let（决定 __returned__ 的 get/set 形态） */
  setupBindings: Map<string, { isLet: boolean }> = new Map()
  /** 普通 script 的顶层绑定：保守按 let 处理（真源码 normalScript.ts 同策略） */
  normalBindings: Map<string, { isLet: boolean }> = new Map()
  /** 普通 script 的 import（返回对象里只有 getter，模块导入不可重赋值） */
  normalImports: Set<string> = new Set()

  /** 普通 script 的 export default 对象带了 name 键（跳过 __name 生成） */
  hasDefaultExportName = false
  /** 普通 script 是否含 export default（决定产物形态是 Object.assign 还是裸对象） */
  hasScriptDefault = false
  /** 普通 script 默认导出里的 props/emits 键（与 defineProps/defineEmits 查重） */
  scriptDefaultHas: { props?: boolean; emits?: boolean } = {}
  /** 普通 script 重写后的文本（export default → const __default__），preamble 组装用 */
  normalScriptText = ''

  // ---- 宏状态 ----
  hasDefinePropsCall = false
  hasDefineEmitsCall = false
  hasDefineExposeCall = false
  hasDefineOptionsCall = false

  /** defineProps/defineEmits/defineOptions 的实参 AST（getString 取原文用） */
  propsDecl: any = null
  emitsDecl: any = null
  optionsDecl: any = null
  /** setup 里带宏初始化的声明（const props = defineProps(...)），改写区间归主流程 */
  propsInitOverwrites: { init: any; replace: string }[] = []
  /** 「props 相关变量」是否被模板用——with(_ctx) 模式不需要 bindingMetadata，恒不查 */
  emitDeclOverwrites: { init: any }[] = []
  optionsCallStart = 0

  constructor(descriptor: SFCDescriptor) {
    const { script, scriptSetup, source, filename } = descriptor
    this.descriptor = descriptor
    this.filename = filename
    this.source = source
    this.s = new MagicString(source)

    this.startOffset = scriptSetup!.loc.start.offset
    this.isJS = isJS(scriptSetup!.lang)
    this.isTS = !this.isJS

    // babel 解析（真源码 resolveParserPlugins：importAttributes + TS 时 typescript）
    this.scriptSetupAst = this.parseBlock(scriptSetup!.content, this.startOffset)
    this.scriptAst = script ? this.parseBlock(script.content, script.loc.start.offset) : null
  }

  private parseBlock(content: string, offset: number): Program {
    try {
      const ast = babelParse(content, {
        sourceType: 'module',
        startLine: this.offsetToLine(offset),
        plugins: [
          'importAttributes',
          ...(this.isTS ? (['typescript'] as const) : []),
        ],
      })
      return ast.program
    } catch (e: any) {
      this.error(`Failed to parse <script> block: ${e.message}`, offset)
    }
  }

  /** 坐标换算：块内 offset → 整份源码 offset（教学点：两套坐标的唯一换算点） */
  at(offset: number): number {
    return offset + this.startOffset
  }

  /** 从源码取 AST 节点的原文（props/emits/options 声明用，保真原格式） */
  getString(node: any): string {
    return this.source.slice(this.at(node.start), this.at(node.end))
  }

  private offsetToLine(offset: number): number {
    let line = 1
    for (let i = 0; i < offset && i < this.source.length; i++) {
      if (this.source.charCodeAt(i) === 10) line++
    }
    return line
  }

  /** 统一的错误出口：行号 + 所在行源码（简版 codeframe） */
  error(msg: string, offset: number): never {
    const line = this.offsetToLine(offset)
    const lineStart = this.source.lastIndexOf('\n', offset - 1) + 1
    const lineEnd = this.source.indexOf('\n', offset)
    const rawLine = this.source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    throw new Error(
      `[@mini-vue/compiler-sfc] ${msg}\n\n${this.filename}:${line}\n${rawLine}\n${' '.repeat(Math.max(0, offset - lineStart))}^`,
    )
  }

  /** 注册 setup 顶层绑定（声明顺序即 __returned__ 顺序） */
  registerBinding(name: string, isLet = false): void {
    if (!this.setupBindings.has(name)) {
      this.setupBindings.set(name, { isLet })
    }
  }
}