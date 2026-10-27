# 09 · parse 状态机：模板字符串如何被啃成 AST

前八篇把运行时垒完了：响应式回答「何时重跑」，渲染器回答「差异怎么落到 DOM」，组件回答「状态与生命周期怎么组织成一个自治单元」。但写真实应用时，交给框架的既不是 effect 也不是 `h()`，而是一段模板字符串。浏览器从不认识 `v-if` 和 `{{ }}`，它眼里的模板只是一串字符。把这串字符变成程序能遍历的树，是编译器第一段的工作，也是本章的主题。

本章从手写一个正则版解析器开始，先看它在哪里翻车，再进入仓库的 `compiler-core`，看状态机如何一小口一小口把模板啃成 AST。过程中会依次回答四个问题：`<div v-if="ok">{{ msg }}</div>` 怎么变成一棵可遍历的树？为什么不用一个大正则全文匹配？`<script>` 里的 `{{ }}` 为什么不能当插值？写错一个下标会发生什么？

## 9.1 朴素正则为什么不行

任务听起来不复杂：把模板变成嵌套的对象树。最直觉的思路是一个正则全局匹配——标签一个 token、插值一个 token、剩下的都是文本，再用一个栈把 token 拼成树。手写出来不到三十行：

```js
// —— 手写朴素版，仅用于演示 ——
const TOKEN_RE = /<\/?[a-zA-Z][^>]*>|{{[\s\S]*?}}|[^<]+/g

function naiveParse(template) {
  const tokens = template.match(TOKEN_RE) || []
  const root = { type: 'root', children: [] }
  const stack = [root]
  for (const token of tokens) {
    const parent = stack[stack.length - 1]
    if (token.startsWith('</')) {          // 结束标签：弹栈
      stack.pop()
    } else if (token.startsWith('<')) {    // 开始标签：建节点、压栈
      const tag = token.slice(1).split(/[\s/>]/)[0]
      const el = { type: 'element', tag, children: [] }
      parent.children.push(el)
      if (!token.endsWith('/>')) stack.push(el)
    } else if (token.startsWith('{{')) {   // 插值
      parent.children.push({ type: 'interp', content: token.slice(2, -2).trim() })
    } else {                               // 文本
      parent.children.push({ type: 'text', content: token })
    }
  }
  return root
}
```

整体流程：`match` 切出 token 流，遍历时结束标签弹栈、开始标签压栈，`{{ }}` 与纯文本各自挂到栈顶节点上。跑两个例子——嵌套的 `<div><p>hi</p></div>`、带指令与插值的 `<div v-if="ok">{{ msg }}</div>`——都得到正确形状的树：

```js
naiveParse('<div v-if="ok">{{ msg }}</div>').children
// [{ element div, children: [{ interp 'msg' }] }]
```

输出里那棵嵌套对象，正是本章的目标产物：AST（Abstract Syntax Tree，抽象语法树），模板的结构化表示。仓库版只是给每个节点加上统一的 type 编号，见 `packages/compiler-core/src/ast.ts` 的 `NodeTypes` 枚举——ROOT、ELEMENT、TEXT、INTERPOLATION、ATTRIBUTE、DIRECTIVE 等。

简单例子全部能过，但这恰恰是假象。为什么？因为挑例子的我们自己回避了边角。往输入里加一点真实世界的杂质，三处硬伤立刻现形。

**硬伤一：嵌套没有记忆。** 正则把 `</div>` 吞进 token 列表时，不知道它该关谁——这份「此前开过哪些标签」的记忆，正则给不了。朴素版用栈补上了，但弹栈不核对名字：`naiveParse('<div><p>hi</p></span>Oops')` 静默产出与正确输入同形的树，"Oops" 落到根上，没有任何报错。

把断言跑出来看（node 实测，dump 按 type 缩进打印）：

```text
naiveParse('<div><p>hi</p></span>Oops')
tokens: ['<div>', '<p>', 'hi', '</p>', '</span>', 'Oops']
root
  element div
    element p
      text "hi"
  text "Oops"
```

`</span>` 弹掉的是 div 的栈帧（弹栈只 pop、从不核对名字），Oops 于是挂到根上；栈里剩下的帧与输入里的错位全部被静默吞掉。

