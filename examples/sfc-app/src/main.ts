/**
 * main.ts —— SFC 应用的入口：createApp 挂载一个 .vue 文件
 */
import { createApp } from '@mini-vue/vue'
import App from './App.vue'

createApp(App).mount(document.getElementById('app')!)