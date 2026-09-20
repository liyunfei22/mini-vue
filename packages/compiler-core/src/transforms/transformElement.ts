/**
 * transformElement.ts —— 元素变换：把 ATTR/DIRECTIVE 变成 vnode 的 props/directives
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformElement.ts。
 *
 * exit 阶段（children 已变换完）为元素生成 codegenNode（VNODE_CALL）：
 *   <div id="x" :class="c" @click="h" v-html="html"/>
 *   → _createElementVNode("div", { id:"x", class:c, onClick:h, innerHTML:html }, children, -1)
 *
 * mini 版支持：静态属性、v-bind（静态/动态 arg）、v-on（静态 arg）、v-html、v-text；
 * 其余指令（v-model/v-show）收进 withDirectives 子句（阶段 6 补齐运行时指令）。
 */
import {
  createArrayExpression,
  createCallExpression,
  createFunctionExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  createVNodeCall,
  NodeTypes,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
} from '../ast'

/** 生成 `$event => (exp = $event)` 形式的赋值箭头函数（v-model 双向绑定用） */
/** 组件插槽收编：slot 指令子节点 → { name: () => [子codegen], default: ... } */
function buildSlots(children: any[]): any {
  const named = new Map<string, any[]>()
  const defChildren: any[] = []
  for (const child of children) {
    const slotDir = (child.props || []).find(
      (p: any) => p.type === NodeTypes.DIRECTIVE && p.name === 'slot',
    )
    if (slotDir) {
      const slotName = (slotDir.arg && slotDir.arg.content) || (slotDir.exp && slotDir.exp.content) || 'default'
      child.props = child.props.filter((p: any) => p !== slotDir) // 摘掉 slot 指令
      const list = named.get(slotName) || []
      // <template #name>：slot 体 = template 的子节点（不渲染 template 本身）
      if (child.tag === 'template') {
        child.children.forEach((c: any) => list.push(c.codegenNode || c))
      } else {
        list.push(child.codegenNode || child)
      }
      named.set(slotName, list)
    } else {
      defChildren.push(child)
    }
  }
  if (named.size === 0 && defChildren.length === 0) return null
  const entries: any[] = []
  for (const [name, list] of named) {
    entries.push(
      createObjectProperty(
        createSimpleExpression(name, true),
        createFunctionExpression([], list.map((c: any) => c.codegenNode || c)),
      ),
    )
  }
  if (defChildren.length) {
    entries.push(
      createObjectProperty(
        createSimpleExpression('default', true),
        createFunctionExpression([], defChildren.map((c: any) => c.codegenNode || c)),
      ),
    )
  }
  return createObjectExpression(entries)
}

function createAssignment(exp: any): any {
  return {
    type: NodeTypes.JS_FUNCTION_EXPRESSION,
    params: [createSimpleExpression('$event', false)],
    body: createSimpleExpression(`(${exp.content} = $event.target.value)`, false),
    loc: (exp as any).loc,
  }
}
import { CREATE_ELEMENT_VNODE, CREATE_VNODE, RESOLVE_COMPONENT, WITH_DIRECTIVES } from '../runtimeHelpers'
import type { NodeTransform, TransformContext } from '../transform'

