# 10 · transform 与 codegen：折叠语法树，拼出渲染函数

上一篇结束时树已经啃出来了：`<p v-if="ok">` 在 AST 里是一个 ELEMENT 节点，v-if 只是它 props 数组里一个名叫 if 的指令属性。没有人「执行」它——树只描述了「这里有个带指令的元素」，没有描述「条件不成立时这里什么都没有」。本章补上编译器的后两段：transform 遍历这棵树，把结构指令折叠成机器可执行的结构；codegen 再把树拼成渲染函数源码，最后一跳交给运行时。

在这个过程中，我们会遇到几个问题：渲染函数里那个三元表达式是从哪来的？变换为什么要分「进入」和「退出」两个阶段？产物为什么是一个字符串，运行时怎么把它变成函数？`with (_ctx)` 到底是什么，官方又为什么不用它？

## 10.1 transform：给声明式的树做手术

先看这台手术要切出什么。parse 对 `<div v-if="a"/><div v-else-if="b"/><p v-else/>` 的产出是三个平级兄弟元素，指令各挂在各自的 props 里。codegen 需要的却是单个 IF 节点：三个兄弟折叠成 branches 数组，条件挂在分支上。`packages/compiler-core/src/transforms/transformIf.ts` 文件头注释画的就是这个目标：

```text
<div v-if="a"/><div v-else-if="b"/><p v-else/>
  → IF { branches:[{condition:a, children:[div]},
                   {condition:b, children:[div]},
                   {condition:undefined, children:[p]}] }   // v-else 无条件
```

最直觉的做法是单趟扫描：见到 v-if 就把元素替换成 IF 节点，见到 v-else 就挂到前一个兄弟上并立即把它从兄弟列表摘掉。手写出来不长：

```js
// —— 手写朴素版，仅用于演示 ——
function naiveFoldIf(children) {
  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    const dir = node.props && node.props.find(p => /^(if|else(-if)?)$/.test(p.name))
    if (!dir) continue
    if (dir.name === 'if') {
      children[i] = { type: IF, branches: [{ condition: dir.exp, children: [node] }] }
    } else {
      const prev = children[i - 1]
      if (prev && prev.type === IF) {
        prev.branches.push({
          condition: dir.name === 'else-if' ? dir.exp : undefined,
          children: [node],
        })
        children.splice(i, 1)   // 立即摘掉 v-else 元素
        i--
      }
    }
  }
}
```

纯折叠这一步它能做对。但很明显，我们还做不到「等一个节点的子树全部处理完再回来摘它」。为什么需要等？因为分支的内容不是元素本身，而是元素的 `codegenNode`——一个由 transformElement 在处理完该元素的属性与子节点之后才构造的 vnode 调用描述。摘除若发生在它之前，产物里这个分支就没有内容可读。此外还有别的变换在排队：相邻文本与插值要合并成一个复合表达式，且合并必须发生在 transformElement 读取 children 之前。单趟循环里不存在「回来」这个时刻，需要一种让变换自己声明「这件事请在孩子们处理完之后做」的机制。仓库的答案是双阶段遍历。

核心在 `traverseNode`。每个变换是一个函数：进入节点时调用一次，它可以选择返回一个函数——退出钩子，等整棵子树遍历完再执行：

```ts
// packages/compiler-core/src/transform.ts —— traverseNode（节选）
export function traverseNode(node: any, context: TransformContext) {
  context.currentNode = node
  const { nodeTransforms } = context
  const exitFns: Array<() => void> = []

  // 进入：逐个运行 transforms（结构性 transform 返回 exit 在子树遍历后逆序执行）
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) {
      exitFns.push(onExit)
    }
    if (!context.currentNode) {
      // 节点已被 removeNode/替换
      return
    }
    // 节点可能被结构性 transform 替换（v-if → IF），后续 transform 跟新节点走
    node = context.currentNode
  }

  // 按类型分发子节点遍历（每个 child 都带着自己的父节点走，供 v-else/v-for 回链）
  switch (node.type) {
    case NodeTypes.ROOT:
      traverseChildren(node.children, context, node)
      break
    case NodeTypes.ELEMENT:
      traverseChildren(node.children, context, node)
      break
    // ……（略）IF / IF_BRANCH / FOR 各自 traverseChildren；
    //      INTERPOLATION 登记 TO_DISPLAY_STRING helper
  }

  // 逆序执行 exit 钩子
  let i = exitFns.length
  while (i--) {
    if (!context.currentNode) {
      context.currentNode = node
    }
    exitFns[i]()
  }
}
```

