/**
 * scheduler.spec.ts —— 作业调度行为镜像测试
 * 对齐真 Vue packages/runtime-core/__tests__/scheduler.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import { nextTick, queueJob, queuePostFlushCb, queuePreFlushCb } from '../src'

describe('scheduler', () => {
  it('should be called on nextTick (microtask) by default', async () => {
    const spy = vi.fn()
    queueJob(spy)
    expect(spy).not.toHaveBeenCalled()
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should dedupe the same job queued multiple times', async () => {
    const spy = vi.fn()
    queueJob(spy)
    queueJob(spy)
    queueJob(spy)
    expect(spy).not.toHaveBeenCalled()
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should run jobs in id order (parent before child)', async () => {
    const order: string[] = []
    const parent: any = () => order.push('parent')
    const child: any = () => order.push('child')
    parent.id = 1
    child.id = 2
    // 故意先入队 child，仍应按 id 升序执行
    queueJob(child)
    queueJob(parent)
    await nextTick()
    expect(order).toEqual(['parent', 'child'])
  })

  it('should run pre-flush cbs before jobs and post-flush cbs after', async () => {
    const order: string[] = []
    queuePreFlushCb(() => order.push('pre'))
    queueJob(() => order.push('job'))
    queuePostFlushCb(() => order.push('post'))
    queuePostFlushCb(() => order.push('post2'))

    await nextTick()
    expect(order).toEqual(['pre', 'job', 'post', 'post2'])
  })

  it('should flush new jobs scheduled during flushing', async () => {
    const order: string[] = []
    let jobA: any = () => {
      order.push('a')
      queueJob(jobB) // 执行中入队新作业
    }
    const jobB: any = () => order.push('b')
    queueJob(jobA)
    await nextTick()
    expect(order).toEqual(['a', 'b'])
  })

  it('should resolve nextTick(fn) after flushing', async () => {
    const order: string[] = []
    queueJob(() => order.push('job'))
    await nextTick(() => order.push('tick'))
    expect(order).toEqual(['job', 'tick'])
  })
})