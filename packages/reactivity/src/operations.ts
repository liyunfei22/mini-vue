/**
 * operations.ts —— 操作类型与内部标记
 *
 * 对应真 Vue 源码 packages/reactivity/src/constants.ts（3.5+ 叫 constants.ts，早期叫 operations.ts）。
 * `track(target, type, key)` 的 type 传 TrackOpTypes，`trigger(...)` 的 type 传 TriggerOpTypes，
 * 用字面量字符串而不是数字，是为了册 devtools/debugger 事件可读。
 */

// 收集时机（get 家族）：读到的操作类型
export enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate',
}

// 触发时机（写操作）：set/add/delete/clear
export enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear',
}

/**
 * ReactiveFlags —— 挂在前置 Proxy / 原始对象上的「暗号」字段
 * !!! `value[ReactiveFlags.IS_REACTIVE]`（即 `value.__v_isReactive`）能命中 get 拦截，
 * !!! 拿到的不是真实属性而是 handler 里返回的标记 —— 所以 isReactive() 可以「零成本」判断。
 * SKIP 由 markRaw 打到原始对象上，表示「别给我包 Proxy」
 * RAW 返回原始对象（toRaw 的唯一实现通道）
 */
export enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw',
  IS_REF = '__v_isRef',
}

// 用于 track/trigger 的特殊 key：迭代、Map 键集、数组长度
export const ITERATE_KEY: unique symbol = Symbol('Object iterate')
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol('Map keys iterate')
// 3.x 里数组的 for...of/keys/values 用独立 key 跟踪（配合 arrayInstrumentations）
export const ARRAY_ITERATE_KEY: unique symbol = Symbol('Array iterate')