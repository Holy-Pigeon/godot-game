/**
 * 模板层（docs/15 §1）。
 *
 * 表现层通过本文件的注册表按模板标识取模板，不直接引用任何具体模板的内部符号
 * （§1 硬规则 2）。由 scripts/check-layering.ts 保证。
 */

import type { Template, ViewProjection } from '@terminus/kernel'
import { T11Template } from './t11/index.ts'
import { T11ViewProjection } from './t11/view.ts'
import { ToyTemplate } from './toy/index.ts'

export * from './t11/index.ts'
export { TOY_COMMANDS, TOY_EVENTS, TOY_PHASES, ToyTemplate } from './toy/index.ts'
export type { ToyState, ToyVote } from './toy/index.ts'

const REGISTRY = new Map<string, () => Template<never>>([
  ['t11', () => new T11Template() as unknown as Template<never>],
  ['toy', () => new ToyTemplate() as unknown as Template<never>],
])

export function createTemplate(id: string): Template<never> {
  const factory = REGISTRY.get(id)
  if (factory === undefined) throw new Error(`未注册的模板标识：${id}`)
  return factory()
}

export function registeredTemplateIds(): readonly string[] {
  return [...REGISTRY.keys()].sort()
}

const VIEWS = new Map<string, () => ViewProjection>([['t11', () => new T11ViewProjection()]])

/**
 * 按模板标识取视图投影。表现层只经由这个入口拿视图，
 * 因此不需要（也不允许）引用任何具体模板的内部符号（docs/15 §1 硬规则 2）。
 */
export function createViewProjection(templateId: string): ViewProjection {
  const factory = VIEWS.get(templateId)
  if (factory === undefined) throw new Error(`模板 ${templateId} 没有视图投影`)
  return factory()
}
