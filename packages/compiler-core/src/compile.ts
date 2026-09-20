/**
 * compile.ts —— 编译编排
 *
 * 对应真 Vue packages/compiler-core/src/compile.ts。
 * baseCompile = baseParse → transform → generate 一条龙。
 * DOM 专属能力（isNativeTag 等 parserOptions、model/show 指令）由 compiler-dom 注入。
 */
import { extend } from '@mini-vue/shared'
import { baseParse, type ParserOptions } from './parse'
import { transform, type TransformOptions } from './transform'
import { generate } from './codegen'
import { transformIf } from './transforms/transformIf'
import { transformFor } from './transforms/transformFor'
import { transformElement } from './transforms/transformElement'
import { transformText } from './transforms/transformText'
import { transformSlotOutlet } from './transforms/transformSlotOutlet'
import { transformExpression } from './transforms/transformExpression'

export interface CompilerOptions
  extends ParserOptions,
    TransformOptions {
  prefixIdentifiers?: boolean
}

export function baseCompile(
  template: string | any,
  options: CompilerOptions = {},
) {
  const onError = options.onError || ((e: any) => { throw e })
  let ast = isStringTemplate(template) ? baseParse(template, options) : template

  transform(ast, extend({}, options, {
    nodeTransforms: [
      transformIf,
      transformFor,
      transformExpression,
      transformSlotOutlet,
      transformElement,
      transformText,
      ...(options.nodeTransforms || []),
    ],
  }))

  return generate(ast, options)
}

function isStringTemplate(t: any): t is string {
  return typeof t === 'string'
}