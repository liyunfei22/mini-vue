# 阶段 7 — 内核补全：Options API / v-model 修饰符（7-1）

> 计划修订：router/pinia 取消（见 docs/00 范围决策）。本项目只做 vue 内核，阶段 7 把
> 此前降级的有价值核心项补回，阶段 8 用展示 app 收官。
> 里程碑（7-1）：`pnpm test` 全绿（199 用例），tsc 0 错误。
> 真源码锚点：`packages/runtime-core/src/componentOptions.ts`

## 1. 7-1 学到了什么

### 1.1 Options API 与 Composition API 怎么共存

```
setup（Composition）→ 先执行 → setupState 优先
applyOptions（Options）→ 后合并 → data/computed/methods/watch/生命周期选项
同 key：setup 赢（真 Vue 语义一致）
```

- **统一存放**：data/computed/methods 全部落进 `instance.data` 一个命名空间（真 Vue 也是）。
- **data()** → `reactive(data.call(proxy))`：`this` 绑公共实例。
- **computed** → `computed(getter.bind(proxy))`：getter/setter 的 `this` 也是 proxy。
- **methods** → `methodHandler.bind(proxy)`。
- **watch 选项** → 内部走 `doWatch(getter, handler)`：字符串 key（`'n'`/`'a.b'`）解析成
  从 proxy 取值的 getter；支持 `{ handler, immediate, deep }` 对象形态。
- **生命周期选项** → `injectHook` 登记到实例数组（bm/m/bu/u/bum/um），created/beforeCreate
  在 applyOptions 时同步执行。

### 1.2 公共代理的完整查找链（7-1 扩展后）

```
get: setupState → props → data → ctx → $slots/$attrs/$props/$emit → globalProperties
set: setupState → data → ctx
has: 同 get 前四层（with(_ctx) 的解析依赖 has 陷阱）
```

### 1.3 v-model 修饰符（编译期内联展开）

| 修饰符 | 编译产物变化 |
|---|---|
| `.lazy` | 事件从 `input` 换 `change` |
| `.trim` | 取值表达式 `$event.target.value` → `.trim()` |
| `.number` | 取值表达式换成 `_looseToNumber($event.target.value)`（NaN 保持原值，新增 shared 工具） |

不同修饰符共用 `createAssignment(exp, valueExpr)`——把「整个取值表达式」作为参数，
避免 `.number` 的后缀拼接陷阱（曾产出 `$eventlooseToNumber(...)` 的经典错误）。

## 2. review gate（7-1）

### Q1：Options 的 computed 里 `this.count` 为什么能用？

`applyOptions` 里把用户 getter 包了一层 `() => rawGetter.call(proxy)`——`this` 显式绑定到
公共实例，而公共实例的 get 链会落到 `data.count`。别忘了对方法签名做 `.bind(proxy)`。

### Q2：setup 与 options 同 key 时谁赢？为什么？

**setup 赢**。公共实例查找顺序 `setupState → props → data…`，setupState 在最前。
这是 Vue 3 的既定语义：Composition API 是组合式入口，options 是兜底。

### Q3：公共实例的 get 链为什么必须在 with(_ctx) 下配合 has 陷阱？

模板编译产物用 `with(_ctx)` 包裹，标识符 `age` 这类裸名要能被 `with` 命中，必须让
`_ctx` 的 `[[HasProperty]]` 对 setupState/data/props/ctx 返回 true——否则 `age` 会漏到
**全局作用域**去解析，产生 `age is not defined`（本次 `.number` 测试真实踩了一次）。

## 3. 7-2 / 7-3 预告

- **7-2**：`Transition`（CSS enter/leave 简版，用 style/类名 + setTimeout）与
  `KeepAlive`（vnode 缓存 + 子组件 deactivate/activate）
- **7-3**：编译器优化初版——静态提升（hoistStatic）+ `patchFlag` 动态标记 + block 树
  （`openBlock/createElementBlock/dynamicChildren`，renderer 走 dynamicChildren 快速路径），
  这是此前「patchFlag 恒 -1 / 全量 diff」的补全

## 4. 自查表（7-1）

- [ ] 能说出 Options 与 setup 的合并顺序与同 key 冲突规则
- [ ] 能画出公共实例 get 的完整查找链（含 data 与 $ 内建）
- [ ] 能写出 `.trim/.number/.lazy` 各自的编译产物差异
- [ ] 能解释 `with(_ctx)` 为什么需要 has 陷阱（裸标识符解析）