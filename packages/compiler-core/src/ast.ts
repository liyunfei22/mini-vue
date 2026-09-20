/**
 * ast.ts —— 编译期 AST 节点
 *
 * 对应真 Vue packages/compiler-core/src/ast.ts。
 * mini 覆盖：ROOT/ELEMENT/TEXT/COMMENT/INTERPOLATION/SIMPLE_EXPRESSION/ATTRIBUTE/
 * DIRECTIVE/COMPOUND_EXPRESSION/IF/IF_BRANCH/FOR/TEXT_CALL/VNODE_CALL 及 JS 表达式节点。
 */
export enum NodeTypes {
  ROOT,
  ELEMENT,
  TEXT,
  COMMENT,
  SIMPLE_EXPRESSION,
  INTERPOLATION,
  ATTRIBUTE,
  DIRECTIVE,
  // 容器（结构性）
  COMPOUND_EXPRESSION,
  IF,
  IF_BRANCH,
  FOR,
  TEXT_CALL,
  // 代码生成
  VNODE_CALL,
  JS_CALL_EXPRESSION,
  JS_OBJECT_EXPRESSION,
  JS_PROPERTY,
  JS_ARRAY_EXPRESSION,
  JS_FUNCTION_EXPRESSION,
  JS_CONDITIONAL_EXPRESSION,
  JS_CACHE_EXPRESSION,
  JS_BLOCK_STATEMENT,
  JS_TEMPLATE_LITERAL,
}

/** 编译期 Fragment 哨兵（与运行时的 @mini-vue/runtime-core Fragment 对应） */
export const Fragment = Symbol('mini-fragment-compile') as any

export enum ElementTypes {
  ELEMENT,
  COMPONENT,
  SLOT,
  TEMPLATE,
}

export type ParentNode = RootNode | ElementNode
export type TemplateChildNode =
  | ElementNode
  | TextNode
  | InterpolationNode
  | CommentNode
  | CompoundExpressionNode
  | IfNode
  | IfBranchNode
  | ForNode
  | TextCallNode

export interface SourceLocation {
  start: Position
  end: Position
  source: string
}

export interface Position {
  offset: number
  line: number
  column: number
}

export interface BaseNode {
  type: NodeTypes
  loc: SourceLocation
}

export interface RootNode extends BaseNode {
  type: NodeTypes.ROOT
  children: TemplateChildNode[]
  directives: any[]
  codegenNode?: any
}

export interface ElementNode extends BaseNode {
  type: NodeTypes.ELEMENT
  tag: string
  tagType: ElementTypes
  props: Array<AttributeNode | DirectiveNode>
  children: TemplateChildNode[]
  codegenNode?: any
  ns?: any
}

export interface TextNode extends BaseNode {
  type: NodeTypes.TEXT
  content: string
}

export interface CommentNode extends BaseNode {
  type: NodeTypes.COMMENT
  content: string
}

export interface InterpolationNode extends BaseNode {
  type: NodeTypes.INTERPOLATION
  content: ExpressionNode
}

export interface AttributeNode extends BaseNode {
  type: NodeTypes.ATTRIBUTE
  name: string
  value: TextNode | undefined
}

export interface DirectiveNode extends BaseNode {
  type: NodeTypes.DIRECTIVE
  name: string
  exp: ExpressionNode | undefined
  arg: ExpressionNode | undefined
  modifiers: string[]
  dir?: any
}

export type ExpressionNode = SimpleExpressionNode | CompoundExpressionNode

export interface SimpleExpressionNode extends BaseNode {
  type: NodeTypes.SIMPLE_EXPRESSION
  content: string
  isStatic: boolean
  constType: number
}

export interface CompoundExpressionNode extends BaseNode {
  type: NodeTypes.COMPOUND_EXPRESSION
  children: Array<SimpleExpressionNode | CompoundExpressionNode | string>
}

export interface IfNode extends BaseNode {
  type: NodeTypes.IF
  branches: IfBranchNode[]
  codegenNode?: any
}

export interface IfBranchNode extends BaseNode {
  type: NodeTypes.IF_BRANCH
  condition?: ExpressionNode
  children: TemplateChildNode[]
  userKey?: string
}

export interface ForNode extends BaseNode {
  type: NodeTypes.FOR
  source: ExpressionNode
  valueAlias?: ExpressionNode
  indexAlias?: ExpressionNode
  keyAlias?: ExpressionNode
  children: TemplateChildNode[]
  codegenNode?: any
}

export interface TextCallNode extends BaseNode {
  type: NodeTypes.TEXT_CALL
  content: TextNode | InterpolationNode | CompoundExpressionNode
  codegenNode: any
}

// JS 表达式节点（transform/codegen 之间传递的中间产物）
export interface VNodeCall extends BaseNode {
  type: NodeTypes.VNODE_CALL
  tag: string | symbol | undefined
  props: any
  children: any
  isBlock: boolean
  patchFlag: number
}