走读三个要点。其一，进入阶段允许变换替换节点：transformIf 把元素换成 IF 节点后，`node = context.currentNode` 让排在后面的变换继续作用于新节点——结构先定稿，元素化后进行。其二，退出钩子逆序执行。为什么逆序？因为变换数组等价于一层嵌套作用域：先进入的最后退出，正如多层括号从内向外收口。其三，退出前那句 `context.currentNode = node` 是给摘除钩子兜底：节点已被摘掉时把现场恢复，外层循环据此回退下标。

逆序的收益落在注册顺序上。`compile.ts` 里 nodeTransforms 的顺序是 transformIf、transformFor、transformExpression、transformSlotOutlet、transformElement、transformText。transformText 排在最后注册，它的退出钩子（合并相邻文本与插值）就最先执行；transformElement 的全部逻辑都在退出钩子里（构造 vnode 调用、读取 children），执行得更晚。于是元素收编 children 时，文本已经合并完毕。注册顺序因此是语义的一部分，不是随意的排列。

**整条流水线逐节点跑一遍。** 六个变换的进入与退出交织在一起，光看代码容易把顺序脑补错。办法是给每个变换包一层打点：进入记一笔、登记退出钩子记一笔、钩子真正执行时再记一笔，打点后的数组与 `compile.ts` 的注册顺序逐项一致。跑 `<div><p v-if="ok">{{ msg }}</p><span>hi</span></div>`，实测输出整理成下面这张表（打点脚本见章末「动手验证」）：

```text
事件   现场                          动作（实测）
 1    进入 ROOT                     transformElement / transformText 登记退出钩子
 2    进入 <div>                    同上，两位退出钩子常客都登记
 3    进入 <p v-if>                 transformIf：摘掉指令，节点替换为 IF(1分支)；
                                    transformElement 对新节点 IF 也登记退出钩子
 4    IF 节点分发                   traverseNode 按 IF 类型登记 createCommentVNode，
                                    随后遍历 branches
 5    进入 IF_BRANCH、进入 <p>      <p> 的指令已在事件 3 摘除，此处只是普通元素
 6    进入 {{ msg }}                INTERPOLATION 分发：登记 toDisplayString
 7    退出 {{ msg }}                transformElement 的钩子空转（不是元素）
 8    退出 <p>（逆序）              transformText：把插值包成 TEXT_CALL；
                                    transformElement：建 codegenNode，登记 createElementVNode
 9    退出 IF_BRANCH、IF（逆序）    transformText 在 branch 层无文本可合并；
                                    transformElement 两层都不是元素，空转
10    退出 <p v-if> 的结构包装器     v-if 主分支的收尾为空操作
11    进入 <span>、进入 TEXT("hi")  普通元素与纯文本，只登记不动作
12    退出 <span>（逆序）           transformText 把 "hi" 包成 TEXT_CALL；
                                    transformElement 建 span 的 codegenNode
13    退出 <div>、退出 ROOT（逆序） transformText 两层都无相邻文本可合并；
                                    transformElement 建 div 的 codegenNode
14    遍历结束：createRootCodegen   单根 div 的 codegenNode 标 isBlock，
                                    登记 openBlock 与 createElementBlock
```

四件事值得点名。第一，实测的 helper 登记顺序是 createCommentVNode → toDisplayString → createElementVNode → openBlock → createElementBlock，与产物首行解构的顺序一字不差——generate 按 `ast.helpers` 数组输出，而该数组是 Set 的插入序。第二，事件 8 的退出顺序是 transformText 在前、transformElement 在后，合并先于收编，上一段那句「元素收编 children 时文本已合并完毕」在时间线上落地。第三，事件 3 的替换让同一轮进入循环的后五个变换都作用于 IF 节点，而 `<p>` 本体要到事件 5 才作为 branch 的孩子被遍历。也就是说 v-if 元素被访问两次：一次作为兄弟数组里的折叠对象，一次作为分支内容。第四，事件 14 发生在整棵树遍历完之后，块标记与 openBlock 登记是 transform 收尾做的，不属于任何节点变换。

v-else 的回链也是这套机制的受益者。看 processIf 的 else 分支：

