/**
 * transformSlotOutlet.ts —— <slot> 出口变换
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformSlotOutlet.ts。
 *
 * <slot name="header" :msg="m"/> → _renderSlot(_ctx.$slots, "header", { msg: m })
 */
import {
  createCallExpression,
  createFunctionExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  NodeTypes,
  type ElementNode,
} from '../ast'
import { RENDER_SLOT } from '../runtimeHelpers'
import type { NodeTransform, TransformContext } from '../transform'

export const transformSlotOutlet: NodeTransform = (node, context) => {
  if ((node as ElementNode).type !== NodeTypes.ELEMENT) return
  const element = node as ElementNode
  if ((element.tagType as any) === 2 /* SLOT */ || element.tag === 'slot') {
    return () => {
      const { props } = element
      const propsToWatch: any[] = []
      const propsExpression = createObjectExpression(propsToWatch)

      let slotName = 'default'
      if (element.tag === 'slot') {
        // 从 props 里取 name
        const nameProp = props.find((p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'name')
        if (nameProp) {
          slotName = (nameProp as any).value ? (nameProp as any).value.content : 'default'
        }
        // 其它 props → scoped data
        for (const prop of props) {
          if (prop.type === NodeTypes.ATTRIBUTE && prop.name !== 'name') {
            propsToWatch.push(
              createObjectProperty(
                createSimpleExpression(prop.name, true),
                (prop as any).value
                  ? createSimpleExpression((prop as any).value.content, false)
                  : createSimpleExpression('undefined', false),
              ),
            )
          }
        }
      }

      // 参数按真 Vue transformSlotOutlet.ts:23-45 的 expectedLen 裁剪节奏组装：
      //   _renderSlot(_ctx.$slots, name, props)                 —— 无 fallback 无 scoped
      //   _renderSlot(_ctx.$slots, name, props, fallback)       —— 有默认内容
      //   _renderSlot(..., undefined, true)                     —— scoped 且未用 :slotted
      // 第 5 参 noSlotted=true：跳过插槽内容的 `-s` scopeId 标记（渲染器不渲染多余的 data-v-xxx-s）
      const slotArgs: any[] = [
        createSimpleExpression('_ctx.$slots', false),
        createSimpleExpression(slotName, true),
        propsToWatch.length ? propsExpression : createObjectExpression([]),
      ]
      if (element.children.length) {
        // <slot>默认内容</slot>：第 4 参 fallback 函数
        slotArgs.push(
          createFunctionExpression([], element.children.map((c: any) => c.codegenNode || c)),
        )
      }
      if (context.scopeId && !context.slotted) {
        slotArgs.push(
          createSimpleExpression('undefined', false),
          createSimpleExpression('true', false),
        )
      }

      element.codegenNode = createCallExpression(context.helper(RENDER_SLOT) as any, slotArgs)
    }
  }
}

void NodeTypes