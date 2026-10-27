/**
 * compileScript.ts —— <script setup> 编译主流程
 *
 * 对应真 Vue packages/compiler-sfc/src/compileScript.ts（~1400 行，mini 裁到 ~300）。
 *
 * 机制总览（与真源码一致的三板斧）：
 *   1. Babel 解析 script/scriptSetup 两块 → 按 AST 起止坐标稀疏改写源码
 *   2. MagicString 在「整份 .vue 源码」上改：删块标签/整句、改写 init、
 *      move imports 与普通 script、把 setup 开标签替换成组件对象 + setup 签名、
 *      把闭标签替换成 __returned__ + 收尾
 *   3. 产物 = `export default { __name, props?, emits?, setup(...) { 用户代码 } }`
 *
 * 与真源码的差异（README/文章记录）：
 *   - with(_ctx) 模式：不产出 bindingMetadata（编译期无标识符决策），
 *     __returned__ 返回全部顶层绑定（含 imports）即可
 *   - 不做 TS 类型宏推导（defineProps<Type>() 报不支持）
 *   - 不产出 __isScriptSetup 标记 / @__PURE__ 注解 / _defineComponent 包装
 *   - 宏出现在普通 <script> 里不拦截（真源码同样不拦，原样残留，运行时才报错）
 *   - defineOptions 的 name 不挡 __name（真源码实测行为）
 */
import type { SFCDescriptor } from './parse'
import { ScriptCompileContext } from './script/context'
import { processNormalScript, collectPatternNames } from './script/normalScript'
import { processDefineProps } from './script/defineProps'
import { processDefineEmits } from './script/defineEmits'
import { processDefineExpose } from './script/defineExpose'
import { processDefineOptions } from './script/defineOptions'
import { isCallOf, walkIdentifiers } from './script/utils'

export interface SFCScriptCompileOptions {
  /** 与真源码 API 对齐；mini 不使用（scopeId 归集成层），文档记差异 */
  id?: string
}

export interface SFCScriptCompileResults {
  content: string
}

const MACROS = [
  'defineProps',
  'defineEmits',
  'defineExpose',
  'defineOptions',
  'defineModel',
  'defineSlots',
] as const

