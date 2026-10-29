# 最小闭环：把一次更新走完（mini-vue 的先导地图）

> 对应仓库：`examples/minimal/`（reactivity/ · runtime-core/ · compiler-core/ · app.js，三个框架文件约 630 行，含注释，目录与 packages/ 一一对应）
> 前置：无。这一篇是系列的先导，它不需要你读过任何一章

写这一章之前，我先把 mini-vue 的真相说一遍：它是一个「忠实」的 Vue 3 内核——keyed diff、block 树、patchFlag、scopeId 八步链路、宏改写、两套坐标系…… 每一处都是真源码的行为复刻。忠实带来的代价是阅读负担：第一遍通读时，你会在 patchKeyedChildren 的 LIS 里迷路，在 compileScript 的 startOffset 换算里晕头。

这一章做一件事：**再写一个 mini-vue，只保留「去掉就讲不成 Vue3」的部分。** 三个框架文件，约 630 行，不 import mini-vue 任何一行——浏览器里 `pnpm dev:minimal` 就能跑四个 demo。它给你一条完整的更新链路，作为读任何一章之前的热身：先在这里走通一次更新，再进 mini-vue 看细节。

怎么运行：`pnpm dev:minimal`（vite 起静态服务），或 `python3 -m http.server` 后浏览器打开 `examples/minimal/index.html`。ESM 在 `file://` 下会被浏览器 CORS 拦截，不能双击直开。

## 一、先看全局：一次点击，四层接力

页面上一字排开四个 demo。Demo 1 是最小 count 加减：一个 `count`，left 减号 right 加号两个按钮。点一下加号，背后发生的事是全文的唯一主线画面，按顺序是：

1. 点击触发 button 的 onClick 回调
2. 回调执行 `count++`，写入 setup 状态
3. proxy 的 set 拦截到写入，调用 trigger
4. trigger 找出依赖 count 的 effect，交给它的 scheduler
5. scheduler 把更新送进微任务队列
6. 微任务执行 instance.update，组件渲染 effect 重跑
7. render(ctx) 运行，compile 产出的函数执行，生成新的 vnode 树
8. patch 把新 vnode 与旧 vnode 做同位置就地比较，更新 DOM
9. 页面上的数字变化

四个文件各管一段：

| 文件 | 行数 | 一句话职责 | 问的问题 |
|---|---|---|---|
| `reactivity/index.js` | ~156 | 数据变了，世界怎么知道 | 响应式 |
| `runtime-core/index.js` | ~262 | 知道了之后，谁来画 | 渲染器 |
| `compiler-core/index.js` | ~212 | 模板怎么变成图纸 | 编译器 |
| `app.js` | ~138 | 把三层接成一次点击（读者自己的代码） | 链路 |

app.js 与前三个文件的分隔是故意的：app.js 是「用框架」，前三个是「写框架」。

## 二、第一层：响应式

先写一个五行的「假响应式」：

```js
let value = 0
const deps = new Set()
function read() { deps.add(value) } // 假装在记账
function write(v) { value = v; deps.forEach(f => f()) } // 假装在算账
```

但很明显，这个实现还做不到真正的响应式，因为 `deps` 是一个全局变量，它不知道某个函数读了哪个对象的哪个属性——读 `state.count` 的 effect 和读 `state.total` 的 effect 会被记进同一个集合，修改任何一个都会互相打扰。

于是有两层账本：`targetMap`（对象 → 属性 → effect 集合）。`track(target, key)` 在**读取时**把当前的 effect 记进 `(对象, 属性)` 对应的格子；`trigger(target, key)` 在**写入时**把格子里的 effect 全部重跑。effect 的 fn 跑完就恢复外层 effect，用 parentEffect 指针记住外层，嵌套 effect 结束时指回它，账目不会串。

```js
// reactivity/index.js 全文的骨架，就这三样
function track(target, key) { /* 把 activeEffect 记进 targetMap */ }
function trigger(target, key) { /* 把格子里的 effect 全部重跑 */ }
function effect(fn, options = {}) { /* 登记 fn，首跑一次，把返回值交给 track 认领 */ }
```

`reactive` 只是把读写劫持进这一对函数：`get` 里 track，`set` 里 trigger，深度懒代理（读到的子对象才包代理）加缓存（`reactive(raw)` 恒返回同一代理，保住引用相等）。`ref` 是原始值的容器；`computed` 是 lazy 的 effect 加脏位；`proxyRefs` 让模板里直接写 `count`，代理自动读 `.value`。

三个值得记住的教学点：

