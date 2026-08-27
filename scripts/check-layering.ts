/**
 * 分层检查（docs/15 §1 两条硬规则）。
 *
 *   1. 内核层不引用任何具体模板的符号。这是「横向扩展关卡」能力的唯一实质保障。
 *   2. 表现层不引用任何具体模板的符号。一旦界面直接依赖某个关卡的内部结构，
 *      第二个关卡就要重写整个界面层。
 *
 * §1 明写这两条「必须由目录级检查保证，而不是靠自觉」，所以本文件作为测试跑，
 * 违反即测试失败。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface LayeringViolation {
  readonly file: string
  readonly importPath: string
  readonly rule: string
}

const IMPORT_PATTERN = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      out.push(...sourceFiles(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const path = match[1] ?? match[2]
    if (path !== undefined) found.push(path)
  }
  return found
}

export function checkLayering(repoRoot: string): readonly LayeringViolation[] {
  const violations: LayeringViolation[] = []

  // 规则 1：内核层不引用任何模板
  for (const file of sourceFiles(join(repoRoot, 'packages/kernel/src'))) {
    for (const importPath of importsOf(file)) {
      if (importPath.includes('@terminus/templates') || importPath.includes('templates/')) {
        violations.push({
          file: relative(repoRoot, file),
          importPath,
          rule: '内核层不得引用模板层（docs/15 §1 硬规则 1）',
        })
      }
    }
  }

  // 规则 2：表现层不引用任何具体模板的内部符号。
  // 允许 import 模板层的注册表与通用视图类型，因为表现层必须能按模板标识取到视图投影；
  // 不允许深入到某个具体模板的目录里。
  for (const file of sourceFiles(join(repoRoot, 'packages/client/src'))) {
    for (const importPath of importsOf(file)) {
      if (/@terminus\/templates\/.+/.test(importPath) || /(^|\/)t11\//.test(importPath)) {
        violations.push({
          file: relative(repoRoot, file),
          importPath,
          rule: '表现层不得引用具体模板的内部符号（docs/15 §1 硬规则 2）',
        })
      }
    }
  }

  // 规则 3：内核层不得依赖任何运行宿主。内核要能在任意宿主运行（§1「可无界面运行」）
  for (const file of sourceFiles(join(repoRoot, 'packages/kernel/src'))) {
    for (const importPath of importsOf(file)) {
      if (importPath.startsWith('node:') || importPath === 'ws' || importPath === 'pg') {
        violations.push({
          file: relative(repoRoot, file),
          importPath,
          rule: '内核层不得依赖宿主环境（docs/15 §1）',
        })
      }
    }
  }

  return violations
}

// 直接执行时打印结果，供 CI 单独调用
if (process.argv[1]?.endsWith('check-layering.ts') === true) {
  const violations = checkLayering(process.cwd())
  if (violations.length === 0) {
    console.log('分层检查通过')
  } else {
    for (const v of violations) console.error(`${v.file}: ${v.importPath} — ${v.rule}`)
    process.exitCode = 1
  }
}
