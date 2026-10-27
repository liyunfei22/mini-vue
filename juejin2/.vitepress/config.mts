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
      { text: '开始阅读', link: '/00-权衡与全景' },
      { text: 'GitHub', link: 'https://github.com/liyunfei22/mini-vue' },
    ],

    sidebar: [
      {
        text: '第一部分 · 框架设计',
        items: [
          { text: '系列导读', link: '/' },
          { text: '00 · 权衡与全景', link: '/00-权衡与全景' },
        ],
      },
      {
        text: '第二部分 · 响应式',
        items: [
          { text: '01 · 副作用与桶', link: '/01-副作用与桶' },
          { text: '02 · 让依赖永远准确', link: '/02-让依赖永远准确' },
          { text: '03 · computed 与 ref', link: '/03-computed与ref' },
          { text: '04 · 调度器与 watch', link: '/04-调度器与watch' },
        ],
      },
      {
        text: '第三部分 · 渲染器',
        items: [
          { text: '05 · vnode 与挂载', link: '/05-vnode与挂载' },
          { text: '06 · 属性事件与卸载', link: '/06-属性事件与卸载' },
          { text: '07 · 子节点 diff', link: '/07-子节点diff' },
          { text: '08 · 组件的本质', link: '/08-组件的本质' },
        ],
      },
      {
        text: '第四部分 · 编译器',
        items: [
          { text: '09 · parse 状态机', link: '/09-parse状态机' },
          { text: '10 · transform 与 codegen', link: '/10-transform与codegen' },
          { text: '11 · 编译优化', link: '/11-编译优化' },
        ],
      },
      {
        text: '第五部分 · 补全与交付',
        items: [
          { text: '12 · 内置能力补全', link: '/12-内置能力补全' },
          { text: '13 · 从源码到产物', link: '/13-从源码到产物' },
        ],
      },
      {
        text: '第六部分 · 单文件组件',
        items: [
          { text: '14 · 单文件组件与 parse', link: '/14-单文件组件与parse' },
          { text: '15 · script 宏与 compileScript', link: '/15-script宏与compileScript' },
        ],
      },
      {
        text: '先导',
        items: [
          { text: '16 · 最小闭环（先导地图）', link: '/16-最小闭环' },
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