/**
 * vModel.ts —— v-model 运行时指令（checkbox/radio/select 形态）
 *
 * 对应真 Vue packages/runtime-dom/src/directives/vModel.ts。
 *
 * ## _assigning 防重入
 * 「程序化 set value/checked」与「浏览器触发 change 事件」之间会打转：
 *   set el.value → (若元素是焦点)浏览器可能补发 input → 又触发我们的 handler 回写 → 循环。
 * 我们用 `el._assigning = true` 标记「当前这次写是程序化的」，handler 里看到标记就跳过回写。
 *
 * ## 绑定结构（编译器产出的 withDirectives 第二项）
 *   [dir, assigner, arg, modifiers]
 *   assigner = ($event) => (name = $event)  —— 把用户输入落回响应式变量
 *   （text/textarea 仍走 transformElement 内联的 value+onInput，见 transformElement）
 */
export interface ObjectDirective<T = any> {
  created?(el: T, binding: any, vnode: any): void
  mounted?(el: T, binding: any, vnode: any): void
  beforeUpdate?(el: T, binding: any, vnode: any, prevVNode: any): void
  updated?(el: T, binding: any, vnode: any, prevVNode: any): void
  beforeUnmount?(el: T, binding: any, vnode: any): void
  unmounted?(el: T, binding: any, vnode: any): void
}

/** 把 props.checked（含 v-model 的值）写成元素状态，禁重入 */
function setChecked(el: any, vnode: any) {
  el._assigning = true
  const props = vnode.props || {}
  const value = props.value
  el.checked = props.checked ?? false
  if (value != null) {
    el.value = value // checkbox 的 value 属性
  }
  el._assigning = false
}

export const vModelCheckbox: ObjectDirective<any> = {
  created(el, { value: assign }, vnode) {
    el._assigning = true
    el.addEventListener('change', () => {
      if (!el._assigning && assign) {
        // 单一布尔模型：checked 直接回写
        assign(el.checked)
      }
    })
    el._assigning = false
  },
  mounted(el, _binding, vnode) {
    setChecked(el, vnode)
  },
  updated(el, _binding, vnode) {
    setChecked(el, vnode)
  },
}

export const vModelRadio: ObjectDirective<any> = {
  created(el, { value: assign }, _vnode) {
    el._assigning = true
    el.addEventListener('change', () => {
      if (!el._assigning && assign) {
        assign(el.value) // 回写 radio 的 value 属性
      }
    })
    el._assigning = false
  },
  mounted(el, _binding, vnode) {
    el._assigning = true
    const props = vnode.props || {}
    // checked 条件：模型的当前值 === 本 radio 的 value
    el.checked = props.value === props.checked
    el._assigning = false
  },
  updated(el, _binding, vnode) {
    ;((el as any).mounted || ((el as any).mounted = vModelRadio.mounted!))(el, _binding, vnode)
  },
}

export const vModelSelect: ObjectDirective<any> = {
  created(el, { value: assign }, _vnode) {
    el._assigning = true
    el.addEventListener('change', () => {
      if (!el._assigning && assign) {
        assign(el.value)
      }
    })
    el._assigning = false
  },
  mounted(el, { value: assign }, vnode) {
    el._assigning = true
    const props = vnode.props || {}
    const value = props.value
    if (value != null) {
      el.value = value
    }
    el._assigning = false
  },
  updated(el, binding, vnode) {
    vModelSelect.mounted!(el, binding, vnode)
  },
}