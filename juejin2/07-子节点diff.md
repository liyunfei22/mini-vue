# 07 · 子节点更新：keyed diff 与最长递增子序列

上一章把「一个元素自己的更新」收了尾：属性经 patchProp 打补丁，事件靠 invoker 换值不换监听器，卸载时先停副作用再摘节点。但 `patchElement` 的最后一行 `patchChildren` 一直是块黑盒：旧 children 是一组、新 children 也是一组时，渲染器面对的不再是「改一个节点」，而是「重排一群节点」。这是渲染器四章里最绕的一段，也是 diff 这个词最常指代的地方。

本章照例从朴素做法开始。先手写两个版本，亲眼看见「全卸载重挂」怎么浪费、「按位置配对」怎么错位；再带着教训推导仓库的 keyed diff——键控子节点比对，指以 key 为身份标识对新旧两组子节点配对并应用差异的算法。路上有几个问题要回答：两组子节点怎么配对才不浪费？为什么 `v-for` 必须写 key？都说 Vue 的 diff「移动最少」，凭什么做得到？没有 key 会发生什么？第 5 篇埋下的伏笔——`insert` 的第三参 anchor——也在这里兑现。

## 1.1 先分流：children 更新只有三种形态

先看仓库把问题切成了什么样。`patchChildren`（签名五个参数，与 05 篇的 patch 同族）按新旧 children 的形态分流，「数组对数组」只是其中一支：

```ts
// packages/runtime-core/src/renderer.ts —— patchChildren（节选，c1/c2/shapeFlag 局部量从略）
// 新 children 是文本：卸掉旧数组、一次 setText（分支体从略）
if (nextShapeFlag & ShapeFlags.TEXT_CHILDREN) {
  // ……
} else {
  if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    if (nextShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      const prevArr = isArray(c1) ? c1 : [c1]
      const nextArr = isArray(c2) ? c2 : [c2]
      // 数组 ↔ 数组 → 走 keyed diff
      patchKeyedChildren(prevArr, nextArr, container, anchor, parentComponent)
    } else {
      // 数组 → 空：全卸载（isArray 归一同上，从略）
    }
  } else {
    // 旧是文本（或空）：先清空再挂新（从略）
  }
}
```

三态读法：新 children 是文本，就卸掉旧数组、一次 `setText`；旧数组对新的「无」，全卸载；旧是文本新是数组，清空再挂。为什么数组对数组值得单独发明算法？因为它是性能敏感路径，也最容易「对得上、排不对」。第四参 anchor 是这组 children 之后的参照节点，会被一路传进 `patchKeyedChildren` 兜底使用。下一节先不进仓库，手写两个朴素版试试水。

## 1.2 朴素版 A：全部推倒重来

最直接的想法：旧的统统卸掉、新的统统挂上，一次到位。

```js
// —— 手写朴素版，仅用于演示 ——
function patchChildrenNaiveA(c1, c2, container) {
  c1.forEach(child => unmount(child))                  // 旧的全部卸载
  c2.forEach(child => patch(null, child, container))   // 新的全部重挂
}
```

对 ABCD 变 BCDA 这类更新，结果完全正确，代价是四个 li 全部重建、DOM 节点换成全新实例。DOM 节点是有状态的：焦点、输入框里未提交的文字、CSS 过渡的中间态、`<video>` 的播放进度，都挂在具体的节点实例上，节点一换全部归零。上一章的 invoker 也救不了场——它省的是「同一个元素上换监听器函数」的成本，元素本身没了，事件只能从 addEventListener 从头来。

为什么「结果正确」仍不可接受？因为 children diff 是高频路径，每次状态变化都要走一遍；每次都把状态与监听清零，等于每次渲染都回到首屏。朴素版 A 输在「节点身份全丢」——那就反过来，把身份焊死在位置上，看看朴素版 B。

## 1.3 朴素版 B：按索引逐一 patch

第二个想法：同位置的节点互相 patch，长度差出的部分增删。

