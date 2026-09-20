/**
 * scheduler.ts —— 作业调度：把同步触发收敛成微任务里的批量刷新
 *
 * 对应真 Vue packages/runtime-core/src/scheduler.ts。
 *
 * ## 为什么要调度器？
 * 响应式触发是同步的 —— 如果没有调度器，一次「改数据」会让依赖它的组件渲染成百上千次。
 * scheduler 把组件的「更新函数」作为 job 入队并去重：同一次渲染周期内同一组件只更新一次。
 *
 * ## 三条队列
 *   queue           渲染作业（自带 id，二分插序保证 父先于子）
 *   pendingPreFlush  渲染前的作业（watch flush:'pre' 等）   —— 阶段 4 apiWatch 用
 *   pendingPostFlush 渲染后的作业（onMounted 等生命周期、nextTick 后的回调）
 *
 * 刷新顺序：pre → 主队列 → post；执行期间再入队的作业会再次排队直到稳定。
 *
 * ## 与真 Vue 3.5 的差异
 * 3.5 把 pre 作业也混进主 queue（用 PRE 位区分）并用 flags 位去重；mini 用「独立数组 +
 * identity 去重」，语义等价、阅读顺。
 */
import { isArray, NOOP } from '@mini-vue/shared'

export interface SchedulerJob extends Function {
  id?: number
  flags?: number
  i?: any
}

export type SchedulerJobs = SchedulerJob | SchedulerJob[]

const QUEUED = 1

const queue: SchedulerJob[] = []
// -1 表示「当前没有任何作业正在执行」：二分插入从 index 0 起搜（真 Vue 同约定）
let flushIndex = -1

const pendingPostFlushCbs: SchedulerJob[] = []
let activePostFlushCbs: SchedulerJob[] | null = null
let postFlushIndex = 0

const pendingPreFlushCbs: SchedulerJob[] = []
let preFlushIndex = 0

let isFlushing = false
let isFlushPending = false

const resolvedPromise = /*#__PURE__*/ Promise.resolve()
let currentFlushPromise: Promise<any> | null = null

const getId = (job: SchedulerJob): number =>
  job.id == null ? Infinity : job.id

/**
 * 等本次刷新完成后再执行 fn（不传则返回那个 Promise）。
 */
export function nextTick<T = void>(fn?: () => T): Promise<T | void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(fn) : p
}

/**
 * 把渲染作业入队：去重（QUEUED 位）+ 按 id 二分插序（父组件 uid 小 → 先执行）。
 * 若没有正在刷新的流水，则安排一个微任务。
 */
export function queueJob(job: SchedulerJob) {
  // 同一作业已在队列（含正在执行的部分）→ 跳过
  if (!(job.flags! & QUEUED)) {
    job.flags = (job.flags || 0) | QUEUED

    const jobId = getId(job)
    const last = queue[queue.length - 1]
    if (!last || jobId >= getId(last)) {
      queue.push(job)
    } else {
      // 二分找插入位，保证 id 升序
      let start = flushIndex + 1
      let end = queue.length
      while (start < end) {
        const mid = (start + end) >>> 1
        if (getId(queue[mid]) < jobId) {
          start = mid + 1
        } else {
          end = mid
        }
      }
      queue.splice(start, 0, job)
    }
    queueFlush()
  }
}

export function queuePreFlushCb(cb: SchedulerJob) {
  if (!isFlushing) {
    if (!pendingPreFlushCbs.includes(cb)) {
      pendingPreFlushCbs.push(cb)
    }
  } else {
    // 正在刷新：推迟到下一轮微任务避免就地修改正在跑的数组
    nextTick(() => queuePreFlushCb(cb))
  }
  queueFlush()
}

export function queuePostFlushCb(cb: SchedulerJob | SchedulerJob[]) {
  if (!isArray(cb)) {
    if (activePostFlushCbs && !(cb as SchedulerJob).flags) {
      // 正在执行 post 队列：插到当前 index 后（避免重复）
      activePostFlushCbs.splice(postFlushIndex + 1, 0, cb as SchedulerJob)
    } else if (!((cb as SchedulerJob).flags! & QUEUED)) {
      pendingPostFlushCbs.push(cb as SchedulerJob)
      ;(cb as SchedulerJob).flags = ((cb as SchedulerJob).flags || 0) | QUEUED
    }
  } else {
    for (let i = 0; i < cb.length; i++) {
      pendingPostFlushCbs.push(cb[i])
    }
  }
  queueFlush()
}

function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

/** 主刷新：pre → 主队列 → post，循环到稳定 */
function flushJobs() {
  isFlushPending = false
  isFlushing = true

  // 1. pre 作业优先（插槽/渲染前的 watch 回调）
  flushPreFlushCbs()

  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job) {
        // 清掉 QUEUED 再执行，允许 wait：执行中途又能被 queueJob
        job.flags! &= ~QUEUED
        job()
      }
    }
  } finally {
    flushIndex = -1
    queue.length = 0

    // 2. post 作业（onMounted/onUpdated 等）
    flushPostFlushCbs()

    isFlushing = false
    currentFlushPromise = null

    // 3. 刷新中又来了新作业 → 再来一轮
    if (queue.length || pendingPostFlushCbs.length || pendingPreFlushCbs.length) {
      flushJobs()
    }
  }
}

export function flushPreFlushCbs() {
  if (pendingPreFlushCbs.length) {
    const cbs = pendingPreFlushCbs.slice()
    pendingPreFlushCbs.length = 0
    for (preFlushIndex = 0; preFlushIndex < cbs.length; preFlushIndex++) {
      cbs[preFlushIndex]()
    }
    preFlushIndex = 0
  }
}

export function flushPostFlushCbs() {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)]
    // 按 id 稳定排序（onMounted 钩子同序执行）
    deduped.sort((a, b) => getId(a) - getId(b))
    pendingPostFlushCbs.length = 0

    if (activePostFlushCbs) {
      // 嵌套 flush
      activePostFlushCbs.splice(0, 0, ...deduped)
      return
    }

    activePostFlushCbs = deduped
    for (postFlushIndex = 0; postFlushIndex < activePostFlushCbs.length; postFlushIndex++) {
      const cb = activePostFlushCbs[postFlushIndex]
      cb.flags! &= ~QUEUED
      cb()
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

export { NOOP }