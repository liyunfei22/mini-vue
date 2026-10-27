# 05 · vnode 与挂载：写一个不认识浏览器的渲染器

00 篇留下过一个断言：声明式框架的内部必然是命令式的，`querySelector`、`textContent` 这些调用一行都不会少，只是从用户代码搬进了框架。这个「框架内部的命令式层」就是接下来四篇的主角——渲染器（renderer），接收 vnode 树、把它转换为真实宿主节点的模块。官方文档把渲染管线概括为编译、挂载、更新三个阶段；编译器第 9 篇才登场，本章先做「挂载」。

但翻开本仓库 `runtime-core` 的源码会发现一件怪事：整个渲染核心里找不到一处 `document.` 调用。**它凭什么不认识浏览器？换到 canvas 或 SSR 要重写多少？挂载与更新凭什么共用一个入口？** 做法沿用前几篇的节奏：先手写二十行朴素渲染器，挂出一个真实的 div；再指出它换不了平台、也谈不上更新；最后看仓库实现如何演进成一副不认识浏览器的形态。

## 1.1 先写个能用的：二十行朴素渲染器

先明确术语。挂载（mount），指把描述界面的数据变成真实节点、放进页面容器的过程。朴素版连「描述」长什么样都不用深究，直接上代码：

```js
// —— 手写朴素版，仅用于演示 ——
function render(vnode, container) {
  const el = document.createElement(vnode.type)   // 按 type 造元素
  if (typeof vnode.children === 'string') {
    el.textContent = vnode.children               // 文本子节点：直接写
  } else if (Array.isArray(vnode.children)) {
    vnode.children.forEach(child => render(child, el))   // 子元素：递归
  }
  container.append(el)                            // 挂进容器
}

const vnode = {
  type: 'div',
  children: [
    { type: 'span', children: 'hello ' },
    { type: 'span', children: 'vue3' },
  ],
}
render(vnode, document.querySelector('#app'))
```

走读一遍。`render` 接收两样东西：一份描述和一个容器。它先按 `type` 创建元素；children 是字符串就写文本，是数组就逐个递归；最后把自己挂进容器。递归的深度就是树的深度——二十行左右，一棵嵌套树就挂出来了。页面上准备好 `<div id="app"></div>`，跑完最后一行，DevTools 里就是 `<div><span>hello </span><span>vue3</span></div>`。

为什么朴素版连 props 都不处理？因为属性与事件怎么「打补丁」是下一章的主题，本章先把「树怎么挂上去」这条主干走通。

不过，「挂载时把属性一口气设满」这件事本身并不依赖补丁算法，可以先用最朴素的方式补进来。给 render 加一段 props 处理，仍是一版手写实现：

```js
// —— 手写朴素版（带 props），仅用于演示 ——
function render(vnode, container) {
  const el = document.createElement(vnode.type)          // 按 type 造元素
  if (typeof vnode.children === 'string') {
    el.textContent = vnode.children                     // 文本子节点：直接写
  } else if (Array.isArray(vnode.children)) {
    vnode.children.forEach(child => render(child, el))  // 子元素：递归
  }
  if (vnode.props) {                                    // 属性与事件：一口气设满
    for (const key in vnode.props) {
      if (key.startsWith('on')) {                       // 约定：on 开头是事件
        el.addEventListener(key.slice(2).toLowerCase(), vnode.props[key])
      } else {
        el.setAttribute(key, vnode.props[key])          // 其余一律当普通属性
      }
    }
  }
  container.append(el)                                  // 挂进容器
}

render(
  { type: 'button', props: { id: 'btn', class: 'primary', onClick: () => {} }, children: '点我' },
  document.querySelector('#app'),
)
// DevTools 里：<button id="btn" class="primary">点我</button>
```

