/**
 * normalScript.ts —— 普通 <script> 块处理
 *
 * 对应真 Vue compiler-sfc/src/script/normalScript.ts + rewriteDefault.ts 的教学子集。
 *
 * 职责（纯分析 + 产出文本，不做 magic-string 操作——「已编辑区块不能 move」的
 * 约束让普通 script 的内容重组统一在 compileScript 的 preamble 组装里做）：
 *   1. export default <对象|defineComponent(...)> → 重写成 `const __default__ = ...`
 *      （真 rewriteDefault.ts 对任意表达式做前缀改写；mini 只认对象字面量与
 *      defineComponent 调用，其它形态报不支持）
 *   2. 顶层 import / 声明收集进 normalBindings（保守按 let + 只读 import）
 *      —— 模板引用它们时经 __returned__ 的 getter 读到模块级绑定。
 *   3. 无 export default 时：内容原样保留在模块顶层，不生成 __default__
 *   4. 「普通 script 位于 setup 之后」无需处理——整个块被移除，文本进 preamble，
 *      位置天然归位（真源码用 s.move，mini 用组装，产物一致）
 */
import type { ScriptCompileContext } from './context'
import { isCallOf } from './utils'

export function processNormalScript(ctx: ScriptCompileContext): void {
  const { script } = ctx.descriptor
  if (!script || !ctx.scriptAst) return

  let text = script.content
  let hasDefaultExportName = false

  // ---- 1. export default → const __default__（字符串手术：前缀改写） ----
  for (const stmt of ctx.scriptAst.body as any[]) {
    if (stmt.type !== 'ExportDefaultDeclaration') continue
    const exp = stmt.declaration
    let objectExpr: any = null
    if (exp.type === 'ObjectExpression') {
      objectExpr = exp
    } else if (isCallOf(exp, 'defineComponent') && exp.arguments.length) {
      objectExpr = exp.arguments[0]
    } else {
      ctx.error(
        `export default in <script> must be an object literal (or defineComponent({...})) ` +
          `for mini-vue compiler-sfc to merge it with <script setup>`,
        ctx.at(stmt.start),
      )
    }
    if (objectExpr.type === 'ObjectExpression') {
      for (const p of objectExpr.properties as any[]) {
        if (p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'name') {
          hasDefaultExportName = true
        }
        if (p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'props') {
          ctx.scriptDefaultHas.props = true
        }
        if (p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'emits') {
          ctx.scriptDefaultHas.emits = true
        }
      }
    }
    // exp.start 是块内（=content 内）坐标；前缀 = content[0..exp.start] 去掉 'export default'
    const prefix = text.slice(0, exp.start)
    const rewritten = prefix.replace(/export\s+default\s*$/, 'const __default__ = ')
    text = rewritten + text.slice(exp.start)
    ctx.hasDefaultExportName = hasDefaultExportName
    ctx.hasScriptDefault = true
  }

  // ---- 2. 顶层 import 收集 ----
  for (const stmt of ctx.scriptAst.body as any[]) {
    if (stmt.type !== 'ImportDeclaration') continue
    for (const spec of stmt.specifiers as any[]) {
      ctx.normalImports.add(spec.local.name)
    }
  }

  // ---- 3. 顶层声明收集（函数/变量/类 + 它们内部的名字） ----
  for (const stmt of ctx.scriptAst.body as any[]) {
    if (stmt.type === 'ImportDeclaration' || stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportNamedDeclaration') continue
    if (stmt.type === 'VariableDeclaration' || stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
      collectDeclNames(stmt, (name) => ctx.normalBindings.set(name, { isLet: true }))
    }
  }

  ctx.normalScriptText = text
}

/** 收集顶层声明的名字（可变声明逐声明器；函数/类取 id） */
function collectDeclNames(stmt: any, fn: (name: string) => void): void {
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) {
      collectPatternNames(d.id, fn)
    }
  } else if (stmt.id && stmt.id.type === 'Identifier') {
    fn(stmt.id.name)
  }
}

/** 声明 pattern 的名字（Identifier / ObjectPattern / ArrayPattern / RestElement / AssignmentPattern） */
export function collectPatternNames(id: any, fn: (name: string) => void): void {
  if (!id) return
  switch (id.type) {
    case 'Identifier':
      fn(id.name)
      break
    case 'ObjectPattern':
      for (const p of id.properties) {
        if (p.type === 'RestElement') collectPatternNames(p.argument, fn)
        else if (p.computed && p.key) collectPatternNames(p.key, fn) // 计算键是引用，不登记
        else collectPatternNames(p.value, fn) // 解构出的名字在 value 上
      }
      break
    case 'ArrayPattern':
      for (const e of id.elements) collectPatternNames(e, fn)
      break
    case 'RestElement':
      collectPatternNames(id.argument, fn)
      break
    case 'AssignmentPattern':
      // `const { a, b = 2 } = ...` → 默认值挂在 AssignmentPattern 上，取 left
      collectPatternNames(id.left, fn)
      break
  }
}