```ts
// packages/compiler-core/src/transforms/transformIf.ts —— processIf 的 v-else 分支（节选）
    // v-else / v-else-if：追加到前一个兄弟的 IF 上
    const parent = context.parent
    const prevSibling = parent!.children[context.childIndex - 1] as any
    if (prevSibling && prevSibling.type === NodeTypes.IF) {
      prevSibling.branches.push({
        type: NodeTypes.IF_BRANCH,
        loc: node.loc,
        condition: dir.name === 'else-if' ? dir.exp : undefined,
        children: [node],
        userKey: undefined,
      })
      // 摘除延迟到退出阶段：等 transformElement 给这个元素建好 codegenNode 后再摘。
      // 用「身份查找」而非 childIndex —— 内层遍历（子节点）会污染 childIndex。
      return () => {
        const list = context.parent!.children
        const index = list.indexOf(node)
        if (index > -1) {
          list.splice(index, 1)
          context.currentNode = null
        }
      }
    } else {
      console.warn(`[mini-vue] v-else/v-else-if has no adjacent v-if.`)
    }
    return
```

两处关键决策。第一，回链只认「前一个兄弟是 IF 节点」。`context.parent` 与 `context.childIndex` 由外层 `traverseChildren` 在遍历每个孩子前设置，配不上 IF 时给出警告而非静默丢弃。第二，摘除用 `indexOf(node)` 身份查找而绝不使用 childIndex。为什么？因为进入钩子之后、退出钩子之前，这个元素的整棵子树都被遍历过，`context.childIndex` 已被子节点的遍历覆盖——按陈旧下标 splice 会删错兄弟。源码注释原样记载着这个坑。v-if 主分支则走 `context.replaceNode(ifNode)` 替换；外层的包装器 `createStructuralDirectiveTransform` 会先把指令从 props 里摘掉，防止重遍历到同一指令上无限递归。

回链到底怎么一步步发生，同样用打点实测回答。跑 `<div v-if="a"/><div v-else-if="b"/><p v-else/>`，逐事件记录 root.children 的形态（同一套打点脚本，实测整理）：

| 事件 | root.children 此刻的形态 |
|---|---|
| parse 产出 | `[div(v-if), div(v-else-if), p(v-else)]` |
| 进入第 1 个 div，transformIf | 节点替换：`[IF(1分支), div(v-else-if), p(v-else)]` |
| 第 1 个 div 的子树遍历与退出全部跑完 | 不变（v-if 主分支无收尾动作） |
| 进入第 2 个 div，transformIf | 前一个兄弟是 IF，追加分支：`[IF(2分支), div(v-else-if), p(v-else)]`，注意 div 本体还在数组里 |
| 退出第 2 个 div：transformText、transformElement | div 的 codegenNode 已建好，本体仍在数组里 |
| 退出第 2 个 div：transformIf 的摘除钩子 | splice 掉本体：`[IF(2分支), p(v-else)]` |
| 进入 p，transformIf | 前一个兄弟是 IF，追加第三分支：`[IF(3分支), p(v-else)]` |
| 退出 p：transformText、transformElement，最后 transformIf 摘除 | `[IF(3分支)]`，回链完成 |

「追加在进入、摘除在退出」的中间，隔着这个元素整棵子树的遍历加两个退出钩子。实测的退出顺序是 transformText → transformElement → transformIf：摘除必然最后执行，此刻 div 与 p 的 codegenNode 早已建好。10.1 开头说的「摘除若发生在 transformElement 之前，分支就没有内容可读」，在时间线上指的正是这三步的间隔。

还有一处细节只有跑一遍才看得见。摘除钩子把 `context.currentNode` 置为 null，外层 `traverseChildren` 见到 null 就执行 `i--` 回退下标。第二次 splice 之后数组短了一位，p 仍然被正确遍历，既没跳过也没重复——transform.ts 里那三行回退代码就是为这一刻写的。最终 IF 节点的三个分支（实测打印）：cond=a 的 children 是 [div]、cond=b 的 children 是 [div]、cond=undefined 的 children 是 [p]。10.2 的嵌套三元正是从这份 branches 数组拼出来的。

v-for 与 v-if 同构，只是表达式要先剖开。一条正则按 `in`/`of` 把 `(item, i) in list` 切成两侧：

