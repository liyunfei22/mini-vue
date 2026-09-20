/**
 * transformElement.ts —— 元素变换：把 ATTR/DIRECTIVE 变成 vnode 的 props/directives
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformElement.ts。
 *
 * exit 阶段为元素生成 codegenNode（VNODE_CALL）：
 *   <div id="x" :class="c" @click="h" v-html="html"/>
 *   → _createElementVNode("div", { id:"x", class:c, onClick:h, innerHTML:html }, children, -1)
 *
 * v-model 分流：
 *   input/textarea → 内联 { value, onInput: $event => (x = $event.target.value) }
 *   checkbox/radio/select → props(checked/value) + withDirectives(运行时 vModel 指令)
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
import {
  CREATE_ELEMENT_VNODE,
  CREATE_VNODE,
  RESOLVE_COMPONENT,
  LOOSE_TO_NUMBER,
  V_MODEL_CHECKBOX,
  V_MODEL_RADIO,
  V_MODEL_SELECT,
  V_SHOW,
  WITH_DIRECTIVES,
  helperNameMap,
} from '../runtimeHelpers'
import type { NodeTransform } from '../transform'

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
            value ? createSimpleExpression(value.content, true) : createSimpleExpression('""', true),
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
            properties.push({ type: NodeTypes.JS_PROPERTY, key: arg, value: exp, computed: true, loc: (arg as any).loc } as any)
          }
        } else if (name === 'on' && arg && exp) {
          const eventName = (arg as any).content
          const keyName = `on${eventName[0]?.toUpperCase()}${eventName.slice(1)}`
          properties.push(createObjectProperty(createSimpleExpression(keyName, true), exp))
        } else if (name === 'html' && exp) {
          properties.push(createObjectProperty(createSimpleExpression('innerHTML', true), exp))
        } else if (name === 'text' && exp) {
          properties.push(createObjectProperty(createSimpleExpression('textContent', true), exp))
        } else if (name === 'model' && exp) {
          // 先看静态 type 属性决定 input 的具体形态
          const typeAttr = el.props.find(
            (x) => x.type === NodeTypes.ATTRIBUTE && (x as any).name === 'type',
          )
          const inputType = typeAttr && (typeAttr as any).value ? (typeAttr as any).value.content : ''

          if (tag === 'input' && inputType === 'checkbox') {
            properties.push(createObjectProperty(createSimpleExpression('checked', true), exp))
            dirs.push(modelBinding(context, V_MODEL_CHECKBOX, exp, modifiers))
          } else if (tag === 'input' && inputType === 'radio') {
            properties.push(createObjectProperty(createSimpleExpression('checked', true), exp))
            dirs.push(modelBinding(context, V_MODEL_RADIO, exp, modifiers))
          } else if (tag === 'input' && inputType === 'select') {
            properties.push(createObjectProperty(createSimpleExpression('value', true), exp))
            dirs.push(modelBinding(context, V_MODEL_SELECT, exp, modifiers))
          } else if (tag === 'input' || tag === 'textarea') {
            // 文本形态：内联 value + 事件/取值（支持 .lazy/.trim/.number 修饰符）
            properties.push(createObjectProperty(createSimpleExpression('value', true), exp))
            const lazy = modifiers.includes('lazy')
            const eventName = lazy ? 'onChange' : 'onInput'
            let valueExpr = '$event.target.value'
            if (modifiers.includes('trim')) {
              valueExpr = '$event.target.value.trim()'
            } else if (modifiers.includes('number')) {
              context.helper(LOOSE_TO_NUMBER)
              // 用别名 `_looseToNumber`（顶层 const 解构），裸名在 with(_ctx) 里解析不到
              valueExpr = `_${helperNameMap[LOOSE_TO_NUMBER]}($event.target.value)`
            }
            properties.push(
              createObjectProperty(
                createSimpleExpression(eventName, true),
                createAssignment(exp, valueExpr),
              ),
            )
          } else if (tag === 'checkbox') {
            properties.push(createObjectProperty(createSimpleExpression('checked', true), exp))
            dirs.push(modelBinding(context, V_MODEL_CHECKBOX, exp, modifiers))
          } else if (tag === 'radio') {
            properties.push(createObjectProperty(createSimpleExpression('checked', true), exp))
            dirs.push(modelBinding(context, V_MODEL_RADIO, exp, modifiers))
          } else if (tag === 'select') {
            properties.push(createObjectProperty(createSimpleExpression('value', true), exp))
            dirs.push(modelBinding(context, V_MODEL_SELECT, exp, modifiers))
          } else {
            dirs.push(createArrayExpression([exp as any, createSimpleExpression(name, true)]))
          }
        } else if (name === 'show' && exp) {
          // v-show：withDirectives(_vShow, exp) —— 运行时按 binding.value 显隐
          context.helper(V_SHOW)
          dirs.push(
            createArrayExpression([
              createSimpleExpression(`_${helperNameMap[V_SHOW]}`, false),
              exp,
              createSimpleExpression('', true),
              createSimpleExpression(modifiers.join('.'), true),
            ]),
          )
        } else if (name === 'slot') {
          // 插槽指令由「父侧 buildSlots」收编，这里跳过
        } else {
          // 其它指令 → [exp, "name", arg?, modifiers]，运行时 by withDirectives
          const elements: any[] = [exp as any, createSimpleExpression(name, true)]
          if (arg) elements.push(arg)
          elements.push(createSimpleExpression(modifiers.join('.'), true))
          dirs.push(createArrayExpression(elements))
        }
      }
    }

    const vnodeProps = properties.length ? createObjectExpression(properties) : null

    // 组件元素：slot 指令子节点收集成 slots 对象
    let vnodeChildren: any = null
    if (isComponent && el.children.length) {
      vnodeChildren = buildSlots(el.children)
    } else if (el.children.length) {
      const childCodegen = el.children.map((c: any) => c.codegenNode || c)
      vnodeChildren = childCodegen.length === 1 ? childCodegen[0] : createArrayExpression(childCodegen)
    }

    // 组件标签用 _createVNode（会按「解析后的对象」算 COMPONENT shapeFlag）
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

/**
 * 生成 `$event => (exp = <valueExpr>)` 形式的赋值箭头函数。
 * text 形态默认 `$event.target.value`（.trim 加 .trim()）；指令形态传 `$event`。
 */
function createAssignment(exp: any, valueExpr = '$event.target.value'): any {
  return {
    type: NodeTypes.JS_FUNCTION_EXPRESSION,
    params: [createSimpleExpression('$event', false)],
    body: createSimpleExpression(`(${exp.content} = ${valueExpr})`, false),
    loc: (exp as any).loc,
  }
}

/**
 * 构造指令绑定条目：[运行时指令对象, 回写赋值器, arg, modifiers]
 * 运行时指令读 binding.value（=赋值器），把用户输入通过它回写响应式变量。
 */
function modelBinding(context: any, helperSym: symbol, exp: any, modifiers: string[]): any {
  context.helper(helperSym)
  return createArrayExpression([
    createSimpleExpression(`_${helperNameMap[helperSym]}`, false),
    // 指令形态赋值器：value 原样回写（checkbox → el.checked、radio/select → el.value）
    createAssignment(exp, '$event'),
    createSimpleExpression('', true),
    createSimpleExpression(modifiers.join('.'), true),
  ])
}

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
      child.props = child.props.filter((p: any) => p !== slotDir)
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