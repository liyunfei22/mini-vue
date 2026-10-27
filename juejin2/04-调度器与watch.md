# 04 · 调度器与 watch：谁来决定副作用什么时候执行

前三章回答的都是「谁在跑」：副作用登记进账本，数据变化时 trigger 把它们找出来重跑。还有一个维度没碰——**时机**：副作用应该在写入那一瞬就执行，还是等同一轮同步代码改完，还是排在组件重渲染之前或之后？

时机不同，行为完全不同。组件希望「改十次状态只渲染一次」；watch 回调希望拿到旧值与新值；有的回调要赶在渲染前修数据，有的要等 DOM 更新完再量尺寸。于是一串问题等着回答：trigger 通知之后，执行时机由谁决定？watch 的 `flush: 'pre' | 'post' | 'sync'` 把回调安排到了流水线的哪个位置？组件里散落十个 watch 和几个 computed，卸载时谁来统一「关掉」？

本章从 trigger 末尾几行出发，手写一个十行的迷你调度器，再看 watch 如何长在这一个选项上，最后用 effectScope 解决「成组收割」——响应式四篇到此收尾。

## 4.1 交出执行权：scheduler 选项

源头在 trigger 的收尾。收集完所有该通知的副作用后，逐个执行的方式是：

```ts
// packages/reactivity/src/effect.ts —— trigger（节选，收尾）
for (const effect of effects) {
  if (effect.scheduler) {
    // 有调度器（computed / watch / 组件渲染）：交给它决定何时重算
    effect.scheduler()
  } else {
    // 普通副作用：同步立即重跑
    effect.run()
  }
}
```

翻译成一句话：挂了调度器，执行权就交出去；没挂，保持默认——同步立即重跑。调度器从哪来？`effect()` 工厂（同文件）把 options 原样透传：`scheduler` 作为构造参数挂上 ReactiveEffect，其余选项经 `extend` 拷到实例上，其中 `lazy` 会推迟首次执行——4.3 马上要用。为什么 trigger 不干脆写死「全部丢进微任务批量执行」？因为 reactivity 包不认识渲染器。副作用交给谁消费，只有消费者自己知道最佳时机：computed 只想标记失效，组件想进渲染队列，watch 要区分三种 flush。依赖单向的铁律（第 0 章）决定了「时机决策权」必须以选项的形式交出去。选项有了，下一节就把它用起来。

## 4.2 手写最小调度：改三次，只跑一次

先看问题的形态。用默认行为观测一个计数：`effect(() => console.log(state.count))` 创建即执行打印 0；同一轮同步代码改三次，副作用同步重跑三次，1、2、3 各打印一次。中间的 1 和 2 只是过渡态——如果副作用是「渲染组件」，就是同一轮渲染三次、两次白干。能不能合并成一次、只在最后跑？

```js
// —— 手写朴素版，仅用于演示 ——
const queue = new Set()   // 任务池：Set 按引用去重，同一任务进多次只留一份
let flushing = false

function schedule(job) {
  queue.add(job)
  if (flushing) return    // 已安排过刷新，不重复安排
  flushing = true
  Promise.resolve().then(() => {   // 微任务里统一执行
    queue.forEach(j => j())
    queue.clear()
    flushing = false
  })
}
const state = reactive({ count: 0 })
const runner = effect(
  () => console.log(state.count),
  { scheduler: () => schedule(runner) },
)
state.count = 1
state.count = 2
state.count = 3
console.log('同步代码结束')
// 输出：0 → 同步代码结束 → 3（三次触发合并成微任务里的一次补跑）
```

走读一遍：三次赋值各自同步触发一次 `scheduler`；Set 把同一个 runner 去重成一项，`flushing` 保证微任务只安排一次，微任务开始时终值已定，所以只补跑一次。把五个关键时间点的状态记在一张表里，两行状态变量的演变一目了然：

| 时刻 | queue 内容 | flushing | 发生了什么 |
|---|---|---|---|
| effect 创建即执行 | {} | false | `run()` 同步首跑，打印 0（首跑不经过调度） |
| `count = 1` → schedule | {runner} | false → true | 入队；首次发现还没安排刷新，挂一个微任务 |
| `count = 2` → schedule | {runner} | true | Set 按引用去重，queue 不变，也不安排新微任务 |
| `count = 3` → schedule | {runner} | true | 同上 |
| 微任务开始 | {}（跑完清空） | true → false | `runner()` 补跑一次读到 3，打印后复位 |

