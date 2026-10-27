/**
 * compileTemplate.ts —— SFC 模板编译包装
 *
 * 对应真 Vue packages/compiler-sfc/src/compileTemplate.ts（~337 行，mini 裁到 ~70）。
 * 真源码在这里做：id → longId 换算、预处理语言、transformAssetUrls、
 * bindingMetadata 注入、行号回映（inMap）、SSR/CSS vars 分流。
 * mini 只保留核心：包一层 compiler-dom 的 compile，把 SFC 语义的选项
 * （scopeId / slotted / 错误收集）传透。
 *
 * 教学点：scoped 模式不会在产物里出现任何 data-v——scopeId 选项只影响
 * 「静态提升是否关闭」（codegen）与「<slot> 出口的 noSlotted 第 5 参」
 * （transformSlotOutlet）；data-v 属性全由运行时 currentScopeId 链路落下
 * （见 runtime-core scopeId 相关文件与 juejin2 对应文章）。
 */
import { compile } from '@mini-vue/compiler-dom'
import type { CompilerOptions } from '@mini-vue/compiler-core'

export interface SFCTemplateCompileOptions {
  source: string
  filename?: string
  /** SFC 的 scopeId（如 'data-v-abc123'）；缺省告警并置空（真源码 warnOnce 同款） */
  id: string
  scoped?: boolean
  /** 模板是否用了 :slotted()（parse 的 descriptor.slotted 传入） */
  slotted?: boolean
  compilerOptions?: CompilerOptions
}

export interface SFCTemplateCompileResults {
  code: string
  source: string
  tips: string[]
  errors: (string | Error)[]
}

let warnedId = false

export function compileTemplate(
  options: SFCTemplateCompileOptions,
): SFCTemplateCompileResults {
  const {
    source,
    filename = 'anonymous.vue',
    id,
    scoped = false,
    slotted = false,
    compilerOptions = {},
  } = options

  const errors: any[] = []
  const warnings: string[] = []

  if (!id) {
    if (!warnedId) {
      warnedId = true
      console.warn(`[@mini-vue/compiler-sfc] compileTemplate now requires the \`id\` option.`)
    }
  }

  // 真源码同款：短 id 是 hash，长 id = data-v-短 id（scoped 属性的完整名）
  const shortId = id.replace(/^data-v-/, '')
  const longId = `data-v-${shortId}`

  let code = ''
  try {
    const result = compile(source, {
      // 编译器侧只认这两个 SFC 语义选项（C1 已接入 TransformOptions）；
      // mini 的 CompilerOptions 无 filename（真源码有，仅用于错误信息），差异已文档化
      scopeId: scoped ? longId : undefined,
      slotted,
      onError: (e: any) => errors.push(e),
      ...compilerOptions,
    })
    code = result.code
  } catch (e: any) {
    // mini 差异：我们的 parser 对语法错误直接 throw（真源码经 onError 收集），
    // wrapper 统一转成 errors 数组，与 compileTemplate 的契约对齐
    errors.push(e)
  }

  const tips = warnings

  return { code, source, errors, tips }
}