**硬伤二：不懂区域。** HTML 不同区域规则不同，`<script>` 内部是纯文本。实测 `naiveParse('<script>if (a <b && c > 2) {}</script>')` 把 `<b && c >` 当成了标签，树里多出一个 element b。`<textarea>` 里的 `{{ }}` 会被当插值——它算不算插值取决于外围标签，正则看不见外围。

同样实测：

```text
naiveParse('<script>if (a <b && c > 2) {}</script>')
tokens: ['<script>', 'if (a ', '<b && c >', ' 2) {}', '</script>']
root
  element script
    text "if (a "
    element b
      text " 2) {}"
```

`<b && c >` 被整个当成标签 token，树里多出 element b。再往细看还有一层错位：`</script>` 弹掉的是 b 的栈帧，script 自己直到结束都没被关上——朴素版对此同样一声不吭。

**硬伤三：错误无处报。** `match` 失败只返回 null；第几个字符出了什么问题，一概不知。而编译器的本职之一，就是把「`<div>` 少写了关闭标签」报成带位置的错误。

三处硬伤指向同一个根因：正则描述的是正则语言，天生没有「已开标签」的上下文；配对嵌套属于上下文无关结构，需要状态机加一个栈。仓库的 `parse.ts` 正是这两样：一条滚动源加光标，一个 `ancestors` 栈，再配一套区域档位 TextModes。展开之前，先把编译器全景摆正。

```text
"<div v-if=\"ok\">{{ msg }}</div>"（模板字符串）
   │  parse —— 状态机滚动啃食，产出 AST（本章）
   ▼
AST（ELEMENT / TEXT / INTERPOLATION / DIRECTIVE … 节点树）
   │  transform —— 遍历改写：v-if 折叠、v-for 包装（下一篇）
   ▼
"return function render(_ctx) { … }"（codegen 拼源码，下一篇）
```

编排这三段的是 `packages/compiler-core/src/compile.ts` 的 `baseCompile`。本章只走第一段。下一节我们先认识状态机里唯一的核心状态——那条越啃越短的滚动源。

## 9.2 滚动源与光标：advanceBy

仓库解析器的全部状态收敛在一个对象上：

```ts
// packages/compiler-core/src/parse.ts（节选）
export interface ParserContext {
  source: string
  options: ParserOptions
  // 定位信息（mini 简化：只维护 offset）
  offset: number
}

function advanceBy(context: ParserContext, numberOfCharacters: number): void {
  const { source } = context
  context.source = source.slice(numberOfCharacters)
  context.offset += numberOfCharacters
}
```

走读一下。`source` 永远指向「还没解析的部分」，`offset` 记录已经吃掉了多少个字符——它是报错定位的全部依据。`advanceBy` 只做两件事：把 source 切短、把 offset 累加。入口 `baseParse` 也就三行实事：建 context、从 DATA 档起跑 `parseChildren(context, [], TextModes.DATA)`、把结果装进 ROOT 节点。

用 `<p>{{ msg }}</p>` 演一遍：初始 source 是全文、offset 0。元素解析吃掉 `<p>` 后，source 变成 `{{ msg }}</p>`，offset 是 3。往后每个函数看到的「开头」，永远就是下一个该解析的东西。

单层不过瘾，换嵌套模板 `<div><p>{{ msg }}</p></div>` 从头啃到尾。下表每行对应一次 advanceBy，中间状态在 parse.ts 的带打印副本上实测采得（模板无空白，advanceSpaces 一次都没触发）：

| # | 调用方 | 吃掉 | 吃完后 source | offset | 此刻产出 |
|---|--------|------|---------------|--------|----------|
| 1 | parseTag（div 开始标签名） | `<div` | `><p>{{ msg }}</p></div>` | 4 | — |
| 2 | parseTag（div 的 `>`） | `>` | `<p>{{ msg }}</p></div>` | 5 | ELEMENT div（无属性） |
| 3 | parseTag（p 开始标签名） | `<p` | `>{{ msg }}</p></div>` | 7 | — |
| 4 | parseTag（p 的 `>`） | `>` | `{{ msg }}</p></div>` | 8 | ELEMENT p |
| 5 | parseInterpolation（定界开） | `{{` | ` msg }}</p></div>` | 10 | — |
| 6 | parseInterpolation（内容） | ` msg ` | `}}</p></div>` | 15 | — |
| 7 | parseInterpolation（定界闭） | `}}` | `</p></div>` | 17 | INTERPOLATION msg |
| 8 | parseTag（p 结束标签名） | `</p` | `></div>` | 20 | — |
| 9 | parseTag（p 结束的 `>`） | `>` | `</div>` | 21 | p 收口，children 为 [插值] |
| 10 | parseTag（div 结束标签名） | `</div` | `>` | 26 | — |
| 11 | parseTag（div 结束的 `>`） | `>` | ``（空串） | 27 | div 收口，isEnd 因 !s 成立 |

