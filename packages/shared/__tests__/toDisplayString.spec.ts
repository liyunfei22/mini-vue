import { describe, expect, it } from 'vitest'
import { toDisplayString } from '../src'

describe('shared: toDisplayString', () => {
  it('stringifies plain objects without stack overflow', () => {
    expect(toDisplayString({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('handles nested objects and arrays', () => {
    expect(() => toDisplayString({ a: { b: [1, 2] }, c: true })).not.toThrow()
  })

  it('formats Map and Set to a readable shape', () => {
    expect(toDisplayString(new Map([['k', 1]]))).toContain('Map(1)')
    expect(toDisplayString(new Set([1, 2]))).toContain('Set(2)')
  })

  it('handles primitives and null', () => {
    expect(toDisplayString(null)).toBe('')
    expect(toDisplayString(undefined)).toBe('')
    expect(toDisplayString(42)).toBe('42')
    expect(toDisplayString('hi')).toBe('hi')
  })
})