走读 props 段。约定沿用模板的写法：`on` 开头的键当事件，剥掉前缀、转成小写拿到事件名，`addEventListener` 绑上；其余键一律走 `setAttribute`。注意属性设在 `append` **之前**——节点进文档那一刻就是成品，不是「先进文档再补妆」。这十几行朴素处理，正对应 1.3 节仓库 `mountElement` 里那个 `for (const key in props)` 循环：挂载路径上「一口气设满属性」的语义，两边完全同构，仓库版只是把 `setAttribute` 与 `addEventListener` 换成了统一的 `hostPatchProp`。

朴素版到头了：离「属性做得对」还差三步。其一，事件每渲染一次都 `addEventListener` 一个新函数，旧的不拆，越绑越多。其二，`class` 传对象或数组、`style` 传字符串或对象，归一化一概没有。其三，更新时旧属性怎么比对、怎么移除，无从谈起。这三步正是下一章 `patchProp` 与事件 invoker 的主题，本章不展开。

但很明显，我们还做不到两件事。其一，换平台就全废：`document.createElement` 硬编码在函数体里，渲染到 canvas 或字符串时每一行都要重写。其二，更新无从谈起：再调一次 `render` 只会往容器里再塞一棵树，函数对「上一次渲染过什么」一无所知。本章先解决第一件事——把 DOM 操作从渲染器里交出去；第二件事的入口 1.4 节就会出现。

## 1.2 vnode：把「要渲染什么」变成纯数据

朴素版里 vnode 已经出现了，只是没正式介绍。官方文档对虚拟 DOM 的定义是「将目标所需的 UI 通过数据结构“虚拟”地表示出来，保存在内存中」。这个数据结构就是 vnode（虚拟节点），仓库 `packages/runtime-core/src/vnode.ts` 的 `VNode` 接口是它的完整形态：

```ts
// packages/runtime-core/src/vnode.ts —— VNode 接口（节选）
export interface VNode<HostNode = any, HostElement = any, ExtraProps = Data> {
  __v_isVNode: true
  __v_skip: true
  type: any
  props: (VNodeProps & ExtraProps) | null
  key: VNodeProps['key'] | null
  children: VNodeNormalizedChildren
  component: ComponentInternalInstance | null
  // DOM/输出物
  el: HostNode | null
  anchor: HostNode | null // Fragment 的尾部锚点
  // 位图与编译优化（mini 阶段 3 只用到 shapeFlag）
  shapeFlag: number
  // ……（ref / patchFlag / dynamicChildren 等字段从略）
}
```

字段分两组读。第一组描述「是什么」：`type` 记节点种类，`props`、`key`、`children` 记属性、身份与子节点。注意 `type` 的取值远不止元素名——字符串是元素，对象或函数是组件，还有下面要讲的三个特殊 Symbol。第二组是渲染结果的回写通道：`el`、`anchor`、`component`，建 vnode 时全是 `null`，挂载后由渲染器填上。

为什么渲染结果要回写到 vnode 身上？因为更新时要用：`patchElement` 更新元素的第一行就是 `n2.el = n1.el!`，新旧 vnode 靠这个字段共用同一个真实节点。可以说 `el` 是纯数据世界与真实宿主之间唯一的接线——除它之外，接口里没有任何平台 API。

字段再多也不乱，因为每个字段的「谁写、谁读」都是定死的。按仓库源码整理成一张表：