两次「白来」的 schedule 调用就是全部收益所在：排队只排一次，执行也只执行一次。时序两头拼起来，就是这份代码的真实输出（实测）：

```text
同步阶段（脚本直跑到尾）                微任务阶段（同步栈清空后）
──────────────────────────          ───────────────────────────
打印 0（effect 创建即执行）
count = 1 → schedule：入队、安排微任务
count = 2 → schedule：去重，无事
count = 3 → schedule：去重，无事
打印「同步代码结束」
                                    runner() 补跑：读 count，打印 3
                                    queue.clear()；flushing = false
```

为什么用 Set 不用数组？因为去重要按「任务身份」做，Set 按引用判等，天然合并。为什么放微任务不放宏任务？因为同一轮同步代码的改动在微任务开始前必然完成，看到的一定是终值。

但很明显，这个十行版本还做不到「生产可用」，缺三样东西：

- **排序**：作业没有身份（id），排不出顺序。渲染要求父组件先于子组件（父先创建、uid 更小）。
- **与渲染协作**：pre 回调排在渲染前、post 排在渲染后，孤立的 Set 无从表达「相对渲染的位置」。
- **边界**：刷新期间再入队、作业无限自触发（官方给 100 次上限）、执行出错的隔离。

仓库的 `scheduler.ts` 把这三样全接走了，那是第 8 章的主角。本章只需记住：**组件更新的批处理，建立在本节这一个选项上**；computed 的脏位也在此（第 3 章已见）。scheduler 的三个主要消费者：

| 消费者 | scheduler 里做的事 | 效果 |
|---|---|---|
| 组件渲染 effect（renderer.ts） | `queueJob(update)` 进主队列 | 同组件一轮只渲染一次，父先子后 |
| computed（computed.ts） | 置脏位 + 通知下游 | 不重算，只标记失效 |
| watch（apiWatch.ts） | 按 flush 分流三路 | pre / post / sync 三种时机（下两节） |

下一节看第三行消费者：watch 如何用「effect + scheduler」拼出一个带时机的观察者。

## 4.3 朴素 watch：拿不到旧值的观察者

先不管 flush，把 watch 的骨架手写出来。它无非是「观测一个源，变了就回调」：

```js
// —— 手写朴素版，仅用于演示 ——
function watch(source, cb) {
  effect(
    () => source.value,        // 读源：建立订阅（只支持 ref）
    {
      scheduler() {
        cb(source.value)       // 变了就回调——但拿不到旧值
      },
    },
  )
}
```

能跑，但最扎眼的缺陷是**旧值**：官方的回调签名是 `(newValue, oldValue)`，这里没有旧值可给。补一个闭包变量：

```js
// —— 旧值版：新旧值存进闭包 ——
function watch(source, cb) {
  let oldValue
  const runner = effect(
    () => source.value,
    {
      lazy: true,                 // 不立即执行，先把返回值握在手里
      scheduler() {
        const newValue = runner() // 重跑 getter，此刻的返回值就是新值
        cb(newValue, oldValue)
        oldValue = newValue       // 忘了这行，下一轮的旧值就是错的
      },
    },
  )
  oldValue = runner()             // 首跑一次：记下初始值，不回调
}
```

思路是把 getter 的「求值」和「订阅」拆开：`lazy` 让首次执行握在我们手里，`oldValue = runner()` 拿到初始值；此后每次触发，scheduler 重跑一次 runner 拿新值。这正是仓库 `doWatch` 的骨架。

朴素版很快撞到边界。为什么？因为它对「一轮」没有概念：同一轮同步代码里把 `n.value` 从 1 改到 2 再改到 3，朴素版回调两次——`(2, 1)` 和 `(3, 2)`，过渡态 2 泄漏进了回调。仓库版同一轮只回调一次 `(3, 1)`：scheduler 把 job 合并进队列，微任务里执行时源已是终值。此外它还缺：源只认 ref（getter、响应式对象、多源数组都要归一）；`deep` 深层观测、`immediate`、`once`、`onCleanup` 一个都没有。下一节打开 `doWatch` 逐项看它怎么补。

