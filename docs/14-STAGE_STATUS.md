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

## 阶段 2 — 响应式进阶（○）

## 阶段 3 — runtime-core 基础（○）

## 阶段 4 — runtime-core 进阶（○）

## 阶段 5 — 编译器闭环（○）

## 阶段 6 — v-model / slots / 全局 API（○）

## 阶段 7 — mini-vue-router（○）

## 阶段 8 — mini-pinia（○）

## 阶段 9 — 全家桶自洽 capstone（○）