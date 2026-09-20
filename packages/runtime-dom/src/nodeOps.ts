/**
 * nodeOps.ts —— DOM 宿主操作集
 *
 * 对应真 Vue packages/runtime-dom/src/nodeOps.ts。
 * 渲染器不直接碰 DOM，全部经由这里 —— 换一套实现（比如 canvas/SSR），
 * 渲染器一行不改。`insert(anchor)` 的语义是「anchor 之前」，history 见 renderer 协议。
 */
import type { RendererOptions } from '@mini-vue/runtime-core'

export const nodeOps = {
  insert: (child: Node, parent: Element, anchor?: Node | null) => {
    parent.insertBefore(child, anchor || null)
  },

  remove: (child: Node) => {
    const parent = child.parentNode
    if (parent) {
      parent.removeChild(child)
    }
  },

  createElement: (tag: string): Element => {
    return document.createElement(tag)
  },

  createText: (text: string): Text => document.createTextNode(text),

  createComment: (text: string): Comment => document.createComment(text),

  setText: (node: Node, text: string) => {
    node.nodeValue = text
  },

  setElementText: (el: Element, text: string) => {
    el.textContent = text
  },

  parentNode: (node: Node): Element | null => node.parentNode as Element | null,

  nextSibling: (node: Node): Node | null => node.nextSibling,

  // KeepAlive 显隐：display 切换（留在原位隐藏，不清晨 slot）
  hideNode: (el: Element) => {
    ;(el as HTMLElement).style.display = 'none'
  },
  showNode: (el: Element) => {
    ;(el as HTMLElement).style.display = ''
  },
} satisfies Partial<RendererOptions<Node, Element>>