# script 宏与 compileScript：一行 API 背后的四次改写

> 对应仓库：`packages/compiler-sfc`（真源码对照：`third_party/vue-core/packages/compiler-sfc/src/compileScript.ts`，1417 行；mini 版约 300 行）
> 前置：第 14 章（parse 与 scopeId 链路）

`<script setup>` 是 Vue 3 里最像「黑魔法」的部分。看这段代码：

```vue
<script setup>
const props = defineProps({ label: String })
const emit = defineEmits(['go'])
let count = ref(0)
defineExpose({ reset })
</script>
```

`defineProps` 既不是 import 来的，也不是运行时函数（浏览器里根本没有 `defineProps` 这个名字）。你写下的每一行，都在被一个编译期程序逐字拆解、改写、重排。这一章我们就把它拆开：宏改写的机制、四个宏各自的产物、以及为什么我们的 mini 版**不需要**真 Vue 的 bindingMetadata 那一套。

先给答案再走读：上面那段代码，经真 Vue 3.5.43 编译后长这样（我们以这份输出为 ground truth）：

```js
export default {
  __name: 'App',
  props: { label: String },
  emits: ['go'],
  setup(__props, { expose: __expose, emit: __emit }) {
    const props = __props
    const emit = __emit
    let count = ref(0)
    defineExpose({ reset })          // → __expose({ reset })
    const __returned__ = { props, emit, get count() { return count }, set count(v) { count = v }, reset }
    return __returned__
  }
}
```

注意 **用户代码 95% 保持原样**：`let count = ref(0)` 一行没动，你只是被加了签名、改了四个词、追加了返回对象。这就是 compileScript 与其它编译器最大的气质差异——它是**稀疏改写**，不是重新生成。

## 一、为什么宏需要 Babel + MagicString

朴素版先上场。把 `defineProps({ label: String })` 替换掉，最容易想到的是正则：

```js
source.replace(/defineProps\(([\s\S]*?)\)/, '...')
```

但很明显，我们还做不到可靠改写，因为要回答的问题正则接不住：`defineProps` 出现在哪一层？它的实参从哪到哪（`{ default: '}' }` 里有右花括号）？它在**声明初始化**（要改写成 `__props`）还是**独立语句**（要整体删除）？这些都要一棵真正的 AST。

于是引入两个工具，与真 Vue 完全同款：

- **@babel/parser**：把 script 块解析成带精确起止坐标的 AST；
- **magic-string**：在「整份 .vue 源码」上做区间替换/删除，用户代码原样保留。

教学上最值得讲的，是 magic-string 带来的**两套坐标系**。babel 解析的是 script 块的内容（块内 offset），magic-string 操作的是整份源码（全局 offset），中间差一个 `startOffset = scriptSetup 内容的起点`。所有改写一律经 context 的 `at(offset)` 换算，这是本目录最容易写错的地方，注释里我们特意标了「两套坐标系的唯一换算点」。

第二个坑来自 magic-string 的约束：**已编辑的区块不能再 move**。我们第一版用 `s.move` 把普通 script 块前置、把 import 移到文件头，直接撞上 `Cannot split a chunk that has already been edited`。解法不是绕开，而是**消灭 move**：import 原文抽成字符串、普通 script 内容做字符串手术，全部组装进「开标签替换文本」里，位置操作只剩 remove/overwrite。产物顺序与真源码一致，清洁得多。

## 二、四个宏逐一拆解

宏的识别只有一条规则：**callee 是同名 Identifier 的 CallExpression**（`isCallOf`）。`const dm = defineModel` 之后再调用不命中——这是宏的语法契约。

### defineProps：抽原文，改 init

`const props = defineProps({ foo: String })` 拆成两件事：

1. **props 声明取原文**：把实参的源码切片（`getString(propsDecl)`）原样塞进组件对象：

```js
props: { foo: String, bar: { type: Number, default: 1 } },
```

为什么用「原文」而不是重新生成？因为保真：字符串、嵌套、注释全部原样，不可能写错。

2. **init 改写成 `__props`**：`const props = __props`。setup 的第一参就是 `__props`（组件 props 引用），声明保留、赋值来源换掉。

解构形态 `const { a, b = 2 } = defineProps(...)` 走「propsDestructure 关闭」的老形态：pattern 保持，init 改 `__props`，键登记进返回对象。响应式解构（真 Vue 3.5 默认开启，会把 pattern 整体移除）不在 mini 范围，文档记差异。