## 4.4 doWatch 走读：归一化、flush 分流与 once

`doWatch(source, cb, options)` 是四个 watch API 共用的内核。第一步把 source 归一成同一个 getter：

```ts
// packages/runtime-core/src/apiWatch.ts —— doWatch：source 归一化（节选）
if (isRef(source)) {
  getter = () => (source as Ref).value
  forceTrigger = isShallow(source)
} else if (isReactive(source)) {
  // 默认深遍历（读遍全部嵌套属性建立依赖）；deep:false 只遍历浅层
  getter = () => (deep === false ? traverse(source, 1) : traverse(source))
  forceTrigger = true
} else if (isFunction(source)) {
  if (cb) {
    // watch(getter, cb)
    getter = source
  }
} // ……（watchEffect 分支、多源数组与兜底，见源码）
```

ref 直接读 `.value`；getter 原样充当 effect 的 fn。为什么响应式对象要 `traverse`？因为依赖来自「读」——只有把嵌套的每个属性真正读一遍，track 才会逐个登记，深层变化才触得到回调。deep watch 的本质，就是把「读」这件事做完整。

三种形态各跑一个最小例子（导入方式与 apiWatch.spec.ts 一致，可直接放进 vitest 文件，均已实测）：

```js
// —— 形态一：ref 源 ——
const n1 = ref(1)
const log1 = []
watch(n1, (v, o) => log1.push(`ref: ${o} → ${v}`))
n1.value = 2
await nextTick()
console.log(log1)   // ['ref: 1 → 2'] —— 新旧值都是解包后的数字
```

```js
// —— 形态二：getter 源 ——
const n2 = ref(2)
const log2 = []
watch(() => n2.value * 2, (v, o) => log2.push(`getter: ${o} → ${v}`))
n2.value = 3
await nextTick()
console.log(log2)   // ['getter: 4 → 6'] —— 观测的是表达式的值，不是某个具体属性
```

```js
// —— 形态三：reactive 对象源（默认深遍历）——
const user = reactive({ profile: { name: 'a' } })
const log3 = []
watch(user, () => log3.push(`reactive: name 变为 ${user.profile.name}`))
user.profile.name = 'b'      // 改的是二层属性
await nextTick()
console.log(log3)   // ['reactive: name 变为 b'] —— 深层变化也触发了回调
```

形态一最容易理解：getter 就是 `() => source.value`。形态二是「想观测一个表达式」的口子——比对的是 getter 的返回值，源可以是多个 ref 的组合。形态三最反直觉：传进去的对象本身没有「值变了」一说，靠 traverse 把 `profile.name` 读了一遍才建立深层订阅；这就是 reactive 源默认 deep 的原因。三种形态在归一化之后汇成同一个 getter，后面的流程完全一致——这正是 doWatch 第一步「归一化」的意义。

第二步是 job，即 4.3 旧值版的完整形态。它先以 Symbol 哨兵 `INITIAL_WATCHER_VALUE` 初始化 `oldValue`，变更判定通过后才调用回调：

```ts
// packages/runtime-core/src/apiWatch.ts —— doWatch：job（节选）
const job: SchedulerJob = () => {
  if (!effect.active) return
  if (cb) {
    // watch(source, cb)
    const newValue = effect.run()
    if (
      deep ||
      forceTrigger ||
      isMultiSource ||
      hasChanged(newValue, oldValue) ||
      (isMultiSource && (newValue as any[]).some((v, i) => hasChanged(v, oldValue[i])))
    ) {
      // ……（先跑上一次的 cleanup，再以 [newValue, oldValue, onCleanup] 调用 cb，首轮 oldValue 传 undefined，见源码）
      oldValue = newValue
      if (once) {
        // once：首次触发（含 immediate）后自停止，之后不再响应
        effect.stop()
      }
    }
  }
}
```

三处值得停下。哨兵解决「首轮旧值传 undefined」的歧义：`undefined` 本身可能是源的合法值，分不清「还没跑过」和「值就是 undefined」，而 Symbol 不与任何用户值相等。`hasChanged` 过滤「没变的抖动」：源跑了、值没变，就不惊动回调。`once` 在首次触发后直接 `effect.stop()`，订阅当场解除；`immediate` 则让 job 在创建时就先跑一次，回调拿到 `(初值, undefined)`。

