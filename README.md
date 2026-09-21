# mini-vue — 一行行手写的 Vue3 内核

从零实现的 Vue 3 内核：**响应式 → 渲染器/组件 → 编译器 → Options API / Transition / KeepAlive / 优化**。
没有一行用真 Vue 的代码跑起来，全部自研，`pnpm test` 绿（208 用例）。

## 为什么存在

学习「原理 + 源码」最可靠的办法是照着真源码重写一遍。每个阶段的做法：
**跑真 Vue 测试锁行为 → 读 `third_party/vue-core` 源码 → 写 mini 实现 → 测试验证 → 中文笔记**。

> 2026-09-20 计划修订：mini-vue-router / mini-pinia **取消**，本项目只做 vue 内核本身；
> 最后用一个展示 app 收官。

## 仓库地图

```
packages/
  shared/        类型/工具/ShapeFlags/PatchFlags
  reactivity/    响应式：reactive/ref/computed/effect/effectScope/集合特化
  runtime-core/  vnode/h/renderer/组件/调度器/keyed diff/watch/Options API/Transition/KeepAlive
  runtime-dom/   nodeOps/patchProp/事件 invoker/vModel/vShow/createApp
  compiler-core/ parse/transform/codegen（patchFlag+block+静态提升）
  compiler-dom/  isNativeTag 等 DOM 选项 + compile
  vue/           聚合包：createApp + compileToFunction（template 运行时编译）
examples/
  playground/   纯 h() 手写 demo
  showcase/     展示页：模板编译驱动的全能力演示
docs/            00 概览 / 01–07 各阶段笔记 / 14 打卡表（含 review gate）
third_party/    真 Vue v3.5.43 浅克隆（gitignore，本地阅读）
```

## 快速开始

```bash
pnpm install
pnpm test                        # 208 个测试
pnpm dev:playground              # h() 手写 demo（vite）
npx vite examples/showcase --config examples/showcase/vite.config.ts  # 展示页
```

## 打包产物（参考官方 vue 的 rollup 脚手架）

```bash
pnpm build        # dev + d.ts：每包 dist/<pkg>.{esm-bundler.js, cjs, d.ts}，vue 另有 global.js
pnpm build:prod   # __DEV__=false + 压缩，产出 *.prod.* / *.prod.cjs
```

- `scripts/build.js` 组织（逐包 spawn rollup + 依 `buildOptions.formats` 出多格式）；`rollup.config.js` 共享配置；
- d.ts 两段式（`tsc emitDeclarationOnly → temp/` + `rollup-plugin-dts` 捆成 `dist/<pkg>.d.ts`）；
- `__DEV__` 按 NODE_ENV define：dev=true / prod=false；
- 每包 `package.json` 的 `exports` 带 **`source` 条件** → vite/vitest 与 rollup-local 构建走 `src/index.ts`，
  npm 消费者走 `import`/`default`（dist）；
- 本地模拟消费：`node -e "const V=require('@mini-vue/vue')"` 即从 dist 加载。

产物形态对照官方：`dist/<pkg>.esm-bundler.js`（ESM）等价官方 esm-bundler；`dist/<pkg>.cjs` 等价官方 cjs；`vue.global.js`（IIFE，window.MiniVue）等价官方 global/UMD。

## 一句话说清它做了什么

```
"<div>{{ n }}</div>"
   → compiler（parse→transform→codegen）→ render 函数（with(_ctx) + patchFlag/block/hoist）
   → instance.update = effect(fn, { scheduler })   ← 响应式依赖变化驱动
   → renderer patch（keyed diff / block 快速路径）→ DOM
```

## 各阶段要点（详见 docs/00 与 docs/01–07）

| # | 主题 | 关键结论 |
|---|---|---|
| 1–2 | 响应式 | track/trigger / effect cleanup 分支切换 / effectScope（组件与库生命周期管理） |
| 3–4 | runtime | 组件=effect+scope / keyed diff+LIS（移动最少） / watch 三 flush / invoker |
| 5–6 | 编译 | 状态机 parse / transform 结构指令 / with(_ctx) 方案 / v-model 指令 |
| 7 | 补全 | Options API 合并 / Transition·KeepAlive / patchFlag·block·hoistStatic |

## 已知简化（真 Vue 有、mini 做的克制）

- 表达式用 `with(_ctx)`（真 Vue 是 prefixIdentifiers CSP 沙箱）
- 无 SSR/hydration、无 compiler-sfc（.vue）、无 Teleport/Suspense（KeepAlive/Transition 有简版）
- block 快速路径对「动态节点数变化」回退全量 diff
- 类型推导从简；无 devtools 插件

## 相关

- 真源码：github.com/vuejs/core（本地 `third_party/vue-core`）
- 每阶段的「真源码解读 + mini 取舍」见 `docs/`