export function compileScript(
  descriptor: SFCDescriptor,
  _options: SFCScriptCompileOptions = {},
): SFCScriptCompileResults {
  const { scriptSetup } = descriptor

  // 无 <script setup>：没有可改写的宏，普通 script 原样返回（真源码同款）
  if (!scriptSetup) {
    return { content: descriptor.script ? descriptor.script.content : '' }
  }

  const ctx = new ScriptCompileContext(descriptor)
  const { s, source } = ctx
  const setupAst = ctx.scriptSetupAst!

  // ============================================================
  // 第一步：普通 <script>（export default → __default__ / 绑定收集 / 前置）
  // ============================================================
  processNormalScript(ctx)

  // ============================================================
  // 第二步：setup 的 imports：宏名 import 移除+警告、原文抽取（进 preamble）、
  // 绑定登记。不做 s.move——「已编辑区块不能再 move」是 magic-string 的约束，
  // import 文本直接抽进 preamble 字符串，产物顺序等价（真源码用 move，结果一致）
  // ============================================================
  const setupImportTexts: string[] = []
  for (const stmt of setupAst.body as any[]) {
    if (stmt.type !== 'ImportDeclaration') continue
    const macroSpecifiers: any[] = []
    for (const spec of stmt.specifiers as any[]) {
      if (
        spec.type === 'ImportSpecifier' &&
        (stmt.source.value === 'vue' || stmt.source.value === '@mini-vue/vue') &&
        (MACROS as readonly string[]).includes(spec.imported.name)
      ) {
        macroSpecifiers.push(spec)
      }
    }
    if (macroSpecifiers.length) {
      for (const spec of macroSpecifiers) {
        console.warn(
          `[@mini-vue/compiler-sfc] \`${spec.imported.name}\` is a compiler macro and no longer needs to be imported.`,
        )
      }
      if (macroSpecifiers.length === stmt.specifiers.length) {
        // 整条 import 只剩宏 → 移除整句，不进 preamble
        s.remove(ctx.at(stmt.start), ctx.at(stmt.end))
      } else {
        // 重建 import 头（教学简化：保留项重组 { a, b }）后进 preamble
        const keep = (stmt.specifiers as any[])
          .filter((sp) => !macroSpecifiers.includes(sp))
          .map((sp) => sp.local.name)
        setupImportTexts.push(`import { ${keep.join(', ')} } from '${stmt.source.value}'`)
        s.remove(ctx.at(stmt.start), ctx.at(stmt.end))
      }
    } else {
      setupImportTexts.push(source.slice(ctx.at(stmt.start), ctx.at(stmt.end)))
      s.remove(ctx.at(stmt.start), ctx.at(stmt.end))
    }
  }
  // setup import 绑定登记（with(_ctx) 模式下模板引用走 _ctx，全部进 __returned__；
  // 真源码会按 isImportUsed 过滤 + 跳过 vue 来源——实测产物包含 vue 导入，mini 跟随实测。
  // 注意剔除宏 specifier：整条都被移除/重建了，绑定不能残留）
  const setupImports = new Map<string, { source: string }>()
  for (const stmt of setupAst.body as any[]) {
    if (stmt.type !== 'ImportDeclaration') continue
    for (const spec of stmt.specifiers as any[]) {
      const fromVueMacro =
        (stmt.source.value === 'vue' || stmt.source.value === '@mini-vue/vue') &&
        (MACROS as readonly string[]).includes(spec.imported?.name ?? spec.local.name)
      if (fromVueMacro) continue
      setupImports.set(spec.local.name, { source: stmt.source.value })
    }
  }

  // ============================================================
  // 第三步：删除非 script 块（template/style/custom 整体移除；普通 script 整块
  // 移除，内容已由 normalScript 抽进 ctx.normalScriptText）——
  // 需要先算出各块的标签区间（parse 只给 inner loc，开标签起点回溯找 '<')
  // ============================================================
  ;[
    descriptor.template,
    ...descriptor.styles,
    ...descriptor.customBlocks,
  ]
    .filter(Boolean)
    .forEach((block: any) => {
      const openStart = findOpenTagStart(source, block)
      const closeEnd = findCloseTagEnd(source, block)
      s.remove(openStart, closeEnd)
    })
  if (descriptor.script) {
    const scriptBlock: any = descriptor.script
    s.remove(findOpenTagStart(source, scriptBlock), findCloseTagEnd(source, scriptBlock))
  }

  // ============================================================
  // 第四步：宏处理（遍历 setup 顶层语句；全量收集后统一应用改写）
  // ============================================================
  const macroRemovals: { start: number; end: number }[] = []
  const initOverwrites: { start: number; end: number; text: string }[] = []
  const exposeCallee: { start: number; end: number }[] = []

  for (const stmt of setupAst.body as any[]) {
    if (stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportNamedDeclaration') {
      ctx.error(
        `<script setup> cannot contain ES module exports. If you are using a previous version of <script setup>, please consult the migration guides at https://v3.vuejs.org/api/sfc-script-setup.html`,
        ctx.at(stmt.start),
      )
    }
    if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'CallExpression') {
      const c = stmt.expression
      if (isCallOf(c, 'defineProps')) {
        processDefineProps(ctx, c)
        macroRemovals.push({ start: ctx.at(stmt.start), end: ctx.at(stmt.end) })
      } else if (isCallOf(c, 'defineEmits')) {
        processDefineEmits(ctx, c)
        macroRemovals.push({ start: ctx.at(stmt.start), end: ctx.at(stmt.end) })
      } else if (isCallOf(c, 'defineOptions')) {
        processDefineOptions(ctx, c)
        macroRemovals.push({ start: ctx.at(stmt.start), end: ctx.at(stmt.end) })
      } else if (isCallOf(c, 'defineExpose')) {
        processDefineExpose(ctx, c)
        // defineExpose({...}) 语句保留，callee 改写为 __expose
        exposeCallee.push({ start: ctx.at(c.callee.start), end: ctx.at(c.callee.end) })
      } else if (isCallOf(c, 'defineModel')) {
        ctx.error(
          `defineModel() is not supported in mini-vue compiler-sfc. ` +
            `Generate modelValue prop + update:modelValue emit manually, or read the real source.`,
          ctx.at(c.start),
        )
      } else if (isCallOf(c, 'defineSlots')) {
        ctx.error(`defineSlots() is not supported in mini-vue compiler-sfc.`, ctx.at(c.start))
      }
      continue
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations as any[]) {
        const init = d.init
        if (init && isCallOf(init, 'defineProps')) {
          processDefineProps(ctx, init)
          initOverwrites.push({ start: ctx.at(init.start), end: ctx.at(init.end), text: '__props' })
        } else if (init && isCallOf(init, 'defineEmits')) {
          processDefineEmits(ctx, init)
          initOverwrites.push({ start: ctx.at(init.start), end: ctx.at(init.end), text: '__emit' })
        } else if (init && (isCallOf(init, 'defineModel') || isCallOf(init, 'defineSlots'))) {
          ctx.error(
            `defineModel/defineSlots are not supported in mini-vue compiler-sfc.`,
            ctx.at(init.start),
          )
        } else if (init && init.type === 'AwaitExpression') {
          ctx.error(
            `<script setup> top-level await is not supported in mini-vue compiler-sfc. ` +
              `Wrap the awaited code in a function or use .then().`,
            ctx.at(init.start),
          )
        }
        // 声明名字一律登记（宏变量的 id 也登记：props/emit 出现在 __returned__）
        collectPatternNames(d.id, (name) => ctx.registerBinding(name, stmt.kind !== 'const'))
      }
      continue
    }
    if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
      if (stmt.id) ctx.registerBinding(stmt.id.name, false)
      continue
    }
    if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AwaitExpression') {
      ctx.error(`<script setup> top-level await is not supported in mini-vue compiler-sfc.`, ctx.at(stmt.start))
    }
  }

  // 应用改写（宏整句移除 / init 替换 / callee 替换）
  for (const r of macroRemovals) s.remove(r.start, r.end)
  for (const o of initOverwrites) s.overwrite(o.start, o.end, o.text)
  for (const c of exposeCallee) s.overwrite(c.start, c.end, '__expose')

  // ---- 宏参数引用检查（延迟到绑定收集完成后：引用 setup 局部变量一律报错）----
  // 真源码 checkInvalidScopeReference 同语义；String/Number 等全局标识符不在
  // setupBindings 里，安全放行
  for (const arg of [ctx.propsDecl, ctx.emitsDecl, ctx.optionsDecl]) {
    if (!arg) continue
    walkIdentifiers(arg, (id: any) => {
      if (ctx.setupBindings.has(id.name)) {
        ctx.error(
          `defineProps/defineEmits/defineOptions arguments cannot reference locally declared variables ` +
            `(they will be stripped at compile time)`,
          ctx.at(id.start),
        )
      }
    })
  }

  // ============================================================
  // 第五步：组装产物提纲（setup 开标签 → 组件对象+签名；闭标签 → __returned__）
  // ============================================================
  const setupBlock: any = scriptSetup
  const setupOpenStart = findOpenTagStart(source, setupBlock)
  const setupOpenEnd = setupBlock.loc.start.offset
  const setupCloseStart = setupBlock.loc.end.offset
  const setupCloseEnd = findCloseTagEnd(source, setupBlock)

  // ---- 字典序检查：__default__/defineOptions 里已有 props/emits ----
  if (ctx.propsDecl && ctx.scriptDefaultHas.props) {
    ctx.error(`props are already defined in the ${'__default__'}. Use only defineProps() or the options.`, ctx.startOffset)
  }
  if (ctx.emitsDecl && ctx.scriptDefaultHas.emits) {
    ctx.error(`emits are already defined in the ${'__default__'}. Use only defineEmits() or the options.`, ctx.startOffset)
  }

  // ---- 组件对象前缀 ----
  // preamble：setup imports + 普通 script 重写文本（模块级语句，必须先于一切）
  const preamble = [...setupImportTexts, ctx.normalScriptText].filter(Boolean).join('\n')
  const hasDefault = ctx.hasScriptDefault
  let opener = preamble ? preamble + '\n\n' : ''
  opener += 'export default '
  if (ctx.optionsDecl && hasDefault) {
    opener += `Object.assign(__default__, ${ctx.getString(ctx.optionsDecl)}, {`
  } else if (ctx.optionsDecl) {
    opener += `Object.assign(${ctx.getString(ctx.optionsDecl)}, {`
  } else if (hasDefault) {
    opener += `Object.assign(__default__, {`
  } else {
    opener += `{`
  }
  const assign = ctx.optionsDecl || hasDefault
  opener += '\n'
  if (!ctx.hasDefaultExportName) {
    opener += `  __name: ${JSON.stringify(nameFromFilename(descriptor.filename))},\n`
  }
  if (ctx.propsDecl) {
    opener += `  props: ${ctx.getString(ctx.propsDecl)},\n`
  }
  if (ctx.emitsDecl) {
    opener += `  emits: ${ctx.getString(ctx.emitsDecl)},\n`
  }
  opener += `  setup(__props, { expose: __expose${ctx.hasDefineEmitsCall ? ', emit: __emit' : ''} }) {\n`
  if (!ctx.hasDefineExposeCall) {
    opener += `  __expose();\n`
  }

  // ---- 返回对象 ----
  const returned: string[] = []
  for (const [name, { isLet }] of ctx.setupBindings) {
    returned.push(isLet ? `get ${name}() { return ${name} }, set ${name}(v) { ${name} = v }` : name)
  }
  for (const [name, { isLet }] of ctx.normalBindings) {
    if (ctx.normalImports.has(name)) continue
    returned.push(isLet ? `get ${name}() { return ${name} }, set ${name}(v) { ${name} = v }` : name)
  }
  for (const name of ctx.normalImports) {
    returned.push(`get ${name}() { return ${name} }`)
  }
  for (const name of setupImports.keys()) {
    returned.push(name)
  }

  let closer = `\n\nconst __returned__ = { ${returned.join(', ')} }\n`
  closer += `return __returned__\n}\n\n}`
  if (assign) closer += `)`

  // ============================================================
  // 第六步：落盘全部位置操作（全部是 remove/overwrite，不碰 move）
  // ============================================================
  s.overwrite(setupOpenStart, setupOpenEnd, opener)
  s.overwrite(setupCloseStart, setupCloseEnd, closer)

  return { content: s.toString() }
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

/** 文件路径 → 组件名：App.vue → App（真源码 __name 推断同规则） */
function nameFromFilename(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() || filename
  return base.replace(/\.[^.]+$/, '')
}

/**
 * 开标签起点：从内容起点回溯找 '<'（块定位只有 inner loc，与 parse.ts 的
 * innerLoc 切片对应；属性里不会出现裸 '<'，最后一个 '<' 就是开标签）
 */
function findOpenTagStart(source: string, block: any): number {
  let idx = block.loc.start.offset - 1
  while (idx >= 0 && source[idx] !== '<') idx--
  return idx
}

/** 闭标签终点：从内容终点向后找 `</tag`，再跳到 '>' 之后 */
function findCloseTagEnd(source: string, block: any): number {
  const open = source.indexOf('</' + block.type, block.loc.end.offset)
  if (open === -1) return source.length
  let j = open + 2 + block.type.length
  while (j < source.length && /\s/.test(source[j])) j++
  return source[j] === '>' ? j + 1 : source.length
}