```js
// —— 手写朴素版，仅用于演示 ——
function patchChildrenNaiveB(c1, c2, container) {
  const len = Math.min(c1.length, c2.length)
  for (let i = 0; i < len; i++) patch(c1[i], c2[i], container)            // 同位置配对，原地改写
  for (let i = len; i < c2.length; i++) patch(null, c2[i], container)    // 多出的挂
  for (let i = len; i < c1.length; i++) unmount(c1[i])                   // 少掉的删
}
```

ABCD 变 BCDA 走一遍：四个位置逐位改写，第 0 个 li 由 A 的内容改成 B，第 1 个由 B 改成 C，以此类推。零移动、零新建，看起来毫无浪费。但给每个 li 里放一个 `<input>` 再试：在 A 行输入 hello，点一次 rotate，hello 还留在第一行——而第一行现在渲染的是 B 的数据。输入框的状态跟着位置走，没有跟着数据走。

为什么内容都对、体验却是错的？因为「同一个位置」不等于「同一个节点」。用户心里的列表项身份是数据（这一行是 A），朴素版 B 的身份却是下标（这一行是第 0 个）。两个身份一旦错开，DOM 状态就挂到了错误的数据上。这正是官方文档要求 `v-for` 必须提供 key 的根源：key 才是节点的身份。留个伏笔：朴素版 B 不是稻草人，它就是「无 key 列表」在仓库里的真实行为，机制证据在 1.7 节兑现。

## 1.4 key：给节点一个身份

key 的落点很朴素：`h('li', { key: item.id }, ...)` 里的 key 经 createVNode 写进 `vnode.key`，身份判定只有一行：

```ts
// packages/runtime-core/src/vnode.ts —— isSameVNodeType
export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  return n1.type === n2.type && n1.key === n2.key
}
```

type 与 key 都相同才算同一个节点。key 的约定是：同一组兄弟内唯一、随数据稳定。为什么官方文档告诫不要用数组下标当 key？因为那等于把身份又拴回位置，退回朴素版 B 的世界。

有了 key，「谁对应谁」从猜测变成查表。剩下的难题是移动：ABCD 变 BCDA 时 A 从第 0 位挪到第 3 位，B、C、D 相对位置根本没变，diff 怎么知道哪些该动、哪些不必动？答案分五步，下一节开始推导。

## 1.5 第 1、2 步：头头、尾尾，先扫掉规律情形

仓库的 `patchKeyedChildren` 用四个游标工作：`i` 是头部游标，`e1`、`e2` 是旧、新数组的尾部游标，`l2` 是新数组长度。前两步从两端夹击：

```ts
// packages/runtime-core/src/renderer.ts —— patchKeyedChildren 第 1 步（节选）
// 1. 同步前缀：左右开头的同型节点直接 patch
while (i <= e1 && i <= e2) {
  const n1 = c1[i]
  const n2 = (c2[i] = normalizeVNode(c2[i]))
  if (isSameVNodeType(n1, n2)) {
    patch(n1, n2, container, null, parentComponent)
  } else {
    break
  }
  i++
}
```

第 2 步「同步后缀」与上面逐行对称：比较 `c1[e1]` 与 `c2[e2]`，同型同 key 就 patch 并 `e1--`、`e2--`，一遇差异就停，不再重贴。两步合起来的效果：

```text
旧 [ A  B ( C  D  E ) F  G ]     步骤 1 吃掉前缀 A、B；步骤 2 吃掉后缀 F、G
新 [ A  B ( E  D  C  H ) F  G ]     括号里的乱序区留给第 5 步
```

为什么头尾优先？因为真实列表的更新大多发生在两端：push、pop、unshift、shift、分页追加。这些情形在两趟线性扫描里就被消化，根本走不到昂贵的第 5 步；头部插入的成本只是一次前缀扫描加一段挂载。细看还会发现第 1 步的 patch 把 anchor 传成了 null——这一段节点位置不变，只做原地改写、不做插入，自然用不上锚点。那扫完前后缀之后呢？若一边先耗尽，就是两种纯情形——第 3、4 步。

## 1.6 第 3、4 步：一边有剩余，就是纯增删

