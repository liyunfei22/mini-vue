// @vitest-environment jsdom
/**
 * sfc.spec.ts —— SFC 端到端闭环（模拟 @vitejs/plugin-vue 的集成层）
 *
 * 链路：parse → compileScript → compileTemplate → 实例化 → createApp → 渲染。
 * 集成层职责（真 plugin-vue 同款，这里由测试夹具扮演）：
 *   - 编译出的 render 挂到组件对象上
 *   - scoped 时给组件对象挂 __scopeId（compiler-sfc 全程不产 data-v，全在运行时）
 *   - ESM import/export 转成可执行形态（真实场景 = vite 的模块系统）
 *
 * 覆盖：script setup 全特性 + scoped + 插槽 -s + 子组件 import 解析 +
 * defineEmits 上行 + expose 关闭公开面 + let 的 v-model 双向。
 */
import { describe, expect, it, vi } from 'vitest'
import * as Vue from '@mini-vue/vue'
import { parse, compileScript, compileTemplate } from '../src'
import { getComponentPublicInstance } from '@mini-vue/vue'

const ID = 'data-v-abc123'

/** 集成层：执行 compileScript 的 ESM 产物（import → Vue 解构/注册表，export default → module.exports） */
function instantiateScript(content: string, registry: Record<string, any> = {}): any {
  const module: any = { exports: {} }
  const body = content
    .replace(/import \{ ([^}]+) \} from '(@mini-vue\/)?vue'/, (_m: string, names: string) => `const { ${names} } = Vue`)
    .replace(/import (\w+) from ['"]([^'"]+)['"]/, (_m: string, local: string, src: string) => `const ${local} = __registry__[${JSON.stringify(src)}]`)
    .replace(/export default/, 'module.exports.default =')
  new Function('Vue', 'module', '__registry__', body)(Vue, module, registry)
  return module.exports.default
}

/** 集成层：执行 compileTemplate 的产物（with(_ctx) 形态，与 compileToFunction 同款） */
function instantiateTemplate(code: string): Function {
  return new Function('Vue', code)(Vue)
}

/** 完整 SFC → 可挂载组件（模拟 plugin-vue 的 transform 流程） */
function compileSFC(sfc: string, filename: string, registry: Record<string, any> = {}): any {
  const { descriptor, errors } = parse(sfc, { filename })
  expect(errors).toHaveLength(0)
  const scriptResult = compileScript(descriptor)
  const isScoped = descriptor.styles.some((s) => s.scoped)
  const tplResult = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: ID,
    scoped: isScoped,
    slotted: descriptor.slotted,
  })
  expect(tplResult.errors).toHaveLength(0)
  const Comp = instantiateScript(scriptResult.content, registry)
  Comp.render = instantiateTemplate(tplResult.code)
  if (isScoped) {
    Comp.__scopeId = ID // 集成层职责（真 plugin-vue 同款）
  }
  return Comp
}

function mount(comp: any, props?: Record<string, any>) {
  const container = document.createElement('div')
  createApp(comp, props).mount(container)
  return { container, rootInstance: (container as any)._vnode.component }
}

