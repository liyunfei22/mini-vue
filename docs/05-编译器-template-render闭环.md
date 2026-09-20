# 阶段 5 — 编译器：template → render 函数闭环

> 里程碑：`pnpm test` 全绿（184 用例，阶段 5 新增 20；含 vue 聚合包端到端 11 个），tsc 0 错误。
> 真源码锚点：`third_party/vue-core/packages/compiler-core/src/{parse,transform,codegen,compile}.ts`（3.5 拆 tokenizer/parser）

## 1. 这一阶段学到了什么

一句话：**模板编译 = 「状态机解析成 AST」→「transform 把结构指令转换成 JS 表达式」→「codegen 拼出渲染函数源码」**。

```
 "<div id=app>{{ n }}</div>"
   │ baseParse（光标 + TextMode 状态机）
   ▼
 AST（ROOT → ELEMENT → TEXT/INTERPOLATION/…）
   │ transform（nodeTransforms：v-if/v-for 先重构结构 → transformElement 生成 codegenNode）
   ▼
 transform 后的 AST（每个元素带 VNODE_CALL/JS 节点）
   │ generate（with(_ctx) 包裹 + helpers 解构）
   ▼
 "const { createElementVNode: _createElementVNode } = Vue
  return function render(_ctx, _cache) { with (_ctx) { return _createElementVNode(...) } }"
   │ compileToFunction = new Function('Vue', code)(runtimeDom)
   ▼
 render 函数 → 挂进实例 → 运行时渲染
```

### 100 行 vs 1000 行的差距（本阶段真实踩过的坑）

| 坑 | 根因 | 修法 |
|---|---|---|
| parse 报缺结束标签 | 标签名正则 `[^\t\r\n/>]` 漏了空格 → `tag="div class=..."` | 类排除集 = 真 Vue 的 `[^\t\r\n\f />]` |
| 编译产物文本错乱 `uble = {{ n * 2)` | `parseInterpolation` 没先判 `{{` 开头就把普通文本当插值吞 | guard：`!source.startsWith(open) → undefined` |
| 全模板报 code 26 | 插值 `closeIndex` 在 advance(`{{`) 前算的，事后用错 | 用 `closeIndex - open.length` 去 slice |
| v-if 丢了 else | 结构指令要「先摘指令、后处理」+「exit 阶段再移除元素」（否则 transformElement 没跑到 / childIndex 被内层遍历污染） | `props.splice(i,1)` + 按身份 remove + `node = context.currentNode` 跟新节点 |
| after挂载空 div | 编译路径 `_createElementVNode`（非全归一化）单 vnode children 只打 ARRAY 位不包数组 | mountElement/mountChildren 兜底 `isArray ? children : [children]` |
| 组件被 createElement | 组件标签用了 createElementVNode（shapeFlag 默认 ELEMENT）| 组件走 `_createVNode`（按 type 算 COMPONENT） |
| slot 变 `<template>` 空壳 | `<template #title>` 被当元素渲染 | buildSlots：template 的**子节点**当 slot 体 |

### 关键设计：with(_ctx) 表达式方案

codegen 把 render 函数体包进 `with(_ctx) { }`，模板表达式 `{{ n * 2 }}` **原样输出**即可在运行时解析到 setupState/props —— 免去 prefixIdentifiers 的逐标识符前缀（那是真 Vue 的 CSP 沙箱方案）。代价：产物在**严格模式**下不合法（with 被禁），且不做变量遮蔽分析。取舍记录在此，阶段文档 6/9 如需要可补。

### transform 的父指针线程化

v-else 回链靠 `context.parent/childIndex`；遍历子节点时**保存/恢复**父指针，且结构指令在**进入时**从 props 摘除（防重入），**退出时**才从树上移除元素（保证 transformElement 已给它建好 codegenNode）。

## 2. review gate 参考答案

### Q1：手推 `<div v-for="x in xs"><span>{{x}}</span></div>` 的 transform 路径

1. parse → ELEMENT(div, props:[v-for exp='x in xs'], children:[ELEMENT(span, children:[INTERPOLATION x])])
2. transform 进入 div：transformIf(无) → transformFor 命中 → **splice 摘 v-for 指令** → 生成 FOR 节点替换 div（`source=xs, valueAlias=x`），div 进 forNode.children
3. 遍历 FOR 的 children（原 div）：transformElement exit 给 div 生成 codegenNode = `VNODE_CALL(div, null, [span的 codegenNode], -1)`；span 自己被 transformElement 生成 `VNODE_CALL(span, null, 插值)`；插值注册 `TO_DISPLAY_STRING` helper
4. codegen 遇 FOR → `_renderList(xs, (x) => _createElementVNode("div", null, [...], -1))`，span 的插值 → `_toDisplayString(x)`

### Q2：v-else 如何与 v-if 建立逻辑链？

v-else 处理的瞬间，前一个兄弟**已经被 v-if 替换成 IF 节点**了——`context.parent.children[childIndex - 1]` 拿到的就是那个 IF。`IF.branches.push(elseBranch)` 把它们编进同一分支数组；codegen 据此生成嵌套三元 `(cond1) ? A : (cond2) ? B : C`。指令链是**结构性数据（branches）**，不是字符串配对。

### Q3：codegen 的 helpers 怎么从 transform 流到产物头部？

transform 期间 `context.helper(symbol)` 把用到的 helper 记进 `context.helpers`（Set），transform 结束时 `root.helpers = [...set]`。generate 读 `ast.helpers`，生成顶部 `const { createElementVNode: _createElementVNode, ... } = Vue` 解构，配合 `new Function('Vue', code)(runtimeDom)`——编译器只记 ID 和名字，运行时补同名函数即完成接线。

## 3. mini 取舍

| 特性 | 3.5.x | mini |
|---|---|---|
| 表达式方案 | prefixIdentifiers（沙箱+CSP） | `with(_ctx)` 原样输出 |
| block/inline 优化 | patchFlag/动态子级 | 全部 `-1` 全 diff（阶段 4 的 keyed diff 兜底） |
| hoistStatic/cacheHandlers | 有 | 不做 |
| parse 架构 | tokenizer+parser 拆分 | 经典单文件 parse.ts |
| 组件标签 | `createElementBlock`+resolveDynamicComponent | `_createVNode` + `_resolveComponent` |
| v-model | 运行时指令（vModelText 等） | 基础形态内嵌 value+onInput（checkbox/radio 阶段 6） |

## 4. 冒烟验证

```bash
cd /Users/liyf/ms/mini-vue
npx vitest run          # 184 passed（含 vue 端到端 11 个）
npx tsc -p tsconfig.json --noEmit
npx vite build examples/playground --config examples/playground/vite.config.ts
```

## 5. 自查表

- [ ] 能画出 parse→transform→codegen→compileToFunction 全链路（对哪个输入产哪个输出）
- [ ] 能解释为什么结构指令要「进入摘指令、退出移除元素」
- [ ] 能说出 `with(_ctx)` 方案与 prefixIdentifiers 的取舍
- [ ] 能从头复现本阶段的 7 个坑（正则漏空格 / 插值吞文本 / 组件 createElementVNode 等）