| 字段 | 谁写 | 谁读 |
|---|---|---|
| `__v_isVNode` | `_createVNode` 建 vnode 时写死 `true` | `isVNode()` 判型；`_createVNode` 识别「传入已是 vnode」改走克隆分支 |
| `type` | `h()` 或编译产物传入 | `patch` 的 switch 分发；`isSameVNodeType` 的同型判定 |
| `props` | 建 vnode 时写入（响应式 props 先克隆一份） | `mountElement` 遍历逐键设属性；`patchElement` 做新旧比对 |
| `key` | 建 vnode 时从 props 提取，缺省 `null` | `isSameVNodeType`：type 与 key 都相同才视为同一节点 |
| `children` | 建 vnode 时写入；`normalizeChildren` 归一后改写 | `mountElement` 按形态挂孩子；`patchChildren` 更新时比对 |
| `component` | `mountComponent` 首行创建实例时回写 | `unmountComponent` 卸载组件；`createApp` 的 mount 返回 `vnode.component.proxy` |
| `el` | 各 `process*` 挂载时回写真实节点 | `patchElement` 首行继承；`unmount` 摘除；`getNextHostNode` 定位 |
| `anchor` | `processFragment` 挂载时写尾部注释节点 | `getNextHostNode`（Fragment 取它当组尾）；`unmountFragment` 最后摘掉两条锚 |
| `shapeFlag` | `_createVNode` 按 type 编码；`normalizeChildren` 追加孩子形态位 | `patch` 的 default 分支选路；`mountElement` 位与判定孩子形态 |

一张表读出一个结构性事实：前五行建好之后不再变，是「输入」；`component`、`el`、`anchor` 三行建时全是 `null`、挂载时才由渲染器回写，是「输出」。上一段说的回写通道，字段级的分工就在这里。`shapeFlag` 最特殊——建时编码、渲染时只读，它是对前几行的压缩摘要，让查询不必再做 `typeof` 探测。

`type` 的三个特殊取值是三个独立 Symbol：

```ts
// packages/runtime-core/src/vnode.ts
export const Fragment = Symbol('mini-fragment') as any
export const Text = Symbol('mini-text') as any
export const Comment = Symbol('mini-comment') as any
```

`Text` 对应文本节点；`Comment` 对应注释节点，还兼任 `null`/布尔值子节点的占位。`Fragment`（片段）最特殊：它不对应任何真实节点，职责是把一组子节点「打包成一个位置」。Vue 3 允许模板写多个根节点，这多个根就是一棵 Fragment 子树。挂载时它创建首尾两个注释节点占位：`processFragment` 把它们写进 `n2.el` 与 `n2.anchor`，真实内容围在中间。于是「一组节点」在 DOM 里有了确定的边界——整组移动、整组卸载只需处理两个锚点；锚点在 diff 里怎么用，第 7 篇展开。

双注释锚点挂载后的真实 DOM 长什么样，实测一遍（`render(h(Fragment, null, [h('span', 'a'), h('span', 'b')]), container)`，验证方式见本章末）：

```html
<!-- container 的真实内容：n2.el ↓                        ↓ n2.anchor -->
<!----><span>a</span><span>b</span><!---->
```

四个子节点逐个对号：首注释是 `n2.el`，尾注释是 `n2.anchor`，两个 span 是被打包的真实内容。两条空注释就是这组节点在 DOM 里钉下的界碑，一前一后。为什么非要界碑？因为 DOM 对「一组兄弟节点」没有任何原生记号——给定容器，没法问浏览器「这三个节点是一伙的」。有了界碑，整组定位就有了参照：`getNextHostNode` 对 Fragment 取 `anchor` 之后紧跟的节点当「下一家」；`unmountFragment` 先逐个卸孩子，最后把两条界碑一并摘掉，整组消失得干干净净。没有这对锚点，Fragment 的孩子散在兄弟节点中间，就成了无主孤儿。

为什么 `type` 用 Symbol 而不用字符串 `'text'`？因为字符串会与同名元素标签撞车（万一有人写 `<text>`），Symbol 天然唯一。mini 用独立 `Symbol()` 而非官方的 `Symbol.for('v-txt')`，源码注释给了理由：避免与「同进程里加载的真 Vue」类型撞车。

接口里的 `shapeFlag` 本章只提一句：它是位图——用一个整数的每个二进制位，同时记「节点是什么」（元素/组件）和「孩子是什么形态」（文本/数组/插槽），查询是一次位与。编码发生在建 vnode 时。`_createVNode` 把字符串 type 编成 `ELEMENT`、对象或函数编成 `STATEFUL_COMPONENT`；`normalizeChildren` 再按 children 形态追加 `TEXT_CHILDREN`、`ARRAY_CHILDREN` 或 `SLOTS_CHILDREN`。位图怎么读、怎么省事，第 6/7 篇用到时再展开。

