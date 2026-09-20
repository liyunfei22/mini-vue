#!/usr/bin/env node
/**
 * 自包含性静态检查：
 *   mini-vue-router / mini-pinia 必须只依赖 @mini-vue/* 包，绝不能 import 真 vue。
 * 用「代码扫描」通道保证 capstone 的「全家桶自洽」成立（依赖树检查在阶段 7 细化）。
 *
 * 注（2026-09-20）：router/pinia 是两个「同级独立仓库」（/Users/liyf/ms/mini-vue-router、
 * /Users/liyf/ms/mini-pinia），不在本仓库 packages/ 内；本脚本届时扫描同级目录 src。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const FORBIDDEN = ['vue', 'vue-router', 'pinia']
const CHECK_PACKAGES = ['vue-router', 'pinia']
const root = join(import.meta.dirname, '..')

let failed = false

/** 递归收集目录下所有 .ts/.mts 文件 */
function collectTs(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectTs(full, acc)
    else if (entry.name.endsWith('.ts')) acc.push(full)
  }
  return acc
}

for (const pkg of CHECK_PACKAGES) {
  // 同级独立仓库（/Users/liyf/ms/mini-vue-router、mini-pinia），不在本仓 packages/ 内
  const src = join(root, '..', `mini-${pkg === 'vue-router' ? 'router' : 'pinia'}`, 'src')
  if (!existsSync(src)) {
    console.log(`[skip] 同级目录 mini-${pkg === 'vue-router' ? 'router' : 'pinia'}/src 尚不存在（阶段 ${pkg === 'vue-router' ? 7 : 8} 创建）`)
    continue
  }
  const files = collectTs(src)
  for (const file of files) {
    const code = readFileSync(file, 'utf-8')
    for (const name of FORBIDDEN) {
      // 匹配 `from 'vue'` / `from "vue"` / `import('vue')` 形式的裸模块 import
      const re = new RegExp(`(?:from\\s*['"]|import\\(\\s*['"])${name}['"]`, 'g')
      if (re.test(code)) {
        console.error(`[FAIL] ${file.replace(root, '')} 引用了真 ${name}`)
        failed = true
      }
    }
  }
}

if (failed) {
  process.exit(1)
}
console.log('[ok] 自包含检查通过：mini vue-router / pinia 未引用真 vue 生态')
process.exit(0)