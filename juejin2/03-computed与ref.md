# 03 · computed 与 ref：惰性、脏位与原始值的房子

先从一个再熟悉不过的写法开始：`const count = ref(0)`，`const double = computed(() => count.value * 2)`。这两行天天在写，但很少有人追问它们身后的事。问题是——**一个值是「算出来的」，凭什么十个地方引用只算一次、没人读时一次都不算？原始值连对象都不是，Proxy 根本代理不了，`ref(0)` 的响应式从哪里来？模板里写 `count` 从不写 `count.value`，是谁悄悄拿掉了 `.value`？**

本章依次回答这三个问题。先手写一个「每次都重算」的朴素 computed，指出它做不到的三件事，再看仓库实现如何用「脏位 + scheduler」补齐惰性与失效传播。然后手写一个十来行的 ref 容器，同样先暴露三个缺陷，再看 `RefImpl` 如何逐一回应。过程中还会遇到几个新问题：脏位凭什么挡得住重算？判等为什么会踩 `Object.is` 的坑？深层响应式怎么住进一栋只有一间屋的房子？

## 1.1 computed：从「每次都重算」开始

官方文档对只读形态的描述是：computed「接受一个 getter 函数，返回一个只读的响应式 ref 对象」；可写形态传入带 get/set 函数的对象。先放下「返回一个 ref」这个身份不表，用第 1 篇的手感把「源变就重算」做出来：

```js
// —— 手写朴素版，仅用于演示（effect / reactive 取第 1 篇语义）——
function computed(getter) {
  let value                       // 缓存：getter 最近一次的结果
  effect(() => {                  // getter 包进副作用：源变 → 重新执行
    value = getter()
  })
  return {
    get value() { return value }, // 读：直接拿缓存
  }
}
```

走读一遍。我们把 getter 包进第 1 篇的 `effect`：定义时立即执行一次，getter 读过的源全部登记进账本；此后任何源变化都会把这个副作用拉起来，`value` 随之更新。重算的结果也存在 `value` 里，读十次也只是读一个变量。测试一下：

```js
const state = reactive({ count: 1 })
const double = computed(() => state.count * 2)

console.log(double.value)   // 2 —— 注意：定义那一行，getter 已经跑过一次了
state.count = 2
console.log(double.value)   // 4 —— 源变的「瞬间」就重算了，不管有没有人要读
```

有了缓存，为什么还说它「每次都重算」？因为重算的触发条件是「源变了」，而不是「有人要读」。上面两处计算发生时，没有任何人读过它。离「计算属性」三个字，它还做不到三件事。

**做不到一：没人读也算。** `computed` 那一行执行完，getter 就跑了一次。一个组件里挂着十几个只在特定分支才用到的 computed，开局全部白算——惰性的反面：积极过头。

**做不到二：源每变一次就重算一次。** 哪怕这一轮没有任何读者（组件还没挂载、分支还没走到），源一变它照算不误。缓存解决的是「读十次算一次」，解决不了「没人读也一直算」。

**做不到三：读者联动不上。**

```js
effect(() => { console.log(double.value) })   // 读的是普通属性，什么也没收集
state.count = 3                                // double 内部重算了；上面的外层不会重跑
```

读 `double.value` 是一次普通的属性读取，没有经过任何拦截，外层副作用什么也没订阅。上游的变更传到 computed 就断了——它成了信息黑洞。三条分别指向惰性、失效的时机、失效的传播，下一节逐一拆解。

## 1.2 演进：脏位，以及一个「不执行」的调度器

惰性的思路是一个一比特的标记：**脏位（dirty flag）**。缓存可信就直接返回；不可信——「脏了」——才重算，算完恢复干净：

```js
// —— 演进一：惰性 + 缓存（半成品）——
function computed(getter) {
  let value
  let dirty = true               // true：缓存不可信，需要重算
  return {
    get value() {
      if (dirty) {
        value = getter()         // 脏才重算
        dirty = false            // 算完落缓存
      }
      return value
    },
  }
}
```

定义不算，第一次读算一次，此后读十次都拿缓存。「没人读就不算、读十次算一次」有了前半句。但马上撞上一个空洞：**谁把 dirty 置回 true？** 上面的 getter 是裸跑的，不在任何副作用里，账本上没有它的名字——源变时，它什么也听不见。

