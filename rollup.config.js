/**
 * rollup.config.js —— 共享构建配置（每个包经由 build.js 传 TARGET 来 build）
 *
 * 参考官方 vuejs/core/packages 的 rollup 骨架：
 *   - TARGET 决定打哪个包（readFileSync packages/<TARGET>/package.json 的 buildOptions）
 *   - outputConfigs：format → 文件命名 + rollup format（esm-bundler / cjs / global(仅 vue)）
 *   - NODE_ENV=production：define __DEV__=false + esbuild minify（产出 *.prod.js）
 *   - nodeResolve exportConditions:['source'] → 跨包解析走各自的 src/index.ts（不依赖先构建的 dist）
 */
import nodeResolve from '@rollup/plugin-node-resolve'
import esbuild from 'rollup-plugin-esbuild'
import { readFileSync } from 'node:fs'

const TARGET = process.env.TARGET
if (!TARGET) throw new Error('[mini-vue] rollup 需要 TARGET（经 scripts/build.js 注入）')
const NODE_ENV = process.env.NODE_ENV || 'development'
const isProd = NODE_ENV === 'production'

const pkg = JSON.parse(
  readFileSync(new URL(`./packages/${TARGET}/package.json`, import.meta.url), 'utf-8'),
)
const buildOptions = pkg.buildOptions || {}
const formats = (
  process.env.FORMATS ? process.env.FORMATS.split(',') : buildOptions.formats || ['esm-bundler', 'cjs']
)
const name = buildOptions.name || 'MiniVue'

const entry = `packages/${TARGET}/src/index.ts`
const outputName = (f) => {
  const prod = isProd ? '.prod' : ''
  if (f === 'esm-bundler') return `packages/${TARGET}/dist/${pkg.name.replace('@mini-vue/', '')}.esm-bundler${prod}.js`
  if (f === 'cjs') return `packages/${TARGET}/dist/${TARGET}${prod}.cjs`
  if (f === 'global') return `packages/${TARGET}/dist/${TARGET}.global${prod}.js`
  return `packages/${TARGET}/dist/${TARGET}.${f}.js`
}
const outputFormat = { 'esm-bundler': 'es', cjs: 'cjs', global: 'iife' }

const define = {
  __DEV__: isProd ? 'false' : 'true',
  'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
}

export default formats.map((f) => ({
  input: entry,
  output: {
    file: outputName(f),
    format: outputFormat[f],
    exports: 'named',
    name: f === 'global' ? name : undefined,
    sourcemap: false,
    banner: `/* mini-vue ${TARGET} v${pkg.version} (${NODE_ENV}) */`,
  },
  plugins: [
    // exportConditions:['source'] → 跨包 @mini-vue/x 从兄弟包 package.json 的 exports.source 吃源码
    nodeResolve({ exportConditions: ['source'], extensions: ['.ts', '.js'] }),
    esbuild({
      define,
      target: 'es2018',
      minify: isProd,
      treeShaking: true,
      sourcemap: false,
    }),
  ],
  onwarn(w, warn) {
    // 跨包 circular 是 monorepo 常态（shared↔reactivity 等），不刷屏
    if (w.code && (w.code.startsWith('CIRCULAR') || w.code === 'UNRESOLVED_IMPORT')) return
    warn(w)
  },
}))