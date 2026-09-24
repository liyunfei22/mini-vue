/**
 * apiWatch.spec.ts —— watch / watchEffect 行为镜像测试
 * 对齐真 Vue packages/runtime-core/__tests__/apiWatch.spec.ts 经典子集。
 */
import { describe, expect, it, vi } from 'vitest'
import { watch, watchEffect, watchSyncEffect, watchPostEffect, nextTick } from '../src'
import { reactive, ref, isRef } from '@mini-vue/reactivity'

describe('watch', () => {
  it('should watch a ref source and report new/old values', async () => {
    const n = ref(1)
    const spy = vi.fn()
    watch(n, (v, o) => spy(v, o))

    expect(spy).not.toHaveBeenCalled()

    n.value = 2
    await nextTick()
    expect(spy).toHaveBeenCalledWith(2, 1)
  })

  it('should watch a getter source', async () => {
    const n = ref(1)
    const spy = vi.fn()
    watch(() => n.value * 2, (v, o) => spy(v, o))

    n.value = 2
    await nextTick()
    expect(spy).toHaveBeenCalledWith(4, 2)
  })

  it('immediate: run callback once at setup with old = undefined', () => {
    const n = ref(1)
    const spy = vi.fn()
    watch(n, (v, o) => spy(v, o), { immediate: true })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(1, undefined)
  })

  it('should not trigger when the source value does not change', async () => {
    const n = ref(1)
    const spy = vi.fn()
    watch(n, spy)
    n.value = 1
    await nextTick()
    expect(spy).not.toHaveBeenCalled()
  })

  it('stop() should stop watching', async () => {
    const n = ref(1)
    const spy = vi.fn()
    const stop = watch(n, spy)
    stop()
    n.value = 2
    await nextTick()
    expect(spy).not.toHaveBeenCalled()
  })

  it('once: true fires the callback only once', async () => {
    const n = ref(1)
    const spy = vi.fn()
    watch(n, (v, o) => spy(v, o), { once: true })
    n.value = 2
    await nextTick()
    expect(spy).toHaveBeenCalledWith(2, 1)

    n.value = 3
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1) // 首次触发后已自停止
  })

  it('cleanup registered inside cb runs before the next invocation', async () => {
    const n = ref(1)
    const cleanup = vi.fn()
    const order: string[] = []
    watch(n, (val, _old, onCleanup) => {
      onCleanup(() => {
        cleanup()
        order.push('cleanup')
      })
      order.push(`cb:${val}`)
    })
    expect(order).toEqual([]) // 初始不跑 cb

    n.value = 2
    await nextTick()
    expect(order).toEqual(['cb:2']) // 首次 cb，注册了 cleanup

    n.value = 3
    await nextTick()
    expect(order).toEqual(['cb:2', 'cleanup', 'cb:3']) // 再触发前先跑 cleanup
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('watchEffect runs immediately and tracks deps', async () => {
    const n = ref(1)
    const spy = vi.fn(() => n.value)
    watchEffect(spy)
    expect(spy).toHaveBeenCalledTimes(1)

    n.value = 2
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('watchEffect can register onCleanup via its fn arg', async () => {
    const cleanup = vi.fn()
    let i = 0
    const n = ref(1)
    watchEffect((onCleanup) => {
      void n.value // 建立响应式依赖
      i++
      onCleanup(cleanup)
    })
    expect(i).toBe(1)

    n.value = 2
    await nextTick()
    expect(cleanup).toHaveBeenCalledTimes(1) // 重跑前跑了上次的清理
    expect(i).toBe(2)
  })

  it('deep watch on a nested reactive object', async () => {
    const obj = reactive({ inner: { count: 0 } })
    const spy = vi.fn()
    watch(obj, spy)
    obj.inner.count++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deep: true with a getter', async () => {
    const obj = reactive({ inner: { count: 0 } })
    const spy = vi.fn()
    watch(() => obj, (v, o) => spy(v, o), { deep: true })
    obj.inner.count = 1
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('watches an array of sources', async () => {
    const a = ref(1)
    const b = ref(2)
    const spy = vi.fn()
    watch([a, b] as any, (v, o) => spy(v, o))

    a.value = 10
    await nextTick()
    expect(spy).toHaveBeenCalledWith([10, 2], [1, 2])
  })

  it('isRef stays untouched by watch', () => {
    const n = ref(0)
    expect(isRef(n)).toBe(true)
  })
})

describe('watch: flush timing', () => {
  it('flush: sync runs the callback synchronously', () => {
    const n = ref(1)
    const spy = vi.fn()
    watch(n, (v, o) => spy(v, o), { flush: 'sync' })
    n.value = 2
    expect(spy).toHaveBeenCalledWith(2, 1)
  })

  it('flush: post defers the callback until after the flush', async () => {
    const n = ref(1)
    const spy = vi.fn()
    watch(n, (v, o) => spy(v, o), { flush: 'post' })
    n.value = 2
    expect(spy).not.toHaveBeenCalled()
    await nextTick()
    expect(spy).toHaveBeenCalledWith(2, 1)
  })

  it('default flush runs before post flush in the same tick', async () => {
    const order: string[] = []
    const n = ref(1)
    watch(n, () => order.push('default'))
    watch(n, () => order.push('post'), { flush: 'post' })
    n.value = 2
    await nextTick()
    expect(order).toEqual(['default', 'post'])
  })

  it('watchSyncEffect runs and re-runs synchronously', () => {
    const n = ref(1)
    const spy = vi.fn(() => n.value)
    watchSyncEffect(spy)
    expect(spy).toHaveBeenCalledTimes(1)
    n.value = 2
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('watchPostEffect defers both the initial and subsequent runs', async () => {
    const n = ref(1)
    const spy = vi.fn(() => n.value)
    watchPostEffect(spy)
    expect(spy).not.toHaveBeenCalled() // watchEffect 类 post flush：首次也延后
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    n.value = 2
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})