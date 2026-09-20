/**
 * mini-vue playground —— 阶段 3 runtime 演示
 *
 * 全部用纯 h() 手写（无模板编译器），验证「响应式 ↔ 渲染器 ↔ 组件协议」闭环。
 * 演示点：
 *   1. 嵌套组件 + props 下传 + emit 上抛（父子协作计数）
 *   2. provide / inject 跨两层注入主题
 *   3. 条件渲染（v-if 语义 via 三目） + 列表增删
 *   4. 生命周期钩子顺序打印
 */
import { h, ref, createApp, provide, inject, onMounted } from '@mini-vue/runtime-dom'

// ---------- 主题注入（Symbol key 走原型链） ----------
const ThemeKey = Symbol('theme')

// ---------- 子组件：按钮触发 emit ----------
const CounterButton = {
  props: ['label'],
  emits: ['increment'],
  setup(props, { emit }) {
    onMounted(() => console.log(`[lifecycle] <${props.label}> mounted`))
    return { emit }
  },
  render(ctx: any) {
    return h(
      'button',
      { onClick: () => ctx.emit('increment') },
      `点我 +1（${ctx.label}）`,
    )
  },
}

// ---------- 子组件：inject 主题 + 接收 prop ----------
const ThemeBadge = {
  props: ['count'],
  setup() {
    const theme = inject(ThemeKey)
    return { theme }
  },
  render(ctx: any) {
    return h(
      'span',
      { class: 'theme-badge' },
      `${ctx.theme} · count=${ctx.count}`,
    )
  },
}

// ---------- 根组件 ----------
const App = {
  setup() {
    provide(ThemeKey, 'mini-dark')
    onMounted(() => console.log('[lifecycle] <App> mounted'))

    const count = ref(0)
    const show = ref(true)
    const items = ref(['列表项 A', '列表项 B'])

    return { count, show, items }
  },
  render(ctx: any) {
    return h('div', [
      h('h2', 'mini-vue 阶段 3 runtime demo'),

      // 1. 嵌套组件 + emit 上抛
      h('div', { class: 'card' }, [
        h('p', `计数器：${ctx.count}`),
        h(CounterButton, {
          label: '加一',
          onIncrement: () => ctx.count++,
        }),
        h(ThemeBadge, { count: ctx.count }),
      ]),

      // 2. 条件渲染：三目切换 div/span
      h('div', { class: 'card' }, [
        h('button', { onClick: () => (ctx.show = !ctx.show) }, '切换条件块'),
        ctx.show ? h('p', '现在显示的是 <p>') : h('span', '现在显示的是 <span>'),
      ]),

      // 3. 列表增删（阶段 4 keyed diff：稳定节点复用不重挂）
      h('div', { class: 'card' }, [
        h(
          'button',
          { onClick: () => ctx.items.push(`列表项 ${ctx.items.length + 1}`) },
          '新增',
        ),
        h(
          'button',
          { onClick: () => ctx.items.shift() },
          '删头',
        ),
        h(
          'ul',
          ctx.items.map((it: string, idx: number) =>
            h('li', { key: `${it}-${idx}` }, it),
          ),
        ),
      ]),
    ])
  },
}

createApp(App).mount(document.querySelector('#app')!)