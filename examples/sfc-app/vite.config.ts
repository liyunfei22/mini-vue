import { defineConfig } from 'vite'
import miniVueSfc from './mini-vue-sfc-plugin'

// sfc-app：compiler-sfc 的落地演示（阶段 C7）
// 与 playground 的区别：组件是真 .vue 单文件（script setup + scoped 样式）
export default defineConfig({
  plugins: [miniVueSfc()],
  resolve: {
    alias: {
      '@mini-vue/vue': new URL(
        '../../packages/vue/src/index.ts',
        import.meta.url,
      ).pathname,
      '@mini-vue/compiler-sfc': new URL(
        '../../packages/compiler-sfc/src/index.ts',
        import.meta.url,
      ).pathname,
      '@mini-vue/shared': new URL(
        '../../packages/shared/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
})