第三步是本章主题——flush 分流：

```ts
// packages/runtime-core/src/apiWatch.ts —— doWatch：uid 与调度分流（节选）
if (instance && flushMode === 'pre') {
  ;(job as any).id = instance.uid
}

const effect = new ReactiveEffect(getter, undefined)
effect.allowRecurse = !!cb // watch 回调允许自触发（用户显式递归）
effect.scheduler = () => {
  if (flushMode === 'post') {
    queuePostFlushCb(job)
  } else if (flushMode === 'sync') {
    job()
  } else {
    queueJob(job)
  }
}
```

官方文档约定 flush 取 `'pre' | 'post' | 'sync'`，默认 `'pre'`。三种取值在本仓库的落点：

| flush | scheduler 里做的事 | 回调执行的时机 |
|---|---|---|
| `'pre'`（默认） | `queueJob(job)` 进主队列 | 与渲染作业同队列，按组件 uid 排序，下一轮微任务 |
| `'post'` | `queuePostFlushCb(job)` | 渲染作业之后（与 onMounted 同一条 post 队列） |
| `'sync'` | `job()` 当场执行 | 不等待：写入同步触发回调 |

`watchPostEffect` / `watchSyncEffect` 是后两种的糖，各自把 flush 写死。pre 作业挂上 `instance.uid` 后与同组件的渲染作业同 id、同队列，父组件的 watch 因此先于子组件执行（队列按 uid 升序）。

最后用一句话交代 `onCleanup`：回调的第三个参数可注册清理函数，仓库把它存为 `cleanup` 并同时挂在 `effect.onStop` 上，约定「新回调触发前、以及 watch 停止时，先执行上一次注册的清理」。它防的是竞态——参数连变两次、发出两个请求，第一个响应晚到时会用旧数据覆盖新结果。对应测试断言的执行序是 `['cb:2', 'cleanup', 'cb:3']`。

竞态到底长什么样，值得完整跑一遍。模拟一个搜索框：关键词变一次发一次请求，旧词的响应故意比新词慢：

```js
// —— 竞态演示：慢响应后到（延迟可控的假请求，实测可跑）——
const fakeFetch = (q, delay) =>
  new Promise((resolve) => setTimeout(() => resolve(`result of ${q}`), delay))

const query = ref('vue')
let shown = null
watch(
  query,
  async (q) => {
    shown = await fakeFetch(q, q === 'vue' ? 30 : 10)   // 'vue' 慢 30ms，'vuejs' 快 10ms
  },
  { immediate: true },
)

query.value = 'vuejs'      // t=0：新词先出发（快），旧词的请求还在路上（慢）
// t=10：'result of vuejs' 落进 shown —— 正确
// t=30：'result of vue' 迟到，把 shown 覆盖回旧词 —— 污染
```

时间线排开看更清楚：两个请求都成功返回了，问题纯粹出在**到达顺序**。新结果先到、旧结果后到，最后留在 `shown` 里的是旧词。修复只需要让旧回调「知道自己已经过期」：

```js
// —— 加上 onCleanup：过期回调不再落地 ——
const query = ref('vue')
let shown = null
watch(
  query,
  async (q, _old, onCleanup) => {
    let expired = false
    onCleanup(() => { expired = true })    // 新一轮触发前，先执行上一轮注册的清理
    const data = await fakeFetch(q, q === 'vue' ? 30 : 10)
    if (!expired) shown = data             // 过期的响应被丢弃
  },
  { immediate: true },
)

query.value = 'vuejs'
// 新一轮回调开始前，onCleanup 把上一轮的 expired 置 true
// t=10：'result of vuejs' 落地（新一轮未过期）
// t=30：旧响应到达，但它那一轮已过期，shown 不再被污染
```

机制上，第二轮回调开始前 job 会先执行上一轮注册的 `cleanup`——这正是 `['cb:2', 'cleanup', 'cb:3']` 那条执行序的用途。清理函数不必取消请求（很多请求根本取消不了），它只需要作废旧回调的「落地资格」；await 之后的写入被一个布尔值拦下，竞态窗口就关上了。watch 的拼图完整了，还剩开头遗留的问题：一堆 watch 和 computed，谁来统一「关掉」？下一节回答。

## 4.5 effectScope：一键收割

