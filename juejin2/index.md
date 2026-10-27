---
layout: home

hero:
  name: mini-vue
  text: 一行行手写的 Vue 3 内核
  tagline: 从零复刻响应式 → 渲染器 → 编译器 → 内核补全，无一行真 Vue 代码，全套行为测试护航
  actions:
    - theme: brand
      text: 开始阅读
      link: /00-权衡与全景
    - theme: alt
      text: 在 GitHub 上查看
      link: https://github.com/liyunfei22/mini-vue

features:
  - title: 副作用与桶
    details: 从二十行手写最小响应式开始：桶 → 两层账本 targetMap → track/trigger，概念全部从例子长出来。
  - title: 渲染器与组件
    details: vnode 协议与宿主注入、keyed diff 与最长递增子序列、组件即渲染副作用、异步批更新。
  - title: 模板编译器
    details: parse 状态机 → transform 双阶段 → codegen，with(_ctx) 的取舍与 patchFlag / block / 静态提升。
  - title: 渐进式讲法
    details: 每章先写朴素版、指出做不到什么，再看完整实现如何演进——对齐《Vue.js 设计与实现》的教学节奏。
  - title: 与官方对照
    details: 每章末列出与 vuejs/core 的真实差距，全部经 v3.5 源码核对；含若干真实修复过的踩坑案例。
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

## 系列目录 {#series}

| 部分 | 章节 |
|---|---|
| 框架设计 | [00 · 权衡与全景](/00-权衡与全景) |
| 响应式 | [01 · 副作用与桶](/01-副作用与桶) · [02 · 让依赖永远准确](/02-让依赖永远准确) · [03 · computed 与 ref](/03-computed与ref) · [04 · 调度器与 watch](/04-调度器与watch) |
| 渲染器 | [05 · vnode 与挂载](/05-vnode与挂载) · [06 · 属性事件与卸载](/06-属性事件与卸载) · [07 · 子节点 diff](/07-子节点diff) · [08 · 组件的本质](/08-组件的本质) |
| 编译器 | [09 · parse 状态机](/09-parse状态机) · [10 · transform 与 codegen](/10-transform与codegen) · [11 · 编译优化](/11-编译优化) |
| 单文件组件 | [14 · 单文件组件与 parse](/14-单文件组件与parse) · [15 · script 宏与 compileScript](/15-script宏与compileScript) |
| 补全与交付 | [12 · 内置能力补全](/12-内置能力补全) · [13 · 从源码到产物](/13-从源码到产物) |

## 快速开始

配套工程仓库内即可运行全部代码与测试：

```bash
pnpm install
pnpm test          # 每章的行为断言都在其中
pnpm dev:showcase  # 模板编译驱动的展示页（自研内核渲染）
pnpm build         # 参考官方脚手架的构建流水线（第 13 章）
```

文中引用的代码均标注仓库路径（如 `packages/reactivity/src/effect.ts`），可对照阅读完整实现。

## 内容依据

- **官方文档（cn.vuejs.org）**：术语与对外行为的基准；
- **[vuejs/core](https://github.com/vuejs/core) 源码（v3.5.x）**：实现真相，「与官方实现的差距」各章均经源码核对；
- **《Vue.js 设计与实现》（霍春阳 著）**：行文范式与教学序列参照（不抄内容，代码一律取本仓库实现）。
