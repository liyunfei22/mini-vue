/**
 * transform.ts —— 遍历/变换管线
 *
 * 对应真 Vue packages/compiler-core/src/transform.ts。
 *
 * transform(root, options) 做三件事：
 *   1. 深度优先遍历 AST，对每个节点依次运行 nodeTransforms（进入）+ 逆序跑它们的
 *      exit 钩子（返回的函数）—— 这保证「结构性变换（v-if/v-for 先替换结构）」在
 *      「元素化变换（transformElement 赋值 codegenNode）」之前收网；
 *   2. 收集 runtime helpers（import 别名在 codegen 阶段读 root.helpers）；
 *   3. 把 root.codegenNode 定出来（单根直接用其 codegenNode，多根用 Fragment 包装）。
 */
import {
  createVNodeCall,
  Fragment,
  NodeTypes,
  type DirectiveNode,
  type ElementNode,
  type ParentNode,
  type RootNode,
  type TemplateChildNode,
} from './ast'

export type NodeTransform = (
  node: RootNode | TemplateChildNode,
  context: TransformContext,
) => (() => void) | void

export type DirectiveTransform = (
  dir: DirectiveNode,
  node: ElementNode,
  context: TransformContext,
) => any

export interface TransformOptions {
  nodeTransforms?: NodeTransform[]
  directiveTransforms?: Record<string, DirectiveTransform>
  expressionPlugins?: string[]
  isNativeTag?: (tag: string) => boolean
  onError?: (error: any) => void
}

export interface TransformContext {
  root: RootNode
  parent: ParentNode | null
  currentNode: unknown
  childIndex: number
  nodeTransforms: NodeTransform[]
  directiveTransforms: Record<string, DirectiveTransform>
  helpers: Set<symbol>
  helper<T extends symbol>(name: T): T
  helperString(name: symbol): string
  replaceNode(node: TemplateChildNode): void
  removeNode(): void
  onError?(error: any): void
  components: Set<string>
}

export function createTransformContext(
  root: RootNode,
  { nodeTransforms = [], directiveTransforms = {}, onError }: TransformOptions,
): TransformContext {
  const context: TransformContext = {
    root,
    parent: null,
    currentNode: root,
    childIndex: 0,
    nodeTransforms,
    directiveTransforms,
    helpers: new Set(),
    components: new Set(),
    helper(name) {
      context.helpers.add(name)
      return name
    },
    helperString(name) {
      return `_${helperNameMap[name] || name.description}`
    },
    replaceNode(node) {
      context.parent!.children[context.childIndex] = node
      context.currentNode = node
    },
    removeNode() {
      const list = context.parent!.children
      const removalIndex = context.childIndex
      context.parent!.children.splice(removalIndex, 1)
      context.currentNode = null
    },
    onError: onError as any,
  }
  return context
}

export function transform(root: RootNode, options: TransformOptions) {
  const context = createTransformContext(root, options)
  traverseNode(root, context)
  createRootCodegen(root, context)
  ;(root as any).helpers = [...context.helpers]
  ;(root as any).components = [...context.components]
  return root
}

function traverseNode(node: any, context: TransformContext) {
  context.currentNode = node
  const { nodeTransforms } = context
  const exitFns: Array<() => void> = []

  // 进入：逐个运行 transforms（结构性 transform 返回 exit 在子树遍历后逆序执行）
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) {
      exitFns.push(onExit)
    }
    if (!context.currentNode) {
      // 节点已被 removeNode/替换
      return
    }
    // 节点可能被结构性 transform 替换（v-if → IF），后续 transform 跟新节点走
    node = context.currentNode
  }

  // 按类型分发子节点遍历（每个 child 都带着自己的父节点走，供 v-else/v-for 回链）
  switch (node.type) {
    case NodeTypes.ROOT:
      traverseChildren(node.children, context, node)
      break
    case NodeTypes.ELEMENT:
      traverseChildren(node.children, context, node)
      break
    case NodeTypes.IF:
      traverseChildren((node as any).branches, context, node)
      break
    case NodeTypes.IF_BRANCH:
      traverseChildren(node.children, context, node)
      break
    case NodeTypes.FOR:
      traverseChildren(node.children, context, node)
      break
    case NodeTypes.INTERPOLATION:
      context.helper(TO_DISPLAY_STRING_SYM)
      break
  }

  // 逆序执行 exit 钩子
  let i = exitFns.length
  while (i--) {
    if (!context.currentNode) {
      context.currentNode = node
    }
    exitFns[i]()
  }
}

function traverseChildren(
  children: TemplateChildNode[],
  context: TransformContext,
  parent: ParentNode,
) {
  const prevParent = context.parent
  for (let i = 0; i < children.length; i++) {
    context.parent = parent
    context.childIndex = i
    traverseNode(children[i], context)
    if (!context.currentNode) {
      // removeNode 已把数组缩短，回退下标重新对齐
      i--
    }
  }
  context.parent = prevParent
}

function createRootCodegen(root: RootNode, context: TransformContext) {
  const { children } = root
  if (children.length === 1) {
    const child = children[0]
    if (child.type === NodeTypes.ELEMENT && child.codegenNode) {
      root.codegenNode = child.codegenNode
    } else {
      root.codegenNode = child
    }
  } else if (children.length > 1) {
    root.codegenNode = createVNodeCall(
      Fragment as any,
      undefined,
      root.children as any,
      -1,
      false,
    )
  }
}

// transform.ts 用的内部 helper 符号
import { TO_DISPLAY_STRING, helperNameMap } from './runtimeHelpers'
const TO_DISPLAY_STRING_SYM = TO_DISPLAY_STRING