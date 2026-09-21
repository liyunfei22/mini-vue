# 阅读地图：官方 Vue ↔ 我们的 mini

> 真源码（vuejs/core v3.5.43）在 `third_party/vue-core`（浅克隆，离线可读）。
> 每一项给你：官方文件 → 我们实现 → 阶段 → 怎么读（先跑测试再读码）。

## 响应式（packages/reactivity）

| 官方 | mini（packages/reactivity/src） | 阶段 | 怎么读 |
|---|---|---|---|
| `__tests__/effect.spec.ts` | `../__tests__/effect.spec.ts` | 1 | 先跑它锁行为（分支切换/停止/scheduler） |
| `effect.ts` | `effect.ts`（经典 Set+cleanup 版） | 1 | 对照 3.5 的 Link+EffectFlags 差异在文件头写了 |
| `dep.ts` | `dep.ts` | 1 | targetMap 两层索引 |
| `baseHandlers.ts` | `baseHandlers.ts` | 1 | get/set 四个开关组合 |
| `reactive.ts` / `ref.ts` / `computed.ts` | 同名 | 1 | computed 的 _dirty 位 |
| `effectScope.ts` | `effectScope.ts` | 2 | run/on/off/stop；pinia 地基 |
| `collectionHandlers.ts` | `collectionHandlers.ts` | 2 | 内部槽 → instrumentations 改道 |
| `constants.ts` | `operations.ts` | 1 | ITERATE_KEY / 操作类型 |
| `watch.ts`(3.5 移入) | runtime-core `apiWatch.ts` | 4 | baseWatch 分工：scheduler 由 runtime 注入 |

## 运行时（packages/runtime-core）

| 官方 | mini | 阶段 | 怎么读 |
|---|---|---|---|
| `renderer.ts` | `renderer.ts` | 3–4 | 先读 patch 分发；再啃 patchKeyedChildren 五步 |
| `sequence.ts`(并入 renderer) | `sequence.ts` | 4 | LIS：耐心排序+前驱回溯 |
| `vnode.ts` / `h.ts` | 同名 | 3 | shapeFlag 位运算；h 参数歧义 |
| `component.ts` | `component.ts` | 3 | 实例=小宇宙；setup 与 scope 握手 |
| `componentOptions.ts` | `componentOptions.ts` | 7-1 | Options 合并 data/computed/methods/watch |
| `apiWatch.ts` | `apiWatch.ts` | 4 | doWatch 归一化 + flush 三通道 + cleanup |
| `scheduler.ts` | `scheduler.ts` | 3 | queueJob 去重+二分插序+pre/post |
| `BaseTransition.ts` / `Transition.ts` | `components/*` | 7-2 | vnode.transition 钩子→renderer 调用 |
| `KeepAlive.ts` | `components/KeepAlive.ts` | 7-2 | _deactivate/_activate + 隐藏式去激活 |
| `apiInject.ts` | `apiInject.ts` | 3 | provide 原型链 |
| `lifecycle.ts` | `lifecycle.ts` | 3 | injectHook 短键数组 |
| `componentPublicInstance.ts` | 同名 | 3/6/7-1 | 完整查找链 |

## 编译（packages/compiler-core / compiler-dom）

| 官方 | mini | 阶段 | 怎么读 |
|---|---|---|---|
| `parser.ts`+`tokenizer.ts`(3.5 拆) | `parse.ts`(经典单文件) | 5 | 状态机+光标 advance |
| `transform.ts` | `transform.ts` | 5 | nodeTransforms 进入/退出 + 父指针线程化 |
| `codegen.ts` | `codegen.ts` | 5/7-3 | with(_ctx) vs prefixIdentifiers 差异 + patchFlag/block/hoist |
| `transforms/vIf.ts vFor.ts transformElement.ts` | 同名 | 5/7-3 | 结构指令摘除时序 / buildProps+patchFlag |
| `runtimeHelpers.ts` | 同名 | 5 | helper 符号表 ↔ 运行时导出对接 |
| `parserOptions.ts` | compiler-dom `parserOptions.ts` | 5 | isNativeTag/void 标签 |
| template-explorer.vuejs.org | — | 5 | 我们的产物与它做「结构对拍」 |

## 聚合包

| 官方 `vue` 包 | mini `@mini-vue/vue` | 阶段 | 作用 |
|---|---|---|---|
| run runtime+compile 合一 | `src/index.ts` | 5/6 | createApp + compileToFunction + registerRuntimeCompiler |

## 高效阅读的顺序建议

1. 想复现某行为 → 先跑真源码同目录 `__tests__`（`third_party/vue-core/packages/<x>/__tests__`）
2. 想看实现 → 读官方 src → 对照 mini 同名文件（差异注释都写在 mini 文件头）
3. 想验证理解 → 做阶段打卡表（docs/14）里的 review gate 判断题