/**
 * transformSlotOutlet.ts —— <slot> 出口变换
 *
 * 对应真 Vue packages/compiler-core/src/transforms/transformSlotOutlet.ts。
 *
 * <slot name="header" :msg="m"/> → _renderSlot(_ctx.$slots, "header", { msg: m })
 */
import {
  createCallExpression,
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

      element.codegenNode = createCallExpression(context.helper(RENDER_SLOT) as any, [
        createSimpleExpression('_ctx.$slots', false),
        createSimpleExpression(slotName, true),
        propsToWatch.length ? propsExpression : createObjectExpression([]),
      ])
    }
  }
}

void NodeTypes