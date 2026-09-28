import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitepress'

// 站点配置：https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'zh-CN',
  title: 'mini-vue',
  description: '一行行手写的 Vue 3 内核：响应式 / 运行时 / 编译器 / 补全',

  // 部署在 GitHub Pages 子路径 <user>.github.io/mini-vue/，base 必须带仓库名
  base: '/mini-vue/',

  // 排除两个「_」前缀的内部元文件（专栏规划 / 系列导读）不进入路由
  srcExclude: ['_*.md'],

  markdown: {
    config(md) {
      // 文章大量引用 Vue 的 mustache 插值语法（如 `<code>{{ msg }}</code>`、`{{`、`{{ }}`）。
      // VitePress 只给代码块加 v-pre，行内代码默认不加；而 escapeHtml 不转义花括号，
      // 于是行内代码里的 `{{` 会被 Vue 模板引擎当插值编译 -> 构建报错 / 页面走样。
      // 这里给行内代码同样加上 v-pre，让花括号原样输出，与代码块行为对齐。
      md.renderer.rules.code_inline = (tokens, idx, options, env, slf) => {
        const token = tokens[idx]
        return `<code v-pre${slf.renderAttrs(token)}>${md.utils.escapeHtml(token.content)}</code>`
      }
    },
  },

  // 构建收尾：写入 .nojekyll，防止 GitHub Pages 的 Jekyll 忽略 _ / . 开头资源
  buildEnd(siteConfig) {
    writeFileSync(join(siteConfig.outDir, '.nojekyll'), '')
  },

  themeConfig: {
    nav: [
      { text: '开始阅读', link: '/00-权衡与整体架构' },
      { text: 'GitHub', link: 'https://github.com/liyunfei22/mini-vue' },
    ],

    sidebar: [
      {
        text: '实现 Vue 3 内核',
        items: [
          { text: '系列导读', link: '/' },
          { text: '00 · 权衡与整体架构', link: '/00-权衡与整体架构' },
          { text: '01 · 响应式系统', link: '/01-响应式系统' },
          { text: '02 · 渲染器与组件', link: '/02-渲染器与组件' },
          { text: '03 · 模板编译器', link: '/03-模板编译器' },
          { text: '04 · 内核补全', link: '/04-内核补全' },
          { text: '05 · 构建与发布', link: '/05-构建与发布' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: {
      text: '最后更新',
      formatOptions: { dateStyle: 'medium', timeStyle: 'short' },
    },

    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',

    editLink: {
      pattern: 'https://github.com/liyunfei22/mini-vue/edit/main/juejin2/:path',
      text: '在 GitHub 上编辑此页',
    },

    footer: {
      message: '基于官方 Vue 3 内核，一行行手写复刻',
      copyright: 'MIT License · liyunfei22',
    },
  },
})