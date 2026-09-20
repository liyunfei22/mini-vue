# 阶段打卡表（STAGE_STATUS）

> 每到达一个 review gate，填入：**学到了什么** / **绿的测试** / **下次 checkpoint**。
> 全绿 = ✓ 进行中 = 🚧 未开始 = ○ 没通过 = ✗

## 阶段 1 — 基建 + 响应式基础（✓）

**当前状态**：✅ 已完成（2026-09-20），review gate 通过

**交付清单**
- [x] pnpm monorepo 脚手架（workspace / tsconfig / vitest / git）
- [x] `packages/shared` 基础工具
- [x] `packages/reactivity`: operations / dep / effect / reactive / baseHandlers / ref / computed
- [x] 镜像测试：effect / reactive / readonly / ref / computed（**73 个用例全绿**）
- [x] 中文文档：`docs/01-响应式基础.md`

**Review Gate 判断题**（答案见 `docs/01-响应式基础.md` 第 3 节）
1. trigger 里为什么要把 dep 拷贝一份 `[...dep]` 再遍历？
2. computed 的 `_dirty` 位如何实现「lazy + 只重算一次」？
3. 新增 key 为什么只影响 ITERATE_KEY 订阅者、不影响具体 key 订阅者？

**本轮所学笔记**：
- 响应式 = Proxy + targetMap 两层索引 + 写时触达；<br>
- 分支切换靠「每次 run 前先 cleanup」；trigger 必须稳定快照遍历；<br>
- computed 用 scheduler 置脏代替重算 = lazy 的来源；<br>
- ref 面向原始值（容器对象），reactive 面向对象（Proxy）；reactive 里的 ref 读时解包/写时透传。

---

## 阶段 2 — 响应式进阶（✓）

**当前状态**：✅ 已完成（2026-09-20），review gate 通过

**交付清单**
- [x] `effectScope.ts` + effect.ts 集成（构造器自动登记）
- [x] `collectionHandlers.ts` + reactive.ts 四件套接入
- [x] ref.ts 扩展：shallowRef / triggerRef / customRef / proxyRefs
- [x] 镜像测试：effectScope / Map / Set / refAdvanced（**111 用例全绿**，tsc 0 错误）
- [x] 中文文档：`docs/02-响应式进阶.md`

**Review Gate 判断题**（答案见 `docs/02-响应式进阶.md` 第 2 节）
1. `onScopeDispose` 何时执行、以什么顺序？
2. `markRaw` 在 pinia 里具体防什么？
3. router 的 `currentRoute` 为什么必须用 `shallowRef`？

**本轮所学笔记**：
- scope 是组件/pinia 生命周期的地基；`scope.stop()` = 批量断连 + 清理 + 递归子树；<br>
- 集合必须「改道 instrumentations」才能绕开内部槽 + 翻译成 track/trigger；<br>
- `ITERATE_KEY`（整体结构）vs `MAP_KEY_ITERATE_KEY`（仅键集）双锚点；<br>
- 深响应式打开程度可逐格控制：ref/reactive（深）、shallowRef/shallowReactive（浅）、markRaw（关）。

## 阶段 3 — runtime-core 基础（✓）

**当前状态**：✅ 已完成（2026-09-20），review gate 通过

**交付清单**
- [x] `runtime-core`: vnode / h / renderer（挂载+朴素更新）/ component(instance+setup) / apiInject / lifecycle / scheduler / componentPublicInstance / renderSlot
- [x] `runtime-dom`: nodeOps / patchProp 骨架 / createApp
- [x] 镜像测试：scheduler + renderer DOM 行为（**132 用例全绿**，tsc 0 错误）
- [x] `examples/playground`：纯 h() 手写嵌套组件 demo（vite 构建通过）
- [x] 中文文档：`docs/03-runtime-core-基础.md`

**Review Gate 判断题**（答案见 `docs/03` 第 2 节）
1. setup 完成后 setupState 以什么形式进入渲染上下文？
2. provide/inject 原型链在跨两层组件时如何命中？
3. queueJob 为什么去重 + 为什么父先子？

**本轮所学笔记**：
- instance.update = effect(componentUpdateFn, { scheduler }) → 组件响应式自更新的真正接线；<br>
- patch 先取 anchor 再 unmount（顺序错了会 NotFoundError —— 本次真实踩坑）；<br>
- getNextHostNode 返回的是 nextSibling 而非自身；<br>
- slots 必须先初始化为可写对象（EMPTY_OBJ 是 frozen 的 → Cannot add property 坑）；<br>
- runtime-core 应 re-export reactivity（与真 Vue 对齐，ref 才能从一层拿到）。

## 阶段 4 — runtime-core 进阶（○）

## 阶段 5 — 编译器闭环（○）

## 阶段 6 — v-model / slots / 全局 API（○）

## 阶段 7 — mini-vue-router（○）

## 阶段 8 — mini-pinia（○）

## 阶段 9 — 全家桶自洽 capstone（○）