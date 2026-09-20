import { defineConfig } from 'vite'

// playground 直接用 TS 源码；@mini-vue/* 由 pnpm workspace 链接解析
export default defineConfig({
  resolve: {
    // 显式指到源码，绕过「必须在 node_modules」的歧义
    alias: {
      '@mini-vue/reactivity': new URL(
        '../../packages/reactivity/src/index.ts',
        import.meta.url,
      ).pathname,
      '@mini-vue/shared': new URL(
        '../../packages/shared/src/index.ts',
        import.meta.url,
      ).pathname,
      '@mini-vue/runtime-core': new URL(
        '../../packages/runtime-core/src/index.ts',
        import.meta.url,
      ).pathname,
      '@mini-vue/runtime-dom': new URL(
        '../../packages/runtime-dom/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
})