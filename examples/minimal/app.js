/**
 * app.js —— 读者自己的代码：把三层接成一次点击
 *
 * 本文件与前三文件的分隔是故意的：这里是「用框架」，那里是「写框架」。
 *
 * 一次点击的完整链路（本文档的核心画面）：
 *   点击 → @click 回调 → setup 改 state → proxy set → trigger
 *   → 微任务队列 → instance.update 重跑 → render(ctx) → h() 新 vnode
 *   → patch（同位置就地 diff）→ DOM 变
 *
 * 阶段 2：三个 demo 全部用 h() 手写 render（对照 playground）；
 * 阶段 3：compiler.js 接入后，同款模板变成 compile() 的产物（对照 showcase）。
 */
import { ref, reactive } from './reactivity.js'
import { h, createApp } from './renderer.js'

// ---------------------------------------------------------------
// Demo 1 · 计数器：最小回路
// ---------------------------------------------------------------
const Counter = {
  setup() {
    const count = ref(0)
    return { count }
  },
  render(ctx) {
    return h('div', null, [
      h('p', null, `计数：${ctx.count}`),
      h('button', { onClick: () => ctx.count++ }, '加一'),
      h('button', { onClick: () => (ctx.count = 0) }, '清零'),
    ])
  },
}
createApp(Counter).mount(document.getElementById('demo1'))

// ---------------------------------------------------------------
// Demo 2 · 任务列表：就地 diff 的边界
//   「危险重排」故意让无 key 的就地 diff 错位（勾选状态跟着位置走，
//   而不是跟着任务走）——文章 07 的引入场景，这里先踩雷
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
        // 反转数组 = 同位置 diff 的雷区
        state.list.reverse()
      },
    }
  },
  render(ctx) {
    return h('div', null, [
      h('button', { onClick: ctx.addTodo }, '添加任务'),
      h('button', { onClick: ctx.dangerousShuffle }, '危险重排（就地 diff 会错位）'),
      h(
        'ul',
        null,
        ctx.state.list.map((todo, index) =>
          h('li', { key: todo.id }, [
            h('input', {
              type: 'checkbox',
              checked: todo.done,
              onChange: () => (todo.done = !todo.done),
            }),
            h('span', null, todo.text),
            h('button', { onClick: () => ctx.removeTodo(index) }, '删除'),
          ]),
        ),
      ),
    ])
  },
}
createApp(Todo).mount(document.getElementById('demo2'))

// ---------------------------------------------------------------
// Demo 3 · 父子组件：props 下传（:step 绑定）+ @update 上抛（emit）
//   父改 step → props merge 进 reactive → 子自动重渲染（不用手动调）
// ---------------------------------------------------------------
const Stepper = {
  // 简化版不做 props 声明校验：setup 第一参收到的就是父传来的全部 props
  setup(props, { emit }) {
    return {
      inc() {
        emit('update', props.step)
      },
    }
  },
  render(ctx) {
    return h('div', null, [
      h('span', null, `步长 ${ctx.props.step}`),
      h('button', { onClick: ctx.inc }, '按步长加（emit 上去）'),
    ])
  },
}

const Parent = {
  setup() {
    const step = ref(2)
    const total = ref(0)
    return {
      step,
      total,
      onUpdate(stepValue) {
        total.value += stepValue
      },
    }
  },
  render(ctx) {
    return h('div', null, [
      h('p', null, `父组件总数：${ctx.total}`),
      h('button', { onClick: () => (ctx.step = ctx.step + 2) }, '父改步长'),
      h(Stepper, {
        step: ctx.step,
        onUpdate: ctx.onUpdate,
      }),
    ])
  },
}
createApp(Parent).mount(document.getElementById('demo3'))