表里有三处值得停。第 2、4 行：标签名正则只吃名字，`>` 由 parseTag 的属性循环单独吃——一个开始标签永远占两次推进。第 8 行：结束标签的正则带着 `\/?`，斜杠一并吃进 `</p`，所以吃 3 个字符后剩下的开头是 `>` 而不是 `</div>`——这是手工推演最容易算错的一位。第 5 到 7 行：插值的三段推进各自独立，第 6 行吃的 ` msg ` 还带着两侧空格（trim 之前的样子），9.3 的「下标回扣」正发生在第 5、6 两步之间。

再给模板加一个属性，看 parseAttribute 与 advanceSpaces 怎么进这张表。`<p class="a">{{ x }}</p>` 实测共 12 次推进，摘属性区那一段：

| # | 调用方 | 吃掉 | 吃完后 source（节选） |
|---|--------|------|----------------------|
| 1 | parseTag（标签名） | `<p` | ` class="a">{{ x }}</p>` |
| 2 | advanceSpaces | ` `（一个空格） | `class="a">{{ x }}</p>` |
| 3 | parseAttribute（属性名） | `class` | `="a">{{ x }}</p>` |
| 4 | parseAttribute（等号） | `=` | `"a">{{ x }}</p>` |
| 5 | parseAttributeValue（开引号） | `"` | `a">{{ x }}</p>` |
| 6 | parseAttributeValue（值加闭引号） | `a"` | `>{{ x }}</p>` |
| 7 | parseTag（`>`） | `>` | `{{ x }}</p>` |

属性区的节奏有讲究：属性名与等号各自单独推进；开引号一次，值与闭引号却合并成一次——parseAttributeValue 按 `content.length + 1` 一口吃掉，闭引号不单独占行。第 6 行之后、第 7 行之前 advanceSpaces 跑过但无空白可吃，推进数为零。往后的插值与结束标签和上一张表同构。

为什么让字符串自己变短，而不是记「起始位置加两个下标」？因为每个解析函数只关心开头：`s[0] === '<'`、`startsWith('{{')` 这类判断都落在 source 头上，切短之后全体函数共用同一条基准线。不过要诚实地说，滚动源消灭的是「当前从哪开始」的歧义，消灭不了「某个下标属于哪次推进之前」的歧义——9.3 的第一个翻车案例正是后者。

到这里可以给协议了：**任何解析函数的协议都是「读 source 开头、吃掉一段、推进光标」**，推进统一走 `advanceBy`，旁路修改 source 会让 offset 与内容失去同步。光标有了，下一节看主循环怎么用它分流。

## 9.3 主循环：看开头分流

`parseChildren` 的主循环几乎就是 parse 的全部逻辑。每次迭代只看 source 开头一两个字符：

```ts
// packages/compiler-core/src/parse.ts —— parseChildren 主循环（节选）
  while (!isEnd(context, ancestors)) {
    const s = context.source
    let node: TemplateChildNode | undefined
    if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
      if (s[0] === '<') {
        if (s[1] === '!') {
          // ……（略）注释与 DOCTYPE：定位结束符后整段跳过
        } else if (s[1] === '/') {
          // 错误处理到这里就 break
          break
        } else {
          node = parseElement(context, ancestors)
        }
      }
    }
    if (!node) {
      node = parseInterpolation(context, mode) || parseText(context, mode)
    }
    if (node) {
      children.push(node)
    }
  }
```

分派规则：`<` 打头看第二个字符——`!` 是注释或 DOCTYPE，`/` 是关闭标签，字母则交给 `parseElement` 递归下沉。`<` 没接住的 source 再交给 `parseInterpolation`，它只认 `{{` 开头；最后兜底的 `parseText` 按「下一个 `<` 或 `{{`」切出文本。循环结束后一行 `children.filter(...)` 把注释节点全部丢弃。为什么看一两个字符就够分流？因为 HTML 的语法类别恰由前缀决定，其余内容只可能是文本。

