# 单文件组件与 parse：把 .vue 拆成三块

> 对应仓库：`packages/compiler-sfc`（真源码对照：`third_party/vue-core/packages/compiler-sfc/src/parse.ts`，485 行）
> 前置：第 09–11 章（parse 状态机 / transform / codegen）、第 05 章（vnode 与挂载）

从这一章起，我们进入 Vue 3 的最后一层：单文件组件（Single File Component，`.vue`）。之前的所有能力——响应式、渲染器、模板编译器——都还差一口「气」才能连成日常开发的样子：**一个 .vue 文件，同时装着模板、脚本和样式。**

我们将拆掉一块一块砖：parse 怎么把 `.vue` 拆成三块？`<script setup>` 里的宏（defineProps/defineEmits/defineExpose/defineOptions）是如何被改写的？scoped 样式为什么「编译产物里搜不到 data-v」？以及，一个真实的 vite 插件如何把这些拼起来？

先回答第一个问题：**拆块的 parse 是怎么写的**——以及它和真 Vue 的 parse 差在哪、又像在哪。

## 一、全景：一条 .vue 的旅程

先看我们要实现的目标。一个最小 SFC：

```vue
<template>
  <p class="msg">{{ msg }}</p>
</template>

<script setup>
const msg = 'hello sfc'
</script>

<style scoped>
.msg { color: red }
</style>
```

跑在 vite 里，这个文件最终变成三个东西：

1. **组件对象**：`{ __name: 'App', setup(__props) { ... } }`，来自 `<script setup>`；
2. **render 函数**：来自 `<template>` 的编译产物；
3. **CSS**：来自 `<style scoped>` 的产物（选择器被注入 `data-v-xxx`）。

分工是这样的（这就是 `@vitejs/plugin-vue` 干的事，我们在第 8 章之后会手写一个迷你版）：

```
         ┌──────────────────────────────────────────────┐
 .vue ──▶│  compiler-sfc（我们这一章的包）                 │
         │  ① parse：拆成 template/script/style 三块     │
         │  ② compileScript：宏改写 → 组件对象           │
         │  ③ compileTemplate：模板 → render 函数        │
         │  ④ compileStyle：scoped 选择器注入            │
         └──────────────────────────────────────────────┘
                      │
                      ▼
          集成层（vite 插件）拼装成最终的 JS 模块
```

本章先做 ①，以及把它喂给 ③④ 时需要的两个「选项」——scopeId 与 slotted。② 是下一章的主角。

## 二、真源码的 parse：委托给 HTML 解析器

先看真 Vue 怎么做拆块。打开 `third_party/vue-core/packages/compiler-sfc/src/parse.ts`，你会发现一件反直觉的事：**compiler-sfc 的 parse 几乎没有自己的扫描逻辑**。它把整份源码交给 compiler-dom，用一个特殊模式跑一遍：

```ts
const ast = compiler.parse(source, {
  parseMode: 'sfc',   // 关键：SFC 模式
  prefixIdentifiers: true,
  onError: e => errors.push(e),
})
```

`parseMode: 'sfc'` 让 tokenizer 进入一种特殊状态（`tokenizer.ts` 的 `inSFCRoot`）：**根层级遇到任何非 template 的起始标签，立即把后续内容当原始文本吞掉，直到匹配到 `</tag`**。HTML 解析器术语里这叫 RAWTEXT——`<script>`、`<style>` 元素在 HTML5 规范里本来就是这种语义。

于是「拆块」=「让 HTML 解析器跑一遍，读它产出的元素节点」，块内容用元素节点的 `innerLoc` 精确切片：

```ts
// parse.ts:316-327
const loc = node.innerLoc!
const block = {
  type: node.tag,
  content: source.slice(loc.start.offset, loc.end.offset),  // 开标签 '>' 之后 到 '</tag' 之前
  loc,
  attrs,
}
```

`innerLoc` 的 start 被 parser 精确设在开标签的 `>` 之后，end 设在最后一个子节点（RAWTEXT 文本）的结尾——正好是 `</tag` 之前。这一切都由 HTML 解析器代劳，compiler-sfc 一行偏移量都没手算。

这个「委托式分块」是最优雅的真相，但代价是：**整条 parser + tokenizer 链必须为 SFC 模式改造**（tokenizer 里的 `stateInSFCRootTagName`、`enterRCDATA` 都是为此存在的）。对教学项目，我们要复刻的是它的**语义**，不是它的架构。

## 三、手写扫描器：复刻 RAWTEXT 语义

朴素版先上场。拆块最容易想到的正则方案：

```js
const m = source.match(/<script>([\s\S]*?)<\/script>/)
```

