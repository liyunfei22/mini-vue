/**
 * compileScript.spec.ts —— <script setup> 编译
 *
 * 期望产物均以真 @vue/compiler-sfc@3.5.43 的实测输出为 ground truth
 * （减掉 __isScriptSetup 标记 / /*@__PURE__*\/ 注解 / _defineComponent 包装），
 * 关键差异已在文件注释与文档里记录。
 */
import { describe, expect, it, vi } from 'vitest'
import { parse, compileScript } from '../src'

const compile = (sfc: string, filename = 'App.vue') => {
  const { descriptor, errors } = parse(sfc, { filename })
  expect(errors).toHaveLength(0)
  return compileScript(descriptor).content
}

describe('compileScript: 基本形态', () => {
  it('最小 setup：setup 签名 + 自动 __expose() + __returned__ 返回绑定', () => {
    const content = compile(`<script setup>
const msg = 'hi'
</script>`)
    expect(content).toContain(`export default {`)
    expect(content).toContain(`__name: "App",`)
    expect(content).toContain(`setup(__props, { expose: __expose }) {`)
    expect(content).toContain(`const msg = 'hi'`)
    // 未调 defineExpose → 自动补空 __expose()（关闭组件公开面的默认安全边界）
    expect(content).toContain(`__expose();`)
    expect(content).toContain(`const __returned__ = { msg }`)
    expect(content).toContain(`return __returned__`)
  })

  it('文件名的 __name 推断（去掉路径与扩展名）', () => {
    const { descriptor } = parse(`<script setup>const a = 1</script>`, {
      filename: 'components/MyCard.vue',
    })
    expect(compileScript(descriptor).content).toContain(`__name: "MyCard",`)
  })
})

