/**
 * dep.ts —— 依赖(盒)：一个响应式数据对应的「订阅者集合」
 *
 * 对应真 Vue packages/reactivity/src/dep.ts。
 *
 * 教学模型里：Dep 就是一个 `Set<ReactiveEffect>`。
 * 真 Vue 3.4+ 为了性能换成了「版本号 + 双向链表 Link」，行为语义完全一致：
 *   - 每次 effect 重跑前，按其 deps 链表把每个 dep 清除（cleanup）
 *   - 依赖没变时 track 命中缓存，无需重插
 * 我们 mini 用 Set + effect.deps 数组，理解成本低得多；3.5 的内部差异写在阶段文档里。
 */
import type { ReactiveEffect } from './effect'

export type Dep = Set<ReactiveEffect>

/** 构造一个空 dep；`effects` 参数为「预置订阅者」（mini 备用，真 Vue 也支持） */
export function createDep(effects?: ReactiveEffect[]): Dep {
  return new Set<ReactiveEffect>(effects)
}