import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@mini-vue/reactivity': new URL('../../packages/reactivity/src/index.ts', import.meta.url).pathname,
      '@mini-vue/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
      '@mini-vue/runtime-core': new URL('../../packages/runtime-core/src/index.ts', import.meta.url).pathname,
      '@mini-vue/runtime-dom': new URL('../../packages/runtime-dom/src/index.ts', import.meta.url).pathname,
      '@mini-vue/compiler-core': new URL('../../packages/compiler-core/src/index.ts', import.meta.url).pathname,
      '@mini-vue/compiler-dom': new URL('../../packages/compiler-dom/src/index.ts', import.meta.url).pathname,
      '@mini-vue/vue': new URL('../../packages/vue/src/index.ts', import.meta.url).pathname,
    },
  },
})
