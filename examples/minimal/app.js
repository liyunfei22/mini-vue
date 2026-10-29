/**
 * app.js —— 读者自己的代码：把三层接成一次点击
 *
 * 本文件与框架文件的分隔是故意的：app.js 是「用框架」，前三个是「写框架」。
 *
 * 一次点击的完整链路（本文档的核心画面）：
 * 点击按钮触发 onClick 回调，回调写入 setup 状态，proxy 的 set 拦截到写入并
 * 调用 trigger，trigger 把更新交给 effect 的 scheduler 送进微任务队列，队列
 * 执行 instance.update 重跑渲染，render(ctx) 生成新的 vnode 树，patch 就地
 * 比较并更新 DOM，页面上的数字变化。
 *
 * 目录结构与 packages/ 一一对应（这就是「最小版是索引」的含义）：
 *   reactivity/      ↔ packages/reactivity
 *   runtime-core/    ↔ packages/runtime-core
 *   compiler-core/   ↔ packages/compiler-core
 */
import { ref, reactive } from './reactivity/index.js'
import { createApp } from './runtime-core/index.js'
import { compile } from './compiler-core/index.js'

// ---------------------------------------------------------------
// 最小 demo：count 加减（Vue 官网的第一个例子就是它）
// 对比真实 Vue：createApp({ setup(){...}, render: compile(模板) })
// 与 h 手写版的差别只有 render 的写法
// ---------------------------------------------------------------
const Counter = {
  /** 初始化 count 状态 */
  setup() {
    const count = ref(0)
    return { count }
  },
  /** 模板编译成 render：- / count / + 三件套，点击改 count */
  render: compile(`
<button @click="count--">-</button>
<b>{{ count }}</b>
<button @click="count++">+</button>
`),
}
createApp(Counter).mount(document.getElementById('demo1'))

// ---------------------------------------------------------------
// Demo 2 · 任务列表：v-for + 就地 diff 的边界
// 「危险重排」故意让无 key 的就地 diff 错位（勾选状态跟着位置走）
// ---------------------------------------------------------------
const Todo = {
  /** 初始化任务列表与操作集合 */
  setup() {
    const state = reactive({
      list: [
        { id: 1, text: '读完 reactivity.js', done: false },
        { id: 2, text: '读完 renderer.js', done: false },
        { id: 3, text: '读完 compiler.js', done: false },
      ],
      nextId: 4,
    })
    return {
      state,
      /** 在列表尾部追加一条新任务 */
      addTodo() {
        state.list.push({ id: state.nextId++, text: `新任务 ${state.nextId - 1}`, done: false })
      },
      /** 按下标移除一条任务 */
      removeTodo(index) {
        state.list.splice(index, 1)
      },
      /** 反转任务列表，让就地 diff 的错位现象显形 */
      dangerousShuffle() {
        state.list.reverse()
      },
    }
  },
  /** 模板编译成 render：操作按钮 + v-for 列表（勾选、文本、删除） */
  render: compile(`
<button @click="addTodo()">添加任务</button>
<button @click="dangerousShuffle()">危险重排（就地 diff 会错位）</button>
<ul>
  <li v-for="todo, index in state.list">
    <input type="checkbox" :checked="todo.done" @change="todo.done = !todo.done" />
    <span>{{ todo.text }}</span>
    <button @click="removeTodo(index)">删除</button>
  </li>
</ul>
`),
}
createApp(Todo).mount(document.getElementById('demo2'))

// ---------------------------------------------------------------
// Demo 3 · 父子组件：props 下传（:step）+ @update 上抛（emit）
// 模板里的 <Stepper> 是组件标签（首字母大写 → with(ctx) 里解析到 ctx.Stepper）
// ---------------------------------------------------------------
const Stepper = {
  /** 读取父传来的 props.step，提供 inc 方法把步长 emit 回去 */
  setup(props, { emit }) {
    return {
      inc() {
        emit('update', props.step)
      },
    }
  },
  /** 模板编译成 render：显示步长与触发按钮 */
  render: compile(`
<span>步长 {{ props.step }}</span>
<button @click="inc()">按步长加（emit 上去）</button>
`),
}

const Parent = {
  /** 维护步长与总数，注册子组件 Stepper，接收子组件 emit 的 update 事件 */
  setup() {
    const step = ref(2)
    const total = ref(0)
    return {
      step,
      total,
      Stepper,
      /** 子组件 emit 的 update 事件处理：把步长累进总数 */
      onUpdate(stepValue) {
        total.value += stepValue
      },
    }
  },
  /** 模板编译成 render：总数、改步长按钮、子组件（:step 下传 / @update 上抛） */
  render: compile(`
<p>父组件总数：{{ total }}</p>
<button @click="step = step + 2">父改步长</button>
<Stepper :step="step" @update="onUpdate" />
`),
}
createApp(Parent).mount(document.getElementById('demo3'))

// ---------------------------------------------------------------
// Demo 4 · 模板探照灯：把编译产物摊开（编译器透明化）
// ---------------------------------------------------------------
const tplInput = document.getElementById('tpl-input')
const tplCode = document.getElementById('tpl-code')
const tplRender = document.getElementById('tpl-render')

/** 用 textarea 的当前内容编译 render，显示产物源码并实时挂载渲染结果 */
function runSpotlight() {
  const template = tplInput.value
  const render = compile(template)
  tplCode.textContent = render.toString()
  // 每次重编译换新容器重挂载（旧组件与旧 state 失去引用后自然失效）
  tplRender.innerHTML = ''
  const host = document.createElement('div')
  tplRender.appendChild(host)
  createApp({
    setup: () => ({ count: ref(0) }),
    render,
  }).mount(host)
}
// 初始值：一个最小模板
tplInput.value = `
<p>{{ count }}</p>
<button @click="count++">点我 +1</button>`
tplInput.addEventListener('input', runSpotlight)
runSpotlight()