所以要复用第 1 篇的账本：让 getter 在一个副作用里执行，源依赖才会记到它名下。但这个副作用有两个非常规要求：**构造时不执行**（惰性不许被破坏），**被触发时也不执行**（只宣布失效）。第一个要求好办——仓库的 `ReactiveEffect` 构造函数本来就只登记、不执行，`run()` 才是执行的开关。第二个要求，靠的是 trigger 收尾留的那个口子：

```ts
// packages/reactivity/src/effect.ts —— trigger 的收尾循环（节选）
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

为什么 trigger 不直接执行，还要多问一句有没有 scheduler？因为「何时执行」不该由数据层独断。computed 要把重算推迟到有人读；watch 要控制执行时机；组件渲染要进微任务队列做批处理。一个 if 分支，三个上层机制共用（后两个在第 4、8 篇展开）。仓库的 computed，正是把自己的「不执行」写在这个分支里：

```ts
// packages/reactivity/src/computed.ts —— ComputedRefImpl 构造器（节选）
  constructor(
    getter: ComputedGetter<T>,
    private readonly setter: ComputedSetter<T> | undefined,
    isReadonly: boolean,
  ) {
    this[ReactiveFlags.IS_READONLY] = isReadonly
    this.effect = new ReactiveEffect(getter, () => {
      // scheduler：源变化时，把脏位置起并通知「本 computed 的读者」
      if (!this._dirty) {
        this._dirty = true
        triggerRefValue(this)
      }
    })
  }
```

走读。getter 被装进一个 `ReactiveEffect`，第二个参数就是它的 scheduler。源变化时，trigger 命中这个 effect，改走 scheduler 分支：不 run、不重算。它只做两件事——`_dirty = true`，缓存作废；`triggerRefValue(this)`，通知读者。

为什么先判 `!this._dirty`？因为源可能连变两次。第一次已经置脏并通知过，第二次再通知就是让读者空跑；脏着的 computed 保持脏着即可，反正重算被推迟到下一次读取。

scheduler 里那行 `triggerRefValue(this)` 是谁？它是 ref 世界的通知入口，定义在 `ref.ts`，1.5 节展开。这里先记住语义：唤醒「读过这个值的所有副作用」。读者被唤醒后会去读 `.value`——接力棒交到下一节。

## 1.3 get value：脏才重算，算完缓存

```ts
// packages/reactivity/src/computed.ts —— get value（节选）
  get value(): T {
    // 迅护到 toRaw：可能被 readonly() 包一层（真实场景 #3376），track/dirty 都要落在裸 computed 上
    const self = toRaw(this) as ComputedRefImpl<T>
    // 1. 收集「当前 activeEffect」进本 computed 的 dep（读者成订阅者）
    trackRefValue(self)
    // 2. 脏才重算；算完缓存到 _value
    if (self._dirty) {
      self._dirty = false
      self._value = self.effect.run()!
    }
    return self._value
  }
```

走读。第一行的 `toRaw` 是防御：computed 可能被 `readonly()` 再包一层，登记与脏位都要落在脱壳后的本体上。接着 `trackRefValue` 把「此刻正在执行的副作用」登记进 computed 自己的 dep——做不到三（读者联动不上）在此解决。最后才是脏位判定：脏则 `effect.run()` 重算一次，算完落缓存。

这五行每一行都有它必须存在的理由，值得逐行拆开看：

- **`const self = toRaw(this)`——为什么先脱壳。** `readonly()` 包过的 computed 再读 `.value`，this 是外层代理；若不脱壳，脏位读写和读者登记会落在外壳上，与本体割裂。脱壳之后，本节所有操作都指向同一个 `self`。
- **`trackRefValue(self)`——为什么放在脏位判定之前。** 读者登记不该依赖「这次读是否触发重算」。缓存新鲜也要登记，因为「失效通知」要发给所有读过的人——哪怕他读的那次没赶上重算。登记若被塞进重算分支，新鲜期读过的读者就收不到下一轮失效，身份③出现漏洞。
- **`self._dirty = false`——为什么在 `run()` 之前复位。** 这是个断路器。设想一个病态的 getter 里又读了同一个 computed：递归进入 get value 时脏位已复位，直接返回旧缓存、不再 run，递归当场截断。实测如此——若把复位挪到 run 之后，递归读取会再次进入重算分支，调用栈一路打穿。
- **`self._value = self.effect.run()!`——为什么新值从返回值来。** `run()` 执行 `fn` 并原样返回其结果，getter 的返回值因此直达 `_value`，不需要中间变量。类型里的 `!` 是给 TS 的交代：`run` 的返回类型是 `T | undefined`，那个 undefined 属于「重入被查栈拦下、函数走空不返回」的分支（第 2 篇的递归防线）；computed 的读取路径进不了那条分支，`!` 只是把这层已知安全告诉编译器。
- **`return self._value`——为什么最后才返回。** 到这一步，脏则已重算、缓存必新鲜；无论前面走了哪条分支，读者拿到的都是同一个可信的值。

重算这一刻有个细节值得停一下。`effect.run()` 会把内部 effect 压上执行栈、设为 `activeEffect`，然后才执行 getter。所以源依赖登记在 computed 自己的 effect 名下，而外层读者还压在栈的更深处（执行栈是第 2 篇的主角）。订阅关系由此分层：源属于 computed，computed 属于读者。把失效传播的完整回路画出来：

```text
state.count = 2
  → trigger 命中 state 的账本 → computed 的内部 effect → 走 scheduler
  → _dirty = true + triggerRefValue(computed)
  → computed.dep 里的读者被唤醒、重跑 → 重跑途中再读 .value → 脏 → 重算一次、清脏
  → 后续读者再读 .value：不脏，直接拿缓存
