# 阶段 6 — v-model 指令形态 / slots 编译 / 全局 API 补全

> 里程碑：`pnpm test` 全绿（191 用例，阶段 6 新增 7），tsc 0 错误。
> 真源码锚点：`runtime-dom/src/directives/vModel.ts`、`runtime-core/src/componentPublicInstance.ts`、`compiler-dom/transforms/transformModel.ts`

## 1. 这一阶段学到了什么

### 1.1 v-model 的两种实现路线

| 形态 | 实现 | 何时走 |
|---|---|---|
| 文本输入（input/textarea） | 编译期内联 `{ value: x, onInput: $event => (x = $event.target.value) }` | 一条都不用指令钩子 |
| 复选框/单选/下拉框 | **指令对象路线**：`withDirectives(vnode, [[vModelCheckbox, assigner, arg, mods]])` | 运行时指令读 `binding.value`(= 回写函数) |

**指令对象路线**的编译产物长这样（gate Q1 答案）：
```js
_withDirectives(
  _createElementVNode("input", { type: "checkbox", checked: agree }, null, -1),
  [[vModelCheckbox, ($event) => (agree = $event), "", ""]]
)
```
运行时 vModelCheckbox：
- `created`：`el._assigning = true` → `addEventListener('change', ...)` → `el._assigning = false`
- handler：看到 `_assigning` 就不回写（**防重入**：程序化 set checked 时浏览器补发 change，会被跳过）
- `mounted/updated`：把 `vnode.props.checked` 写回元素（显示侧）

**为什么需要 _assigning？** `el.checked = value`（程序化）在某些浏览器会顺势触发 `change` → 若 handler 再写回模型，就是一个意外循环。加 `_assigning` 标记后：那一瞬间的 change 被当噪音忽略。

### 1.2 renderer 指令 hook 接线

| 时机 | 钩子 |
|---|---|
| mountElement（insert 后） | `created`（前缀）→ `mounted` |
| patchElement（更新后） | `updated`（带 oldValue） |
| unmountElement（remove 前） | `unmounted` |

`invokeDirectiveHook(vnode, prevVNode, inst, type)` 遍历 `vnode.dirs`，逐个调 `binding.dir[type]`。

### 1.3 v-show 与 useSlots/defineComponent

- `v-show`＝指令：`withDirectives(vnode, [[vShow, show, "", ""]])`，运行时 `mounted/updated` 依 `binding.value` 设 `el.style.display`
- `useSlots()/useAttrs()`：读 `getCurrentInstance()` 的 `slots/attrs`（composition 语法糖）
- `defineComponent`：真 Vue 在这里做 TS 类型推导（props/emits 泛型），mini 恒等包装

## 2. review gate 参考答案

### Q1：v-model 指令对象在编译产物里长什么样？

见上 `_withDirectives(...)` 片段：第四条绑定 `[指令对象, 回写函数, arg, modifiers]`。
回写函数由编译器生成 `($event) => (agree = $event)`（赋值目标在 `with(_ctx)` 作用域内解析）。
运行时指令只做「用户输入 → 调 binding.value」与「模型 → 写元素」两件事，不复制造型语法。

### Q2：scoped slot 的"父传函数"与 renderSlot 的对应关系？

- 父侧编译：`<template #title="{ msg }">…</template>` → `{ title: ({msg}) => [...], default: () => [...] }`（值全是函数）
- 子侧 `renderSlot($slots, 'title', { msg })`：拿 `$slots.title`（函数）→ **把 scoped 数据当 props 喂给它** → 得到 vnode 数组。
父传函数 + 子喂数据 = scoped slot 的数据流。`_withCtx` 只是给函数包一层“渲染上下文”以保证 `useSlots` 在子作用域可用（mini 直接透传已够）。

### Q3：globalProperties 与组件同名字段谁的优先级更高？

`PublicInstanceProxyHandlers.get` 的查找顺序：**setupState → props → ctx → $内建 → app.config.globalProperties**。
即组件自己的 `count` 永远盖过 `app.config.globalProperties.count`。真 Vue 一样（globalProperties 是"公共最后兜底"）。

## 3. mini 取舍

| 特性 | 3.5.x | mini |
|---|---|---|
| v-model 文本 | vModelText 指令 + composition 处理 | 内联 value+onInput |
| 复选框/radio/select | 指令 + edge case（数组模型/lazy 等） | 指令路线，单一布尔/值模型 |
| 指令钩子 | created/beforeMount/mounted/beforeUpdate/updated/beforeUnmount/unmounted 全链 | created+mounted / updated / unmounted |
| useSlots/useAttrs | 带 TS 泛型推导 | 直读 instance |
| defineComponent | Options API + TS 推导 | 恒等包装 |

## 4. 冒烟验证

```bash
cd /Users/liyf/ms/mini-vue
npx vitest run          # 191 passed
npx tsc -p tsconfig.json --noEmit
```

## 5. 自查表

- [ ] 能默写出 checkbox v-model 的编译产物（withDirectives 四元组）
- [ ] 能解释 `_assigning` 防的是什么循环
- [ ] 知道指令钩子在 renderer 的哪几个时机被调
- [ ] 能说出 public this 的查找优先级链（含 globalProperties 兜底）