痛点很具体。组件卸载时，setup 里创建的渲染副作用、三个 watch、两个 computed 都得停；状态库销毁一个 store 同样要停一串。逐个 stop 的问题是「散」：漏一个，就留下一个没有监听者的订阅，数据再变时它还在静默空跑。仓库的方案是 effectScope，把一批副作用的生命周期捆成整体：

```js
// 导入均来自 @mini-vue/reactivity
const state = reactive({ count: 0 })
const log = []
const scope = effectScope()
scope.run(() => {
  const double = computed(() => state.count * 2)
  effect(() => log.push(`double=${double.value}`))   // double=0
})
state.count = 1   // double=2：scope 里的副作用照常工作
scope.stop()      // 一键收割
state.count = 2   // 无输出：订阅已解除。log 为 ['double=0', 'double=2']
```

机制三步：构造时登记、run 时接管指针、stop 时递归收割。

```ts
// packages/reactivity/src/effectScope.ts —— EffectScope（节选）
export class EffectScope {
  // ……（字段、on()/off() 与 run()，略——run 把 activeEffectScope 换成自己执行 fn，finally 还原）

  constructor(public detached = false) {
    if (!detached && activeEffectScope) {
      if (activeEffectScope.active) {
        this.parent = activeEffectScope
        this.index =
          (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
            this,
          ) - 1
      }
    }
  }

  stop(fromParent?: boolean) {
    if (this._active) {
      this._active = false
      let i, l
      // 1. 停掉本 scope 直接创建的 effects（它们各自解除订阅）
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].stop()
      }
      this.effects.length = 0
      // ……（2. cleanups 回调；4. 从父 scope 摘除自己，见源码）

      // 3. 递归，深度优先停掉子 scope
      if (this.scopes) {
        const scopes = this.scopes.slice()
        for (i = 0, l = scopes.length; i < l; i++) {
          scopes[i].stop(true)
        }
        this.scopes.length = 0
      }
    }
  }
}
```

「登记」的另一半在 ReactiveEffect 构造器里：scope.run 期间 new 出的副作用，一出生就自动归队（父 scope 已停止则一出生就失活，防孤儿订阅）。

```ts
// packages/reactivity/src/effect.ts —— ReactiveEffect 构造器（节选）
// 自动登记进「构造时的活跃 effect scope」：scope.run() 里创建的 effect，
// 会随 scope.stop() 一起被停掉（阶段 2 新增，对应真 Vue 3.5 行为）
if (activeEffectScope) {
  if (activeEffectScope.active) {
    activeEffectScope.effects.push(this)
  }
}
```

stop 的收割顺序值得逐步推演。搭一棵三层 scope 树：外层挂一个副作用和一个 computed，内层挂一个副作用，内层里再嵌一层叶子 scope；副作用挂 `onStop`、scope 挂 `onScopeDispose`，让每一步停下都留下日志（实测可跑）：

```js
const state = reactive({ count: 0 })
const order = []
const outer = effectScope()
outer.run(() => {
  effect(() => { void state.count }, { onStop: () => order.push('outer effect: onStop') })
  const c = computed(() => state.count * 2)          // 内部计算 effect 也自动归队
  onScopeDispose(() => order.push('outer: onScopeDispose'))
  const inner = effectScope()
  inner.run(() => {
    effect(() => { void state.count }, { onStop: () => order.push('inner effect: onStop') })
    onScopeDispose(() => order.push('inner: onScopeDispose'))
    const leaf = effectScope()
    leaf.run(() => {
      effect(() => { void state.count }, { onStop: () => order.push('leaf effect: onStop') })
      onScopeDispose(() => order.push('leaf: onScopeDispose'))
    })
  })
})

outer.stop()
console.log(order)
// ['outer effect: onStop', 'outer: onScopeDispose',
//  'inner effect: onStop', 'inner: onScopeDispose',
//  'leaf effect: onStop', 'leaf: onScopeDispose']
```

对照 stop 的四段代码，六条日志的来历逐一定位：