循环的终止交给 `isEnd`，返回 true 的路径有两条：其一，滚动源耗尽（`!s`）；其二，源开头是 `</` 且能配上栈里某个祖先。第二条是嵌套的回收机制：内层 `parseChildren` 遇到 `</div>` 停手不吃，把关闭标签留在原地给外层的 `parseElement` 消费。为什么从栈顶往下扫而不是只看栈顶？因为关闭标签配的不一定是栈顶——`<div><p></div>` 这类笔误里它配的是栈底；扫全栈让本层及时收手，精确报错交给上层。

```ts
// packages/compiler-core/src/parse.ts —— isEnd（节选）
function isEnd(context: ParserContext, ancestors: ElementNode[]): boolean {
  const s = context.source
  if (s.startsWith('</')) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (startsWithEndTagOpen(s, ancestors[i].tag)) {
        return true
      }
    }
  }
  return !s
}
```

主循环短小，但仓库开发时在插值解析里真实翻过两次车。

**翻车一：下标回扣。** `parseInterpolation` 找 `}}` 的下标时，source 还带着 `{{` 前缀；找到后先 `advanceBy` 吃掉 `{{`，source 变短了两个字符：

```ts
// packages/compiler-core/src/parse.ts —— parseInterpolation（节选）
  const closeIndex = context.source.indexOf(close, open.length)
  if (closeIndex === -1) {
    // 未闭合插值：抛错而非 return undefined —— 否则 parseText 对 `{{` 开头且无 `}}` 的源
    // advanceBy(0) 原地空转、主循环永不前进，同步死循环直到 OOM。
    throw createCompilerError(ErrorCodes.X_MISSING_INTERPOLATION_END, getCursor(context))
  }
  const start = getCursor(context)
  // closeIndex 是在「尚未 advance」的源串上算的；advance 掉 `{{` 后
  // close 的实际位置是 closeIndex - open.length（经典 mini-vue 也踩过这坑）
  advanceBy(context, open.length)
  const rawContent = context.source.slice(0, closeIndex - open.length)
```

拿 `{{ msg }}` 演算：`closeIndex` 在原串上是 7。吃掉 `{{` 后 source 是 ` msg }}`，内容应为 ` msg `，即 `slice(0, 7 - 2)`。若忘了回扣直接 `slice(0, closeIndex)`，得到 ` msg }`——闭界定界的第一个字符被吞进表达式，编译产物从此悄悄错位。这类「推进后复用旧下标」的错位是状态机解析的惯犯，判别方法只有一个：每个下标都问一句它属于哪次推进之前的源串。

**翻车二：未闭合插值的死循环。** 找不到 `}}` 时若返回 undefined 会怎样？`parseText` 接手 `{{ msg</div>`，但 DATA 模式的文本在 `{{` 处切断，得到零长度文本、零推进。主循环拿到节点继续下一轮，source 分毫未动，children 数组无限塞进空文本节点——同步死循环直到内存耗尽。这是仓库真实修过的一次 OOM，修法就是上面那行抛错：`X_MISSING_INTERPOLATION_END`（错误码 27），用测试锚死：

```ts
// packages/compiler-core/__tests__/compiler.spec.ts（节选）
  it('throws (not hangs) on unterminated interpolation', () => {
    // 修复前 `{{` 无 `}}` 会让 parse 同步死循环 OOM；现在应迅速抛编译错误
    expect(() => baseParse(`<div>{{ msg</div>`)).toThrow(/compiler error/)
  })
```

主循环把 `<` 打头的分支交给了 `parseElement`。下一节跟着它下沉一层，顺带解开 `<script>` 之谜。

## 9.4 递归下降与语法模式

`parseElement` 的节奏是标准的递归下降，四拍子：

```ts
// packages/compiler-core/src/parse.ts —— parseElement（节选）
function parseElement(context: ParserContext, ancestors: ElementNode[]): ElementNode | undefined {
  const start = getCursor(context)
  const parent = ancestors[ancestors.length - 1] || null
  const element = parseTag(context, { isRoot: parent === null })
  // ……（略）自闭合 / void 元素：element.isSelfClosing 或 isVoidTag 命中时直接 return

  ancestors.push(element)
  const mode = getRawTextOrRcDataMode(element.tag) || TextModes.DATA
  element.children = parseChildren(context, ancestors, mode) as any
  ancestors.pop()

  // 结束标签
  if (startsWithEndTagOpen(context.source, element.tag)) {
    parseTag(context, { isRoot: parent === null })
  } else {
    // ……（略）抛 X_MISSING_END_TAG（错误码 26），带 start 定位
  }

  return element
}
```

第一拍 `parseTag` 用正则取标签名，再循环调 `parseAttribute` 逐个吃属性，直到 `>` 或 `/>`。第二拍把自己压进 `ancestors`。第三拍按标签选定语法模式，递归 `parseChildren` 解析孩子。第四拍弹栈、吃掉关闭标签；配不上就抛 `X_MISSING_END_TAG`（错误码 26）。为什么要压栈？因为内层 `isEnd` 必须知道「我在谁的肚子里」，`ancestors` 就是从根到当前元素的路径。

`parseTag` 循环里的 `parseAttribute` 负责把四种指令写法归一。识别看首字符或 `v-` 前缀（`directiveRE = /^v-([a-zA-Z0-9-_]+)/`）：

```ts
// packages/compiler-core/src/parse.ts —— parseAttribute 指令的识别与拆分（节选）
const isDirective =
  name[0] === ':' || name[0] === '@' || name[0] === '#' || directiveRE.test(name)

if (isDirective) {
  let dirName: string
  let argContent = ''
  let modifiers: string[] = []

  if (name[0] === ':') {
    dirName = 'bind'
    argContent = name.slice(1)
  } else if (name[0] === '@') {
    dirName = 'on'
    // ……（略）argContent = name.slice(1)；# → slot 分支与此同构
  } else {
    const m = directiveRE.exec(name)!
    dirName = m[1]
    // 解析 arg 与 modifiers：v-on:click.once → name 'on', arg 'click', modifiers ['once']
    const afterDirective = name.slice(m[0].length) // ':click.once'
    // ……（略）冒号后取 arg，再按 `.` 拆 modifiers；`:click.once` 缩写路径另有兜底拆分
  }

  return {
    type: NodeTypes.DIRECTIVE,
    // ……（略）name: dirName、exp/arg 包成表达式节点、modifiers 原样挂上
  } as any
}
```

缩写前缀展开成全名：`:` 是 bind、`@` 是 on、`#` 是 slot。全名路径先取指令名，剩余部分冒号取参数、点号拆修饰符。实测 `<button v-on:click.once="h">` 解析出 `name='on'`、`arg='click'`、`modifiers=['once']`；`:class="c"` 解析出 `name='bind'`、`arg='class'`（测试锚定见 compiler.spec.ts）。至此 transform 见到的都是规范化指令名，语法糖在 parse 阶段就消化完了。

两条路径的中间态值得逐格摆开。先看全名 `v-on:click.once="h"`：

| 步 | 动作 | 值 |
|---|------|-----|
| 0 | 属性名正则一口气吃掉整段名字 | name = `v-on:click.once` |
| 1 | 遇 `=`，parseAttributeValue 取引号内 | value.content = `h` |
| 2 | directiveRE 命中前缀 | m[0] = `v-`、m[1] = `on` → dirName = `on` |
| 3 | 名字剥掉前缀 | afterDirective = `:click.once` |
| 4 | `/^:([^:]+)/` 吃参 | argContent = `click` |
| 5 | `/^:([^.]+)(.*)/` 的第二组按点拆 | modifiers = `['once']` |
| 6 | 组装 DIRECTIVE 节点 | name='on'、arg='click'、exp='h'、modifiers=['once'] |

再看缩写 `:class="c"`：name[0] 是 `:`，第一分支两步到位——dirName 为 'bind'、argContent 为 'class'，modifiers 为空，全名路径的 3 至 5 步全省。缩写还能带修饰符：`@click.once` 走 `@` 分支拿到 argContent 为 `click.once`，靠函数末尾的兜底段（argContent 含点就拆开）补出 modifiers 为 ['once']。三条路径殊途同归，产出与全名逐字段一致（实测对拍）。

最后一块拼图：`parseElement` 第三拍里的「按标签选模式」。这就是 `<script>` 之谜的答案：

```ts
// packages/compiler-core/src/parse.ts（节选）
const enum TextModes {
  DATA,
  RCDATA,
  RAWTEXT,
  CDATA,
  ATTRIBUTE_VALUE,
}

function getRawTextOrRcDataMode(tag: string): TextModes | undefined {
  if (tag === 'textarea' || tag === 'title') {
    return TextModes.RCDATA
  }
  if (tag === 'style' || tag === 'script') {
    return TextModes.RAWTEXT
  }
  return undefined
}
```

三档实际生效。DATA 是普通 HTML 区域，`<` 与 `{{` 都有语法含义。RAWTEXT 对应 `script`/`style`：里面的一切都是文本。RCDATA 对应 `textarea`/`title`：插值仍有效。实测对比一目了然——`<textarea>{{ msg }}</textarea>` 解析出插值节点；`<script>{{ msg }}<div></script>` 解析出 text 为 `"{{ msg }}<div>"` 的单个文本节点。

三档再各配一段完整模板与实测产出（baseParse 后打印 AST）：

```text
DATA     <p>a {{ x }} b</p>
         → ELEMENT p [ TEXT "a " · INTERP x · TEXT " b" ]        '<' 与 '{{' 都会切断文本

RCDATA   <textarea rows="3">{{ msg }}</textarea>
         → ELEMENT textarea [ ATTRIBUTE rows="3" · INTERP msg ]  属性区不受模式影响，插值仍有效

RAWTEXT  <style>a { color: red }</style>
         → ELEMENT style [ TEXT "a { color: red }" ]             花括号、冒号全是普通字符
```

这组对照把「同一套主循环、三套切断规则」拍在了明面上：DATA 的文本被 `<` 与 `{{` 切成三段；RCDATA 的属性照常解析（模式只管标签内部的孩子区域），插值继续生效；RAWTEXT 里整段进文本——9.3 主循环的 `<` 分支根本不会走到，因为模式在下钻 parseChildren 之前就已换挡。mini 的 RCDATA 还有个诚实的短板：主循环对 RCDATA 也进 `<` 分支，`<textarea>1 < 2</textarea>` 里的 `< ` 不是字母开头，标签正则失配后抛的是原生 TypeError（实测；官方把这段按文本处理，差距节的 RCDATA 条目说的就是这片边界）。

`<script>` 里的 `{{ }}` 为什么不能当插值？因为 script 里会出现 `a < b` 这类任意字符，浏览器对它的处理就是吃到 `</script>` 为止；解析器必须模拟浏览器，否则就会重演 9.1 里 `<b && c >` 被当标签的车祸。

模式的消费点有三处：9.3 主循环里 `mode === DATA || mode === RCDATA` 才进 `<` 分支；`parseInterpolation` 开头的 `if (mode !== DATA && mode !== RCDATA) return undefined`；以及 `parseText` 的切断符。第二处的源码注释标注着「mini 阶段 5 的欠账修复（对齐真 Vue）」。看切断符：

```ts
// packages/compiler-core/src/parse.ts —— parseText 的切断符（节选）
  const endTokens =
    mode === TextModes.RAWTEXT
      ? ['</'] // RAWTEXT：直到关闭标签前的整段都是文本（'{{'、'<' 视为普通字符）
      : mode === TextModes.RCDATA
        ? ['{{', '</', '<']
        : ['<', '{{'] // DATA：标签 / 插值切
```剩下 CDATA 与 ATTRIBUTE_VALUE 两档是为官方的边角场景预留的位（SVG 外来内容、属性值内实体解码），本仓库解析不会进入。还要诚实交代一处差距：mini 的 RCDATA 仍会进 `<` 分支，`<textarea><p></textarea>` 会抛 X_MISSING_END_TAG，与官方「textarea 内容全是文本」不同，详见章末。

树啃出来了。但 `<p v-if="ok">` 里的 v-if 此刻只是 props 数组里一个名叫 if 的指令属性，没有人「执行」它。下一篇的 transform 接手：把它折叠成真正的条件结构。

## 本章小结

parse 是一条「滚动源 + 光标」的状态机：`ParserContext.source` 永远指向未解析的部分，`advanceBy` 是唯一推进入口。主循环按开头一两个字符分流到元素、插值、文本，`isEnd` 靠 `ancestors` 栈回收嵌套。递归下降的 `parseElement` 压栈下沉、弹栈收口，`parseAttribute` 把四种指令写法归一成 DIRECTIVE 节点。TextModes 按 textarea、script 等区域切换语法规则。插值处的两处防御——下标回扣与未闭合抛错——分别挡住了内容错位与同步死循环。

## 仓库文件索引

- `packages/compiler-core/src/parse.ts` —— 本章全部：ParserContext、advanceBy、parseChildren、isEnd、parseElement、parseAttribute、TextModes
- `packages/compiler-core/src/ast.ts` —— AST 节点类型与工厂函数（NodeTypes、ElementTypes）
- `packages/compiler-core/src/errors.ts` 与 `__tests__/compiler.spec.ts` —— 错误码定义（26/27）；parse 七例加 transform/codegen 六例的行为锚定

## 与官方实现的差距

- **结构**：官方 3.5 把解析拆成 `tokenizer.ts` 加 `parser.ts`，tokenizer 产出事件、parser 组装 AST（本地 `third_party/vue-core` v3.5.43 核对）；mini 是单文件状态机。mini 的 TextModes 五档承自官方拆分前的 parse.ts，拆分后官方改用 tokenizer 内部 State 加 `inRCDATA` 标志。
- **实体解码**：官方 `compiler-dom` 在浏览器构建注入 `decodeHtmlBrowser` 做实体解码；mini 的 `decodeEntities` 恒等返回（`packages/compiler-dom/src/parserOptions.ts`），`&amp;` 原样进 AST。
- **注释与错误恢复**：官方按 `options.comments`（默认 DEV 环境）决定保留注释节点；mini 解析后一律丢弃。官方错误走 `onError` 回调，`onend` 逐层补报未闭合标签并收尾，换成收集器还能继续解析；mini 结束标签缺失直接抛。
- **定位**：官方 `getLoc` 维护行列且 codegen 支持 sourceMap；mini 只累加 offset，`getCursor` 的 line、column 是占位值。
- **RCDATA 行为**：官方 textarea/title 内的标签按文本处理；mini 的 RCDATA 档仍进 `<` 分支，`<textarea><p></textarea>` 会抛错（本章实测）。

## 动手验证

```bash
npx vitest run packages/compiler-core   # 13 例全绿（parse 7 + compile 6）
```

再亲手把一棵 AST 打出来。仓库根目录建 `tmp-dump-parse.ts`：

```ts
import { baseParse, NodeTypes } from './packages/compiler-core/src/index'

const dump = (n: any, d = 0): void => {
  const pad = '  '.repeat(d)
  if (n.type === NodeTypes.ELEMENT) {
    console.log(`${pad}ELEMENT <${n.tag}>`)
    for (const p of n.props) console.log(`${pad}  ${p.type === NodeTypes.DIRECTIVE ? 'DIRECTIVE' : 'ATTRIBUTE'} ${p.name}`)
    n.children.forEach((c: any) => dump(c, d + 1))
  } else if (n.type === NodeTypes.TEXT) console.log(`${pad}TEXT ${JSON.stringify(n.content)}`)
  else if (n.type === NodeTypes.INTERPOLATION) console.log(`${pad}INTERP {{ ${n.content.content} }}`)
}
const ast: any = baseParse('<div v-if="ok">{{ msg }}</div>', { isNativeTag: () => true })
console.log('ROOT'); ast.children.forEach((c: any) => dump(c, 1))
```

```bash
npx esbuild tmp-dump-parse.ts --bundle --format=esm --outfile=/tmp/dump.mjs --log-level=error
node /tmp/dump.mjs
```

预期输出（已实测）：

```text
ROOT
  ELEMENT <div>
    DIRECTIVE if
    INTERP {{ msg }}
```

把模板换成 `<script>{{ msg }}<div></script>`，会得到 `ELEMENT <script>` 下单个 `TEXT "{{ msg }}<div>"`——语法模式在起作用。换成本章的两个翻车输入，则分别抛错误码 27 与 26。

## 延伸阅读

- 官方文档：[渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html)（渲染管线三阶段：编译、挂载、更新）
- core 源码：`vuejs/core` 的 `packages/compiler-core/src/parser.ts` 与 `tokenizer.ts`（3.5 拆分后的解析器）
- 《Vue.js 设计与实现》15.2–15.3 节与第 16 章（状态机解析器的构造与文本模式）

> 下一篇：树有了，但 `<p v-if>` 还只是个属性——transform 将遍历这棵树，把结构指令折叠成机器能执行的条件与循环，再交给 codegen 拼出渲染函数源码。