```ts
// packages/runtime-core/src/renderer.ts —— patchKeyedChildren 第 3/4 步（节选）
// 3. 旧节点耗尽：剩余的(新)全是新增 → 挂载
if (i > e1) {
  if (i <= e2) {
    const nextPos = e2 + 1
    const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
    while (i <= e2) {
      patch(null, (c2[i] = normalizeVNode(c2[i])), container, anchor, parentComponent)
      i++
    }
  }
}
// 4. 新节点耗尽：剩余(旧)全是删除 → 卸载
else if (i > e2) {
  while (i <= e1) {
    unmount(c1[i], parentComponent)
    i++
  }
}
```

`i > e1` 表示旧侧先耗尽：新数组剩下的节点没有任何旧对应，是纯新增。批量挂载时锚点取 `c2[e2 + 1].el`——紧挨这段新区之后的那个节点的真实 DOM，insert 把新节点逐个插到它前面；没有右邻就退回 `parentAnchor`（整组 children 之后的参照，1.1 节传入的那个）。反过来 `i > e2` 是新侧先耗尽，旧数组剩下的全是被删项，逐个 unmount。

锚点这行值得马上走一个最小例。旧 [a, b]、新 [x, a, b]：第 1 步在 a 对 x 处扑空，i 停在 0；第 2 步从尾部吃掉 b、a 两对，e1 退到 -1、e2 退到 0；第 3 步判定 i(0) > e1(-1) 成立——剩下的 c2[0] 即 x 是纯新增。锚点取 `c2[e2 + 1].el`，正是刚被第 2 步原地 patch 过的 a：它已经站在最终位上，insert 把 x 插到它前面，一次挂载收工。头部插入因此只花「一趟失败的前缀扫描、一趟后缀扫描、一次 insert」，全程没碰 keyToNewIndexMap。

为什么这两步敢直接下「纯增删」的判断？因为前两步已经扫过：走到这里时，任何一对「旧开头对新开头」「旧结尾对新结尾」都不再同型同 key，两端已经没有可复用的了。头部插入走第 3 步，尾部删除走第 4 步，都不需要任何移动。真正麻烦的是两边都有剩余、顺序还乱了——第 5 步，keyed diff 的核心。

## 1.7 第 5 步（上）：查表配对，记下旧下标

乱序区记为旧侧 `[s1, e1]`、新侧 `[s2, e2]`。先为新侧建一张倒排表 `keyToNewIndexMap`（key → 新下标），再遍历旧侧逐一认领：

```ts
// packages/runtime-core/src/renderer.ts —— patchKeyedChildren 第 5.2 步（节选，j/patched 计数器与建表循环从略）
const toBePatched = e2 - s2 + 1
let moved = false
let maxNewIndexSoFar = 0
// newIndexToOldIndexMap[newIndex-s2] = oldIndex+1（+1 是为了 0 表示“新节点”）
const newIndexToOldIndexMap = new Array(toBePatched)
for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0

for (i = s1; i <= e1; i++) {
  const prevChild = c1[i]
  if (patched >= toBePatched) {
    // 新节点全 patch 完了，剩下的旧节点只能删除
    unmount(prevChild, parentComponent)
    continue
  }
  let newIndex
  if (prevChild.key != null) {
    newIndex = keyToNewIndexMap.get(prevChild.key)
  } else {
    // 无 key：在新区里找一个「同型且还没被占位」的（循环体从略）
  }
  if (newIndex === undefined) {
    unmount(prevChild, parentComponent)
  } else {
    newIndexToOldIndexMap[newIndex - s2] = i + 1
    if (newIndex >= maxNewIndexSoFar) {
      maxNewIndexSoFar = newIndex
    } else {
      moved = true
    }
    patch(prevChild, c2[newIndex] as VNode, container, null, parentComponent)
    patched++
  }
}
```

走读配对循环。每个旧孩子拿 key 去表里查新下标：查不到说明被删除，unmount；查得到就 `patch(prevChild, c2[newIndex])`。注意这两个 vnode 的 type 与 key 必然相同——查表命中才走到这里——patch 内部的 isSameVNodeType 检查必然通过，真实 DOM（el）被安全复用。`patched` 达到 `toBePatched` 后新侧已全部对上号，剩余旧节点只剩删除一种命运。

