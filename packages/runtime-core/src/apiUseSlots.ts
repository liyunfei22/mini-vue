/**
 * apiUseSlots.ts / apiUseAttrs —— setup 内取插槽/透传属性
 */
import { getCurrentInstance } from './currentInstance'
import type { Data } from './component'
import type { Slots } from './componentSlots'

export function useSlots(): Slots {
  const instance = getCurrentInstance()
  return (instance && instance.slots) as Slots
}

export function useAttrs(): Data {
  const instance = getCurrentInstance()
  return ((instance && instance.attrs) || {}) as Data
}
