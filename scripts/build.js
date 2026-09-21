#!/usr/bin/env node
/**
 * build.js —— 驱动各包的构建（参考官方 vuejs/core/scripts/build.js 的骨架）
 *
 * 用法：
 *   pnpm build         构建全部包（dev：__DEV__=true，挨个 spawn rollup）
 *   pnpm build shared  只建 shared（支持子串匹配）
 *   pnpm build --prod  按 production 构建（__DEV__=false + 压缩），产出 <pkg>.esm-bundler.prod.js 等
 *   pnpm build:types   生成 d.ts（tsc emit → rollup-plugin-dts 捆包到 dist/<pkg>.d.ts）
 *
 * 每一项都会 `pnpm build:types` 里的 tsc 步骤，先保证 dist 目录存在。
 */
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

const PACKAGES_DIR = new URL('../packages/', import.meta.url).pathname
const args = process.argv.slice(2)
// 位置参数 = 包名（子串匹配）；--xx 是 flag
const targetArgs = args.filter((a) => !a.startsWith('--'))
const prodOnly = args.includes('--prod')
const NODE_ENV = prodOnly ? 'production' : 'development'
const withTypes = args.includes('--with-types')
const all = args.includes('--all') || targetArgs.length === 0

// 收集「非私有」的包（shared/reactivity/.../vue —— showcase/playground 是 private）
// 我们的 7 个包都标了 private（npm 私有），但依然要构建 —— 这里只要求 package.json 存在
const targets = readdirSync(PACKAGES_DIR)
  .filter((dir) => {
    try {
      readFileSync(`${PACKAGES_DIR}${dir}/package.json`, 'utf-8')
      return true
    } catch {
      return false
    }
  })
  .filter((t) => all || targetArgs.some((a) => a.startsWith(t)))

if (!targets.length) {
  console.error('没有匹配的包；可用: pnpm build shared | reactivity | runtime-core | runtime-dom | compiler-core | compiler-dom | vue | --all')
  process.exit(1)
}

function run(cmd, argv = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: 'inherit', cwd: new URL('../', import.meta.url).pathname })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(' ')} 退出码 ${code}`))))
    child.on('error', reject)
  })
}

async function main() {
  const started = Date.now()
  for (const t of targets) {
    const distDir = `${PACKAGES_DIR}${t}/dist`
    rmSync(distDir, { recursive: true, force: true })
    mkdirSync(distDir, { recursive: true })
    console.log(`\n[build] ${t} (${NODE_ENV})`)
    await run('npx', ['rollup', '-c', '--environment', `TARGET:${t},NODE_ENV:${NODE_ENV}`])
  }
  if (withTypes) {
    console.log('\n[build:types] 生成声明文件…')
    await run('npx', ['tsc', '-p', 'tsconfig.build.json'])
    for (const t of targets) {
      // rollup 的 --environment 用逗号切 KV，多值会丢，所以逐包传 TARGET
      await run('npx', ['rollup', '-c', 'rollup.dts.config.js', '--environment', `TARGET:${t}`])
    }
  }
  console.log(`\n[done] 构建 ${targets.join(', ')} 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})