三个细节值得停一下。其一，`newIndexToOldIndexMap` 的下标是「新下标 - s2」，值是「旧下标 + 1」。为什么加一？因为 0 要留给哨兵：数组默认值 0 表示「这个新位置还没有旧节点认领」，是个待挂载的新节点；旧下标 0 加一变 1，避开与哨兵撞车。

其二，`maxNewIndexSoFar` 记录配对中见过的最大新下标。新下标一旦回退（小于它），说明有节点在新序列里排到了前面——相对顺序乱了，moved 置真；顺序没乱就一个都不用动，后面第 5.3 步的 LIS 也直接省掉。

其三，无 key 的回退分支拿「同型且未被占位」当条件顺序找。1.3 节的伏笔在此兑现：无 key 时 isSameVNodeType 只比 type，第 1 步就把同位置的同类节点当成了同一个，逐位改写。朴素版 B 果然不是稻草人，它就是无 key 世界的真实行为。

三个细节都发生在同一个循环里，拿旧 [a, b, c, d]、新 [d, a, b, c] 把每轮的账面摆开（此例 s1 = s2 = 0、toBePatched = 4，建表产物 d→0、a→1、b→2、c→3）：

| 旧下标 i | prevChild | 查表 newIndex | 档案写入 | maxNewIndexSoFar | moved | patched |
|----------|-----------|---------------|----------|------------------|-------|---------|
| 0 | a | 1 | map[1] = 1 | 0 → 1 | false | 1 |
| 1 | b | 2 | map[2] = 2 | 1 → 2 | false | 2 |
| 2 | c | 3 | map[3] = 3 | 2 → 3 | false | 3 |
| 3 | d | 0 | map[0] = 4 | 3（走 else，不再抬） | 置真 | 4 |

每行同时干两件事：写档案，给 5.3 备料。前三行 newIndex 一路走高，maxNewIndexSoFar 逐行抬升、moved 纹丝不动——新序列里相对顺序没乱。第四行 d 的 newIndex 是 0，小于 maxNewIndexSoFar 的 3，进了 else 分支：moved 置真。这份 [4,1,2,3] 随后就是 getSequence 的输入，「只动 d 一个」的全部依据都在里面。

配对完成时，`newIndexToOldIndexMap` 已是一份完整档案——每个新位置来自旧侧哪个下标。剩下的问题只有一个：谁动，谁不动。

## 1.8 第 5 步（下）：moved 才请出 LIS，从后往前挂与移

配对之后的收尾也有一个朴素版：按新顺序把每个节点都 move 一遍，各自插到正确位置。结果正确，但做了多余的功——ABCD 变 BCDA 时 B、C、D 的相对顺序根本没变，一次都不必动。移动是昂贵的 DOM 操作（触发重排），「能不动的节点一个都别动」才是目标。这是本章第二组「朴素 → 翻车 → 演进」：朴素收尾全量移动，翻车在浪费；仓库的答案分三层收紧——moved 为假整段跳过 LIS 计算，moved 为真才用 `getSequence` 在档案里挑「不必动的最长集合」，遍历从后往前、只移动集合之外的节点：

```ts
// packages/runtime-core/src/renderer.ts —— patchKeyedChildren 第 5.3 步（节选）
// 5.3 移动 + 挂载：只有 moved 才算 LIS；从后往前，用「后一个已就位的节点」当锚点
const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : EMPTY_ARR
j = increasingNewIndexSequence.length - 1
for (i = toBePatched - 1; i >= 0; i--) {
  const nextIndex = s2 + i
  const nextChild = c2[nextIndex] as VNode
  const anchor = nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor

  if (newIndexToOldIndexMap[i] === 0) {
    // 新节点 → 挂载
    patch(null, nextChild, container, anchor, parentComponent)
  } else if (moved) {
    // 不在 LIS 里的节点才需要移动
    if (j < 0 || i !== increasingNewIndexSequence[j]) {
      move(nextChild, container, anchor)
    } else {
      j--
    }
  }
}
```

