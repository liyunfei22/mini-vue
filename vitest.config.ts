import { defineConfig } from 'vitest/config'

// packages 通过 pnpm workspace 在根 node_modules 建立符号链接，
// 包名（如 @mini-vue/shared）直接由 exports 解析到 src/index.ts，
// vitest(vite) 会以 esbuild 直接消费 TS 源码，无需前置构建。
export default defineConfig({
  test: {
    include: ['packages/**/__tests__/**/*.spec.ts'],
    // 默认 node 环境；后续 runtime/compiler 包需要 DOM 的用例，
    // 会在文件头加 `// @vitest-environment jsdom` 单独切换
    environment: 'node',
  },
})