```

两个当初的承诺都能兑现了。**没人读就不算**：scheduler 只置脏不重算；这一轮没人读，脏位就一直躺着，等下一次读取。**十个读者只算一次**：triggerRefValue 会唤醒全部十个读者，但只有第一个读到的 computed 还是脏的，由它触发重算并清脏。后面九个读到的，已是新鲜缓存。链式 computed（`c2` 读 `c1`）不过是把这条回路串起来：`c2` 是 `c1` 的读者，失效逐级传下去。

把订阅关系画成一张结构图，谁订阅谁一目了然：

```text
┌───────────────────────────────────────────────┐
│ 源：state（reactive 代理）                        │
│ targetMap：state → count → dep                  │
└───────────────────────┬───────────────────────┘
                        │ 订阅：computed 的内部 effect
                        │（getter 执行时 track，登记在这本账）
                        ▼
┌───────────────────────────────────────────────┐
│ double = computed(() => state.count * 2)        │
│ ComputedRefImpl                                │
│   _value / _dirty —— 缓存与脏位                   │
│   effect           —— 身份②：向内，订阅者          │
│   dep              —— 身份③：向外，发布源          │
└───────────────────────┬───────────────────────┘
                        │ 发布：失效时 triggerRefValue(this)
                        │（读者读 .value 时经 trackRefValue 登记在这本账）
                        ▼