但很明显，我们还做不到可靠拆块，因为有一个 HTML 规范级别的坑：**脚本内容里的 `</script>` 字符串会提前闭合标签**。`const s = '</script>'` 这种写法，任何正则都会被它截断。这不是 bug，是 HTML 的既定行为——真 Vue 的 tokenizer 序列匹配器（`tokenizer.ts:425-473`）同样会被它闭合，写 Vue 时需要在字符串里转义成 `'<\/script>'` 的原因正在于此。

所以我们按真源码的语义，手写一个小扫描器，零第三方依赖（`packages/compiler-sfc/src/parse.ts`，约 220 行）。结构上分四步：

**第一步：定位根级起始标签 + 属性解析。** 根层级找 `<tag`，进入属性解析的小状态机：`name (=["'"]...["'"]|=\S+)?` 循环，引号配对，无值属性得 `true`。这一步产出 `attrs`，并抽取 `lang` / `src` / `setup` / `scoped` / `module`：

```ts
// 真 parse.ts:334 同款语义：p.value ? p.value.content || true : true
attrs[name] = value === null ? true : value   // <script setup> → setup: true
```

**第二步：RAWTEXT 闭合扫描。** 从开标签的 `>` 之后开始，逐位置找 `</tag`（大小写不敏感），确认后一个字符必须是空白或 `>` 才算闭合，否则当作普通文本继续。字符串里的 `</script>` 会命中——与真源码行为一致。

**第三步：切片。** 块内容 = `source.slice(开标签'>'之后, 闭合区起点)`。这正是真源码 innerLoc 切片的零 AST 版，天然免手工偏移计算。`loc` 只给 offset 与行号。

**第四步：分类与守卫。** 照抄真源码的规则：template 只认第一个（重复报错）；script 按 `setup` 属性分流到 `script` / `scriptSetup`（重复各自报错）；style 全部收进 `styles[]` 不查重；其它根级标签（如 `<i18n>`）进 `customBlocks`。所有错误 push 进 `result.errors`，**从不 throw**。

一个必须处理的边界：template 内容里允许嵌套 `<template v-if>`、`<template v-for>`，用「第一个 `</template>`」截断会把内层当成外层结尾。真源码靠完整 HTML 解析器天然处理嵌套；我们的扫描器对 template 用**开标签计数**配对闭合（6 行），script/style 保持 RAWTEXT 的第一个闭合即止。

还有几个走读代码时值得注意的设计：

- **ignoreEmpty**：空白内容的 script/style/自定义块默认丢弃（template 永远保留，`<script src="./a.js"></script>` 这种带 src 的保留——内容为空但外链有意义）。
- **根级杂散内容一律丢**：template 外的文本、注释、DOCTYPE 不进 descriptor。
- **descriptor.slotted**：scoped 样式里匹配到 `:slotted(` 时置 true（真 parse.ts:288-291 同款正则）。这个字段是下一节 scopeId 链路的一个开关，先记住它。

## 四、compileTemplate 与 compileStyle：包一层，传 id

拆完块，模板与样式各自交给已有的编译器。这两层薄得惊人：

```ts
// compileTemplate.ts：包一层 compiler-dom 的 compile
compile(source, {
  scopeId: scoped ? longId : undefined,  // longId = 'data-v-' + shortId
  slotted,
  onError: e => errors.push(e),
})
```

scopeId 与 slotted 是第 10 章给你的编译器新增的两个选项：scopeId 存在时**关闭模块级静态提升**（为什么？看下一节），slotted 决定 `<slot>` 出口的第 5 参 noSlotted。这两个选项是 SFC 语义伸进编译器的两只手，其余一概不管。

compileStyle 则是「手写选择器注入器」+ trim 两阶段，规则表下一章细讲。

## 五、scopeId 全链路：编译产物里搜不到 data-v

这是整个 scoped 机制最反直觉的地方。把上一节的模板编译出来看：

```js
return function render(_ctx, _cache) {
  with (_ctx) {
    return _openBlock(), _createElementBlock("p", { class: "msg" }, ...
```

**全文搜不到 `data-v-xxx` 四个字。** 而浏览器里渲染出来的 DOM 却带着 `data-v-abc123=""`。属性从哪来的？答案：全在运行时。链路有八步：

