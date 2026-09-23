/**
 * errorHandling.spec.ts —— 错误处理入口单元测试
 * callWithErrorHandling / handleError 是「渲染主流程容错」的地基：组件 setup/render、
 * 事件、watch，都经它兜底。此前整套零测（handleError 的 errorHandler 分支、
 * callWithErrorHandling 的 Promise 兜底都是死路径）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  callWithArrayAsErrorHandling,
  callWithErrorHandling,
  handleError,
} from '../src/errorHandling'

describe('errorHandling: callWithErrorHandling', () => {
  it('calls fn with args and returns its result', () => {
    const fn = vi.fn((a: number, b: number) => a + b)
    expect(callWithErrorHandling(fn, null, undefined, [2, 3])).toBe(5)
    expect(fn).toHaveBeenCalledWith(2, 3)
  })

  it('catches sync errors without rethrowing and reports them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('boom')
    const fn = vi.fn(() => {
      throw boom
    })
    expect(() => callWithErrorHandling(fn)).not.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('routes async rejections to the errorHandler without swallowing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errHandler = vi.fn()
    const proxy = { n: 1 }
    const instance = { appContext: { config: { errorHandler: errHandler } }, proxy }
    const boom = new Error('async boom')
    const p = callWithErrorHandling(() => Promise.reject(boom), instance)
    await expect(p).rejects.toBe(boom)
    await new Promise((r) => setTimeout(r, 0))
    expect(errHandler).toHaveBeenCalledWith(boom, proxy)
    spy.mockRestore()
  })

  it('callWithArrayAsErrorHandling delegates to callWithErrorHandling', () => {
    const fn = vi.fn(() => 'ok')
    expect(callWithArrayAsErrorHandling(fn, null, undefined, [1])).toBe('ok')
    expect(fn).toHaveBeenCalledWith(1)
  })
})

describe('errorHandling: handleError', () => {
  it('invokes appContext.config.errorHandler with (err, proxy)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errHandler = vi.fn()
    const proxy = { name: 'p' }
    const err = new Error('x')
    handleError(err, { appContext: { config: { errorHandler: errHandler } }, proxy })
    expect(errHandler).toHaveBeenCalledWith(err, proxy)
    spy.mockRestore()
  })

  it('survives a throwing errorHandler', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errHandler = vi.fn(() => {
      throw new Error('handler boom')
    })
    const instance = { appContext: { config: { errorHandler: errHandler } }, proxy: {} }
    expect(() => handleError(new Error('orig'), instance)).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    spy.mockRestore()
    warnSpy.mockRestore()
  })
})