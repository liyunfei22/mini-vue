/**
 * rollup.dts.config.js —— 第二阶段 d.ts 捆包（参考官方 rollup.dts.config.js）
 * 先由 tsconfig.build.json（tsc emitDeclarationOnly → temp/types）产出各包声明，
 * 再用 rollup-plugin-dts 把每包分散的 d.ts 捆成单个 dist/<pkg>.d.ts。
 */
import dts from 'rollup-plugin-dts'
import { readFileSync } from 'node:fs'

const TARGET = process.env.TARGET
if (!TARGET) throw new Error('rollup.dts 需要 TARGET（经 scripts/build.js 逐包传入）')

const pkg = JSON.parse(
  readFileSync(new URL(`./packages/${TARGET}/package.json`, import.meta.url), 'utf-8'),
)
export default {
  input: `temp/types/${TARGET}/src/index.d.ts`,
  output: { file: `packages/${TARGET}/dist/${TARGET}.d.ts`, format: 'es' },
  plugins: [dts()],
  onwarn(w, warn) {
    // 跨包的 d.ts import 是预想行为（consumer 自带依赖）
    if (w.code === 'UNRESOLVED_IMPORT' && !w.id?.includes('@mini-vue')) return
    warn(w)
  },
}