1. **集成层挂 `__scopeId`**：vite 插件编译完 script 后，把 `data-v-xxx` 挂到组件对象上（`Comp.__scopeId = 'data-v-xxx'`）。compiler-sfc 全程不碰它。
2. **渲染时读它**：`renderComponentRoot` 里 `setCurrentRenderingInstance(instance)`，同时更新模块级变量 `currentScopeId = instance.type.__scopeId`。
3. **vnode 创建期快照**：每次 `createBaseVNode` 把当前 `currentScopeId` 记进 `vnode.scopeId`（`vnode.ts:460` 真源码同款）。
4. **挂载期落地**：渲染器 `mountElement` 调 `setScopeId(el, vnode, vnode.scopeId, ...)`，runtime-dom 的宿主操作 `el.setAttribute(id, '')` 打出属性。
5. **子组件根元素继承**：如果正在挂载的元素恰好是某组件 subTree 的根（`vnode === parentComponent.subTree`），递归拿父组件 vnode 的 scopeId 再打一遍——这就是「父组件的 scoped 样式能命中子组件根元素」的机制。
6. **插槽内容属于父**：子组件里渲染 `<slot>` 时，插槽函数是父作用域编译的、被 `_withCtx` 包裹——调用时把渲染上下文切回父组件，插槽内容 vnode 带的是**父的 scopeId**。否则它们会错误地带上子的。
7. **:slotted 的 -s**：子组件渲染 `<slot>` 时，`renderSlot` 把 `currentScopeId + '-s'` 挂到插槽内容容器上（`slotScopeIds`），经 `mountChildren` 参数线程化传到所有后代元素——子组件的 `:slotted(.x)` 规则（编译成 `.x[data-v-子-s]`）才命中得了。
8. **noSlotted 优化**：子组件模板没写 `:slotted` 时，编译产物给 `_renderSlot` 传第 5 参 `true`，第 7 步直接跳过——不渲染多余的 `data-v-子-s` 属性。

第 5–7 步里最值得玩味的是步骤 6 的 `withCtx`。插槽函数在**子组件渲染期间**被调用，若不切换上下文，两件事都会错：组件解析（`resolveComponent`）会找到子的作用域，scopeId 也会带上子的。真 Vue 的 withCtx 还做了 block 跟踪的开关（`_d` 标志），mini 只做上下文切换——我们注释里记了这个差异。

这一轮实现里，scopeId 链路还顺手修了三个「预留位」：vnode 上的 `scopeId` 字段此前是僵尸字段（恒 null），`expose()` 此前是空操作（下一章的主角），`resolveComponent` 缺 setupState 回退（script setup 的组件 imports 全靠它从渲染上下文解析）。

## 六、集成层：一个迷你 vite 插件

五件事拼起来，就是 `examples/sfc-app/mini-vue-sfc-plugin.ts`（约 100 行，对应真 `@vitejs/plugin-vue` 的教学子集）。transform 钩子把 `.vue` 变成模块：

```ts
const { descriptor, errors } = parse(code, { filename: id })
const scriptCode = compileScript(descriptor).content
  .replace(/^export default /m, 'const __sfc__ = ')
// ... compileTemplate + new Function 实例化 render
__sfc__.render = new Function('Vue', tplCode)(__Vue)
__sfc__.__scopeId = 'data-v-' + hashContent(code)   // scoped 时
export default __sfc__
```

这里藏着一个本轮的**真坑**：我们的模板编译器是 with(_ctx) 模式，产物长这样——`const { ... } = Vue` + `return function render(_ctx, _cache) { with (_ctx) { ... } }`。它是**函数体形态**，不是模块形态：`with` 语句在 ESM（strict 模式）里是语法错误。真 Vue 的 SFC 模板走 prefixIdentifiers + module 模式，产物是纯模块代码，没有这个问题；我们的 with 模式注定只能靠 `new Function('Vue', code)(__Vue)` 实例化——和 `compileToFunction` 是同一条路。这是「第 5 章选 with(_ctx) 的代价」在 SFC 层的落地，文章把它写成教学点而非缺陷：**with 模式 = 函数体产物 = 集成层 new Function；prefixIdentifiers = 模块级产物 = 直接 import。**

顺带记录：lang="ts" 的类型注解剥除只能对 **script 部分**做——render 里的 `with` 过不了 esbuild 的模块管线（它在模块里见到 with 直接报错）。真插件靠 query 里的 `lang.ts` 让 vite:esbuild 处理虚拟模块，效果相同。

## 七、我们 vs 真源码

| 能力 | 真 Vue（v3.5.43） | mini |
|---|---|---|
| 分块架构 | 委托 compiler-dom 的 `parseMode:'sfc'`（tokenizer 级 RAWTEXT） | 手写扫描器复刻同语义，零依赖 |
| 块内容定位 | parser 维护的 innerLoc | 开标签 `>` 后 到 `</tag` 前切片 |
| template 嵌套 | HTML 解析器天然处理 | 开标签计数配对 |
| sourceMap / pad / parseCache | 有 | 不做（文档记差异） |
| 错误路径 | 收集进 errors 不 throw | 同 |
| scoped 产物 | 运行时全链路（产物零 data-v） | 同 |

下一章，我们处理 `<script setup>`——那个最像「黑魔法」的部分：defineProps 一行 API，编译器要还它一个 props 选项、一个 `__props` 别名、一个返回对象成员，和一个报错时刻。