位图的取值不是抽象口号，每个名字对应一个精确的数，定义在 `packages/shared/src/ShapeFlags.ts`：

```ts
// packages/shared/src/ShapeFlags.ts（节选）
export const enum ShapeFlags {
  ELEMENT = 1,                    // 1 << 0
  FUNCTIONAL_COMPONENT = 1 << 1,  // 2（mini 不实现，保留位）
  STATEFUL_COMPONENT = 1 << 2,    // 4
  TEXT_CHILDREN = 1 << 3,         // 8
  ARRAY_CHILDREN = 1 << 4,        // 16
  SLOTS_CHILDREN = 1 << 5,        // 32
}
```

拿三个真实 vnode 把编码算一遍（实测值，`h()` 创建后直接读 `vnode.shapeFlag`）：

| vnode | 编码过程 | 结果 | 二进制 |
|---|---|---|---|
| `h('div', [h('span')])` | ELEMENT(1) \| ARRAY_CHILDREN(16) | 17 | `0b10001` |
| `h('div', 'hello')` | ELEMENT(1) \| TEXT_CHILDREN(8) | 9 | `0b1001` |
| `h(组件, () => 'slot')` | STATEFUL_COMPONENT(4) \| SLOTS_CHILDREN(32) | 36 | `0b100100` |

读的时候就是一次位与：`shapeFlag & ShapeFlags.ARRAY_CHILDREN` 在 17 上得 16，非零即真；在 9 上得 0，为假。`patch` 里那句 `if (shapeFlag & ShapeFlags.ELEMENT)` 选路、`mountElement` 里判孩子形态，用的都是这一种运算。一个整数同时回答「是什么」与「孩子是什么形态」，每次分叉只花一次与运算——位图的全部收益就这些，没有更多魔法。

日常代码不直接碰 `createVNode`，用的是 `h()`——它只是 `createVNode` 的语法糖，麻烦全在参数歧义：`h('div', 'hello')` 的第二个参数是 children，`h('div', { id: 'a' })` 却是 props。至此「要渲染什么」已经是纯数据。但朴素版再读一遍会发现，病灶不在数据，在渲染器自己动手调了 `document`——下一节把这双手交出去。

## 1.3 把 DOM 操作交出去：createRenderer 依赖注入

朴素版里两种东西长在了一起：编排逻辑（先建谁、后插谁、怎么递归）和宿主操作（`createElement`、`append`）。宿主（host），指渲染的最终目标环境——浏览器 DOM、canvas、SSR 的字符串都算。想让编排逻辑跨环境复用，就得把宿主操作抽成参数、由外部提供。这套做法叫依赖注入：调用方提供底层操作，框架只编写编排逻辑。

仓库的入口是 `createRenderer`，`options` 就是宿主操作集：

```ts
// packages/runtime-core/src/renderer.ts —— createRenderer
export function createRenderer<HostNode, HostElement>(
  options: RendererOptions<HostNode, HostElement>,
) {
  return baseCreateRenderer(options)
}
```

契约由同文件的 `RendererOptions` 接口列出：创建节点（`createElement`/`createText`/`createComment`）、插入移除（`insert`/`remove`）、写文本（`setText`/`setElementText`）、结构查询（`parentNode`/`nextSibling`）、打属性补丁（`patchProp`）。实现体 `baseCreateRenderer` 的第一件事是把它们解构成 `host*` 别名：

```ts
// packages/runtime-core/src/renderer.ts —— baseCreateRenderer 开头（节选）
function baseCreateRenderer(options: RendererOptions) {
  const {
    patchProp: hostPatchProp,
    insert: hostInsert,
    remove: hostRemove,
    createElement: hostCreateElement,
    createText: hostCreateText,
    setElementText: hostSetElementText,
    // ……（createComment / setText / parentNode / nextSibling / hideNode / showNode 同款）
  } = options
```