export interface CallExpression extends BaseNode {
  type: NodeTypes.JS_CALL_EXPRESSION
  callee: any
  arguments: any[]
}

export interface ObjectExpression extends BaseNode {
  type: NodeTypes.JS_OBJECT_EXPRESSION
  properties: PropertyNode[]
}

export interface PropertyNode extends BaseNode {
  type: NodeTypes.JS_PROPERTY
  key: any
  value: any
}

export interface ArrayExpression extends BaseNode {
  type: NodeTypes.JS_ARRAY_EXPRESSION
  elements: any[]
}

export interface FunctionExpression extends BaseNode {
  type: NodeTypes.JS_FUNCTION_EXPRESSION
  params: any[]
  body: any
  isSlot?: boolean
}

export interface ConditionalExpression extends BaseNode {
  type: NodeTypes.JS_CONDITIONAL_EXPRESSION
  test: any
  consequent: any
  alternate: any
}

// ---------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------

export function createRoot(children: TemplateChildNode[], loc: SourceLocation): RootNode {
  return { type: NodeTypes.ROOT, children, loc, directives: [] }
}

export function createText(content: string, loc: SourceLocation): TextNode {
  return { type: NodeTypes.TEXT, content, loc }
}

export function createInterpolation(content: ExpressionNode, loc: SourceLocation): InterpolationNode {
  return { type: NodeTypes.INTERPOLATION, content, loc }
}

export function createSimpleExpression(
  content: string,
  isStatic: boolean,
  loc?: SourceLocation,
  constType = 0,
): SimpleExpressionNode {
  return {
    type: NodeTypes.SIMPLE_EXPRESSION,
    content,
    isStatic,
    loc: loc || { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 }, source: '' },
    constType,
  }
}

export function createCompoundExpression(
  children: CompoundExpressionNode['children'],
  loc?: SourceLocation,
): CompoundExpressionNode {
  return {
    type: NodeTypes.COMPOUND_EXPRESSION,
    children,
    loc: loc || emptyLoc,
  }
}

export function createCallExpression(callee: any, args: any[], loc?: SourceLocation): CallExpression {
  return { type: NodeTypes.JS_CALL_EXPRESSION, callee, arguments: args, loc: loc || emptyLoc }
}

export function createObjectExpression(properties: PropertyNode[], loc?: SourceLocation): ObjectExpression {
  return { type: NodeTypes.JS_OBJECT_EXPRESSION, properties, loc: loc || emptyLoc }
}

export function createObjectProperty(key: any, value: any): PropertyNode {
  return { type: NodeTypes.JS_PROPERTY, loc: emptyLoc, key, value }
}

export function createArrayExpression(elements: any[], loc?: SourceLocation): ArrayExpression {
  return { type: NodeTypes.JS_ARRAY_EXPRESSION, elements, loc: loc || emptyLoc }
}

export function createFunctionExpression(
  params: any[],
  body: any,
  loc?: SourceLocation,
  isSlot = false,
): FunctionExpression {
  return { type: NodeTypes.JS_FUNCTION_EXPRESSION, params, body, isSlot, loc: loc || emptyLoc }
}

export function createConditionalExpression(
  test: any,
  consequent: any,
  alternate: any,
): ConditionalExpression {
  return {
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
    test,
    consequent,
    alternate,
    loc: emptyLoc,
  }
}

export function createVNodeCall(tag: any, props: any, children: any, patchFlag = -1, isBlock = false): VNodeCall {
  return {
    type: NodeTypes.VNODE_CALL,
    tag,
    props,
    children,
    isBlock,
    patchFlag,
    loc: emptyLoc,
  }
}

/** 在 children 里查找指定指令（transformIf/For 回链用） */
export function findDir(
  node: ElementNode,
  name: string | ((n: DirectiveNode) => boolean),
): DirectiveNode | undefined {
  return node.props.find(
    (p) =>
      p.type === NodeTypes.DIRECTIVE &&
      (typeof name === 'string' ? p.name === name : name(p)),
  ) as DirectiveNode | undefined
}

/** 在 props 里查找指定属性（普通 attribute） */
export function findProp(
  node: ElementNode,
  name: string,
  dynamicOnly = false,
): AttributeNode | DirectiveNode | undefined {
  return node.props.find(
    (p) =>
      p.type === NodeTypes.ATTRIBUTE && !dynamicOnly && p.name === name,
  )
}

export function isText(node: any): node is TextNode | InterpolationNode | CompoundExpressionNode {
  return (
    node.type === NodeTypes.INTERPOLATION ||
    node.type === NodeTypes.TEXT ||
    node.type === NodeTypes.COMPOUND_EXPRESSION
  )
}

const emptyLoc: SourceLocation = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
  source: '',
}