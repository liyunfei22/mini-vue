# 阶段 4 — runtime-core 进阶：keyed diff / watch / invoker / createApp 全量

> 里程碑：`pnpm test` 全绿（164 个用例，阶段 4 新增 32），tsc 0 错误，playground 构建通过。
> 真源码锚点：`third_party/vue-core/packages/runtime-core/src/{renderer,sequence,apiWatch}.ts`、`packages/runtime-dom/src/modules/events.ts`

## 1. 这一阶段学到了什么

### 1.1 keyed children diff（五步 + LIS）—— 最硬核的一块

```
旧的: a b [c d e] f g
新的: a b [e d c h] f g
         中间区 s1→e1 / s2→e2 未知
```

| 步骤 | 做什么 | 复杂度 |
|---|---|---|
| 1. 同步前缀 | 左右开头的同型节点直接 patch | O(公共前缀) |
| 2. 同步后缀 | 尾部同型节点直接 patch | O(公共后缀) |
| 3. 旧耗尽 | 剩余新节点都是新增 → 顺序挂载 | O(新增数) |
| 4. 新耗尽 | 剩余旧节点都是删除 → 批量卸载 | O(删除数) |
| 5. 未知区 | 键表 → 新老映射 → `moved` 判定 → **LIS** → 倒序移动/挂载 | 核心 O(n log n) |

**LIS（最长递增子序列）的用途**：`newIndexToOldIndexMap` 记录「新节点对应哪个旧下标」，
LIS 找出「顺序本来就对的节点们」——它们不用动，其余节点才需要 `move`。因为只有 LIS 中的
节点是「天然有序的」，其余按后往前一个个插到正确锚点前，移动次数 = 总节点数 − LIS 长度。

**为什么从后往前**：`anchor = c2[nextIndex+1].el`——倒序遍历时，后一个节点保证已就位，
拿它当锚点 `insertBefore` 即正确。

### 1.2 watch / watchEffect —— 响应式订阅的高级形态

- `doWatch` 的本质：`new ReactiveEffect(getter, scheduler)`，scheduler 决定「何时重跑」：
  - `pre`（默认）→ `queueJob`（**与组件渲染同队列**，父组件先于子组件）
  - `post` → `queuePostFlushCb`（渲染之后再跑）
  - `sync` → 直接同步跑
- `watch(source, cb)`：job 里 `effect.run()` 拿新值 → `hasChanged` 判定 → 变了才调 cb；
  cb 三参 `(newValue, oldValue, onCleanup)`。
- **cleanup 协议**：cb 内 `onCleanup(fn)` → 下次触发前与 stop 时执行（防抖、取消过期请求）。
- reactive 对象当 source 时默认**深遍历**（读遍所有嵌套属性 → 建立全依赖）；`deep: false` 只浅层。
- `forceTrigger`：reactive 源的引用本身没变也触发（因为深遍历得是 "值变了"）。

### 1.3 事件 invoker —— 一次绑定，只换 handler

```
el.__vei['onClick'] = invoker（包装函数）
首次: addEventListener('click', invoker)
更新: invoker.value = newHandler   ← 零 DOM 操作
移除: removeEventListener
```
静态对比朴素版「每次 patch remove + add」：大幅减少重复绑定的开销。

### 1.4 createApp 全量补全

app.use（插件 install 协议）、app.provide（应用级注入）、app.component（全局注册）、
app.config.globalProperties（公共代理的兜底查找）、app.unmount（卸载整棵树）、
resolveDynamicComponent（`<component :is>` 的运行时解析：字符串→全局注册表→原生标签）。

---

## 2. review gate 参考答案

### Q1：LIS 为什么能保证「移动最少」？手推一个例子

`newIndexToOldIndexMap = [4, 1, 3, 2, 1]`（旧下标+1）。LIS = 保持"相对顺序一致"的**最长**
旧下标序列。设其长度为 k，其余 n−k 个节点必须移动（它们无法与这个稳定序列共存）；
而 LIS 是"最长"的，所以 n−k 就是**理论最小**移动数。倒序移动时，每个需移节点只
`insertBefore(anchor)` 一次，锚点是已就位的下一节点 → 总数恰为 n−k。
手推例：`[3, 1, 2]` 映射（新 a-b-c 对应旧 c-a-b）→ LIS = [1, 2]（对应旧 a,b）→ 只有 c 移动。

### Q2：invoker 缓存为何比「每次先 remove 再 add」快？

因为大多数更新里，事件名没变只有 handler 函数变了（闭包捕获的变量变了）：
- 朴素版：每次 patch → `removeEventListener(old) + addEventListener(new)` = 2 次 DOM 操作 + 事件系统重绑；
- invoker：`invoker.value = newHandler` = **1 次属性赋值，零 DOM 操作**。
重绑还有「同一事件在微任务里触发两次」的边界 bug（真 Vue 用 `_vts` 时间戳防抖）。

### Q3：watch 的 post flush 与 nextTick 的区别是什么？

同一个话题：都是「等渲染刷新完再做什么」。
- `nextTick(fn)`：**外层调用者**主动等「下一次刷新」后执行 fn（widget 请求一次）；
- `watch(..., { flush: 'post' })`：**框架主动**在「渲染结束后」跑回调 —— 它在源变化
  时入 post 队列，与 onMounted/onUpdated 同批。区别在**语义**：post watcher 是随
  响应式变化的「被动反应」，nextTick 是用户的一次性「主动等待」。实现上一个走
  queuePostFlushCb、一个直接 promise.then（都挂在同一条 post 流水上，顺序稳定）。

---

## 3. mini 取舍

| 特性 | 3.5.x | mini |
|---|---|---|
| keyed diff | 同五步 + patchFlag/动态子级优化 | 五步全实现，无 block/static 优化 |
| 二分插入 | 带 PRE 位双字段排序 | 简化无 PRE 位（pre 队列独立实现） |
| watch 内核位置 | @vue/reactivity（可脱离组件） | runtime-core（依赖注入 scheduler） |
| 事件 | options 修饰符（.once/.passive/.capture） | 简化为 onXxx → 小写全名 |
| 动态组件 | 支持 setupState 名字解析 | 全局注册表 + 原生标签 |
| 递归绑定 | allowRecurse 位控制 | cb 存在即放宽 |

## 4. 冒烟验证

```bash
cd /Users/liyf/ms/mini-vue
npx vitest run        # 164 passed
npx tsc -p tsconfig.json --noEmit   # 0 error
pnpm dev:playground   # keyed list 增删头尾观察 DOM 复用
```

## 5. 自查表

- [ ] 能手推一遍「([3,1,2]) → LIS → 需要移动的节点」的 keyed diff
- [ ] 能解释 watch 的 pre/post/sync 三种 flush 分别进了哪条队列
- [ ] 能说出 invoker 相比 remove+add 省掉了什么
- [ ] 理解 globalProperties 是公共代理优先级链的最后一环