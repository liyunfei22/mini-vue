# 阶段 3 — runtime-core 基础：vnode / renderer / 组件 / 调度器

> 里程碑：`pnpm test` 全绿（132 个用例），tsc 0 错误，playground vite 构建通过。
> 真源码锚点：`third_party/vue-core/packages/runtime-core/`（v3.5.43）

## 1. 这一阶段学到了什么

一句话：**Vue 的运行时 = 「vnode 描述世界」 + 「renderer 把它变成 DOM」 + 「组件实例管理每个组件的独立小宇宙」 + 「scheduler 把散落的更新收敛成一次微任务刷新」**。

```
    h('div', {class:'a'}, text)
            │ createVNode 归一化
            ▼
         vnode { type, props, shapeFlag, el, component }
            │ render(vnode, container) → patch(null, vnode)
            ▼
         renderer 分发
        ┌────────┴────────┐
   TEXT/COMMENT/FRAGMENT │ ELEMENT        │ COMPONENT
        processText       processElement    processComponent
                           mountElement     mountComponent
                                             ├─ createComponentInstance
                                             ├─ setupComponent（跑 setup）
                                             └─ setupRenderEffect
                                                 = instance.update = effect(fn, { scheduler })
                                                    响应式依赖变 → scheduler → queueJob → 微任务 flush
```

### 概念与文件对照

| 概念 | mini 位置 | 一句话 |
|---|---|---|
| vnode 位图 | `vnode.ts` shapeFlag | 一个数字（位或）标记「元素/组件/文本子级/数组子级…」 |
| 平台无关渲染器 | `renderer.ts` createRenderer(options) | DOM 只通过 options 六个 host 原语注入 |
| patch 六路分发 | `renderer.ts` patch | 同层比较 + 种类分发（Text/Comment/Fragment/Element/Component） |
| 组件实例 | `component.ts` | props/attrs/slots/setupState/render/subTree/update + 生命周期数组 + scope |
| 当前实例 | `currentInstance.ts` | getCurrentInstance 的秘密：setup 同步执行窗口里的全局指针 |
| provide/inject | `apiInject.ts` | 原型链注入：首次 provide 造 Object.create(parentProvides) |
| 调度器 | `scheduler.ts` | queueJob 去重 + 二分插序（父先子）+ pre/post 三条队列 |
| 公共 this | `componentPublicInstance.ts` | proxy.get 按 setupState→props→ctx 顺序取值 |

### 三个关键机制

**① 组件如何"响应式更新"**：`instance.update = effect(componentUpdateFn, { scheduler })`。
首次 run 是挂载；此后任何响应式依赖变化 → trigger → 因为它有 scheduler → `queueJob(instance.update)` —— 不立即重渲染，等微任务批量刷新。这就把「几百处数据变更」收敛成「每个组件最多一次 DOM 更新」。

**② setup 如何与 effect scope 握手**：`setCurrentInstance(instance)` 会 `instance.scope.on()`——
setup 期间 new 的 effect/computed 自动登记进组件专属 scope；组件卸载 `scope.stop()` 一并清理。
阶段 2 学的作用域在组件这里第一次真正派上用场。

**③ provide/inject 为什么是原型链**：默认子组件 `provides === parentProvides`（零成本继承），
首次 provide 才 `Object.create(parentProvides)` 造新面。inject 沿实例 chain 一直往上摸，
祖先任意层 provide 过的 key 都能命中，且 O(1) 创建。

---

## 2. review gate 参考答案

### Q1：setup 完成后，setupState 以什么形式进入渲染上下文？

两个通道：
1. **公共代理（this / render 的第一实参）**：`instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)`，渲染函数里读 `this.count` 或第一个参数 `_ctx.count` → get 拦截按 **setupState → props → ctx** 依次命中。
2. **proxyRefs 浅解包**：setup 返回的对象经过 `proxyRefs`，属性是 ref 时读出裸值 —— 模板里写 `{{ count }}` 而不是 `{{ count.value }}`。这就是为什么 setup 里 `const count = ref(0)`，渲染却直接能用 `ctx.count`。

### Q2：provide/inject 原型链在跨两层组件时如何命中？

- A 组件第一次 `provide(k)` → `A.provides = Object.create(rootProvides)` 并设 k。
- B（不 provide）→ `B.provides = A.provides`（同一引用，因为 B 没 create 新面）。
- C `inject(k)` → 从 `B.provides`（= A.provides）开始：`k in provides` 命中 → 返回。
跨层零拷贝、零遍历成本 —— **问题被「每次 provide 只沿原型链长一格」的设计吸收掉了**。

### Q3：queueJob 为什么去重 + 为什么父先子？

- **去重**：同一 job 在同一轮刷新里只执行一次 —— `count.value` 在渲染里被读 N 次、改 N 次，App.update 只入队一次；否则同一组件会被同步触发成百上千次。
- **父先子**：父组件 uid 小，job 按 id 二分插入升序队列 → 父 update 先执行 = 数据从根往下流、子组件「收到新 props 时父组件视图已就绪」。pre/post 队列次序：`pre → job → post`（watch 的 pre flush 阶段 4 接入）。

---

## 3. mini 取舍（与真源码差异）

| 特性 | 3.5.x | mini |
|---|---|---|
| 依赖结构 | 渲染 effect 带 allowRecurse + job flags | 简化 QUEUED 位 + 身份去重 |
| patchChildren | keyed diff + 双端 5 步 | **全量重建**（阶段 4 补） |
| 事件 | invoker 缓存（el._vei） | 朴素 add/removeEventListener（阶段 4 补） |
| async setup | 有状态恢复 | 不支持（setup 必须同步） |
| 优化 | patchFlag/block/hoist 等 | 全部阶段 4/5 |
| props 更新 | fullUpdateProps + 事件名折叠 | 原地 merge |

## 4. 冒烟验证

```bash
pnpm test          # 132 passed
npx tsc -p tsconfig.json --noEmit   # 0 error
pnpm dev:playground # 打开浏览器看 h() 手写 demo
```

## 5. 自查表

- [ ] 能画出 componentUpdateFn 的 mount/update 两条路径
- [ ] 能说清 instance.update 的 scheduler 为什么是"进队列"而不是"直接跑"
- [ ] 能解释为什么 patch 里要先算 anchor 再 unmount 旧节点（本次踩坑：NotFoundError）
- [ ] 能区分 props/attrs/slots 三条数据通道各自的流向