锚点取 `c2[nextIndex + 1].el`，即右邻节点的真实 DOM。为什么从后往前？因为 hostInsert 的语义是「插到 anchor 之前」，锚点必须已经就位；倒序遍历时右邻恰是上一轮刚处理完的节点，从前往后则锚点自己还没搬、插出来的位置全错。最右侧没有右邻，退回 parentAnchor——第 5 篇问过的「挂载不叫 append、非要带第三参」，在这里拿到日常消费者。

「从前往后则全错」值得一个反例坐实。假设 5.3 改成正序（i 从 0 到 toBePatched - 1），锚点仍取右邻。选旧 [a, b, c]、新 [c, b, a]——整表反转，档案 [3,2,1]、不动点只剩 a 一个。正序推演每轮：

| 轮次 | 节点 | 锚点取的是谁的 el | 它此刻在哪 | 动作后 DOM |
|------|------|-------------------|------------|------------|
| 初始 | — | — | — | a b c |
| i=0 | c | c2[1] 即 b | 旧位 1（还没轮到它搬） | a c b |
| i=1 | b | c2[2] 即 a | 位 0 | b a c |
| i=2 | a | 无右邻 → parentAnchor | 位 1 | b c a |

终点 b c a，期望是 c b a。病根在第 1 轮就埋下：拿 b 当 c 的锚点时，b 自己还没搬；第 2 轮 b 一动，插在它前面的 c 跟着错位，误差一路传到收尾。倒序遍历没有这个窗口——右邻永远是上一轮刚处理完、已站在最终位的节点，「插到它之前」始终对着终态。rendererKeyedChildren.spec.ts 的整表反转用例锚定的 c b a，就是倒序遍历交出的答案。

循环体三分：映射值为 0（哨兵）走 `patch(null, ...)` 挂载；moved 且下标不在 LIS 里才 move；在 LIS 里就只把游标 j 回退一格。move 本身还要会搬「看起来不是一个节点」的东西：组件 vnode 下钻到 subTree 的根再搬，Fragment 连首尾锚点和全部子节点一起搬，普通元素才是一次 hostInsert。

五步各自看过一遍，再选一组具体子节点从头连到尾。旧 [a, b, c, d]、新 [d, a, b, c]——头插型旋转，前两步全扑空、必进第 5 步的典型。每步收工时的账面：

| 阶段 | 判定与动作 | i | e1 | e2 | 收工状态 |
|------|-----------|---|----|----|----------|
| 初始 | 四个游标就位（l2 = 4） | 0 | 3 | 3 | DOM 现行序 a b c d |
| 第 1 步 | c1[0] 的 a 对 c2[0] 的 d：key 不同，break | 0 | 3 | 3 | 前缀为空 |
| 第 2 步 | c1[3] 的 d 对 c2[3] 的 c：key 不同，break | 0 | 3 | 3 | 后缀为空 |
| 第 3/4 步 | i(0) 小于等于 e1(3) 与 e2(3)，两个纯增删分支都不进 | 0 | 3 | 3 | 两边都有剩余 → 第 5 步 |
| 5.1 建表 | 扫新侧 [0,3]：d→0、a→1、b→2、c→3 | 0 | 3 | 3 | keyToNewIndexMap 就绪 |
| 5.2 配对 | 四个旧孩子逐一认领（1.7 节逐步表） | — | — | — | 档案 [4,1,2,3]，moved 置真 |
| 5.3 收尾 | getSequence([4,1,2,3]) = [1,2,3]，倒序 i=3→0 | — | — | — | 只 move 一个 d |

5.3 的四轮倒序单独摆一张表，锚点列是「从后往前」的钥匙：

| i | 节点 | anchor（右邻的 el） | map[i] | LIS 判定 | 动作 |
|---|------|---------------------|--------|----------|------|
| 3 | c | 无右邻 → parentAnchor | 3 | LIS[2]=3=i，j 退一格 | 不动 |
| 2 | b | c2[3].el（c，上一轮确认） | 2 | LIS[1]=2=i，j 退一格 | 不动 |
| 1 | a | c2[2].el（b） | 1 | LIS[0]=1=i，j 退到 -1 | 不动 |
| 0 | d | c2[1].el（a） | 4 | j 已小于 0，不在 LIS | move：插到 a 之前 |

