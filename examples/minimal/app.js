/**
 * app.js —— 读者自己的代码：把三层接成一次点击
 *
 * 本文件与框架文件的分隔是故意的：这里是「用框架」，那里是「写框架」。
 *
 * 一次点击的完整链路（本文档的核心画面）：
 *   点击 → @click 回调 → setup 改 state → proxy set → trigger
 *   → 微任务队列 → instance.update 重跑 → render(ctx)（compile 产出的函数）
 *   → h() 新 vnode → patch（同位置就地 diff）→ DOM 变
 *
 * 阶段 3：四个 demo 全部由 compile() 驱动——模板即 render 的语法糖。
 * 想看「糖果」长什么样：Demo 4 探照灯把编译产物摊开在你面前。
 */
import { ref, reactive } from './reactivity.js'
import { createApp } from './renderer.js'
import { compile } from './compiler.js'

// ---------------------------------------------------------------
// Demo 1 · 计数器：最小回路（h 手写版见 commit 2 的 git 历史，形态一致）
// ---------------------------------------------------------------
const Counter = {
  setup() {
    const count = ref(0)
    return { count }
  },
  render: compile(`
<p>计数：{{ count }}</p>
<button @click="count++">加一</button>
<button @click="count = 0">清零</button>
`),
}
createApp(Counter).mount(document.getElementById('demo1'))

// ---------------------------------------------------------------
// Demo 2 · 任务列表：v-for + 就地 diff 的边界
//   「危险重排」故意让无 key 的就地 diff 错位（勾选状态跟着位置走）
// ---------------------------------------------------------------
const Todo = {
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
      addTodo() {
        state.list.push({ id: state.nextId++, text: `新任务 ${state.nextId - 1}`, done: false })
      },
      removeTodo(index) {
        state.list.splice(index, 1)
      },
      dangerousShuffle() {
        state.list.reverse() // 反转数组 = 同位置 diff 的雷区
      },
    }
  },
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
//   模板里的 <Stepper> 是组件标签（首字母大写 → with(ctx) 里解析到 ctx.Stepper）
// ---------------------------------------------------------------
const Stepper = {
  setup(props, { emit }) {
    return {
      inc() {
        emit('update', props.step)
      },
    }
  },
  render: compile(`
<span>步长 {{ props.step }}</span>
<button @click="inc()">按步长加（emit 上去）</button>
`),
}

const Parent = {
  setup() {
    const step = ref(2)
    const total = ref(0)
    return {
      step,
      total,
      Stepper,
      onUpdate(stepValue) {
        total.value += stepValue
      },
    }
  },
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

function runSpotlight() {
  const template = tplInput.value
  const render = compile(template)
  tplCode.textContent = render.toString()
  // 每次重编译换新容器重挂载（旧组件与旧 state 无引用后自然失效）
  tplRender.innerHTML = ''
  const host = document.createElement('div')
  tplRender.appendChild(host)
  createApp({
    setup: () => ({ count: ref(0) }),
    render,
  }).mount(host)
}
// 未接入前的初值：固定一个最小模板
tplInput.value = `
<p>{{ count }}</p>
<button @click="count++">点我 +1</button>`
tplInput.addEventListener('input', runSpotlight)
runSpotlight()