| 步 | stop 里的代码段 | 动作 | 产生的日志 |
|---|---|---|---|
| 1 | `_active = false` | outer 先自我标记失活 | — |
| 2 | effects 循环 | 依次停 outer 名下的副作用（各自 cleanupEffect 解除订阅、跑 onStop） | `outer effect: onStop` |
| 3 | cleanups 循环 | 执行 onScopeDispose 注册的清理 | `outer: onScopeDispose` |
| 4 | scopes 递归 | `inner.stop(true)`：对 inner 完整走一遍步骤 1–3 | `inner effect: onStop` → `inner: onScopeDispose` |
| 5 | （步骤 4 内的递归） | inner 停完自己的 effects/cleanups 后，再递归 `leaf.stop(true)` | `leaf effect: onStop` → `leaf: onScopeDispose` |
| 6 | 从父摘除 | outer 是顶层 scope，无父可摘 | — |

两个结构性的事实从表里浮出来。其一，收割按「先本层、后子树」推进：外层自己的副作用与清理先全部执行完，才轮到内层 scope，内层同样先副作用后清理、再下探一层。其二，computed 没有日志却也被收割了：它的内部计算 effect 同样在构造时自动归队，安静地停掉。停掉之后的证据是行为冻结——源再怎么变也不会置脏，读到的永远是停止那一刻的缓存（实测 `count` 停在 1 时 stop，之后改成 10，`c.value` 仍是 2）。

这套机制和第 2 章的 effect 执行栈是同构的：那边 `run` 压栈接管 `activeEffect`，让执行途中的「读取」自动登记进账本；这边 `run` 接管 `activeEffectScope`，让执行途中的「创建」自动登记进目录。为什么同构？因为它们是同一个问题的两次出现——让随后发生的事自动归队，免得调用方逐个记账。

为什么组件卸载必须显式 stop，不能指望垃圾回收？因为订阅登记在全局 `targetMap` 上，账本持有副作用的引用，它不会被回收；不停掉的后果是「僵尸更新」。effectScope 有两个重量级消费者。第一个是状态库：顶层建一个 `effectScope(true)`（detached，不挂父目录、独立生死，父 scope 停止不牵连），全部 store 的副作用创建于其中，销毁时一个 `stop()` 整体收割。第二个是组件本身——**组件实例就是一个非 detached 的 effect scope**（`component.ts` 里实例带着 `scope: new EffectScope()`），渲染 effect 显式归属它：

```ts
// packages/runtime-core/src/renderer.ts —— setupRenderEffect（节选）
const update: SchedulerJob = (instance.update = effect(componentUpdateFn, {
  // 重要：调度器让它走 job 队列（微任务批量刷新），而不是同步重渲染
  scheduler: () => queueJob(update),
  allowRecurse: true,
  // 渲染 effect 显式归属组件 scope：卸载时 scope.stop() 会一并停掉它。
  scope: instance.scope,
}) as any)

update.id = instance.uid   // 渲染作业以组件 uid 入队：与 pre watch 同队列排序的锚点
```

卸载路径（renderer.ts 的 unmount）最后一步就是 `instance.scope.stop()`：渲染副作用、setup 里创建的 watch 与 computed、子组件的 scope，递归一次全停。所以 `onScopeDispose` 与 `onUnmounted` 是一组对偶——组件内注册的清理回调，卸载时正是由 scope 的 stop 执行的，时机一致。

「跑不跑、什么时候跑、什么时候不跑」至此闭环。下一章换战场。

## 本章小结

trigger 的收尾把「何时执行」交给 scheduler 选项：默认同步重跑，挂上调度器则由消费者决定时机。一个 Set 加微任务就能把一轮多次触发合并成一次，仓库调度队列在此之上补齐排序与边界（第 8 章展开）。watch 是「effect + scheduler」的封装：doWatch 把 source 归一成 getter，job 携带哨兵旧值协议，flush 三选一把回调安进流水线的 pre / post / sync 段位，once 与 onCleanup 补上一次性与竞态清理。effectScope 以「构造自动登记 + stop 递归收割」管理成组副作用的生命周期，组件实例本身就是这样一个 scope。

## 仓库文件索引

- `packages/runtime-core/src/apiWatch.ts` —— watch / watchEffect / watchPostEffect / watchSyncEffect 与内核 doWatch
- `packages/reactivity/src/effect.ts` —— trigger 的 scheduler 分流、effect() 工厂、构造器的 scope 自动登记
- `packages/reactivity/src/effectScope.ts` —— EffectScope / effectScope / onScopeDispose / getCurrentScope
- `packages/runtime-core/src/{scheduler.ts, component.ts, renderer.ts}` —— 调度队列入口、组件实例的 scope 字段与渲染 effect 的 scheduler（第 8 章展开）
- `packages/runtime-core/__tests__/apiWatch.spec.ts`（18 例）、`packages/reactivity/__tests__/effectScope.spec.ts`（9 例）—— 行为锚定