┌───────────────────────────────────────────────┐
│ 读者：渲染副作用 / watch / 另一个 computed          │
└───────────────────────────────────────────────┘
```

图里有两本账、一个中继。上面的账是 targetMap 里「state 的 count 那一行」，登记的是 computed 的内部 effect；下面的账是 computed 自己的 `dep`，登记的是读过 `.value` 的所有读者。computed 站在两本账的连接处：对上以订阅者身份收失效通知，对下以发布源身份把失效发出去。失效从源到读者的每一跳，走的具体路径是：源变 → trigger 命中上账 → scheduler 置脏 → triggerRefValue 命中下账 → 读者重跑 → 重读 `.value` → 重算。

三重身份的第一重：对外它是一个 ref，有 `.value`，`isRef` 为 true，只读形态连 `isReadonly` 也为 true。第二重，向内它是一个订阅者：getter 在它私有的 `ReactiveEffect` 里执行，源依赖记在这个 effect 名下。第三重，向外它又是一个发布源：自己的 dep 登记所有读者，失效时经 `triggerRefValue` 通知。这三重身份正好回答 1.1 埋下的问题：为什么「一个 getter」要被包装成「一个 ref」？因为不成为 ref，就没有 `.value` 这扇门——读者无处订阅，失效无处传播。

三重身份逐条落到代码上，各自有明确的字段与消费方：

| 身份 | 落在哪行代码 | 谁在消费 |
|---|---|---|
| ① 一个 ref | `readonly [ReactiveFlags.IS_REF] = true`，`get/set value` 访问器 | `isRef()` 判型；一切读 `.value` 的代码；模板解包（1.6 节） |
| ② 一个订阅者 | 构造器里 `this.effect = new ReactiveEffect(getter, scheduler)` | trigger 命中源账本后调它的 scheduler（只置脏，不执行） |
| ③ 一个发布源 | `dep` 字段；get value 里 `trackRefValue(self)`，scheduler 里 `triggerRefValue(this)` | 读者（含链式下游 computed）经 `.value` 订阅，失效时被唤醒 |

身份②与身份③共用一个 `ReactiveEffect` 与一个 `dep` 字段吗？不共用——`effect` 订阅的是上游源，`dep` 收纳的是下游读者，一进一出正好是两个方向。链式 computed 之所以能层层传递，正是因为每个 computed 同时站在两本账上：对上游它是 effect，对下游它是 dep。

可写形态在工厂函数里分派：传入 `{ get, set }` 对象时，`set` 接到 `set value` 上转调；只有 getter 时没有 setter，写入只告警。官方文档的两种形态到此都齐了。不过 1.2 和本节用了两次 `trackRefValue` / `triggerRefValue`，却还没见过 ref 本身——下一节补上这块拼图，顺带回答本章第二个问题。

## 1.4 ref：给原始值一个房子

官方文档「深入响应式系统」页有一句容易被划走的话：Vue 3「使用 Proxy 创建响应式对象，仅将 getter/setter 用于 ref」。前半句，前两篇已经兑现。后半句意味着 ref 走的是另一条路——为什么？

因为 Proxy 有个天生的边界：**它只能代理对象**。`new Proxy(0, {})` 当场抛出 TypeError（可以在控制台里试一下）。而 `count.value++` 里的 0、消息里的 `'hello'`，全是原始值——Proxy 体系根本进不去，第 1 篇那套「读时登记、写时通知」对它们无处安放。

ref 的答案朴素：**给原始值盖一栋房子**。房子是一个只有一个属性 `value` 的对象；原始值住进去，读写都从这扇门走，门上装 getter/setter，登记-通知全部装在门上。文档那句话的后半句，说的正是这件事。先手写一版：

```js
// —— 手写朴素版，仅用于演示（沿用第 1 篇的 activeEffect）——
class MyRef {
  dep = new Set()                                // 桶退化成一个 Set：粒度=这一个值
  constructor(value) {
    this._value = value                          // 原始值住进房子
  }
  get value() {
    if (activeEffect) this.dep.add(activeEffect) // 读：登记读者
    return this._value
  }
  set value(newVal) {
    this._value = newVal
    this.dep.forEach(fn => fn())                 // 写：通知读者
  }
}
```

走读。第 1 篇的账本按「对象 → 属性 → 副作用」三层登记；一个值只有一个「属性」，桶退化成一个 Set 就够。测试：

```js
const count = new MyRef(1)
effect(() => { console.log(count.value) })   // 1：读者进 dep
count.value = 2                              // 打印 2 ✓
```

原始值的响应式跑起来了。但这个十来行的版本，同样做不到三件事。

**做不到一：赋相同的值也触发。** `count.value = 2` 之后再赋 2，读者照样空跑一次。表单重置、轮询回写，都是高频赋同值的场景。

**做不到二：对象值没有深层响应。** `const state = new MyRef({ count: 1 })` 之后执行 `state.value.count = 2`，改的是裸对象的内部。没有任何拦截，读者毫无反应。

**做不到三：修好判等，还会踩 Object.is 的坑。** 假设给 set 补上 `Object.is` 判等（做不到一的修法）：先存一个 reactive 代理，再把原始对象赋回来——代理和原对象是两个不同的对象，判等失败，「值明明没换」却被当成换了。更糟的是 `_value` 被换成裸对象后，深层响应式也断了。

仓库的 `RefImpl` 用三处细节逐条回应。下一节走读。

## 1.5 仓库的 RefImpl：三处细节回应三件事

```ts
// packages/reactivity/src/ref.ts —— RefImpl（节选）
class RefImpl<T = any> {
  _value: T
  private _rawValue: T
  dep?: Dep
  // ReactiveFlags.IS_REF 就是 '__v_isRef'：一个字段同时充当 isRef 标记
  readonly [ReactiveFlags.IS_REF] = true

  constructor(value: T, private readonly shallow: boolean) {
    // _rawValue 存「原始值」：传入的若已是 reactive 代理，先脱壳再存
    // —— 这样 `ref(reactiveObj)` 再 set 同一个对象时 hasChanged 才能判「没变」
    this._rawValue = shallow ? value : toRaw(value)
    this._value = shallow ? value : toReactive(value)
  }