describe('compileScript: 四宏', () => {
  it('defineProps：props 声明原文进组件对象，init 改写为 __props，props 变量进 __returned__', () => {
    const content = compile(`<script setup>
const props = defineProps({ foo: String, bar: { type: Number, default: 1 } })
</script>`)
    expect(content).toContain(`props: { foo: String, bar: { type: Number, default: 1 } },`)
    expect(content).toContain(`const props = __props`)
    expect(content).toContain(`const __returned__ = { props }`)
  })

  it('defineEmits：数组原文进组件对象，init 改写为 __emit，签名带 emit', () => {
    const content = compile(`<script setup>
const emit = defineEmits(['update', 'click'])
</script>`)
    expect(content).toContain(`emits: ['update', 'click'],`)
    expect(content).toContain(`const emit = __emit`)
    expect(content).toContain(`setup(__props, { expose: __expose, emit: __emit }) {`)
  })

  it('未用 defineEmits 时签名不带 emit', () => {
    const content = compile(`<script setup>
const props = defineProps({ a: String })
</script>`)
    expect(content).toContain(`setup(__props, { expose: __expose }) {`)
  })

  it('defineExpose：callee 改写为 __expose，参数保留；调用后不自动补空调用', () => {
    const content = compile(`<script setup>
function inc() {}
defineExpose({ inc })
</script>`)
    expect(content).toContain(`__expose({ inc })`)
    expect(content).not.toContain(`__expose();`)
    expect(content).toContain(`const __returned__ = { inc }`)
  })

  it('defineOptions：整句删除，对象原文进 Object.assign 首位，name 不挡 __name（真源码实测）', () => {
    const content = compile(`<script setup>
defineOptions({ name: 'MyApp', inheritAttrs: false })
const x = 1
</script>`)
    expect(content).toContain(`export default Object.assign({ name: 'MyApp', inheritAttrs: false }, {`)
    expect(content).toContain(`__name: "App",`)
    expect(content).not.toContain(`defineOptions`)
    expect(content).toContain(`const x = 1`)
  })

  it('let 绑定 → __returned__ 用 get/set 对（v-model 回写 loop）', () => {
    const content = compile(`<script setup>
let count = ref(0)
const fixed = 1
</script>`)
    expect(content).toContain(`get count() { return count }, set count(v) { count = v }`)
    expect(content).toContain(`const __returned__ = { get count() { return count }, set count(v) { count = v }, fixed }`)
  })

  it('import 进 __returned__（with(_ctx) 模式的组件解析路径）', () => {
    const content = compile(`<script setup>
import Child from './Child.vue'
const msg = 'hi'
</script>`)
    expect(content).toContain(`import Child from './Child.vue'`)
    expect(content).toContain(`const __returned__ = { msg, Child }`)
    // import 被前置到模块头（在 export default 之前）
    expect(content.indexOf(`import Child`)).toBeLessThan(content.indexOf(`export default`))
  })

  it("从 'vue' import 的宏名被移除并警告，非宏导入保留", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const content = compile(`<script setup>
import { defineProps, ref } from 'vue'
const props = defineProps({ a: String })
</script>`)
    expect(content).not.toContain(`import { defineProps, ref } from 'vue'`)
    expect(content).toContain(`import { ref } from 'vue'`)
    expect(content).toContain(`const __returned__ = { props, ref }`)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('宏变量名自定义：__props 别名跟随声明名', () => {
    const content = compile(`<script setup>
const myProps = defineProps({ a: Number })
</script>`)
    expect(content).toContain(`const myProps = __props`)
    expect(content).toContain(`const __returned__ = { myProps }`)
  })

  it('解构声明（propsDestructure:false 形态）：pattern 保持，键登记进 __returned__', () => {
    const content = compile(`<script setup>
const { a, b = 2 } = defineProps({ a: String, b: Number })
</script>`)
    expect(content).toContain(`props: { a: String, b: Number },`)
    expect(content).toContain(`const { a, b = 2 } = __props`)
    expect(content).toContain(`const __returned__ = { a, b }`)
  })
})

describe('compileScript: 普通 script 合并', () => {
  it('export default 对象 → const __default__ + Object.assign 合并', () => {
    const content = compile(`<script>
export default { name: 'Opt' }
</script>
<script setup>
const msg = 'hi'
</script>`)
    expect(content).toContain(`const __default__ = { name: 'Opt' }`)
    expect(content).toContain(`export default Object.assign(__default__, {`)
    // 普通 script 的默认导出带 name → 跳过 __name（真源码实测）
    expect(content).not.toContain(`__name:`)
    expect(content).toContain(`const __returned__ = { msg }`)
  })

  it('普通 script 位于 setup 之后 → 整体前置', () => {
    const content = compile(`<script setup>
const msg = 'hi'
</script>
<script>
export default { name: 'Opt' }
</script>`)
    expect(content.indexOf(`const __default__ = { name: 'Opt' }`)).toBeLessThan(
      content.indexOf(`export default Object.assign`),
    )
  })

  it('普通 script 的顶层 import → __returned__ 里只有 getter', () => {
    const content = compile(`<script>
import { helper } from './helper'
export default { inheritAttrs: false }
</script>
<script setup>
const x = 1
</script>`)
    expect(content).toContain(`get helper() { return helper }`)
    expect(content).toContain(`const __returned__ = { x, get helper() { return helper } }`)
  })

  it('defineOptions + 普通 script 并存：Object.assign(__default__, options, {...})', () => {
    const content = compile(`<script>
export default { inheritAttrs: false }
</script>
<script setup>
defineOptions({ name: 'Two', inheritAttrs: true })
const x = 1
</script>`)
    expect(content).toContain(
      `export default Object.assign(__default__, { name: 'Two', inheritAttrs: true }, {`,
    )
  })

  it('普通 script 无 export default：内容保留模块顶层，无 Object.assign', () => {
    const content = compile(`<script>
import x from './x'
</script>
<script setup>const a = 1</script>`)
    expect(content).toContain(`import x from './x'`)
    expect(content).not.toContain(`Object.assign`)
    expect(content).toContain(`get x() { return x }`)
  })
})

describe('compileScript: 守卫与错误（throw + 行号）', () => {
  it('重复 defineProps 报错', () => {
    const { descriptor } = parse(`<script setup>
const a = defineProps({ a: String })
const b = defineProps({ b: String })
</script>`, { filename: 'X.vue' })
    expect(() => compileScript(descriptor)).toThrow(/duplicate defineProps/)
  })

  it('TS 类型宏 defineProps<...> 报「mini 不支持」', () => {
    const { descriptor } = parse(`<script setup lang="ts">
const props = defineProps<{ foo?: string }>()
</script>`, { filename: 'X.vue' })
    expect(() => compileScript(descriptor)).toThrow(/not supported/)
  })

  it('defineModel/defineSlots 报「mini 不支持」', () => {
    const { descriptor } = parse(`<script setup>
defineModel()
</script>`, { filename: 'X.vue' })
    expect(() => compileScript(descriptor)).toThrow(/defineModel/)
  })

  it('宏参数引用 setup 局部变量报错（编译期剥离的静态契约）', () => {
    const { descriptor } = parse(`<script setup>
const local = 1
const props = defineProps({ a: { default: local } })
</script>`, { filename: 'X.vue' })
    expect(() => compileScript(descriptor)).toThrow(/cannot reference locally declared/)
  })

  it('defineOptions 携带 props/emits/expose/slots 键报错并指向宏', () => {
    for (const key of ['props', 'emits', 'expose']) {
      const { descriptor } = parse(`<script setup>
defineOptions({ ${key}: {} })
</script>`, { filename: 'X.vue' })
      expect(() => compileScript(descriptor)).toThrow(new RegExp(`"${key}"`))
    }
  })

  it('<script setup> 里的 export 报错', () => {
    const { descriptor } = parse(`<script setup>
export const x = 1
</script>`, { filename: 'X.vue' })
    expect(() => compileScript(descriptor)).toThrow(/cannot contain ES module exports/)
  })

  it('top-level await 报「mini 不支持」', () => {
    const { descriptor } = parse(`<script setup>
await foo()
</script>`, { filename: 'X.vue' })
    expect(() => compileScript(descriptor)).toThrow(/top-level await/)
  })

  it('普通 script 的 export default 非常规形态（函数调用）报错', () => {
    const { descriptor } = parse(`<script>
export default createApp({})
</script>
<script setup>const a = 1</script>`, { filename: 'X.vue' })
    expect(() => compileScript(descriptor)).toThrow(/must be an object literal/)
  })

  it('无 <script setup> 时普通 script 原样返回', () => {
    const { descriptor } = parse(`<script>
export default { render: () => null }
</script>`)
    expect(compileScript(descriptor).content.trim()).toBe(`export default { render: () => null }`)
  })

  it('lang="ts" 块按 TS 解析（类型注解不炸）', () => {
    const content = compile(`<script setup lang="ts">
const msg: string = 'hi'
interface Foo { a: number }
</script>`)
    expect(content).toContain(`const msg: string = 'hi'`)
    expect(content).toContain(`const __returned__ = { msg }`)
  })
})

describe('compileScript: 产物可运行闭环（不依赖 vite）', () => {
  it('新 Function 直接实例化产物并跑通 setup（fake Vue 模块）', () => {
    const content = compile(`<script setup>
import { ref } from 'vue'
const props = defineProps({ label: String })
const emit = defineEmits(['go'])
let n = ref(0)
function bump() { n.value++ }
defineExpose({ bump })
</script>`)
    const fakeVue = { ref: (v: number) => ({ value: v }) }
    const module: any = { exports: {} }
    // module.exports.default = <sfc> + import 解构自 Vue（模拟 CJS 消费产物；
    // 真实消费方（vite 插件）走 ESM，import 原样保留）
    const body = content
      .replace(/import \{ ([^}]+) \} from 'vue'/, 'const { $1 } = Vue')
      .replace(/export default/, 'module.exports.default =')
    new Function('Vue', 'module', body)(fakeVue, module)
    const Comp = module.exports.default
    const setupCtx: any = { expose: vi.fn(), emit: vi.fn() }
    const ret = Comp.setup({ label: 'x' }, setupCtx)
    // setup 返回对象里的 ref 是原始形态（proxyRefs 解包在 runtime handleSetupResult 阶段）
    expect(ret.n.value).toBe(0)
    expect(ret.props.label).toBe('x')
    ret.props.label = 'y' // __props 即 props 引用
    expect(setupCtx.expose).toHaveBeenCalledWith({ bump: expect.any(Function) })
    // let 的 get/set 闭环
    expect(ret.count).toBeUndefined()
    const keys = Object.getOwnPropertyDescriptors(ret)
    const getterDesc = keys.n
    expect(typeof (getterDesc as any).get).toBe('function')
    // 产物组件对象 key 齐全
    expect(Comp.props.label).toBe(String)
    expect(Comp.emits).toEqual(['go'])
    expect(Comp.__name).toBe('App')
  })
})