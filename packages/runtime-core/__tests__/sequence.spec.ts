/**
 * sequence.spec.ts —— getSequence（最长递增子序列）单元测试
 * keyed diff 的「移动最少」全靠它：返回值是被判定「无需移动」的旧节点下标序列，
 * 移动数 = 未匹配数 − LIS 长度。此前无直接单测（只在最终 DOM 顺序里间接覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { getSequence } from '../src/sequence'

describe('getSequence（最长递增子序列）', () => {
  it('returns full indices for an already-increasing array', () => {
    expect(getSequence([1, 2, 3])).toEqual([0, 1, 2])
  })

  it('returns a single index for a decreasing array', () => {
    expect(getSequence([5, 4, 3, 2, 1])).toEqual([4])
  })

  it('finds the LIS among reordered values', () => {
    expect(getSequence([2, 1, 3, 4])).toEqual([1, 2, 3])
    expect(getSequence([1, 3, 2, 4])).toEqual([0, 2, 3])
  })

  it('skips 0 (new node) markers when extending', () => {
    // 0 表示「无对应旧节点」的新节点：不参与递增比较，更不应破坏子序列
    expect(getSequence([1, 2, 0, 3, 4])).toEqual([0, 1, 3, 4])
    expect(getSequence([3, 0, 1, 2])).toEqual([2, 3])
  })

  it('handles trivial inputs', () => {
    expect(getSequence([1])).toEqual([0])
    expect(getSequence([3, 2, 1])).toEqual([2])
  })

  it('always yields strictly increasing indices and values (invariant)', () => {
    // 不管输入如何，输出必须：下标递增 + 按值（跳过 0）严格递增 —— 否则 diff 会多移动或出错
    const inputs = [
      [2, 1, 3, 4],
      [1, 3, 2, 4],
      [4, 1, 3, 2, 9, 7],
      [1, 2, 0, 3, 4],
    ]
    for (const arr of inputs) {
      const seq = getSequence(arr)
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).toBeGreaterThan(seq[i - 1])
      }
      let prev = -Infinity
      for (const idx of seq) {
        if (arr[idx] === 0) continue
        expect(arr[idx]).toBeGreaterThan(prev)
        prev = arr[idx]
      }
    }
  })
})