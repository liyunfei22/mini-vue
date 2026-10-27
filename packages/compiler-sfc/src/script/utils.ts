/**
 * utils.ts —— compileScript 的通用小工具
 *
 * 对应真 Vue compiler-sfc/src/script/utils.ts 的教学子集。
 * 宏识别的唯一入口 isCallOf 在这里。
 */
import type { Node } from '@babel/types'

/** 宏识别：callee 是「同名 Identifier」的 CallExpression。
 *   `const dm = defineModel` 之后调用不命中（callee 是变量引用），
 *   真源码的宏改写同样只认直接调用——这是宏的语法契约，教学点。 */
export function isCallOf(node: any, name: string): boolean {
  return (
    !!node &&
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === name
  )
}

/** 块语言判断：无 lang / js / jsx 之外（ts/tsx...）一律按 TS 解析（真源码同款宽松） */
export function isJS(lang?: string): boolean {
  return !lang || lang === 'js' || lang === 'jsx'
}

/** 宏参数是纯字面量对象/数组/字符串（含嵌套），不引用任何变量 */
export function isStaticLiteral(node: any): boolean {
  if (!node) return false
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      return true
    case 'TemplateLiteral':
      return node.expressions.length === 0
    case 'ObjectExpression':
      return node.properties.every(
        (p: any) =>
          (p.type === 'ObjectProperty' || p.type === 'SpreadElement') &&
          (p.type === 'SpreadElement' || isStaticLiteral(p.value)),
      )
    case 'ArrayExpression':
      return node.elements.every((e: any) => isStaticLiteral(e))
    default:
      return false
  }
}

/** 提取一个对象/数组里的键集合（宏参数查重用） */
export function extractKeys(node: Node): string[] {
  const keys: string[] = []
  if (node.type === 'ObjectExpression') {
    for (const p of node.properties as any[]) {
      if (p.type !== 'ObjectProperty') continue
      const key = p.key
      if (key.type === 'Identifier') keys.push(key.name)
      else if (key.type === 'StringLiteral') keys.push(key.value)
    }
  } else if (node.type === 'ArrayExpression') {
    for (const e of node.elements as any[]) {
      if (e && e.type === 'StringLiteral') keys.push(e.value)
    }
  }
  return keys
}

/** 遍历表达式的「引用型 Identifier」（跳过声明 id/属性键/import specifier） */
export function walkIdentifiers(node: any, fn: (id: any) => void): void {
  if (!node || typeof node.type !== 'string') return
  switch (node.type) {
    case 'Identifier':
      fn(node)
      return
    case 'ObjectProperty':
    case 'ObjectMethod':
      // 属性键不是引用（除非 computed）；只走下 value
      if (node.computed) walkIdentifiers(node.key, fn)
      walkIdentifiers(node.value, fn)
      return
    case 'MemberExpression':
      walkIdentifiers(node.object, fn)
      // 静态成员名不是引用（obj.String 里的 String 不算）
      if (node.computed) walkIdentifiers(node.property, fn)
      return
    default:
      break
  }
  for (const key in node) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const c of child) if (c && typeof c.type === 'string') walkIdentifiers(c, fn)
    } else if (child && typeof child.type === 'string') {
      walkIdentifiers(child, fn)
    }
  }
}