  get value() {
    // 读 → 收集当前 activeEffect 进这个 ref 的 dep
    trackRefValue(this)
    return this._value
  }

  set value(newVal) {
    // shallow/readonly 场景要「原样存储」：
    //   - shallowRef / 已是浅代理 / 只读代理 → 直接存，不脱壳也不深代理
    const useDirectValue =
      this.shallow || isShallow(newVal) || isReadonly(newVal)
    newVal = useDirectValue ? newVal : toRaw(newVal)
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal
      this._value = useDirectValue ? newVal : toReactive(newVal)
      // 写 → 触发所有订阅者
      triggerRefValue(this, newVal)
    }
  }
}
```

**细节一回应做不到三：判等用原始值。** `_rawValue` 存的是 `toRaw` 脱壳后的值，set 时新值同样先脱壳再比。于是 `ref(reactiveObj)` 之后把原始对象赋回去，两边是同一个对象，`Object.is` 判等——不触发，`_value` 也不被换掉，代理身份保住了。

这个陷阱值得一个完整可跑的对照。错误实现已经补上了 `Object.is` 判等，唯一的差别是 `_value` 直接存传入值（代理原样进屋）：

```ts
// —— 判等陷阱对照：可保存为临时 spec 运行 ——
import { describe, expect, it } from 'vitest'
import { reactive, ref, isReactive, effect } from '@mini-vue/reactivity'

describe('ref 的判等陷阱', () => {
  it('错误实现：_value 直接存传入值（代理），判等用 Object.is', () => {
    let activeEffect: (() => void) | undefined
    const naiveEffect = (fn: () => void) => {   // 手写三行 effect：够登记读者即可
      activeEffect = fn
      fn()
      activeEffect = undefined
    }
    class NaiveRef {
      dep = new Set<() => void>()
      _value: any
      constructor(value: any) { this._value = value }        // 代理原样住进 _value
      get value() {
        if (activeEffect) this.dep.add(activeEffect)
        return this._value
      }
      set value(newVal: any) {
        if (Object.is(newVal, this._value)) return           // 有判等，但拿「原始对象」比「代理」
        this._value = newVal
        this.dep.forEach((fn) => fn())
      }
    }

    const raw = { count: 1 }
    const state = reactive(raw)                // 造一个代理（reactive 不在被测之列）
    const r = new NaiveRef(state)
    let runs = 0
    naiveEffect(() => { runs++; void r.value })
    r.value = raw                              // 把同一个原始对象赋回去：值其实没换
    console.log('错误实现：', runs, isReactive(r.value))    // 错误实现：2 false
    expect(runs).toBe(2)
    expect(isReactive(r.value)).toBe(false)
  })

  it('仓库实现：_rawValue 脱壳后再判等', () => {
    const raw = { count: 1 }
    const state = reactive(raw)
    const r = ref(state)                       // _rawValue 存 raw，_value 存 state
    let runs = 0
    effect(() => { runs++; void r.value })
    r.value = raw                              // 同一个原始对象赋回去
    console.log('仓库实现：', runs, isReactive(r.value))    // 仓库实现：1 true
    expect(runs).toBe(1)
    expect(isReactive(r.value)).toBe(true)
  })
})
```

两份实现的输入一字不差，输出并排对照：

| | 错误实现 | 仓库实现 |
|---|---|---|
| 构造时存什么 | `_value` = state（代理本体） | `_rawValue` = raw（脱壳），`_value` = state（深层转换） |
| 赋 `r.value = raw` 时的判等 | `Object.is(raw, state)` → false | `Object.is(raw, raw)` → true |
| 读者被通知吗 | 通知，空跑一次（runs 到 2） | 不通知（runs 停在 1） |
| `_value` 被换掉吗 | 换成裸对象，`isReactive` 为 false | 不换，代理身份保住 |
| 最终输出 | `2 false` | `1 true` |

错误实现输在「拿原始对象与代理判等」。Proxy 的代理与目标始终是两个不同的引用，`Object.is` 永远判 false；于是这次「值没换」的赋值被当成真变更，读者空跑一次。更重的代价在后半行：`_value` 被裸对象顶替，屋里的深层响应式随之断线，此后 `r.value.count = 2` 谁也叫不醒。仓库实现两头都堵上了——判等用 `_rawValue`，存值仍走 `toReactive`。

**细节二回应做不到二：深层转换。** 构造和写入都经过 `toReactive`：

```ts
// packages/reactivity/src/reactive.ts —— toReactive（节选）
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? (reactive(value as object) as unknown as T) : value
```

对象经它变成 `reactive()` 代理。官方文档的措辞是：「如果将一个对象赋值给 ref，那么这个对象将通过 reactive() 转为具有深层次响应式的对象」；不需要深层转换时用 `shallowRef`。妙处在分工：ref 的门只管「整个值被替换」这一件事，屋里的深层变化交给 reactive 的拦截器。

为什么 `r.value.count = 2` 能通知到读者？因为读者当初读 `r.value.count` 时登记了两次——一次进 ref 的 dep（整值替换会通知），一次进内部对象自己的账（深层修改会通知）。门和屋子各司其职。

**细节三回应做不到一：相同值不触发。** 赋值前先过一道判等：

```ts
// packages/shared/src/index.ts —— hasChanged（节选）
export const hasChanged = (value: any, oldValue: any): boolean =>
  !Object.is(value, oldValue)