```ts
// packages/compiler-core/src/transforms/transformFor.ts（节选）
const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/

export function parseForExpression(
  input: string,
): { source: SimpleExpressionNode; value?: SimpleExpressionNode; index?: SimpleExpressionNode; key?: SimpleExpressionNode } | undefined {
  const match = input.match(forAliasRE)
  if (!match) return undefined

  const [, lhs, rhs] = match
  const source = createSimpleExpression(rhs.trim(), false)
  // (item, index) 解构
  const params = lhs.trim().replace(/^\(|\)$/g, '')
  const [first, second, third] = params.split(',').map((s) => s.trim())
  return {
    source,
    value: first ? createSimpleExpression(first, false) : undefined,
    index: second ? createSimpleExpression(second, false) : undefined,
    key: third ? createSimpleExpression(third, false) : undefined,
  }
}
```

右侧是数据源表达式，左侧剥掉括号按逗号拆出别名序列，依次映射为 value、index、key。processFor 随后构造 FOR 节点、登记 `RENDER_LIST` helper，把原元素收进 children 后 `replaceNode`。到这里，树上挂的全是带 codegenNode 的可生成节点。下一节我们把它们拼成字符串。

## 10.2 codegen：把树拼成源码

代码生成的本质是按节点类型分发的字符串拼接，骨架决定产物的整体形状：

