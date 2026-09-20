/**
 * @mini-vue/vue —— 聚合入口
 *
 * 与真 Vue 的 `vue` 包对应：把 runtime-dom + compiler-dom 织在一起，
 * 提供 createApp（运行时）+ compile / compileToFunction（运行时编译）。
 *
 * compileToFunction：把模板编译成 render 函数（new Function 实例化），
 * 各 helper 从注入的 Vue 模块解构（代码顶部的 `const {...} = Vue`）。
 */
export * from '@mini-vue/runtime-dom'
import * as runtimeDom from '@mini-vue/runtime-dom'
import { registerRuntimeCompiler } from '@mini-vue/runtime-core'
import { compile } from '@mini-vue/compiler-dom'
import type { CompilerOptions } from '@mini-vue/compiler-core'

export { compile }

export function compileToFunction(template: string, options?: CompilerOptions & { onError?: (e: any) => void }) {
  const { code } = compile(template, options)
  const render = new Function('Vue', code)(runtimeDom)

  ;(render as any)._rc = true // 标记为编译产物（供调试/测试识别）
  return render
}

// 注册运行时编译器：让 `template: "..."` 选项可用（与真 Vue 的 config.compiler 语义一致）
registerRuntimeCompiler(compileToFunction)

export const version = '0.5.0'