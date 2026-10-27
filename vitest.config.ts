import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

// packages 通过 pnpm workspace 在根 node_modules 建立符号链接，
// 包名（如 @mini-vue/shared）由 exports 解析到 src/index.ts；
// 这里显式 alias 是对「测试文件/示例里直接裸引 @mini-vue/*」的兜底
// （部分场景 vite 的 workspace 解析不覆盖到 examples/ 或测试目录）。
export default defineConfig({
  resolve: {
    // exports 已加 source 条件：把 'source' 放进条件集首位 → 测试/vite 继续吃 src/index.ts
    // （npm 消费者默认条件跑 import/default → dist）
    conditions: ['source', 'module', 'browser', 'development|production', 'import', 'require', 'default'],
    alias: {
      '@mini-vue/shared': pkg('shared'),
      '@mini-vue/reactivity': pkg('reactivity'),
      '@mini-vue/runtime-core': pkg('runtime-core'),
      '@mini-vue/runtime-dom': pkg('runtime-dom'),
      '@mini-vue/compiler-core': pkg('compiler-core'),
      '@mini-vue/compiler-dom': pkg('compiler-dom'),
      '@mini-vue/compiler-sfc': pkg('compiler-sfc'),
      '@mini-vue/vue': pkg('vue'),
    },
  },
  test: {
    include: [
      'packages/**/__tests__/**/*.spec.ts',
      // 最小闭环（examples/minimal）：行为契约测试，纯 JS ESM
      'examples/minimal/**/__tests__/**/*.spec.js',
    ],
    // 默认 node 环境；需要 DOM 的用例在文件头 `// @vitest-environment jsdom`
    environment: 'node',
  },
})