终态 DOM 序 d a b c。全程恰好一次 insertBefore（d 插到 a 之前）、零次 remove、四个节点同一批实例——jsdom 实测与推演逐项吻合：新序四个 li 对应旧序下标 [3,0,1,2]，spy 计得 insertBefore 一次、removeChild 零次。1.9 节的论证与 1.10 节的走读，用的正是这份 [4,1,2,3] 档案。

至此五步走完。最后一个疑问：LIS 凭什么等于「不必动的最长集合」？这需要一次严格论证。

## 1.9 不动集合 ⇔ 旧下标递增，移动数 = n − k

配对完成后的世界很简单：新侧每个位置都有一份档案——它来自旧侧哪个下标。把档案按新顺序排开，就得到「新顺序视角下的旧下标序列」（加一的偏移不影响大小关系）。

什么样的节点集合可以整体不动？它必须同时满足两个顺序：DOM 里的现行顺序（旧下标递增），和新列表要求的顺序（新下标递增）。把候选集合按新下标排好后，第二个条件自动成立，第一个条件就转化为——集合内各节点的旧下标必须严格递增。反过来，任何递增子序列都对应一个可以整体不动的集合。合起来：不必动的集合，恰是旧下标序列的递增子序列。

设乱序区共 n 个节点，选出长度 k 的不动集合，需要移动的就是 n − k 个。k 越大移动越少；k 的上限就是最长递增子序列——一个序列中保持相对顺序的最长严格递增子序列，下文简称 LIS。拿 rotate 验算：ABCD 变 BCDA 时档案为 `[2, 3, 4, 1]`，子序列 `[2, 3, 4]` 递增，对应 B、C、D 整体不动；k = 3、n = 4，只动 A 一个。

对照两个朴素版：全量移动版相当于 k = 0，四个全动；朴素版 B 相当于按位置选不动集合，k 不小、身份却错了。LIS 把 k 取到最大，移动数压到理论下限。于是只剩计算问题：给一个数组，O(n log n) 求出一条 LIS 的下标。答案在 sequence.ts。

## 1.10 getSequence：耐心排序加前驱回溯

```ts
// packages/runtime-core/src/sequence.ts —— getSequence（节选，顶部说明注释从略）
export function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length

  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        // 比当前子序列尾巴大 → 直接扩展，记前驱
        p[i] = j
        result.push(i)
        continue
      }
      // 二分找「第一个 >= arrI 的 result 元素」的位置 u
      // ……（u/v 夹逼的二分循环体从略）
      if (arrI < arr[result[u]]) {
        // 替换，并记录它的前驱（用于最后回溯还原）
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }

  // 顺着前驱链还原真正的 LIS（result 下标 → 原数组下标）
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
```

算法思想是耐心排序（patience sorting）。result 存的是原数组的下标，不变式为：result[u] 是「长度为 u + 1 的递增子序列中，尾元素最小的那个」的下标，因此 arr[result[...]] 天然递增。新元素比尾大就直接追加，子序列变长；否则二分找到第一个不小于它的位置 u 并替换。替换为什么不吃亏？因为它只把同长度的尾换得更小，为后面的元素留出更多接续机会，LIS 的长度不会被破坏。

但替换有代价：result 里的下标可能不再连成一条真实子序列。所以每次追加或替换都把「前驱」记进 p[i]，扫完一轮后从 result 的最后一个下标沿 p 回溯，还原一条真实存在的 LIS。拿 `[2, 3, 4, 1]` 走一遍：

| i | arrI | 动作 | result | p 的变化 |
|---|------|------|--------|----------|
| 0 | 2 | 种子（result 预置 [0]，本轮无变化） | [0] | — |
| 1 | 3 | 大于尾 2 → 追加 | [0, 1] | p[1] = 0 |
| 2 | 4 | 大于尾 3 → 追加 | [0, 1, 2] | p[2] = 1 |
| 3 | 1 | 二分落位 u = 0，替换 | [3, 1, 2] | u 为 0，无前驱可记 |