从此函数体里只出现 `hostInsert`、`hostCreateElement` 这些别名，不出现任何平台 API。注意签名上的两个类型参数 `HostNode`/`HostElement`：`createElement` 的返回值在 runtime-core 眼里是不透明对象，它不知道也不需要知道这是 DOM Element。渲染器对宿主的要求被压缩成一张操作表，这张表就是全部耦合。

操作表里最值得端详的是 `insert(child, parent, anchor)`。为什么挂载不叫 `append`，非要带第三个参数？因为它要求的是「插到 anchor 之前」的语义：anchor 为 null 时等价于追加，非空时新节点落在它前面。挂载新节点、移动旧节点用的是同一个动作；第 7 篇 diff 移动节点时，它就是主角。

浏览器一侧的实现在 `runtime-dom` 的 `nodeOps.ts`——同一张表的 DOM 版，全仓库对 `document` 的调用都集中在这一处：

```ts
// packages/runtime-dom/src/nodeOps.ts —— nodeOps（节选）
export const nodeOps = {
  insert: (child: Node, parent: Element, anchor?: Node | null) => {
    parent.insertBefore(child, anchor || null)
  },

  createElement: (tag: string): Element => {
    return document.createElement(tag)
  },

  setElementText: (el: Element, text: string) => {
    el.textContent = text
  },

  // ……（remove / createText / createComment / setText / 结构查询 / KeepAlive 显隐从略）
} satisfies Partial<RendererOptions<Node, Element>>
```

组装发生在 `runtime-dom` 的入口：`patchProp` 来自同目录的 `patchProp.ts`（下一章的主角），与 nodeOps 合并成 options 交给 `createRenderer`。

```ts
// packages/runtime-dom/src/index.ts
const rendererOptions = { ...nodeOps, patchProp }

let renderer: ReturnType<typeof createRenderer> | undefined

function ensureRenderer() {
  return renderer || (renderer = createRenderer(rendererOptions))
}
```

`ensureRenderer` 是惰性单例：不调 `createApp` 就不创建渲染器，且整页只创建一次。「换一套 options 就是另一个平台」至此不是口号。官方文档「自定义渲染器」一节展示的 `createRenderer` 与本仓库签名完全一致，渲染到 canvas 的自定义渲染器正是这样长出来的。SSR 则不止换一张操作表：客户端还要把服务端产出的 DOM 复用起来，那是 hydration，差距节再提。

现在看改造后的挂载，对照朴素版读 `mountElement`：

```ts
// packages/runtime-core/src/renderer.ts —— mountElement（节选）
function mountElement(
  vnode: VNode,
  container: any,
  anchor: any,
  parentComponent: ComponentInternalInstance | null,
) {
  let el = (vnode.el = hostCreateElement(vnode.type as string))
  const { props, shapeFlag } = vnode

  // 子节点：文本 or 数组
  if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
    hostSetElementText(el, vnode.children as string)
  } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    const children = isArray(vnode.children) ? vnode.children : [vnode.children as any]
    mountChildren(children, el, null, parentComponent)
  }

  // 属性
  if (props) {
    for (const key in props) {
      if (key !== 'key' && key !== 'ref') {
        hostPatchProp(el, key, null, props[key])
      }
    }
  }

  // ……（Transition / 指令钩子从略，第 12 篇）
  hostInsert(el, container, anchor)
}
```

逐行同构：`document.createElement` 换成 `hostCreateElement`，`textContent` 换成 `hostSetElementText`，`append` 换成 `hostInsert`。多出来的三样：回写 `vnode.el`、用 `shapeFlag` 位与判孩子形态（朴素版是 `typeof` 探测）、遍历 `props` 调 `hostPatchProp`。顺序也和朴素版一致：先造元素、填孩子、设属性，最后插入。属性在插入**前**设好，节点进文档那一刻就是成品，省掉「半成品进文档再补属性」的重复排版。

