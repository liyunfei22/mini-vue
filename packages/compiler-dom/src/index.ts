/**
 * @mini-vue/compiler-dom —— DOM 专属编译
 * 对应真 Vue packages/compiler-dom/src/index.ts。
 * 在 compiler-core 基础上：注入 DOM parserOptions，导出 compile 入口。
 */
import { extend } from '@mini-vue/shared'
import { baseCompile, type CompilerOptions } from '@mini-vue/compiler-core'
import type { CodegenResult } from '@mini-vue/compiler-core'
import { parserOptions } from './parserOptions'

export function compile(template: string, options: CompilerOptions = {}): CodegenResult {
  return baseCompile(template, extend({}, parserOptions, options, {
    nodeTransforms: [...(options.nodeTransforms || [])],
  }))
}

export * from '@mini-vue/compiler-core'