```

`hasChanged` 不通过，set 直接结束，连 `triggerRefValue` 都不进。`Object.is` 还有个额外好处：`NaN` 与 `NaN` 判等，给 NaN 赋 NaN 不会空跑（`===` 做不到这一点）。set 里那组 `useDirectValue` 判断服务于浅层场景：`shallowRef`，或新值本身是浅代理、只读代理时，原样存储，不脱壳也不深代理。

最后看那对「门轴」——computed 的 get value 里调用的 `trackRefValue`，就定义在这里：

```ts
// packages/reactivity/src/ref.ts —— ref 的 track/trigger（节选）
export function trackRefValue(ref: RefBase<any>) {
  if (shouldTrack && activeEffect) {
    ref = toRaw(ref)
    trackEffects(ref.dep || (ref.dep = createDep()))
  }
}

export function triggerRefValue(ref: RefBase<any>, newVal?: any) {
  ref = toRaw(ref)
  const dep = ref.dep
  if (dep) {
    triggerEffects(dep)
  }
}
```

读必经 `trackRefValue`，写必经 `triggerRefValue`，守卫与第 1 篇的 track 一致：没有正在执行的副作用，读了也不登记。computed 与 ref 共用这对入口——前者本来就是个 ref。模板里那个「不用写 `.value`」的谜题，最后也汇到这里；下一节就来拆它。

## 1.6 为什么模板里不用写 .value

因为取值的链路上有人替我们解了包。第一条路在渲染上下文。setup 返回的对象会被 runtime-core 用 `proxyRefs` 包一层浅解包代理（`instance.setupState = proxyRefs(setupResult)`，见 `packages/runtime-core/src/component.ts`）。属性是 ref 就取 `.value`，是普通值就原样返回。模板表达式编译后统一从上下文取值（`with(_ctx)` 方案，第 10 篇展开）。

第二条路在 reactive 内部：ref 作为 reactive 对象的属性被访问时同样解包，写入则转写进 ref（`baseHandlers.ts` 的 get/set 拦截器）。数组元素是例外，不参与解包——`reactive([ref(1)])[0]` 读出来的仍是 ref 本身。为什么数组例外？源码注释给的理由是「保持元素引用，配合遍历收集」：数组下标是整数键，走的判定路径本就不同。两条路的预期行为都有测试锚定（`ref.spec.ts` 的 unwrapping 一组）。

无论哪条路，解包都只是「在门口替我们读一次 `.value`」；门后的登记-通知——`trackRefValue` / `triggerRefValue` 这对入口——一寸未改。本章的两位主角至此合流：computed 本身就是一个 ref，两者共用同一对门轴。

## 本章小结

computed 的惰性由脏位实现：源变化时，内部 effect 的 scheduler 只置脏、只通知读者，不重算。重算推迟到 get value——脏才执行、算完缓存，于是没人读就不算、十个读者只算一次。ref 用一栋只有 `value` 一间的房子，把 Proxy 无法代理的原始值纳入同一套登记-通知。判等用 `_rawValue` 的原始值加 `hasChanged` 挡住空触发，对象值经 `toReactive` 深层转换。模板不写 `.value`，是 `proxyRefs` 与 reactive 解包在替我们写；所有路径最终汇到 `trackRefValue` / `triggerRefValue` 一对入口。

## 仓库文件索引

- `packages/reactivity/src/computed.ts` —— ComputedRefImpl：脏位、scheduler、get value（1.1–1.3 全部）
- `packages/reactivity/src/ref.ts` —— RefImpl、trackRefValue/triggerRefValue、proxyRefs，及 toRef/toRefs 的引用壳（1.4–1.6）
- `packages/reactivity/src/reactive.ts` —— toReactive / toRaw：深层转换与脱壳判等
- `packages/shared/src/index.ts` —— hasChanged：Object.is 判等
- `packages/reactivity/__tests__/computed.spec.ts`、`__tests__/ref.spec.ts` —— 本章行为的测试锚定

## 与官方实现的差距

- **computed**：官方 3.4 起重构为「版本对比」——读取时经 `refreshComputed` 重算，若新值与旧值 `Object.is` 相等，dep 的版本号不递增，下游订阅者据此判定无需重跑（`third_party/vue-core/packages/reactivity/src/computed.ts` 与同目录 `effect.ts` 的 `refreshComputed`）。本仓库的 scheduler 无条件通知下游：源变了但算出的值没变时，读者会空跑一次、getter 也会重跑。
- **ref**：语义与官方一致。官方 `RefImpl` 同样是 `_rawValue`（toRaw 存原始值）+ `_value`（toReactive 深层转换）+ `hasChanged` 判等的结构（`third_party/vue-core/packages/reactivity/src/ref.ts`）。
- **边角**：官方 computed 还带 `globalVersion` 全局版本快路径与 SSR 分支等优化，本仓库取最简形态。

## 动手验证

```bash
pnpm test -- packages/reactivity   # 8 个测试文件、113 个用例，computed/ref 的行为全部锚定其中
```

再给一个可跑的惰性证据。把下面存成 `packages/reactivity/__tests__/lazy-demo.spec.ts`，运行 `pnpm test -- lazy-demo`：

```ts
import { describe, expect, it } from 'vitest'
import { computed, effect, reactive } from '../src'