- **trigger 里一行 `effectFn !== activeEffect`**：effect 里修改自己读的属性（`count++`）会无限循环，这一行把它挡掉。
- **没有依赖清理（cleanup）**：设计内局限。外层 effect 重建内层后，旧内层仍挂在账本上，改动会多余重跑一次——渲染结果幂等，没有可见影响。`effect.deps` 字段是升级位，mini-vue 的 cleanup 是系列第 02 篇的主题。
- **scheduler**：effect 的第二个选项。渲染器把更新送进微任务队列，effect 不立即重跑——「一次交互多次改动只渲染一次」的源头就在这里。

对照（函数名可 grep，行号不保证）：

| 本文档 | mini-vue | 真源码（v3.5.43） |
|---|---|---|
| `track`/`trigger`/`effect`（reactivity/index.js） | packages/reactivity/src/effect.ts | packages/reactivity/src/effect.ts |
| `effect` 的 parentEffect 指针链 | 同文件的 `effectFn.parent` | 同 |
| `reactive`（WeakMap 缓存） | packages/reactivity/src/reactive.ts | packages/reactivity/src/reactive.ts |
| `ref`（__isRef + proxyRefs 解包） | packages/reactivity/src/ref.ts | packages/reactivity/src/ref.ts（另有 toRef/toRefs/shallowRef） |
| `computed`（lazy + dirty） | packages/reactivity/src/computed.ts | packages/reactivity/src/computed.ts |
| `stop`（stopped 标记，不做 deps 清理） | effect.ts 的完整 cleanup | effect.ts 的完整 cleanup |

## 三、第二层：渲染器

响应式回答「数据变了怎么知道」，渲染器回答「知道了之后谁来画」。

`h(type, props, children)` 产出 vnode——一张纯数据图纸：type 是元素名/Text/组件，props 是属性与事件，children 是子图纸。`patch(n1, n2, container)` 是决策树，按以下顺序判定：

| 判定条件 | 动作 |
|---|---|
| n2 是数组 | 数组根（Fragment 的极简形态），交给就地 diff |
| n1 与 n2 的 type 不同 | 先把旧节点卸载，再挂载新节点 |
| n2.type 等于 Text | 文本处理（Text 也是字符串，必须最先判定） |
| type 是字符串 | 元素处理（挂载或 patchElement） |
| type 是对象或函数 | 组件处理 |

组件是这一层最有价值的部分：**组件 = 函数 + 状态 + 自己的渲染 effect**。`instance.update = effect(渲染函数, { scheduler: () => queueJob(instance.update) })`——组件实例持有自己的 effect，卸载时 `stop` 掉它。共享状态随之变化时，已卸载组件的 effect 被 stopped 挡住，DOM 不会复活出来。

组件间通信只留一条：props 用 `reactive` 包裹。父组件渲染出新 props，`updateComponent` 把新旧 props 原地 merge 进那个 reactive 对象——`trigger` 自动触发子组件的渲染 effect，不需要任何「通知子组件更新」的手动机制。对应到 mini-vue，这套机制是 `applyPreUpdate`，差异只在实现尺寸。

子节点 diff 只做一件事：同位置就地比较，长度增减就补建或卸载。**没有 key**。所以 Demo 2 的「危险重排」按钮展示错位：`reverse()` 之后，文本顺序正确，勾选状态跟着位置走。设计内局限，系列第 07 篇讨论 keyed diff 如何解决错位。

对照：

| 本文档 | mini-vue | 真源码（v3.5.43） |
|---|---|---|
| `h`（children 归一化） | packages/runtime-core/src/vnode.ts 的 `createVNode` | packages/runtime-core/src/vnode.ts 的 `createVNode` |
| `patch` 决策树 | renderer.ts 的 `patch`（多了 Suspense/Teleport 分支） | renderer.ts 的 `patch` |
| `patchChildren`（就地 diff） | renderer.ts 的 `patchChildren` + `patchKeyedChildren` | renderer.ts 的 `patchChildren` + `patchKeyedChildren` |
| `mountComponent` + instance.update | renderer.ts 的 `mountComponent` + `setupRenderEffect` | 同 |
| props reactive 化 | component.ts 的 `applyPreUpdate` | component.ts 的 `updateComponentPreRender` |
| `queueJob` 微任务批更新 | packages/runtime-core/src/scheduler.ts | packages/runtime-core/src/scheduler.ts |
| `host` 宿主操作表 | packages/runtime-dom/src/nodeOps.ts | packages/runtime-dom/src/nodeOps.ts |

## 四、第三层：编译器

Demo 1 的 render 有一段手写的对照物——commit 2 的历史里有它的 `h()` 形态。编译器回答：**模板哪来的？模板是 render 函数的语法糖**。

`compile(template)` 做三件事，各一行：

