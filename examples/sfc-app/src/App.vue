<script setup lang="ts">
/**
 * App.vue —— compiler-sfc 全特性演示
 * script setup（defineProps/defineEmits/defineExpose）+ scoped 样式（:deep/:slotted）
 * 普通 <script> 的 Options 合并（name/inheritAttrs），由编译产物 Object.assign 完成。
 */
import { ref } from '@mini-vue/vue'
import TodoItem from './TodoItem.vue'
import SlottedBox from './SlottedBox.vue'

const title = ref('mini-vue SFC 跑起来了 🎉')
const text = ref('')
const todos = ref<{ id: number; label: string; done: boolean }[]>([])
let nextId = 1

function addTodo() {
  const label = text.value.trim()
  if (!label) return
  todos.value.push({ id: nextId++, label, done: false })
  text.value = ''
}

function removeTodo(id: number) {
  todos.value = todos.value.filter((t) => t.id !== id)
}

defineExpose({ addTodo })
</script>

<script>
// 普通 script 的 Options 与 setup 合并（defineOptions/export default 双形态）
export default { name: 'SfcApp', inheritAttrs: false }
</script>

<template>
  <main class="app">
    <h1 class="app__title">{{ title }}</h1>

    <form class="app__form" @submit.prevent="addTodo">
      <input v-model="text" placeholder="输入待办，回车添加" class="app__input" />
      <button type="submit">添加</button>
    </form>

    <p v-if="!todos.length" class="app__empty">还没有待办（试试上面的输入框）</p>
    <ul class="app__list">
      <TodoItem
        v-for="todo in todos"
        :key="todo.id"
        :todo="todo"
        @remove="removeTodo"
      />
    </ul>

    <SlottedBox title="插槽演示（Scoped :slotted）">
      <span class="slotted-msg">这段插槽内容带父 scopeId + 子组件的 -s 标记</span>
    </SlottedBox>
  </main>
</template>

<style scoped>
/* scoped 样式：选择器注入 data-v-xxx，运行时由 scopeId 链路落属性 */
.app {
  max-width: 480px;
  margin: 40px auto;
  font-family: system-ui, sans-serif;
  color: #0f172a;
}
.app__title {
  font-size: 22px;
}
.app__form {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.app__input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
}
.app__empty {
  color: #94a3b8;
}
/* :deep —— 穿透到子组件内部元素（.todo 是 TodoItem 的根，直接可命中；
   这里演示 :deep 命中子组件内层） */
.app__list :deep(.todo__remove) {
  transition: opacity 0.2s;
}
</style>