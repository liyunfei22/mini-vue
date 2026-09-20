/**
 * sequence.ts —— 最长递增子序列（LIS）
 *
 * 对应真 Vue packages/runtime-core/src/sequence.ts（3.5 内联在 renderer.ts 的 getSequence）。
 *
 * 用途：keyed diff 的「5.3 移动阶段」里，算出「不需要移动的最长稳定子序列」，
 * 其余节点才有移动的资格 —— 移动最少。
 *
 * ## 算法（耐心排序 + 前驱回溯，O(n log n)）
 *   result 维护的是「递增子序列的尾下标」数组（按值有序），对每个元素二分定位插入位：
 *   - 大于尾 → 追加（记前驱 p[i] = 旧尾）
 *   - 否则在 result 里二分找到第一个不小于它的位置 u 并替换（同时记录 p[i] = result[u-1]）
 *   最后用 p 数组倒推，还原出一条真实的最长递增子序列（的值=原数组下标）。
 *
 * 约定：数组中值为 0 的项表示「这是一个新节点、没有对应旧节点」，需要跳过。
 */
export function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length

  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        // 比当前子序列尾巴大 → 直接扩展，记前驱
        p[i] = j
        result.push(i)
        continue
      }
      // 二分找「第一个 >= arrI 的 result 元素」的位置 u
      u = 0
      v = result.length - 1
      while (u < v) {
        c = (u + v) >> 1
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        // 替换，并记录它的前驱（用于最后回溯还原）
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }

  // 顺着前驱链还原真正的 LIS（result 下标 → 原数组下标）
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}