describe('computed 的惰性', () => {
  it('定义不算、读才算、源变只置脏、再读才重算', () => {
    const state = reactive({ count: 1 })
    const double = computed(() => {
      console.log('[getter] 重算')
      return state.count * 2
    })
    // 此刻控制台无输出：定义不算

    expect(double.value).toBe(2)   // ① 打印 [getter]：第一次读才算
    expect(double.value).toBe(2)   // ② 不打印：缓存命中

    state.count = 2                // ③ 不打印：scheduler 只置脏
    expect(double.value).toBe(4)   // ④ 打印 [getter]：脏了才重算

    let shown = 0
    effect(() => { shown = double.value })  // ⑤ 不打印：缓存新鲜，读者只登记
    state.count = 3                // ⑥ 置脏 + 通知读者 → 读者重读 → 打印 [getter]
    expect(shown).toBe(6)
  })
})
```

预期控制台只输出三行 `[getter] 重算`，分别对应 ①、④、⑥。②③⑤ 的静默，就是惰性与脏位在工作的证据。顺手把 ③ 的 `state.count = 2` 改成再赋 `1`（值没变）：连 ④ 都不会打印，reactive 层的 `hasChanged` 把通知挡在了门外。1.5 的判等陷阱对照也可照抄成临时 spec 跑：错误实现输出 `2 false`（空跑一次、深层响应断线），仓库实现输出 `1 true`——两个输出均经本仓库实际运行核对。

## 延伸阅读

- 官方文档：[响应式 API：核心](https://cn.vuejs.org/api/reactivity-core.html)（computed / ref / shallowRef 条目）
- 官方文档：[深入响应式系统](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html)（「使用 Proxy 创建响应式对象，仅将 getter/setter 用于 ref」的原文语境）
- 源码：`vuejs/core` 的 `packages/reactivity/src/{computed.ts, ref.ts}`（3.4+ 版本对比形态的 computed）
- 《Vue.js 设计与实现》4.8 节（惰性求值与脏位）与第 6 章（原始值的响应式方案）

> 下一篇：computed 的 scheduler 只置脏不执行，watch 却反过来要精细控制「何时执行」——pre、post、sync 三种时机从哪来？组件改十次状态为什么只渲染一次？我们去实现调度器，把「执行时机」变成一等公民。
