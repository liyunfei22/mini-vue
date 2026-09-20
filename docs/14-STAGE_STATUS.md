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

## 阶段 4 — runtime-core 进阶（✓）

**当前状态**：✅ 已完成（2026-09-20），review gate 通过

**交付清单**
- [x] keyed children diff 五步 + LIS（`sequence.ts`）+ move/patchChildren 三态
- [x] `apiWatch.ts`：watch/watchEffect/watchPostEffect + doWatch（source 归一化/flush 分流/cleanup/deep/traverse）
- [x] 事件 invoker 缓存（el.__vei）+ createApp 全量（use/provide/component/config.globalProperties/unmount）+ resolveDynamicComponent + currentRenderingInstance
- [x] 镜像测试：keyed diff 全套 / apiWatch / rendererAdvanced（**164 用例全绿**，tsc 0 错误）
- [x] 中文文档：`docs/04-runtime-core-进阶.md`

**Review Gate 判断题**（答案见 `docs/04` 第 2 节）
1. 手推一个 `[3,1,2]` 的 LIS 例子，LIS 为什么保证移动最少？
2. invoker 缓存比每次 remove+add 快在哪里？
3. watch 的 post flush 与 nextTick 的区别？

**本轮所学笔记**：
- keyed diff = 前缀/后缀/剩余增/剩余删/未知区(LIS) 五部曲；倒序移动、锚点取下一已就位节点；<br>
- LIS 长度决定「不用动」的节点，移动数 = 总数 − LIS 长 = 理论最少；<br>
- watch 三 flush 对应三条队列；cleanup 在下次触发前与 stop 时执行；<br>
- reactive 当 source 默认深遍历；resolveDynamicComponent 传错变量(this→ctx)是本次真实踩坑；<br>
- 自触发守卫：watch cb 允许递归（allowRecurse）。

## 阶段 5 — 编译器闭环（✓）

**当前状态**：✅ 已完成（2026-09-20），review gate 通过

**交付清单**
- [x] `compiler-core`: ast / parse（状态机）/ transform（管线+父指针线程化）/ codegen（with(_ctx)+helpers 解构）/ compile
- [x] transforms: transformIf(v-if/v-else)/transformFor/renderList/transformElement(buildProps+buildSlots)/transformText/v-model 内嵌
- [x] `compiler-dom`: parserOptions(isNativeTag/voidTags) + compile
- [x] `@mini-vue/vue` 聚合包：compileToFunction（new Function('Vue',code)）+ registerRuntimeCompiler（`template:` 选项可用）
- [x] 测试：compiler.spec（结构）+ compileToFunction.spec（端到端 11 个）（**184 用例全绿**，tsc 0 错误）
- [x] 中文文档：`docs/05-编译器-template-render闭环.md`

**Review Gate 判断题**（答案见 docs/05 第 2 节）
1. 手推 `<div v-for="x in xs"><span>{{x}}</span></div>` 的 transform 全路径
2. v-else 与 v-if 靠什么数据结构建立逻辑链？
3. helpers 如何从 transform 流到 codegen 产物的 import 头部？

**本轮所学笔记**：
- compiler = parse(状态机) → transform(结构化) → codegen(拼串)，产物 `with(_ctx)` 包裹；<br>
- 结构指令「进入摘指令 + 退出移除元素」+ `node=currentNode` 跟替换；<br>
- 编译路径 createElementVNode 单 vnode children 不包数组（板块挂载兜底）；组件标签必须走 createVNode；<br>
- template#slot 的 slot 体 = 子节点；renderSlot 单子节点去 Fragment 锚点；<br>
- 本阶段踩坑 7 个（正则空格/插值吞文本/closeIndex/else 时序/数组/组件/模板 slot）。

## 阶段 6 — v-model 指令 / 全局 API（✓）

**当前状态**：✅ 已完成（2026-09-20），review gate 通过

**交付清单**
- [x] runtime-dom 指令：vModelCheckbox/Radio/Select（`_assigning` 防重入）+ vShow
- [x] renderer 指令钩子：invokeDirectiveHook（created→mounted / updated / unmounted）
- [x] 编译器：v-model 按 type 分流（text 内联 / checkbox/radio/select 指令化）+ v-show
- [x] defineComponent / useSlots / useAttrs 公开导出
- [x] 测试：v-model 各形态 / v-show / 自定义指令 / useSlots（**191 用例全绿**）
- [x] 中文文档：`docs/06-v-model指令与全局API.md`

**Review Gate 判断题**（答案见 docs/06 第 2 节）
1. v-model 指令对象在编译产物里长什么样（withDirectives 四元组）？
2. scoped slot 的"父传函数"与 renderSlot 的对应关系？
3. globalProperties 与组件同名字段谁优先？

**本轮所学笔记**：
- v-model 双路线：文本内联 / 复选-单选-下拉走运行时指令（_assigning 防重入）；<br>
- 指令钩子时机：created→mounted / updated / unmounted；自定义指令驱动测试全套过；<br>
- public this 查找链含 $slots/$attrs/$emit/$props + globalProperties 兜底。

## 阶段 7 — 内核补全（✓）

> 2026-09-20 计划修订：router / pinia 取消，本项目只做 vue 内核。阶段 7 把此前降级的
> 有价值核心项补回；阶段 8 用展示 app 收官。

- [x] **7-1** Options API 基础（data/computed/methods/watch/生命周期选项 + publicThis 合并）+ v-model 修饰符（.trim/.number/.lazy）（✅ 199 测试绿）
- [x] **7-2** Transition（CSS 过渡简版）+ KeepAlive（隐藏式去激活 + 状态保留）+ 动态组件 （✅ 203 测试绿）
- [x] **7-3** 编译器优化（patchFlag 动态标记 + block 树 dynamicChildren + 静态提升 hoistStatic）（✅ **208 测试绿**，tsc 0 错误）

**vue 内核补全收官** 🎉 —— 阶段 1–7 全部完成。

## 阶段 8 — mini-vue 展示 app + 文档收尾（🚧 待开工）

## 阶段 9 — ❌ 已取消（原 capstone 全家桶自洽，随 router/pinia 一并移除）