还剩一个疑问：`mountChildren` 里对每个子节点调的是 `patch(null, child, ...)`，为什么不直接递归 `mountElement`？下一节回答。

## 1.4 patch：挂载与更新共用的入口

1.1 的第二个局限是「更新无从谈起」。解法的一半是让渲染器记住旧树（1.5 节），另一半是给挂载与比对一个共同的入口——`patch`（比对，对新旧 vnode 做同层比较并应用差异）：

```ts
// packages/runtime-core/src/renderer.ts —— patch（节选）
function patch(
  n1: VNode | null,
  n2: VNode,
  container: any,
  anchor: any = null,
  parentComponent: ComponentInternalInstance | null = null,
  isSVG = false,
) {
  if (n1 === n2) return

  const { type, shapeFlag } = n2

  // 类型或 key 变了 → 丢弃旧节点整树，当新节点处理
  if (n1 && !isSameVNodeType(n1, n2)) {
    anchor = getNextHostNode(n1)
    unmount(n1, parentComponent)
    n1 = null
  }

  switch (type) {
    case Text:
      processText(n1, n2, container, anchor)
      break
    case Comment:
      processCommentNode(n1, n2, container, anchor)
      break
    case Fragment:
      processFragment(n1, n2, container, anchor, parentComponent)
      break
    default:
      if (shapeFlag & ShapeFlags.ELEMENT) {
        processElement(n1, n2, container, anchor, parentComponent, isSVG)
      } else if (shapeFlag & ShapeFlags.COMPONENT) {
        processComponent(n1, n2, container, anchor, parentComponent)
      }
  }
}
```

读法如下。`n1` 是旧 vnode、`n2` 是新 vnode：`n1` 为 null 即挂载，非 null 即比对。每个 `process*` 都是同样的双分支——以 `processElement` 为例，`n1 == null` 走 `mountElement`，否则走 `patchElement`。一个函数同时是挂载入口和更新入口，本章只走挂载路径。

第一行 `if (n1 === n2) return` 是引用相等短路：新旧是同一个对象就直接返回。什么时候会出现同一个对象？第 11 篇的静态提升会把不变的 vnode 提到渲染函数外，两次渲染拿到同一个引用——这行判断让它们零成本跳过。编译器还没登场，先记下这个伏笔。

`isSameVNodeType` 要求 type 与 key 都相同才视为同一节点。不成立时旧子树整体作废：先 `getNextHostNode(n1)` 取锚点，再 `unmount(n1)` 卸掉旧树，`n1` 置空走全新挂载。为什么先取锚点再卸载？因为卸载会把旧节点从文档摘除，之后再查它的兄弟节点必然落空——细节第 6 篇讲卸载时展开。

现在回答上一节的问题：`mountChildren` 为什么绕道 `patch` 而不直接递归 `mountElement`？因为 children 里不一定都是元素——数组里混着字符串（归一化后是 `Text` vnode）、组件 vnode，还有 Fragment。`patch` 是唯一知道「这个 type 该走哪条路」的分发中心，switch 的三路加 default 两路，正是 1.2 那五种 type 的落点。递归的统一入口是 `patch`，不是某个 mount。

到这里，「从 vnode 到真实节点」的链路闭合了。但日常写的是 `createApp(App).mount('#app')`，不是手调 `render`——最后一环在 `apiCreateApp`。

## 1.5 createApp 与 mount：应用入口的最后一环

`baseCreateRenderer` 收尾时回吐两样东西：底层入口 `render`，以及 `createAppAPI(render)` 产出的 `createApp`——一个闭包工厂，把具体的 render 绑进去，返回「应用工厂」：

