/**
 * @mini-vue/compiler-sfc 入口
 *
 * 对应真 Vue packages/compiler-sfc/src/index.ts。
 * 四件套 parse / compileScript / compileTemplate / compileStyle 分批落地
 * （C2 = parse，C3 = compileScript，C4 = compileTemplate，C5 = compileStyle），
 * 每批一个 commit + 独立测试。
 *
 * 工具 re-export（babelParse/MagicString/walk/generateCodeFrame）暂不提供，
 * 文档记差异。
 */
export { parse } from './parse'
export type {
  SFCParseOptions,
  SFCParseResult,
  SFCDescriptor,
  SFCBlock,
  SFCTemplateBlock,
  SFCScriptBlock,
  SFCStyleBlock,
  SourceLocation,
} from './parse'