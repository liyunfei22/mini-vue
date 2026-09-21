/**
 * mini-vue 展示页 —— 一个自研 Vue3 内核的面面观
 *
 * 全部通过「模板字符串运行时编译」驱动（阶段 5+ 由 @mini-vue/vue 的
 * registerRuntimeCompiler 接管 `template:` 选项），覆盖：
 *   响应式/插值、组件 props/emit、具名插槽、v-if/v-else/v-for/v-show/v-model(含修饰符)、
 *   Options API（data/computed/methods/watch）、provide/inject、
 *   Transition 过渡、KeepAlive 状态保留 + 动态组件 :is、block/patchFlag 优化（无声）。
 */
import { createApp, defineComponent, inject, ref } from '@mini-vue/vue'
import { version } from '@mini-vue/vue'

// ============================================================
// 1) 响应式 + v-model（含 .number 修饰符）
// ============================================================
const ReactiveDemo = defineComponent({
  setup() {
    const count = ref(0)
    const name = ref('mini')
    const age = ref(0)
    return { count, name, age }
  },
  template: `
  <h2>响应式 + v-model</h2>
  <div class="card">
    <p class="counter">计数器 = {{ count }}</p>
    <button @click="count++">+1</button>
    <button @click="count--">-1</button>
    <p>v-model 文本：<input v-model="name" /> → <b>{{ name }}</b></p>
    <p>v-model.number：<input v-model.number="age" type="number" /> → <b>{{ age }}</b>（类型 {{ typeof age }}）</p>
  </div>`,
})

// ============================================================
// 2) 组件 props/emit + 具名插槽
// ============================================================
const CounterButton = defineComponent({
  props: ['label'],
  emits: ['increment'],
  setup(props, { emit }) {
    return { label: props.label, bump: () => emit('increment') }
  },
  template: `<button @click="bump">{{ label }}</button>`,
})

const Card = defineComponent({
  props: ['title'],
  template: `
  <div class="card">
    <h3>{{ title }}</h3>
    <slot name="body">（默认插槽内容）</slot>
    <footer><slot name="footer" /></footer>
  </div>`,
})

const ComponentDemo = {
  components: { CounterButton, Card },
  data() {
    return { total: 0 }
  },
  template: `
  <h2>组件：props / emit / 插槽</h2>
  <CounterButton label="点我加 5" @increment="total += 5" />
  <span>累计 = {{ total }}</span>
  <Card title="插槽演示">
    <template #body>这是 <b>body</b> 插槽</template>
    <template #footer>footer · 来自父组件</template>
  </Card>`,
}

// ============================================================
// 3) v-if / v-else / v-for / v-show
// ============================================================
const ListDemo = {
  data() {
    return { show: true, items: ['Vue3', 'Vue Router', 'Pinia'], showList: true }
  },
  methods: {
    toggleShow() {
      this.show = !this.show
    },
    add() {
      this.items.push(`item ${this.items.length + 1}`)
    },
  },
  template: `
  <h2>渲染指令：v-if / v-else / v-for / v-show</h2>
  <div class="card">
    <button @click="toggleShow">切换条件</button>
    <p v-if="show">✅ 条件块：显示</p>
    <p v-else>🚫 条件块：隐藏</p>
    <p v-show="showList">v-show 显隐（display 切换，不销毁）</p>
    <button @click="add">新增一项</button>
    <ul><li v-for="(it, i) in items" :key="it">{{ i }}. {{ it }}</li></ul>
  </div>`,
}

// ============================================================
// 4) Options API：data / computed / methods / watch
// ============================================================
const OptionsDemo = {
  data() {
    return { n: 1 }
  },
  computed: {
    double() {
      return this.n * 2
    },
  },
  methods: {
    inc() {
      this.n++
    },
  },
  watch: {
    n(v, old) {
      console.log(`[Options watch] n: ${old} → ${v}`)
    },
  },
  created() {
    console.log('[Options] created')
  },
  template: `
  <h2>Options API：data / computed / methods / watch</h2>
  <div class="card">
    <p>n = {{ n }}</p>
    <p>computed double = {{ double }}</p>
    <button @click="inc">n++</button>
  </div>`,
}

// ============================================================
// 5) Transition 过渡
// ============================================================
const TransitionDemo = {
  setup() {
    const showX = ref(true)
    return { showX }
  },
  template: `
  <h2>Transition 过渡</h2>
  <div class="card">
    <button @click="showX = !showX">切换</button>
    <Transition>
      <p v-if="showX" style="opacity: 1">过渡效果：淡入淡出</p>
    </Transition>
  </div>`,
}

// ============================================================
// 6) KeepAlive + 动态组件 :is（状态保留）
// ============================================================
const TabA = defineComponent({
  data() {
    return { count: 0 }
  },
  template: `<div><p>Tab A — 计数：{{ count }}</p><button @click="count++">+1</button></div>`,
})
const TabB = defineComponent({ template: `<div>Tab B（无状态）</div>` })

const KeepAliveDemo = {
  components: { TabA, TabB },
  data() {
    return { tab: 'TabA' }
  },
  template: `
  <h2>KeepAlive + 动态组件 :is（切走后状态保留）</h2>
  <div class="card">
    <button @click="tab = 'TabA'">Tab A</button>
    <button @click="tab = 'TabB'">Tab B</button>
    <KeepAlive><component :is="tab" /></KeepAlive>
    <p>在 Tab A 计数后切走再切回，计数保留。各 Tab 状态开在 console 里。</p>
  </div>`,
}

// ============================================================
// 7) provide / inject
// ============================================================
const ThemeBadge = defineComponent({
  setup() {
    const theme = inject('theme')
    return { theme }
  },
  template: `<span class="badge">主题：{{ theme }}</span>`,
})

const ProvideDemo = {
  components: { ThemeBadge },
  setup() {
    // 应用级 provide 由 createApp().provide 注入，这里再走组件级示例
    return {}
  },
  template: `
  <h2>provide / inject</h2>
  <div class="card"><ThemeBadge /></div>`,
}

// ============================================================
// 根组件（组件级 provide）
// ============================================================
const App = {
  components: {
    ReactiveDemo,
    ComponentDemo,
    ListDemo,
    OptionsDemo,
    TransitionDemo,
    KeepAliveDemo,
    ProvideDemo,
  },
  setup() {
    return { version }
  },
  template: `
  <h1>⚛ mini-vue 展示页 <span class="badge">self-hosted v{{ version }}</span></h1>
  <p>这是用我们一行行手写的 Vue3 内核渲染出来的页面 —— 模板在运行时编译成 render 函数，
     再由自研渲染器把它变成 DOM。打开 DevTools 观察 &lt;script&gt; 里只有一个入口文件。</p>
  <ReactiveDemo />
  <ComponentDemo />
  <ListDemo />
  <OptionsDemo />
  <TransitionDemo />
  <KeepAliveDemo />
  <ProvideDemo />
  <pre>// 这些都来自我们自己的实现：
// import { createApp, defineComponent, ref } from '@mini-vue/vue'
// <span class="x">…</span></pre>`,
}

createApp(App)
  .provide('theme', 'mini-dark')
  .mount(document.querySelector('#app')!)