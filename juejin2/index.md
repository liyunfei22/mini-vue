---
layout: home

hero:
  name: mini-vue
  text: 一行行手写的 Vue 3 内核
  tagline: 从零复刻响应式 → 运行时 → 编译器 → 内核补全，无一行真 Vue 代码，208 个测试全绿
  actions:
    - theme: brand
      text: 开始阅读
      link: /00-权衡与整体架构
    - theme: alt
      text: 在 GitHub 上查看
      link: https://github.com/liyunfei22/mini-vue

features:
  - title: 响应式系统
    details: Proxy + targetMap 两层的依赖收集，effect 的清理 / 嵌套 / 调度器，computed 惰性与脏位、ref、effectScope。
  - title: 渲染器与组件
    details: vnode 协议与宿主操作注入、shapeFlag 位图分发、组件实例、keyed diff + 最长递增子序列、事件缓存。
  - title: 模板编译器
    details: parse 状态机 → transform 双阶段 → codegen 拼串，with(_ctx) 方案，patchFlag / block / 静态提升。
  - title: 内核补全
    details: Options API 与组合式 API 共存、Transition / KeepAlive、编译优化三件套。
  - title: 构建与发布
    details: rollup 多格式产物命名、__DEV__ 注入机制、类型声明两段式捆包、exports 的 source 条件。
  - title: 自洽内核
    details: 栈上所有代码都跑在自己写的 reactivity / runtime / compiler 上，不依赖真 Vue。
---

## 这是什么

从零实现 Vue 3 内核的完整过程，覆盖一条完整的渲染管线：

```text
"<div>{{ n }}</div>"
   → compiler（parse → transform → codegen，patchFlag / block / hoist）
   → render 函数（with(_ctx)）
   → instance.update = effect(fn, { scheduler })
   → renderer patch（keyed diff / block 快速路径）→ DOM
```

每个阶段都遵循同一套做法：**跑真 Vue 测试锁行为 → 读 `third_party/vue-core` 源码 → 写 mini 实现 → 测试验证 → 中文笔记**。每篇讲清三件事：这个子系统的**设计动机**、关键实现的**逐点分析**、与官方实现的**差异清单**。

## 系列目录 {#series}

| # | 主题 | 覆盖 |
|---|---|---|
| 00 | [权衡与整体架构](/00-权衡与整体架构) | 命令式与声明式、运行时与编译时的分工、七个包的职责与一次更新的完整数据流 |
| 01 | [响应式系统](/01-响应式系统) | targetMap 与 track/trigger、副作用的清理 / 嵌套、调度器、computed 惰性与脏位、ref、effectScope |
| 02 | [渲染器与组件](/02-渲染器与组件) | vnode 协议、shapeFlag、组件实例、keyed diff + LIS、事件缓存 |
| 03 | [模板编译器](/03-模板编译器) | parse 状态机、transform 双阶段、codegen 与 with(_ctx)、compileToFunction 运行时接线 |
| 04 | [内核补全](/04-内核补全) | Options API 共存、Transition / KeepAlive、补丁标记 / 区块 / 静态提升 |
| 05 | [构建与发布](/05-构建与发布) | rollup 多格式、__DEV__ 注入、exports 的 source 条件、类型声明两段式 |

## 快速开始

配套工程仓库内即可运行全部代码与测试：

```bash
pnpm install
pnpm test          # 每篇的行为断言都在其中（208 个测试）
pnpm dev:showcase  # 模板编译驱动的展示页（自研内核渲染）
pnpm build         # 参考官方脚手架的构建流水线（05 篇）
```

文中引用的代码均标注仓库路径（如 `packages/reactivity/src/effect.ts`），可对照阅读完整实现。

## 内容依据

- **官方文档（cn.vuejs.org）**：术语与对外行为的基准；
- **[vuejs/core](https://github.com/vuejs/core) 源码（v3.5.x）**：实现真相，「与官方实现的差异」各节均经源码核对；
- **《Vue.js 设计与实现》（霍春阳 著）**：组织方法参照（问题 → 权衡 → 实现 → 分析）。