### defineEmits：`__emit` 与签名

`const emit = defineEmits(['go'])` → `const emit = __emit`；emits 声明同样取原文；setup 签名里**有条件地**多一个成员：`setup(__props, { expose: __expose, emit: __emit })`。没用 defineEmits 时签名不带 emit。

### defineExpose：改写 callee + 自动补调用

`defineExpose({ reset })` 语句保留，callee 改写成 `__expose`（运行时才是真 expose）。真正的设计在**未调用时**：setup 返回前自动补一行 `__expose();`。空参数 = 空对象 = **关闭组件公开面**——父组件拿到的引用只能读到 exposed 的键。这是 SFC 的默认安全边界：你 expose 什么，世界就看到什么。

配套的运行时改动：`expose()` 此前在我们 runtime 里是空操作，这一轮落地为 `instance.exposed = exposed || EMPTY_OBJ`，并新增 `getComponentPublicInstance`（真 Vue 同款：exposed 已设置时返回 only-exposed 的专属代理，否则返回完整公共代理）。

### defineOptions：整句删除 + Object.assign

`defineOptions({ name: 'MyApp', inheritAttrs: false })` 是唯一被**整体删除**的宏。删除前先校验：对象键若含 props/emits/expose/slots，报错指向对应宏；实参必须是静态字面量。它的对象原文（getString）进产物顶部的合并：

```js
export default Object.assign({ name: 'MyApp', inheritAttrs: false }, {
  __name: 'App',
  ...
})
```

## 三、普通 script 的合并与名字守卫

`<script>` 与 `<script setup>` 并存时，普通 script 的默认导出被合并进同一个组件对象：

```js
const __default__ = { name: 'Opt', inheritAttrs: false }   // export default → const __default__
export default Object.assign(__default__, {
  setup(__props, { expose: __expose }) { ... }
})
```

三条规则都来自对真源码的实测（ground truth 优先于设计直觉）：

1. **`__name` 的守卫**：普通 script 默认导出带 `name` 键时跳过 `__name` 生成。但 defineOptions 里的 `name` **不**挡 `__name`——两个来源行为不同，实测确认，别猜。
2. **无默认导出**：内容保留模块顶层，不生成 `__default__`，产物是裸 `export default { ... }`；合并形态（Object.assign）只在真有东西可合并时才出现。
3. **产物形态随来源组合**：只有 defineOptions → `Object.assign(<原文>, {`；只有默认导出 → `Object.assign(__default__, {`；两者都有 → `Object.assign(__default__, <原文>, {`（后者赢）。

## 四、bindings 为什么不需要：with(_ctx) 的核心论证

真 Vue 的 compileScript 有好几百行在维护一套 `bindingMetadata`（每个顶层绑定的类型：ref/const/let/import...），并在产物里返回，交给 compileTemplate 做标识符前缀改写（prefixIdentifiers）。**我们整个砍掉了。** 论证一句话：**我们的模板编译是 with(_ctx) 模式，编译期没有任何标识符决策**——模板里的 `count` 在运行时经 `with(_ctx)` 作用域链解析到渲染上下文，而 setup 的返回对象就是渲染上下文的 setupState 来源。

于是 compileScript 只需要维护一张「名字 + 是否 let」的账本：

- **const/函数/import** → 返回对象里裸键：`{ inc, Child }`；
- **let** → get/set 对：`get count() { return count }, set count(v) { count = v }`。

get/set 对是 v-model 双向的闭合关键：模板里 `count = ...` 经 with 赋值 → 代理 set → setupState 的 setter → 局部变量；重渲染读 getter。如果没有 setter，`let count` 的赋值会静默丢失（getter-only 属性在严格模式赋值还会抛错）。

返回对象还承载了 with 模式的**组件可见性闭环**：`import Child from './Child.vue'` 的 `Child` 也进返回对象，模板 `<Child/>` 编译成 `_resolveComponent("Child")`，运行时从 setupState 找到组件定义——这正是第 14 章我们给 resolveComponent 补 setupState 回退的原因。真 Vue 的 script setup 模板是模块级代码，imports 天然可见，不需要这条回路。

## 五、产物解剖：一次走完

把第 14 章那个 demo（App.vue，含普通 script 合并）的完整产物走一遍：

