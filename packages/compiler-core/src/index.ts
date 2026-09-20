/**
 * @mini-vue/compiler-core 入口
 */
export { baseCompile } from './compile'
export type { CompilerOptions } from './compile'
export { baseParse, TextModes } from './parse'
export type { ParserOptions, ParserContext } from './parse'
export { transform, createTransformContext } from './transform'
export type { NodeTransform, DirectiveTransform, TransformContext, TransformOptions } from './transform'
export { generate } from './codegen'
export type { CodegenResult } from './codegen'
export { createCompilerError, ErrorCodes } from './errors'

export {
  NodeTypes,
  ElementTypes,
  Fragment,
  createRoot,
  createText,
  createInterpolation,
  createSimpleExpression,
  createCompoundExpression,
  createCallExpression,
  createObjectExpression,
  createObjectProperty,
  createArrayExpression,
  createFunctionExpression,
  createConditionalExpression,
  createVNodeCall,
  findDir,
  findProp,
  isText,
} from './ast'
export type {
  RootNode,
  ElementNode,
  TextNode,
  CommentNode,
  InterpolationNode,
  AttributeNode,
  DirectiveNode,
  ExpressionNode,
  SimpleExpressionNode,
  CompoundExpressionNode,
  TemplateChildNode,
  IfNode,
  IfBranchNode,
  ForNode,
} from './ast'

export { transformIf, createStructuralDirectiveTransform } from './transforms/transformIf'
export { transformFor } from './transforms/transformFor'
export { transformElement } from './transforms/transformElement'
export { transformText } from './transforms/transformText'
export { transformSlotOutlet } from './transforms/transformSlotOutlet'
export { transformExpression } from './transforms/transformExpression'

export {
  TO_DISPLAY_STRING,
  CREATE_ELEMENT_VNODE,
  CREATE_TEXT_VNODE,
  CREATE_COMMENT,
  RENDER_LIST,
  RENDER_SLOT,
  WITH_DIRECTIVES,
  RESOLVE_COMPONENT,
  RESOLVE_DYNAMIC_COMPONENT,
  helperNameMap,
} from './runtimeHelpers'