```ts
// packages/runtime-core/src/apiCreateApp.ts —— createAppAPI（节选）
export function createAppAPI<HostElement>(
  render: (vnode: VNode | null, container: HostElement) => void,
) {
  return function createApp(rootComponent: any, rootProps: Record<string, unknown> | null = null): App {
    const context = createContext()
    let isMounted = false
    const app: App = {
      // ……（provide / use / component 等全局方法从略）
      mount(rootContainer: HostElement): any {
        if (!isMounted) {
          const vnode = createVNode(rootComponent, rootProps)
          // 根组件能看到 app 级 provides（inject 的顶层兜底）
          vnode.appContext = context

          render(vnode, rootContainer)

          isMounted = true
          app._container = rootContainer
          return vnode.component!.proxy
        }
        // ……（重复挂载的警告与返回值从略）
      },
      // unmount：render(null, app._container) —— 卸载走同一扇门
    }
    return app
  }
}
```

走读 `mount`：它把根组件包成 vnode——组件定义也是一种 `type`，按 1.2 的编码表命中 `STATEFUL_COMPONENT`；挂上 `appContext` 让 `inject` 有顶层兜底；然后交给 `render`。`patch` 的 default 分支会按 shapeFlag 落到 `processComponent`，组件的挂载与更新是第 8 篇的主题。本章只需知道：根组件也是从 `patch` 这扇门进来的。`render` 的本体只有十行：

```ts
// packages/runtime-core/src/renderer.ts —— render
const render: (vnode: VNode | null, container: any) => void = (vnode, container) => {
  if (vnode == null) {
    // 卸载旧树
    if (container._vnode) {
      unmount(container._vnode)
    }
  } else {
    patch(container._vnode || null, vnode, container, null, null)
  }
  container._vnode = vnode
}
```

旧树记在 `container._vnode` 上。为什么记在容器而不设模块级变量？因为一页可以挂多个应用，各容器各记各的，`render` 自身也因此无状态。于是三种调用共用一个入口：第一次 `_vnode` 为空，`patch(null, vnode)` 是挂载；之后组件的渲染副作用重跑、产出新树，`patch(旧树, 新树)` 是比对；传 `null` 进来就是卸载。`app.unmount` 干的事正是 `render(null, container)`——更新与卸载共用一个入口，说的就是这里。

至此 00 篇数据流图的 ②④ 两步有了实体：`createApp(App).mount('#root')` 把根组件包成 vnode，经 `render` 进 `patch`，分发到 `mountElement`，最后落在 `nodeOps`——`document` 在那里、且只在那里。

## 本章小结

vnode 是「要渲染什么」的纯数据协议：`type/props/key/children` 描述目标，`el/anchor/component` 是渲染结果的回写通道。渲染器经 `createRenderer(options)` 依赖注入宿主操作，函数体内只见 `host*` 别名；浏览器实现集中在 `nodeOps.ts`，由 `runtime-dom` 以惰性单例组装出 DOM 版渲染器。`patch` 以 `n1` 是否为空统一挂载与更新两个入口，`mountChildren` 的递归统一走它。`render` 把旧树记在 `container._vnode` 上，更新与卸载共用一个入口；`createApp` 的 `mount` 把根组件包成 vnode 后交给 `render`。

## 仓库文件索引

- `packages/runtime-core/src/vnode.ts` —— VNode 接口、Text/Comment/Fragment 三个 Symbol、createVNode 与 shapeFlag 编码
- `packages/runtime-core/src/renderer.ts` —— createRenderer/baseCreateRenderer、patch 分发、mountElement、render 与 container._vnode
- `packages/runtime-dom/src/nodeOps.ts` —— 浏览器宿主操作表（全仓库唯一碰 document 的地方）
- `packages/runtime-dom/src/index.ts` —— rendererOptions 组装、ensureRenderer 惰性单例
- `packages/runtime-core/src/apiCreateApp.ts` —— createAppAPI 闭包、mount 把根组件包成 vnode
- `packages/runtime-core/src/h.ts` —— h()：createVNode 的参数歧义语法糖