```ts
// packages/compiler-core/src/codegen.ts —— generate（节选）
  const usedHelpers = (ast as any).helpers || []
  if (usedHelpers.length) {
    const destructure = usedHelpers
      .map((h: symbol) => `${helperNameMap[h]}: _${helperNameMap[h]}`)
      .join(', ')
    push(`const { ${destructure} } = Vue`)
    newline()
  }

  // 7-3 静态提升：先收集可提升的静态子树，逐个生成 const（渲染期只会创建一次）
  const hoistedNodes: any[] = []
  collectHoistedNodes(ast.codegenNode, hoistedNodes)
  // ……（略）逐个生成 const _hoisted_N，细节留给第 11 篇

  push(`return function render(_ctx, _cache) {`)
  indent()
  push(`with (_ctx) {`)
  indent()
  newline()
  poshRet: {
    if (ast.codegenNode) {
      push(`return `)
      if ((ast.codegenNode as any).isBlock) {
        push(`${context.helper(OPEN_BLOCK)}(), `)
      }
      genNode(ast.codegenNode, context)
    } else {
      push(`return null`)
    }
    break poshRet
  }
```

第一行解构是编译器与运行时的全部耦合点。transform 阶段各处调用 `context.helper(SYMBOL)` 登记用到的运行时助手，generate 在这里统一输出 `const { renderList: _renderList, ... } = Vue`。编译器只产出符号名，运行时提供同名导出，两侧没有任何导入关系——下一节的实例化正是这样接上的。为什么运行时一定能对上这些名字？因为符号登记表 `runtimeHelpers.ts` 与聚合模块的导出共用一套命名，编译器写下的每个名字，`runtime-dom` 里都有同名函数。中间的静态提升先占个位：可提升子树会生成渲染函数外的 `const _hoisted_N`，机制留给第 11 篇。

接着是 `with (_ctx)`。with 是 JavaScript 的一个语句：把一个对象加进作用域链，块内出现的裸标识符会先在这个对象的属性上找。模板里的 `{{ msg }}`、`:key="i"` 都是裸标识符，编译器对它们一个字符都不改，原样排进 with 块内，求值时自然命中渲染上下文。genExpression 只有两行实事：

```ts
// packages/compiler-core/src/codegen.ts —— genExpression（节选）
  if (node.isStatic) {
    context.push(JSON.stringify(node.content))
  } else {
    // with(_ctx) 方案：表达式原样输出
    context.push(node.content)
  }
```

这个方案的代价不小。with 在严格模式下是语法错误，而 ES 模块默认严格。CSP 环境禁止 `eval` 与 `new Function`，而下一节的实例化恰恰用 `new Function`。裸标识符来源无法静态分析，打包器与压缩器都皱眉。

官方因此走了另一条路：构建期开启 prefixIdentifiers，借助 babel 的解析能力把每个裸标识符改写成 `_ctx.msg` 这样的显式访问。本地 `third_party/vue-core` 的 `transformExpression.ts` 头注释写明：这个变换只在非浏览器构建启用，因为它依赖一个额外的 JavaScript 解析器；浏览器里代码同样包进 `with (this) { ... }`。`codegen.ts` 里的判定是 `const useWithBlock = !prefixIdentifiers && mode !== 'module'`——with 不是官方的权宜之计，是浏览器运行时编译的正式方案。mini 只有这一条路，`transforms/transformExpression.ts` 因此是一个显式的空操作，保留入口方便将来切换方案。

下面看真实产物（实测，仓库 `compile` 的 `code` 字段原样输出）：

```js
// compile('<ul v-if="list.length"><li v-for="(item, i) in list" :key="i">{{ item }}</li></ul><p v-else-if="fallback">fb</p><span v-else>empty</span>').code —— 实测
const { createCommentVNode: _createCommentVNode, renderList: _renderList, toDisplayString: _toDisplayString, createElementVNode: _createElementVNode } = Vue
return function render(_ctx, _cache) {with (_ctx) {
    return (list.length) ? _createElementVNode("ul", null, _renderList(list, (item, i) => _createElementVNode("li", {key: i}, _toDisplayString(item), 9, ["key"])), -1) : (fallback) ? _createElementVNode("p", null, "fb", -1) : _createElementVNode("span", null, "empty", -1)
  }
}
```

逐行指认前文的变换结果。`(list.length) ? … : (fallback) ? … : …` 是 genIf 把三个 branches 展开成的嵌套三元；`_renderList(list, (item, i) => …)` 是 genFor 的产物，FOR 节点的别名成了回调参数；`_toDisplayString(item)` 是插值的包裹；`9, ["key"]` 是补丁标记与动态 props 名单，渲染器据此只比对列名的属性（第 11 篇展开）。表达式 `list`、`item`、`fallback` 原样出现，正是 with 方案的直接证据。genIf 的兜底也有同款产物——链尾没有 v-else 时补一个注释节点占位：

```js
// compile('<div v-if="ok">a</div>').code 的 return 行 —— 实测
return (ok) ? _createElementVNode("div", null, "a", -1) : _createCommentVNode("v-if", true)
```

还有一处诚实的小注：第一份产物解构了 `_createCommentVNode` 却没用上。因为 traverseNode 遇到 IF 节点时无条件登记这个 helper，登记是贪婪的，宁可多解构也不冒产物缺符号的险。

**把第一行解构逐项对账。** 产物首行不是随手列的名单，每个名字都能对到一次显式登记。以第一份产物（三分支加 v-for）为例，逐项核对：

| 解构项 | 登记处（已对照源码） | 登记时机 |
|---|---|---|
| `createCommentVNode` | `transform.ts` traverseNode 的 IF 分支分发 | 进入阶段，遇 IF 节点无条件登记 |
| `renderList` | `transforms/transformFor.ts` processIf 同款的 processFor 里 `context.helper(RENDER_LIST)` | 进入阶段，FOR 替换时 |
| `toDisplayString` | `transform.ts` traverseNode 的 INTERPOLATION 分发 | 进入阶段 |
| `createElementVNode` | `transforms/transformElement.ts` 退出钩子末尾 `context.helper(...)` | 退出阶段，codegenNode 建好时 |

四个名字与 `runtimeHelpers.ts` 的 helperNameMap 一一对应（RENDER_LIST 映射 'renderList'、TO_DISPLAY_STRING 映射 'toDisplayString'，其余同理），排列顺序即 Set 的插入序。再拿一张新产物交叉验证——编译 10.1 打点用的那张模板（实测）：

```js
// compile('<div><p v-if="ok">{{ msg }}</p><span>hi</span></div>').code —— 实测
const { createCommentVNode: _createCommentVNode, toDisplayString: _toDisplayString, createElementVNode: _createElementVNode, openBlock: _openBlock, createElementBlock: _createElementBlock } = Vue
const _hoisted_1 = _createElementVNode("span", null, "hi", -1)
return function render(_ctx, _cache) {with (_ctx) {
    return _openBlock(), _createElementBlock("div", null, [(ok) ? _createElementVNode("p", null, _toDisplayString(msg), 1) : _createCommentVNode("v-if", true), _hoisted_1], -1)
  }
}
```

前三个名字的来路与上表相同，多出来的 `openBlock` 与 `createElementBlock` 由 transform 收尾的 createRootCodegen 登记——单根元素的 codegenNode 被标为块，机制第 11 篇展开。两份产物一对照还能看出两个门道。其一，第一份产物的根是 IF 条件表达式、不是 VNODE_CALL，createRootCodegen 不给它标块，因此首行没有这两个名字。其二，第一份产物也没有 `_hoisted_1`：codegen 的提升预扫描 collectHoistedNodes 只沿节点的 children/elements 下钻，IF 节点只有 branches 字段，扫描根本走不进去；第二份的 span 住在 div 块的 children 数组里，被正常扫到并提升。同一个「静态 span 为什么这份升那份不升」的疑问，答案在树的结构而不在 span 自己。

**嵌套三元是怎么拼出来的。** `(a) ? A : (b) ? B : C` 不是一次写成的，是 genIf 按分支逐段 push 出来的。先把源码摆上：

```ts
// packages/compiler-core/src/codegen.ts —— genIf 与 genIfBranch（节选）
function genIf(node: IfNode, context: CodegenContext) {
  if (!node.branches.length) {
    context.push(`${context.helper(CREATE_COMMENT)}("v-if", true)`)
    return
  }
  genIfBranch(node.branches[0], context)
  for (let i = 1; i < node.branches.length; i++) {
    context.push(` : `)
    genIfBranch(node.branches[i], context)
  }
  // 最后一个分支若还有 condition（即没有裸 v-else）→ 补注释兜底（真 Vue 同款）
  const last = node.branches[node.branches.length - 1]
  if (last.condition) {
    context.push(` : ${context.helper(CREATE_COMMENT)}("v-if", true)`)
  }
}

function genIfBranch(branch: IfBranchNode, context: CodegenContext) {
  const { condition, children } = branch
  const child = children[0] as ElementNode
  const genBranchContent = () => genNode(child.codegenNode, context)

  if (condition) {
    context.push(`(`)
    context.push((condition as any).content.trim())
    context.push(`) ? `)
    genBranchContent()
  } else {
    // v-else 无 condition，只输出内容
    genBranchContent()
  }
}
```

以第一份产物的 branches 为例，条件依次是 list.length、fallback、undefined。用 A、B、C 代称三个分支元素的产物，code 缓冲区逐步长成：

| 步骤 | 动作 | 缓冲区此刻的内容 |
|---|---|---|
| 1 | genIfBranch(branches[0])：push `(list.length) ? `，再输出 ul 的 codegenNode | `(list.length) ? A` |
| 2 | 循环 i=1：push ` : `；genIfBranch(branches[1]) push `(fallback) ? ` 与 p 的内容 | `(list.length) ? A : (fallback) ? B` |
| 3 | 循环 i=2：push ` : `；else 分支无 condition，只输出 span 的内容 | `(list.length) ? A : (fallback) ? B : C` |
| 4 | 末分支 condition 为 undefined | 不追加注释兜底，生成结束 |

把 A、B、C 换回真实产物，得到的正是前文那行 return，逐字符一致（实测对照）。链尾没有 v-else 时走的是另一步：末分支 condition 存在，表末再追加 ` : _createCommentVNode("v-if", true)`，即 `<div v-if="ok">a</div>` 那份产物的形态。genIfBranch 里每个条件都被 push 了括号，`(list.length)` 的括号来自源码里的两行字面量，不是运算符优先级的巧合。

为什么逐段 push 能拼出合法的嵌套三元？因为 JavaScript 的条件表达式本就右结合：`a ? A : b ? B : C` 解析为 `a ? A : (b ? B : C)`，else 臂可以原样容纳下一个完整三元。genIf 每轮循环往缓冲区尾部接一个 ` : ` 加新分支，天然长成右结合的形状，一个额外括号都不需要。

树拼成了字符串，但字符串还不是函数。下一节完成最后一跳，并把编译器正式接进运行时。

## 10.3 最后一跳：compileToFunction

聚合包 `vue` 的入口只有三十行，核心是这一个函数：

```ts
// packages/vue/src/index.ts
export function compileToFunction(template: string, options?: CompilerOptions & { onError?: (e: any) => void }) {
  const { code } = compile(template, options)
  const render = new Function('Vue', code)(runtimeDom)

  ;(render as any)._rc = true // 标记为编译产物（供调试/测试识别）
  return render
}

// 注册运行时编译器：让 `template: "..."` 选项可用（与真 Vue 的 config.compiler 语义一致）
registerRuntimeCompiler(compileToFunction)
```

`new Function('Vue', code)` 构造一个形参名为 Vue 的函数，并立即以整个 `runtime-dom` 聚合模块调用它。产物顶部的 `const { … } = Vue` 解构正是在消费这个形参——上一节说的「编译器只产出符号名」，由这一行落地为运行时模块的具名导出，不需要任何打包期的模块拼接。`_rc = true` 给产物盖一个「我是编译出来的」标记，供调试与测试识别。

`registerRuntimeCompiler` 的接线横跨三个包，三步走完。runtime-core 用模块级变量持有编译器：

```ts
// packages/runtime-core/src/apiCreateApp.ts（节选）
let runtimeCompiler: ((template: string, options?: any) => any) | undefined
export function registerRuntimeCompiler(fn: (template: string, options?: any) => any) {
  runtimeCompiler = fn
}
```

创建应用上下文时，`config.compiler` 填入它；组件安装的 `finishComponentSetup` 里，渲染函数按优先级取用：

```ts
// packages/runtime-core/src/component.ts —— finishComponentSetup 中 render 的来源（节选）
    } else if (Component.template && instance.appContext.config.compiler) {
      // 模板字符串 → 运行时编译（@mini-vue/vue 注入的 compiler）
      instance.render = instance.appContext.config.compiler(Component.template)
    }
```

为什么绕这一圈，而不让 runtime-core 直接 import 编译器包？因为依赖必须单向：runtime-core 是渲染核心，编译器是它的可选拼装件。编译能力由聚合包在初始化时注入，runtime-core 对编译器包零感知。`template:` 选项由此可用——`packages/vue/__tests__/compileToFunction.spec.ts` 里每个用例都是 `createApp({ template: '...' })` 形态，从模板到挂载、更新、事件、v-model 走的是完整闭环。

至此，编译器的三段全部走完，第 9 篇开头那张流程图的最后一格填上了。全章串起来读：transform 用双阶段遍历把声明式的树折叠成带 codegenNode 的中间形态，codegen 把它拼成源码字符串，compileToFunction 用 `new Function` 把字符串变成函数。编译器与运行时只在两处握手：helper 符号名单与注册表注入。

## 本章小结

transform 以进入/退出双阶段遍历改写 AST：进入钩子可替换节点（v-if 折叠为 IF、v-for 剖别名后替换为 FOR），退出钩子在子树处理完后逆序执行，顺序语义由注册顺序与逆序共同保证。v-else 靠 parent 与 childIndex 回链，摘除延迟到退出阶段并用身份查找规避陈旧下标。codegen 把树拼成源码字符串，helper 解构是与运行时的全部耦合，`with (_ctx)` 让模板表达式零改写直出——官方构建期用 prefixIdentifiers 替代它，浏览器运行时同样退回 with。compileToFunction 以 `new Function('Vue', code)` 完成实例化，registerRuntimeCompiler 把编译能力注入运行时，`template:` 选项由此可用。

## 仓库文件索引

- `packages/compiler-core/src/transform.ts` —— traverseNode 双阶段遍历、TransformContext（currentNode/childIndex/replaceNode/removeNode）
- `packages/compiler-core/src/transforms/transformIf.ts` —— createStructuralDirectiveTransform 包装器、processIf（IF 折叠、v-else 回链、身份查找摘除）
- `packages/compiler-core/src/transforms/transformFor.ts` —— forAliasRE 剖分、FOR 节点替换、parseForExpression
- `packages/compiler-core/src/transforms/transformElement.ts`、`transforms/transformText.ts` —— 退出钩子的两大居民：codegenNode 构造、文本合并
- `packages/compiler-core/src/transforms/transformExpression.ts` —— with 方案下的 no-op，prefixIdentifiers 的保留入口
- `packages/compiler-core/src/codegen.ts` —— generate 骨架、genIf 嵌套三元、genFor、genExpression
- `packages/compiler-core/src/compile.ts` —— baseCompile 编排与 nodeTransforms 注册顺序
- `packages/vue/src/index.ts` —— compileToFunction 与 registerRuntimeCompiler 注入
- `packages/vue/__tests__/compileToFunction.spec.ts` —— 「模板 → 编译 → 挂载 → 更新」端到端锚定

## 与官方实现的差距

- **表达式方案**：官方构建期（compiler-sfc / module 模式）用 prefixIdentifiers 借 babel 改写裸标识符为 `_ctx.foo`，产物无 with、兼容严格模式与 CSP；浏览器运行时编译器与本实现同样退回 `with (_ctx)`（`third_party/vue-core` 的 `codegen.ts` 第 304 行 `useWithBlock` 判定与 `transformExpression.ts` 头注释，均已核对）。mini 只有 with 一条路：transformExpression 是空操作，产物依赖 with 加 `new Function`，两者都被严格 CSP 禁止。
- **产物模式**：官方有 module（顶部 `import { … } from "vue"`）与 function（`const { … } = Vue`）两种产物形态；mini 只有 function 形态。
- **v-for 剖分的位置与命名**：官方在 parse 阶段就剖好表达式，挂 `forParseResult`（`parser.ts`），别名映射是 `{ value, key, index }`——第二位是 key、第三位是 index；mini 在 transform 里剖，第二位命名 index、第三位命名 key。两者都按出现顺序生成回调参数，`v-for="(item, i) in list"` 产物一致。官方的 forAliasRE 末段是 `(\S[\s\S]*)`，首字符非空白，比 mini 的 `([\s\S]*)` 略挑剔。
- **无 compiler-sfc 与 SSR**：官方另有 `.vue` 单文件编译与 SSR 编译两个包，mini 明确不做（第 0 篇已列为简化）。

## 动手验证

```bash
npx vitest run packages/vue   # 24 例全绿（compileToFunction 19 + optimization 5）
```

再亲手把产物打出来。仓库根目录建 `tmp-dump-codegen.ts`：

```ts
import { compile, compileToFunction } from './packages/vue/src/index'

// ① 两步的第一步：compile 只拿源码字符串
const { code } = compile('<div v-if="ok">{{ msg }}</div><p v-else>none</p>')
console.log(code)

// ② 第二步：compileToFunction 把字符串变成函数并直接调用
const render = compileToFunction('<p class="t">{{ msg }}</p>')
const vnode: any = render({ msg: 'hello' }, [])   // 第一参是 _ctx，第二参是 _cache
console.log(vnode.type, JSON.stringify(vnode.props), JSON.stringify(vnode.children))
```

```bash
npx esbuild tmp-dump-codegen.ts --bundle --format=esm --outfile=/tmp/dump.mjs --log-level=error
node /tmp/dump.mjs
```

预期输出（已实测）：① 打印 10.2 同款产物，return 行是 `(ok) ? _createElementVNode("div", null, _toDisplayString(msg), 1) : _createElementVNode("p", null, "none", -1)`；② 打印 `p {"class":"t"} "hello"`——返回的 vnode 与第 5 篇手工构造的同构，把它交给 `createApp` 挂载，响应式更新链路即自动接上。把模板换成 10.2 的三分支加 v-for，应得到嵌套三元加 `_renderList` 的那一份。

10.1 那两张 trace 表也可以亲手复现。核心是把六个变换各自包一层打点（约二十行），再按 compile.ts 的顺序传给 transform：

```ts
// tmp-trace.spec.ts 放进 packages/compiler-dom/__tests__（用完可删），nodeTransforms 与 compile.ts 同序
import { baseParse, transform, transformIf, transformFor, transformExpression,
         transformSlotOutlet, transformElement, transformText } from '@mini-vue/compiler-core'
import { parserOptions } from '../src/parserOptions'

const wrap = (name: string, t: any) => (node: any, ctx: any) => {
  const onExit = t(node, ctx)
  console.log(`进入 ${name} @ ${node.type}/${node.tag ?? ''}`)
  return onExit ? () => { console.log(`退出 ${name}`); onExit() } : undefined
}
const ast: any = baseParse('<div><p v-if="ok">{{ msg }}</p><span>hi</span></div>', parserOptions)
transform(ast, { nodeTransforms: [
  wrap('transformIf', transformIf), wrap('transformFor', transformFor),
  wrap('transformExpression', transformExpression), wrap('transformSlotOutlet', transformSlotOutlet),
  wrap('transformElement', transformElement), wrap('transformText', transformText),
] })
console.log(ast.helpers.map((h: symbol) => h.description))   // 登记顺序，与产物首行一致
```

两个实测要点。baseParse 必须传 compiler-dom 的 parserOptions，否则所有标签都按组件处理，helpers 里会多出 resolveComponent 与 createVNode。`ast.helpers` 是 Set 转出的数组，顺序即插入序，拿它与产物首行解构逐项比对即可验证 10.2 的对账表。

## 延伸阅读

- 官方文档：[渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html)（渲染管线三阶段与编译优化的官方视角）
- core 源码：`vuejs/core` 的 `packages/compiler-core/src/transform.ts` 与 `codegen.ts`（双阶段遍历与两种产物形态的官方实现）
- 《Vue.js 设计与实现》15.4–15.6 节（transform 的双阶段设计、代码生成与 compileToFunction）

> 下一篇：编译器其实已经知道哪里是静态、哪里是动态——补丁标记、静态提升、区块，怎么把这些信息打包交给渲染器抄近路。
