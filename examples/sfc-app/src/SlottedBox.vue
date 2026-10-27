<script setup lang="ts">
/**
 * SlottedBox.vue —— 插槽 + :slotted 演示
 * scoped 样式里用 :slotted(.slotted-msg)：
 *   - 编译期：descriptor.slotted → true → <slot> 出口不带 noSlotted
 *   - 运行时：插槽内容元素带上 [data-v-xxx-s]，规则 .slotted-msg[data-v-xxx-s] 命中
 */
defineProps({ title: String })
</script>

<template>
  <section class="box">
    <h2 class="box__title">{{ title }}</h2>
    <div class="box__content">
      <slot></slot>
    </div>
  </section>
</template>

<style scoped>
.box {
  margin-top: 24px;
  padding: 16px;
  border: 2px dashed #94a3b8;
  border-radius: 8px;
}
.box__title {
  margin: 0 0 8px;
  font-size: 14px;
  color: #475569;
}
/* :slotted —— 从父组件「射进来」的内容也能被本组件的 scoped 样式命中 */
.box__content :slotted(.slotted-msg) {
  color: #0f766e;
  font-weight: 600;
}
</style>