```js
import { ref } from '@mini-vue/vue'        // ← 模块头部：imports 被前置（真源码 move，我们组装）
const __default__ = { name: 'SfcApp', inheritAttrs: false }   // ← 普通 script 的 export default 改写
export default Object.assign(__default__, {                   // ← 合并形态
  setup(__props, { expose: __expose }) {                      // ← setup 签名（开标签替换）
    const title = ref('mini-vue SFC 跑起来了 🎉')              // ← 用户代码原地未动
    ...
    function addTodo() { ... }
    defineExpose({ addTodo })                                 // ← callee 改写：__expose
    const __returned__ = { title, text, todos, addTodo, removeTodo }   // ← 追加段落（闭标签替换）
    return __returned__
  }
})
```

注意「开标签替换」与「闭标签替换」：`<script setup lang="ts">` 这个开标签被整段替换成「组件对象 + setup 签名」，`</script>` 被替换成「返回对象 + 收尾」。用户代码夹在中间，一个字节没动。

## 六、compileStyle：选择器注入规则表

scoped 样式的编译在真 Vue 里是 postcss 插件链；我们手写了一个词法器，规则表全部对着真源码 3.5.43 的实测输出校准。挑几个反直觉的：

| 输入 | 输出 | 说明 |
|---|---|---|
| `.a .b:hover` | `.a .b[data-v-x]:hover` | 锚点 = 最后一个可注入复合选择器，尾随伪类保持在后 |
| `.a :deep(.b)` | `.a[data-v-x] .b` | 注入在 :deep 之前 |
| `:deep(> .d)` | `[data-v-x] > .d` | 独立 :deep → 前缀注入，首部组合器保留 |
| `.a :slotted(.foo)` | `.a .foo[data-v-x-s]` | `-s` 只进内层，外层不再注入普通 id |
| `:global(.h)` | `.h` | **整条选择器替换为内层**（真源码 `selector.replaceWith` 语义，设计稿原以为是「前缀仍注入」——实测推翻） |
| `:is(.m, .n)` | `:is(.m[data-v-x], .n[data-v-x])` | is/where 独立时内层逐项注入 |
| `.a:not(.b)` | `.a[data-v-x]:not(.b)` | :not 独立时前缀注入 |
| `/deep/ .old` | `[data-v-x] .old` | 废弃写法按 :deep 处理 + 警告 |

实现上三层结构：词法层（注释/引号感知的 token 化）、语法层（括号/方括号/引号感知的顶层逗号拆分）、重写层（锚点判定 + 注入）。调试中最深的坑是一个「保护机制」：第一版把注释替换成等长空格再还原（位置映射），注入会改变后续文本的偏移，还原必然错位。最后**删掉整个保护机制**——让 tokenizer 和逗号拆分器直接跳过注释即可，原文保留在输出里，比任何位置映射都健壮。

## 七、踩坑记录（这一轮真实的坑）

1. **magic-string 的 move 约束**：已编辑区块不能再 move → 消灭 move，组装 preamble。
2. **with(_ctx) 产物过不了 esbuild**：ESM 里 with 非法 → render 用 `new Function` 实例化；TS 剥除只对 script 部分做。
3. **v-on 内联语句提前执行**：`@click="emit('go')"` 曾编译成 `onClick: emit('go')`（渲染期执行一次！），按真源码的 isMemberExpression 判别包成 `($event) => (...)`, 裸成员表达式（`@click="onGo"`）仍原样引用。SFC 端到端测试暴露的真 bug。
4. **实测推翻设计**：`:global` 整条替换、defineOptions 的 name 不挡 `__name`、普通 script 里的宏不拦截（真源码同样不拦，运行时才报错）。

## 八、差异表

| 能力 | 真 Vue（v3.5.43） | mini |
|---|---|---|
| 宏范围 | 六宏 + 类型推导 + defineModel | 四宏，TS 类型宏报「不支持」 |
| bindingMetadata | prefixIdentifiers 全链路 | 不需要（with(_ctx) 论证见 §4） |
| 结果 | code + map + bindings | content |
| 产物注解 | `__isScriptSetup` / `@__PURE__` | 不产（文档记差异） |
| 坐标体系 | 两套（startOffset 桥接） | 同款，单点换算 |
| scoped 样式 | postcss 插件链 | 手写词法器（规则表 §6） |

至此，compiler-sfc 的四件套齐了：parse 拆块、compileScript 改宏、compileTemplate 包模板、compileStyle 注样式。examples/sfc-app 里那个真正的 `.vue` 应用——script setup、scoped 样式、:deep、:slotted、父子 emit——就是这四件套加一个百行插件的完整果实。跑一下 `pnpm dev:sfc` 看看它。