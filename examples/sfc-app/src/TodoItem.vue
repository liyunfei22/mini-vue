<script setup lang="ts">
/**
 * TodoItem.vue —— 子组件：defineProps（对象字面量形态）/ defineEmits 上行
 * 注意：模板里直接用 `emit(...)` 必须先 `const emit = defineEmits([...])`
 * （产物里 init 会被改写为 `__emit`，模板经返回对象读到它）
 */
import { ref } from '@mini-vue/vue'

const props = defineProps({ todo: { type: Object, required: true } })
const emit = defineEmits(['remove'])

const hovered = ref(false)

function onRemove() {
  emit('remove', props.todo.id)
}
</script>

<template>
  <li class="todo" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <span class="todo__label">{{ todo.label }}</span>
    <span v-if="hovered" class="todo__hint">（hover 状态来自 ref 驱动的重渲染）</span>
    <button class="todo__remove" @click="onRemove">删除</button>
  </li>
</template>

<style scoped>
.todo {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-bottom: 8px;
  background: #f8fafc;
}
.todo__label {
  font-weight: 500;
}
.todo__hint {
  color: #64748b;
  font-size: 12px;
}
.todo__remove {
  margin-left: auto;
  border: none;
  background: #fecaca;
  color: #991b1b;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}
</style>