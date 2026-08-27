/**
 * docs/15 §1 的两条硬规则「必须由目录级检查保证，而不是靠自觉」。
 * 违反即测试失败——这就是「保证」的落法。
 */

import { describe, expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { checkLayering } from '../../../scripts/check-layering.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('分层（docs/15 §1）', () => {
  test('依赖方向严格单向向下，无违规引用', () => {
    const violations = checkLayering(repoRoot)
    if (violations.length > 0) {
      console.error(violations.map((v) => `${v.file}: ${v.importPath} — ${v.rule}`).join('\n'))
    }
    expect(violations).toEqual([])
  })
})