export const transformElement: NodeTransform = (node, context) => {
  return function postTransformElement() {
    if ((node as ElementNode).type !== NodeTypes.ELEMENT) return
    const el = node as ElementNode
    const tag = el.tag
    const isComponent = (el as any).tagType === 1 // COMPONENT

    let vnodeTag: any = tag
    if (isComponent) {
      vnodeTag = createCallExpression(context.helper(RESOLVE_COMPONENT), [
        createSimpleExpression(tag, true),
      ])
    }

    const properties: any[] = []
    const dirs: any[] = []

    for (let i = 0; i < el.props.length; i++) {
      const prop = el.props[i]
      if (prop.type === NodeTypes.ATTRIBUTE) {
        const attr = prop as AttributeNode
        const value = attr.value
        properties.push(
          createObjectProperty(
            createSimpleExpression(attr.name, true),
            value
              ? createSimpleExpression(value.content, true)
              : createSimpleExpression('""', true),
          ),
        )
      } else {
        const dir = prop as DirectiveNode
        const { name, arg, exp, modifiers } = dir
        if (name === 'bind' && arg && exp) {
          if ((arg as any).isStatic) {
            properties.push(createObjectProperty(arg, exp))
          } else {
            // 动态 arg：{ [key]: value }
            properties.push({
              type: NodeTypes.JS_PROPERTY,
              key: arg,
              value: exp,
              computed: true,
              loc: (arg as any).loc,
            } as any)
          }
        } else if (name === 'on' && arg && exp) {
          const eventName = (arg as any).content
          const keyName = `on${eventName[0]?.toUpperCase()}${eventName.slice(1)}`
          properties.push(
            createObjectProperty(createSimpleExpression(keyName, true), exp),
          )
        } else if (name === 'html' && exp) {
          properties.push(
            createObjectProperty(createSimpleExpression('innerHTML', true), exp),
          )
        } else if (name === 'text' && exp) {
          properties.push(
            createObjectProperty(createSimpleExpression('textContent', true), exp),
          )
        } else if (name === 'model' && exp) {
          // v-model（input/textarea 的 DOM 基础形态）：展开成
          // { value: exp, "onUpdate:modelValue": $event => (exp = $event) }
          // （checkbox/radio/select 的指令形态在阶段 6 补齐）
          if (tag === 'input' || tag === 'textarea') {
            properties.push(
              createObjectProperty(
                createSimpleExpression('value', true),
                exp,
              ),
            )
            properties.push(
              createObjectProperty(
                createSimpleExpression('onInput', true),
                createAssignment(exp),
              ),
            )
          } else {
            // 其它标签 → 收进 withDirectives（运行时 v-model 指令，阶段 6）
            dirs.push(
              createArrayExpression([
                exp,
                createSimpleExpression(name, true),
              ]),
            )
          }
        } else if (name === 'slot') {
          // 插槽指令由「父侧 buildSlots」收编，这里跳过（子节点不会带 withDirectives(slot)）
        } else {
          // 其它指令 → [exp, "name", arg?, modifiers]，运行时 by withDirectives 数组
          const elements: any[] = [exp as any, createSimpleExpression(name, true)]
          if (arg) elements.push(arg)
          elements.push(createSimpleExpression(modifiers.join('.'), true))
          dirs.push(createArrayExpression(elements))
        }
      }
    }

    const vnodeProps = properties.length ? createObjectExpression(properties) : null

    // 组件元素：子节点里带 `slot` 指令（<template #title>）收集成 slots 对象
    let vnodeChildren: any = null
    if (isComponent && el.children.length) {
      vnodeChildren = buildSlots(el.children)
    } else if (el.children.length) {
      const childCodegen = el.children.map((c: any) => c.codegenNode || c)
      vnodeChildren =
        childCodegen.length === 1 ? childCodegen[0] : createArrayExpression(childCodegen)
    }

    // 组件标签用 _createVNode（会按「解析后的对象」算 COMPONENT shapeFlag）；
    // 普通元素用 _createElementVNode（跳过 shapeFlag 判定、直接 ELEMENT）
    context.helper(isComponent ? CREATE_VNODE : CREATE_ELEMENT_VNODE)
    let vnodeCall: any = createVNodeCall(vnodeTag, vnodeProps, vnodeChildren, -1)
    ;(vnodeCall as any).isComponent = isComponent
    if (dirs.length) {
      vnodeCall = createCallExpression(context.helper(WITH_DIRECTIVES) as any, [
        vnodeCall,
        createArrayExpression(dirs),
      ])
    }

    el.codegenNode = vnodeCall
  }
}