```js
export function compile(template) {
  const nodes = parse(template) // 模板 → 小树
  const body = gen(nodes) // 小树 → 代码字符串
  return new Function('mv', `return function render(ctx) { with (ctx) { return ${body} } }`)({ h, Text })
}
```

Demo 4 的探照灯把中间产物摊开：左边写模板，右边实时显示 `render.toString()`。

parse 用指针扫描：文本/插值/标签/属性四态，`indexOf` 与 `slice` 推进。HTML 的嵌套结构正则表达不了，整段正则匹配会失控——mini-vue 的第 09 篇「parse 状态机」是这个扫描器的完整形态。

generate 里有两处值得注意的简化：

- **插值表达式原样内嵌**：`{{ count + 1 }}` 直接生成 `String(count + 1)`，计算交给 JS 引擎——不解析表达式，就不用写表达式求值器。
- **v-for 的箭头参数**：`list.map((item, index) => ...)`——item 是箭头函数参数，天然在 `with(ctx)` 的捕获作用域内，不需要维护作用域记录。这是「v-for 只留数组形态」带来的简化：v-if 需要分支树与块作用域，这里用三元表达式替代演示。

`with(ctx)` 是理解模板运行时的关键一行：`render(ctx)` 的函数体包在 `with (ctx)` 里，模板里的裸名（`count`、`list`、大写开头的 `Stepper`）运行时经 with 解析到渲染上下文。这正是 mini-vue 编译器 `with(_ctx)` 方案的源头，也是系列第 10 篇讲「表达式如何解析」时的最小模型。三条铁律写进了 compiler-core/index.js 文件头：禁用整段正则匹配、with 是方案源头、**函数体绝不能带 'use strict'**（with 在严格模式是 SyntaxError；new Function 创建的函数是 sloppy 模式，ESM 的严格不传染进来）。

对照：

| 本文档 | mini-vue | 真源码（v3.5.43） |
|---|---|---|
| `compile`（new Function 实例化） | packages/vue/src/index.ts 的 `compileToFunction` | packages/vue/src/index.ts |
| `parse` 指针扫描 | compiler-core/src/parse.ts 的 `baseParse` | compiler-core/src/parse.ts 的 `baseParse` |
| `gen`/`genElement`（transform 折叠） | `transform`（独立阶段）+ codegen.ts 的 `generate` | 同 |
| with(ctx) codegen | compiler-core/src/codegen.ts（with(_ctx) 包裹） | 真源码是 prefixIdentifiers 模式，无 with，差异见第 10 篇 |

## 五、砍单：没进最小版的东西，各有各的文章

| 去掉的能力 | 它回答的问题 | 在系列的哪一篇 |
|---|---|---|
| 依赖清理 cleanup | 「旧依赖残留」如何消灭 | 02 · 让依赖永远准确 |
| keyed diff + LIS | 重排如何不错位 | 07 · 子节点 diff |
| v-if 分支树 | 条件渲染编译形态 | 10 · transform 与 codegen |
| patchFlag / block / 静态提升 | 编译器如何标记动态点 | 11 · 编译优化 |
| 插槽 / 生命周期 / watch / inject-provide | 组件间通信的其余通道 | 08 · 组件的本质、04 · 调度器与 watch |
| SFC（宏 / scoped / 单文件） | .vue 如何分块与改写 | 14 · 单文件组件与 parse、15 · script 宏 |

这些条目每一行都对应系列里的一篇专题：在小闭环里见到问题，到对应文章里读解法。

## 六、动手

1. **复现重排错位**：Demo 2 里勾选第一项，点「危险重排」，再点「删除」——观察勾选状态与文本的错位。想一下：为什么需要 key？
2. **把最小 demo 改成减号**：`@click="count++"` 换成 `@click="count--"`，感受模板改一行、链路全程不变。
3. **给列表加「完成样式」**：`<li :class="{ done: todo.done }">`——:class 是动态绑定，走 with(ctx) 求值。提示：`:class` 的值会被 runtime-core 的 setAttribute 设置成 `[object Object]`，要让样式生效，需要给 runtime-core 加 class 特判（mini-vue 的 normalizeClass 是它的完整版）。
4. **换一个模板喂给探照灯**：试试 `<div :style="'color: red'">`，看编译产物里 style 变成了什么。

## 七、之后的路

本文档是系列的先导地图。读每一章前的建议热身：先在 examples/minimal 对应文件的对应函数处停留十分钟，把「这一次更新怎么走」在最小版里走通，再打开 mini-vue 的同名文件看细节。映射已经写在每节末尾的对照表里——最小版是索引，mini-vue 是正文，真源码是答案。