describe('SFC 端到端', () => {
  it('script setup + scoped：插值渲染，元素落 data-v 属性', () => {
    const Comp = compileSFC(
      `<template><div class="card"><p>{{ msg }}</p></div></template>
<script setup lang="ts">
const msg = 'hello sfc'
</script>
<style scoped>.card { color: red }</style>`,
      'Card.vue',
    )
    const { container } = mount(Comp)
    expect(container.innerHTML).toBe(
      '<div data-v-abc123="" class="card"><p data-v-abc123="">hello sfc</p></div>',
    )
  })

  it('defineProps：父传 props 进模板', () => {
    const Comp = compileSFC(
      `<template><p class="t">{{ label }}</p></template>
<script setup lang="ts">
const props = defineProps({ label: String })
</script>`,
      'Labeled.vue',
    )
    const { container } = mount(Comp, { label: 'from parent' })
    expect(container.innerHTML).toContain('from parent')
  })

  it('import 组件：setupState 回退解析 + 子根继承父 scopeId', () => {
    const childComp = compileSFC(
      `<template><div class="inner"><b>c</b></div></template>
<script setup lang="ts">
const x = 1
</script>`,
      'ChildComp.vue',
    )
    const ChildFile = { './Child.vue': childComp }
    const Parent = compileSFC(
      `<template><main class="wrap"><Child/></main></template>
<script setup lang="ts">
import Child from './Child.vue'
</script>
<style scoped>.wrap { color: red }</style>`,
      'ParentUse.vue',
      ChildFile,
    )
    const { container } = mount(Parent)
    const main = container.firstChild as HTMLElement
    expect(main.getAttribute('data-v-abc123')).toBe('')
    const childRoot = main.firstChild as HTMLElement
    expect(childRoot.getAttribute('data-v-abc123')).toBe('') // 子根继承父 scopeId
  })

  it('defineEmits 上行：点击子按钮触发父组件 @go 处理器', async () => {
    const Child = compileSFC(
      `<template><button @click="emit('go', 42)">go</button></template>
<script setup lang="ts">
import { ref } from 'vue'
const emit = defineEmits(['go'])
</script>`,
      'Emitter.vue',
    )
    const Parent = compileSFC(
      `<template><Child @go="onGo"/><p>{{ hits }}</p></template>
<script setup lang="ts">
import Child from './Emitter.vue'
import { ref } from 'vue'
const hits = ref(0)
function onGo() { hits.value++ }
</script>`,
      'ParentListen.vue',
      { './Emitter.vue': Child },
    )
    const { container } = mount(Parent)
    expect((container.querySelector('p') as HTMLElement).textContent).toBe('0')
    ;(container.querySelector('button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click'))
    await Vue.nextTick()
    expect((container.querySelector('p') as HTMLElement).textContent).toBe('1')
  })

  it('let + v-model 双向：输入回写 setup 局部变量并驱动重渲染', async () => {
    const Comp = compileSFC(
      `<template><input v-model="text"><p>{{ text }}</p></template>
<script setup lang="ts">
import { ref } from 'vue'
let text = ref('init')
</script>`,
      'Form.vue',
    )
    const { container } = mount(Comp)
    expect((container.querySelector('p') as HTMLElement).textContent).toBe('init')
    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'typed'
    input.dispatchEvent(new Event('input'))
    await Vue.nextTick()
    expect((container.querySelector('p') as HTMLElement).textContent).toBe('typed')
  })

  it('普通 script + script setup 合并（Object.assign 产物）', () => {
    const Comp = compileSFC(
      `<template><p class="opt">{{ msg }}</p></template>
<script>
export default { name: 'OptionsForm', inheritAttrs: false }
</script>
<script setup lang="ts">
const msg = 'merged'
</script>
<style scoped>.opt {}</style>`,
      'Merged.vue',
    )
    const { container } = mount(Comp)
    expect(container.innerHTML).toContain('merged')
    // 集成层挂的 __scopeId 不因 Object.assign 丢失（__scopeId 在运行时从
    // Comp 读，而 Comp 是我们手动挂的组件对象——这里验证组件本身可用）
    expect((container.firstChild as HTMLElement).getAttribute('data-v-abc123')).toBe('')
  })

  it(':slotted 场景：插槽内容带父 scopeId + 子 -s 后缀', () => {
    const Child = compileSFC(
      `<template><div class="shell"><slot/></div></template>
<script setup lang="ts">
const y = 1
</script>
<style scoped>.shell :slotted(.s) { color: green }</style>`,
      'SlottedBox.vue',
    )
    const Parent = compileSFC(
      `<template><Child><span class="s">content</span></Child></template>
<script setup lang="ts">
import Child from './SlottedBox.vue'
</script>
<style scoped>.wrap2 {}</style>`,
      'SlottedUse.vue',
      { './SlottedBox.vue': Child },
    )
    const { container } = mount(Parent)
    // parent 根是 Child 组件（scoped 且 slotted）——span 在子根内
    const shell = container.firstChild as HTMLElement
    expect(shell.getAttribute('data-v-abc123')).toBe('') // 子根（自己的 id）
    const span = shell.firstChild as HTMLElement
    expect(span.classList.contains('s')).toBe(true)
    // 插槽内容带父 scopeId（与子同 id 时仍是 -s 标记）——注意此处父子共用 data-v-abc123，
    // 断言重点是 span 有 -s 后缀：:slotted(.s) 编译成 .s[data-v-abc123-s]
    expect(span.getAttribute('data-v-abc123-s')).toBe('')
    expect(span.getAttribute('data-v-abc123')).toBe('')
  })

  it('defineExpose 关闭公开面：getComponentPublicInstance 只见到 exposed 键', () => {
    const Comp = compileSFC(
      `<template><p>closed</p></template>
<script setup lang="ts">
import { ref } from 'vue'
const secret = ref(1)
function exposeMe() { return 42 }
defineExpose({ exposeMe })
</script>`,
      'Closed.vue',
    )
    const { rootInstance } = mount(Comp)
    const pub = getComponentPublicInstance(rootInstance)
    ;(pub as any).exposeMe()
    expect(pub.secret).toBeUndefined()
    expect(typeof (pub as any).exposeMe).toBe('function')
  })

  it('无 scoped 样式：不产 data-v，模板照常渲染', () => {
    const Comp = compileSFC(
      `<template><div class="plain">{{ n }}</div></template>
<script setup lang="ts">
import { ref } from 'vue'
const n = ref(2)
n.value++
</script>`,
      'Plain.vue',
    )
    const { container } = mount(Comp)
    expect(container.innerHTML).toBe(`<div class="plain">3</div>`)
  })

  it('v-for list 在 script setup 模板里工作', () => {
    const Comp = compileSFC(
      `<template><ul><li v-for="item in list" :key="item">{{ item }}</li></ul></template>
<script setup lang="ts">
const list = ['a', 'b', 'c']
</script>`,
      'List.vue',
    )
    const { container } = mount(Comp)
    expect(container.innerHTML).toContain('<li>a</li>')
    expect(container.innerHTML).toContain('<li>c</li>')
  })
})

import { createApp } from '@mini-vue/vue'