## 与官方实现的差距

以下均对照 `third_party/vue-core`（v3.5.x）核对：

- **无 hydration**：官方 `runtime-core/src/renderer.ts` 另有 `createHydrationRenderer`，`baseCreateRenderer` 多接受一个 `createHydrationFunctions` 参数，在 SSR 产出的 DOM 上做「复用式挂载」。本仓库只有客户端路径，SSR 本就不在系列范围。
- **无 Teleport / Suspense**：官方 `patch` 的 switch 为两者留了 `TeleportImpl.process` 与 `SuspenseImpl.process` 分支；本仓库的 switch 只有 Text/Comment/Fragment/default 四路。
- **宿主操作集更小**：官方 `RendererOptions` 还有 `setScopeId`、`insertStaticContent`（静态提升的整段插入），官方 nodeOps 有 `querySelector`、带 namespace 的 `createElement`（SVG/MathML）——官方 nodeOps 139 行，本仓库 61 行。反过来，本仓库多注入了 `hideNode/showNode`：KeepAlive 用 `style.display` 切换显隐的简化，官方走「子树搬进离屏容器」的路。
- **规模与防御**：官方 renderer.ts 约 2670 行（本仓库 921 行），HMR、dev 警告、optimized 快速路径、namespace 处理都住在里面；本仓库按教学主干裁剪。

## 动手验证

```bash
npx vitest run packages/runtime-dom
```

预期 6 个测试文件、65 个用例全部通过。`renderer.spec.ts` 开头的 mount 组锚定的正是本章路径：`h('div', { id: 'app' }, 'hello')` 挂出 `<div id="app">hello</div>`，嵌套子节点逐层挂载。

也可以起 playground 手工走一遍链路（`pnpm dev:playground`），在 `examples/playground/src/main.ts` 里随手写：

```ts
import { h, createApp } from '@mini-vue/runtime-dom'
createApp({ render: () => h('div', [h('span', 'hello '), h('span', 'vue3')]) }).mount('#app')
```

浏览器里得到 `<div><span>hello </span><span>vue3</span></div>`——与 1.1 朴素版相同的输入、相同的产出，中间已经换成本章这条平台无关链路。把断点打在 `nodeOps.ts` 的 `insert` 上，还能亲眼看到整棵树「孩子先就位、最后插入」的顺序。

本章新增的三个演示也都实测过。Fragment 双锚点：`render(h(Fragment, null, [h('span', 'a'), h('span', 'b')]), container)` 后 `container.innerHTML` 为 `<!----><span>a</span><span>b</span><!---->`（文件头加 `// @vitest-environment jsdom`）。shapeFlag 算例：`h('div', [h('span')]).shapeFlag` 为 17、`h('div', 'hello')` 为 9、`h(组件, () => 'slot')` 为 36。1.1 带 props 的朴素渲染器在 jsdom 里挂出 `<button id="btn" class="primary">点我</button>`。

## 延伸阅读

- 官方文档：[渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html)（虚拟 DOM 定义与渲染管线三阶段）、[自定义渲染器 API](https://cn.vuejs.org/api/custom-renderer.html)（`createRenderer` 的官方签名与 RendererOptions 契约）
- core 源码：`packages/runtime-core/src/renderer.ts` 开头（RendererOptions 与 host* 解构）、`packages/runtime-dom/src/nodeOps.ts`
- 《Vue.js 设计与实现》第 7 章（vnode 与渲染器的引入）、8.1 节（挂载一个元素）

> 下一篇：元素挂上去了，但属性还是「挂载时一口气设满」——class 怎么归一、style 怎么合并？事件每渲染一次都换新函数，怎么绑才不会越绑越多？旧节点卸载时除了摘 DOM 还要停副作用，怎么做才算干净？我们进入 `patchProp`、事件 invoker 与正确的卸载。
