/**
 * errors.ts —— 编译错误
 * 对应真 Vue packages/compiler-core/src/errors.ts。mini 只保留常用的几个错误码。
 */
export const enum ErrorCodes {
  ABRUPT_CLOSING_OF_EMPTY_COMMENT = 0,
  CDATA_IN_HTML_CONTENT = 1,
  DUPLICATE_ATTRIBUTE = 2,
  END_TAG_WITH_ATTRIBUTES = 3,
  END_TAG_WITH_TRAILING_SOLIDUS = 4,
  EOF_BEFORE_TAG_NAME = 5,
  EOF_IN_CDATA = 6,
  EOF_IN_COMMENT = 7,
  EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT = 8,
  EOF_IN_TAG = 9,
  INCORRECTLY_CLOSED_COMMENT = 10,
  INCORRECTLY_OPENED_COMMENT = 11,
  INVALID_FIRST_CHARACTER_OF_TAG_NAME = 12,
  MISSING_ATTRIBUTE_VALUE = 13,
  MISSING_END_TAG_NAME = 14,
  MISSING_WHITESPACE_BETWEEN_ATTRIBUTES = 15,
  NESTED_COMMENT = 16,
  UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME = 17,
  UNEXPECTED_IS_ATTRIBUTE = 18,
  UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME = 19,
  UNEXPECTED_SOLIDUS_IN_TAG = 20,
  X_INVALID_END_TAG = 21,
  X_INVALID_NEW_LINE = 22,
  X_INVALID_RAW_TEXT_ROOT_NAME = 23,
  X_INVALID_RAW_TEXT_TAG = 24,
  X_INVALID_RAW_TAG_NAME = 25,
  X_MISSING_END_TAG = 26,
  __EXTEND_POINT__ = 27,
}

export function createCompilerError(
  code: ErrorCodes,
  loc?: any,
) {
  // mini：只抛通用错误 + 位置信息（真 Vue 有完整文案表）
  const msg = `compiler error (code ${code})`
  const error = new SyntaxError(msg) as any
  error.code = code
  error.loc = loc
  return error
}