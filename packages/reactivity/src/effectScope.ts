/**
 * effectScope.ts —— 作用域容器：把一批 effect 绑定生命周期，能整体停止
 *
 * 对应真 Vue packages/reactivity/src/effectScope.ts。
 *
 * ## 为什么必须学它？（gate：阶段8 pinia 的立身之本）
 * pinia 在 createPinia 里建一个顶层 `effectScope(true)`，所有 store 的 state/computed/
 * subscriptions 都创建在这个 scope 内 —— store.dispose() / 整个 app 卸载时一个
 * scope.stop() 就把全部响应式副作用集体清掉，不留孤儿订阅。
 *
 * ## 核心机制
 *   - scope.run(fn)：执行期间把全局 activeEffectScope 换成自己 —— 期间 new 出的
 *     ReactiveEffect 会被构造器自动登记进 scope.effects；
 *   - scope.stop()：① stop 自己直接创建的 effects ② 执行 cleanups（onScopeDispose 注册）
 *    ③ 递归 stop 子 scope ④ 从父 scope 的 scopes 数组摘掉自己；
 *   - detached=true：不挂父 scope 的目录（脱离层级，独立生死，pinia 顶层就是它）。
 *
 * onScopeDispose(fn)：在「当前处在 scope.run() 里」时注册清理函数，scope.stop() 时执行。
 * 与组件 onUnmounted 的对偶：组件实例本质就是一个非 detached 的 effect scope（阶段3）。
 */
import type { ReactiveEffect } from './effect'
import { __DEV__ } from '@mini-vue/shared'
import { warn } from './warning'

export let activeEffectScope: EffectScope | undefined

export class EffectScope {
  private _active = true

  /** 本 scope 直接创建的 effect */
  effects: ReactiveEffect[] = []
  /** onScopeDispose 注册的清理函数 */
  cleanups: (() => void)[] = []

  /** 只被非 detached 的 scope 使用：挂在哪个父 scope 下 */
  parent: EffectScope | undefined
  scopes: EffectScope[] | undefined
  /** 在父 scopes 数组里的下标（stop 时 O(1) 摘除） */
  private index: number | undefined

  constructor(public detached = false) {
    if (!detached && activeEffectScope) {
      if (activeEffectScope.active) {
        this.parent = activeEffectScope
        this.index =
          (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
            this,
          ) - 1
      } else {
        // 父已停止：这个子 scope 也一出生就失活，避免成为游离的活体
        this._active = false
      }
    }
  }

  get active(): boolean {
    return this._active
  }

  run<T>(fn: () => T): T | undefined {
    if (this._active) {
      const currentScope = activeEffectScope
      try {
        activeEffectScope = this
        return fn()
      } finally {
        activeEffectScope = currentScope
      }
    } else if (__DEV__) {
      warn('cannot run an inactive effect scope.')
    }
  }

  stop(fromParent?: boolean) {
    if (this._active) {
      this._active = false

      let i, l
      // 1. 停掉本 scope 直接创建的 effects（它们各自解除订阅）
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].stop()
      }
      this.effects.length = 0

      // 2. 逆序执行 onScopeDispose 清理回调（后注册先释放）
      for (i = 0, l = this.cleanups.length; i < l; i++) {
        this.cleanups[i]()
      }
      this.cleanups.length = 0

      // 3. 递归，深度优先停掉子 scope
      if (this.scopes) {
        const scopes = this.scopes.slice()
        for (i = 0, l = scopes.length; i < l; i++) {
          scopes[i].stop(true)
        }
        this.scopes.length = 0
      }

      // 4. 从父 scope 摘掉自己（防内存泄漏：父 stop 时不会再遍历到自己）
      if (!this.detached && this.parent && !fromParent) {
        const last = this.parent.scopes!.pop()
        if (last && last !== this) {
          this.parent.scopes![this.index!] = last
          last.index = this.index!
        }
      }
      this.parent = undefined
    }
  }
}

export function effectScope(detached?: boolean): EffectScope {
  return new EffectScope(detached)
}

/**
 * 把一个 effect 登记进指定 scope（effect() 显式传 options.scope 时使用）。
 * 默认路径走 ReactiveEffect 构造器里的「活跃 scope 自动登记」，无需手动调用。
 */
export function recordEffectScope(effect: ReactiveEffect, scope?: EffectScope) {
  if (scope && scope.active) {
    scope.effects.push(effect)
  }
}

export function getCurrentScope(): EffectScope | undefined {
  return activeEffectScope
}

/**
 * 在当前 active scope 上注册清理回调；scope.stop() 时执行。
 * ⚠️ 必须在 scope.run()（或组件 setup 内部）里调用，否则没有关联对象。
 */
export function onScopeDispose(fn: () => void, failSilently = false): void {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn)
  } else if (__DEV__ && !failSilently) {
    warn(
      `onScopeDispose() is called when there is no active effect scope` +
        ` to be associated with.`,
    )
  }
}