回溯：result[2] ← 2、result[1] ← p[2] = 1、result[0] ← p[1] = 0，返回 `[0, 1, 2]`——新位置 0、1、2，即 B、C、D，与 1.9 节的手算一致。

顺手把 i=3 那轮的二分补细：探针先落在 mid=1（arr[result[1]] = 3，不小于 1，end 收到 1），再落在 mid=0（arr[result[0]] = 2，仍不小于 1，end 收到 0），u 定在 0——两次都向左收，正是「找第一个不小于它的位置」的形状。

换 1.7 节的真实档案 [4,1,2,3] 再走一遍（同样经仓库 getSequence 实测对拍），这组输入会让「替换不写 p」与「p 的陈值」两处细节现形：

| i | arrI | 判定 | result | p |
|---|------|------|--------|---|
| 种子 | — | result 预置 [0] | [0] | [4,1,2,3]（arr 的副本） |
| 0 | 4 | 尾 arr[0]=4 不小于 4；二分区间空、u=0；4 也不小于 arr[result[0]]，不动 | [0] | [4,1,2,3] |
| 1 | 1 | 二分落位 u=0，替换 result[0]；u=0 无前驱可记 | [1] | [4,1,2,3] |
| 2 | 2 | 尾 arr[1]=1 小于 2，追加；p[2] = 1 | [1,2] | [4,1,1,3] |
| 3 | 3 | 尾 arr[2]=2 小于 3，追加；p[3] = 2 | [1,2,3] | [4,1,1,2] |

回溯：result[2] ← 3、result[1] ← p[3] = 2、result[0] ← p[2] = 1，返回 [1,2,3]，对应新位置 1、2、3——a、b、c 不动，只动 d，与 1.8 节连播的结论闭环。回溯链只经过 p[3] 与 p[2]；p[1] 在 i=1 那轮因 u=0 没被写过，留着的副本值永远不会被读到——前驱数组只在「被链条经过」的位置才需要正确。

这组输入还有个巧合：走完循环 result 本身已是真实链 [1,2,3]，回溯像是没用上。对照上一组 [2,3,4,1] 就不是：i=3 替换后 result 是 [3,1,2]，按值读 arr[3]、arr[1]、arr[2] 得 1、3、4，数值固然递增，可下标 3→1→2 在原数组里是倒着跳的，不构成真实的子序列；回溯靠 p 把链拉回 [0,1,2] 才算数。前驱回溯不是保险带，是替换策略必需的补救。

还有一处没解释：`arrI !== 0` 是干嘛的？这正是哨兵的出口——档案值为 0 的新节点没有旧下标，不参与「旧相对顺序」的比较，直接跳过。这份实现与官方逐行一致：官方 3.5 将它内联在 runtime-core/src/renderer.ts 的 getSequence 里，更早版本也曾放在独立的 sequence.ts，本仓库沿用独立文件的组织。至此，「移动最少」三个字有了完整的机制链：key 让配对成为查表，moved 判定拦下根本不用动的情形，LIS 把必须动的节点数压到下限，倒序遍历让每次插入都有就位的锚点。

## 本章小结

patchChildren 按形态三态分流，数组对数组进入 patchKeyedChildren 五步：前两步同步前后缀，三四步处理纯增删；第五步先以 keyToNewIndexMap 查表配对，档案 newIndexToOldIndexMap 以 0 为「无旧对应」的哨兵，maxNewIndexSoFar 的回退判定 moved。只有 moved 时才计算 LIS：不动集合等价于旧下标的递增子序列，移动数 n − k 随其长度 k 取到下限。getSequence 以耐心排序维护各长度的最小尾、以前驱数组回溯还原。挂载与移动一律从后往前，锚点取右邻已就位的 el。

## 仓库文件索引

- `packages/runtime-core/src/renderer.ts` —— patchChildren 三态分流、patchKeyedChildren 五步、move（组件与 Fragment 的搬运）
- `packages/runtime-core/src/sequence.ts` —— getSequence（LIS，与官方实现逐行一致）
- `packages/runtime-core/src/vnode.ts` —— isSameVNodeType：type 与 key 的身份判定
- `packages/runtime-dom/__tests__/rendererKeyedChildren.spec.ts` —— 12 例行为锚定：头尾增删、移动、反转、未移动节点复用同一 DOM