## 与官方实现的差距

以下均经 `third_party/vue-core`（v3.5.x）源码核对：

- **pre 作业的排序**：官方同样把 pre 作业经 `queueJob` 并入主队列，但带 `PRE` 标志位；`findInsertionIndex` 会把与渲染作业同 id 的 pre watcher 插在**渲染作业之前**（源码注释明说），因此官方的 pre watcher 先于同组件当轮渲染执行，且组件被父更新卸载时可被跳过。本实现的 pre 作业同样走主队列、同样挂 uid，但没有 PRE 位：同 uid 时排在已入队的渲染作业之后，晚于当轮渲染。
- **递归上限与作废位**：官方 scheduler 有 `RECURSION_LIMIT = 100`（超限在开发环境报「Maximum recursive updates exceeded」）与 `DISPOSED` 标志位（作业作废后跳过执行）；本实现两者皆无。
- **遗留的独立 pre 队列**：本实现的 scheduler.ts 还保留一条独立的 pre 数组（`queuePreFlushCb`），形态接近官方 3.4 及更早；目前它没有生产调用方（仅自测试引用），pre 作业实际都走主队列。官方 3.5 已把这条路径并入主队列统一排序。
- **部署位置**：官方 3.5 把 watch 内核下沉到 reactivity 包（`baseWatch`，见 `packages/reactivity/src/watch.ts`），runtime-core 的 apiWatch 只做选项装配；本实现维持 classic 布局，实现在 runtime-core，依赖方向仍单向。

## 动手验证

```bash
pnpm test -- packages/runtime-core packages/reactivity
```

预期全绿：其中 `apiWatch.spec.ts` 18 例（含 flush timing 专项 5 例）、`effectScope.spec.ts` 9 例，整套 255 例通过。再给一个 flush 三种时机的对照小例子（导入方式与 apiWatch.spec.ts 一致，可直接放进任一 vitest 文件）：

```js
const order = []
const n = ref(1)
watch(n, () => order.push('sync'), { flush: 'sync' })   // 写入当场执行
watch(n, () => order.push('pre'))                       // 默认：进主队列
watch(n, () => order.push('post'), { flush: 'post' })   // 渲染作业之后

n.value = 2            // 此刻：'sync' 已进 order
order.push('assign')   // 同步代码继续
await nextTick()       // 微任务刷新：主队列跑 'pre'，post 队列跑 'post'
console.log(order)     // ['sync', 'assign', 'pre', 'post']
```

预期输出 `['sync', 'assign', 'pre', 'post']`：sync 在赋值行当场执行；pre 与 post 都等到微任务，但 pre 在主队列、post 在其后的 post 队列。4.2 与 4.5 节的两个演示（合并执行、scope 收割）也已逐一实测，输出与注释一致。本章新增的演示同样经实测：4.4 三种 source 形态的输出依次为 `ref: 1 → 2`、`getter: 4 → 6`、`reactive: name 变为 b`；onCleanup 竞态里无防护版最终 `shown` 为旧词结果、加防护后为新词结果；4.5 的收割顺序为六条日志依次 `outer effect → outer 清理 → inner effect → inner 清理 → leaf effect → leaf 清理`。

## 延伸阅读

- 官方文档：[响应式 API：核心](https://cn.vuejs.org/api/reactivity-core.html)（watch 的 flush 取值与默认 'pre'、watchEffect / watchPostEffect / watchSyncEffect、onCleanup）
- 源码：`third_party/vue-core` 的 `packages/runtime-core/src/{apiWatch.ts, scheduler.ts}`、`packages/reactivity/src/{watch.ts, effectScope.ts}`
- 《Vue.js 设计与实现》4.7 节（调度执行）、4.9–4.10 节（watch 的实现原理、立即执行的 watch 与回调执行时机）

> 下一篇：响应式四篇完结，我们进入渲染器。先把 UI 描述成一纸 vnode 协议，再让宿主操作以注入的方式落地——从挂载一个最小元素开始。
