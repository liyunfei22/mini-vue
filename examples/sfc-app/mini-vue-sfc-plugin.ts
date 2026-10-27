/**
 * mini-vue-sfc-plugin.ts —— 迷你 @vitejs/plugin-vue
 *
 * 教学版 SFC 插件：把 .vue 文件编译成可运行的 ESM 模块。
 * 与真 plugin-vue 的分工一致：
 *   - compiler-sfc 负责 parse/compileScript/compileTemplate/compileStyle
 *   - 插件负责集成层：render 挂载、__scopeId 落组件、style 进 DOM
 *
 * 与真插件（@vitejs/plugin-vue）的差异（文档记录）：
 *   - 真插件把 style 交给 vite 原生 css 管线（query 里带 lang.css），
 *     这里用手写 <style> 注入模块（教学自包含，不依赖 vite 内部约定）
 *   - 真插件按 query 分派 type=script/template/style 多次编译 + 缓存；
 *     这里一次 transform 全量处理
 *   - scopeId 用内容哈希（真插件用文件名 hash + 内容增量）
 */
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { transform as esbuildTransform } from 'esbuild'
// 相对路径直引源码：vite 加载配置时（node 环境）只有根 devDeps 会被链接到顶层
// node_modules，@mini-vue/compiler-sfc 不在其列；插件只在构建/开发进程里跑，
// 不会打进浏览器产物（应用代码里的 @mini-vue/vue 走 vite.config 的 alias）
import {
  parse,
  compileScript,
  compileTemplate,
  compileStyle,
} from '../../packages/compiler-sfc/src/index.ts'

/** djb2 内容哈希 → 8 位 hex（scopeId 只需稳定，不追求密码学强度） */
function hashContent(content: string): string {
  let h = 5381
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const STYLE_QUERY = /\?vue&type=style&index=(\d+)$/

export default function miniVueSfc(): Plugin {
  return {
    name: 'mini-vue-sfc',
    enforce: 'pre', // 先于 vite 的默认转换（保证 .vue 不被当 JS 解析）

    async transform(code, id) {
      if (!id.endsWith('.vue')) return null

      const { descriptor, errors } = parse(code, { filename: id })
      if (errors.length) {
        throw errors[0]
      }
      const scopeId = 'data-v-' + hashContent(code)
      const isScoped = descriptor.styles.some((s) => s.scoped)

      // ---- 1. script setup → 组件对象；export default → const __sfc__ ----
      let scriptCode = compileScript(descriptor).content.replace(
        /^export default /m,
        'const __sfc__ = ',
      )

      // ---- 1b. lang=ts 的类型注解剥除（只处理 script 部分：产物里的 with(_ctx)
      //    render 不能在 esbuild/模块里过——with 只存在于 sloppy 函数体） ----
      if (descriptor.scriptSetup?.lang === 'ts' || descriptor.script?.lang === 'ts') {
        const res = await esbuildTransform(scriptCode, { loader: 'ts', target: 'es2018' })
        scriptCode = res.code
      }

      // ---- 2. template → render 函数。with(_ctx) 产物 = 函数体形态（天生不是
      //    ESM：with 语句在 strict/module 里非法），集成层用 new Function 实例化——
      //    与 @mini-vue/vue 的 compileToFunction 同一条路。真 vue 的
      //    prefixIdentifiers 产物是模块级代码，无需这一步（教学点，文档记录） ----
      let renderLine = ''
      if (descriptor.template) {
        const { code: tplCode, errors: tplErrors } = compileTemplate({
          source: descriptor.template.content,
          filename: id,
          id: scopeId,
          scoped: isScoped,
          slotted: descriptor.slotted,
        })
        if (tplErrors.length) {
          throw tplErrors[0]
        }
        renderLine =
          `import * as __Vue from '@mini-vue/vue'\n` +
          `__sfc__.render = new Function('Vue', ${JSON.stringify(tplCode)})(__Vue)\n`
      }

      // ---- 3. styles → 注入式 css 模块（load 钩子按 query 提供） ----
      const styleImports = descriptor.styles
        .map((_, i) => `import '${styleQueryOf(id, i)}'\n`)
        .join('')

      // ---- 4. 组装 ----
      const out = [
        scriptCode,
        renderLine,
        isScoped ? `__sfc__.__scopeId = ${JSON.stringify(scopeId)}\n` : '',
        styleImports,
        `\nexport default __sfc__`,
      ].join('\n')
      return out
    },

    load(loadId) {
      const m = STYLE_QUERY.exec(loadId)
      if (!m) return null
      const file = loadId.slice(0, loadId.indexOf('?'))
      const index = Number(m[1])
      const code = readFileSync(file, 'utf-8')
      const { descriptor } = parse(code, { filename: file })
      const style = descriptor.styles[index]
      if (!style) return null
      // 完整走 compileStyle（scoped 注入器在这条链上）
      const { code: css } = compileStyle({
        source: style.content,
        filename: file,
        id: 'data-v-' + hashContent(code),
        scoped: !!style.scoped,
        trim: true,
      })
      // 教学自包含的注入模块（真插件交给 vite css 管线，见文件头差异说明）
      return [
        `const css = ${JSON.stringify(css)}`,
        `const style = document.createElement('style')`,
        `style.textContent = css`,
        `document.head.appendChild(style)`,
      ].join('\n')
    },
  }
}

function styleQueryOf(id: string, index: number): string {
  return `${id}?vue&type=style&index=${index}`
}