## 与官方实现的差距

以下均对照 `third_party/vue-core`（v3.5.x）核对：

- **getSequence 逐行一致，无差距**。官方 3.5 将其内联在 `runtime-core/src/renderer.ts`；本仓库独立成 `sequence.ts`，与官方早期版本的文件组织相同。
- **建表与防御**：官方 5.1 建表在 optimized（block 路径）下用 `cloneIfMounted` 复用已挂载 vnode，本仓库统一走 `normalizeVNode`；官方另有 `__DEV__` 下重复 key 的警告，本仓库没有。
- **锚点回退**：官方 anchor 解析对未解析的异步组件有占位回退（`resolveAsyncComponentPlaceholder`，对应 issue #13559/#14173），本仓库直接取 `.el`。
- **patchFlag 的消费面**：官方 patchElement 以 `patchFlag > 0` 进快速路径，与 block 路径（dynamicChildren、patchBlockChildren）配合跳过全量 diff；NEED_PATCH（`1 << 9`）等位由编译器打上、经这些快速路径间接消费。本仓库 renderer 只消费 CLASS/STYLE/PROPS/FULL_PROPS/TEXT，NEED_PATCH 在 shared 里有定义但暂无消费者——第 11 篇展开。

## 动手验证

```bash
npx vitest run packages/runtime-dom/__tests__/rendererKeyedChildren.spec.ts
```

预期输出：1 个测试文件、12 个用例全部通过，覆盖头尾增删、单节点前后移动、整表反转、中间插入，以及「未移动节点复用同一 DOM 元素」（以 `toBe` 断言元素引用相等）。

再跑一个能亲眼看见「移动而非重建」的例子。起 playground（`pnpm dev:playground`），在 `examples/playground/src/main.ts` 里写：

```ts
import { createApp, h, ref } from '@mini-vue/runtime-dom'

const App = {
  setup() {
    const list = ref([{ k: 1, t: 'A' }, { k: 2, t: 'B' }, { k: 3, t: 'C' }, { k: 4, t: 'D' }])
    const rotate = () => {
      list.value = [...list.value.slice(1), list.value[0]]   // ABCD → BCDA
    }
    return { list, rotate }
  },
  render(ctx: any) {
    return h('div', [
      h('button', { onClick: ctx.rotate }, 'rotate'),
      h('ul', ctx.list.map((it: any) => h('li', { key: it.k }, `${it.t}-${it.k}`))),
    ])
  },
}
createApp(App).mount('#app')
```

页面初始为 `A-1 B-2 C-3 D-4`。先在 DevTools 里给第一个 li（A-1）执行 `setAttribute('data-mark', 'x')`，再点 rotate。预期：列表变为 `B-2 C-3 D-4 A-1`，带 `data-mark` 的节点出现在末尾——A 被移动而非重建，B、C、D 一次都没动。对照实验：删掉 `h('li', ...)` 里的 key 再来一遍，带标记的节点停在原地、文本被改写成 B-2——节点身份跟位置走，1.3 节的错位现场就在眼前。

## 延伸阅读

- 官方文档：[渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html)（更新管线与 patch 的官方描述）、[特殊属性 key](https://cn.vuejs.org/api/special-attributes.html#key)（key 的语义与用 index 作 key 的告诫）
- core 源码：`vuejs/core` 的 `packages/runtime-core/src/renderer.ts`（patchKeyedChildren 五步与内联的 getSequence）
- 《Vue.js 设计与实现》第 9 章（简单 Diff 算法）、第 10 章（双端 Diff 算法）、第 11 章（快速 Diff 算法）——书用三章推导三种 diff，Vue 3 实装的是第 11 章的快速 Diff，即本章的五步算法

> 下一篇：到本章为止，vnode.type 还是字符串。当它是一个对象——组件定义——时，patch 会走进 processComponent：组件实例怎么建、setup 怎么跑、更新为什么是异步批量的？我们进入组件的本质。
