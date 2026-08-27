/**
 * 随机源：由种子完全决定，记录抽取次数便于比对（docs/15 §2.6）。
 *
 * docs/15 §2.4 第 2 条：任何一次抽取必须把结果写进事件载荷；
 * 重放时不重新抽取，只读事件里的结果。因此本模块只在「产出」路径上被调用，
 * 归约与重放一律不碰它。
 *
 * 算法为 sfc32，种子经 splitmix32 扩展。全部为 uint32 整数运算，不引入浮点，
 * 对齐 §2.4 第 1 条。
 */

export interface RandomSnapshot {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly drawCount: number
}

export class SeededRandom {
  #a: number
  #b: number
  #c: number
  #d: number
  #drawCount = 0

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new Error(`种子必须是整数：${seed}`)
    let s = seed >>> 0
    const splitmix32 = (): number => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
      return (z ^ (z >>> 15)) >>> 0
    }
    this.#a = splitmix32()
    this.#b = splitmix32()
    this.#c = splitmix32()
    this.#d = splitmix32()
  }

  /** 已抽取次数。用于比对两次运行是否走了同一条随机路径。 */
  get drawCount(): number {
    return this.#drawCount
  }

  nextUint32(): number {
    this.#drawCount++
    const t = (((this.#a + this.#b) >>> 0) + this.#d) >>> 0
    this.#d = (this.#d + 1) >>> 0
    this.#a = (this.#b ^ (this.#b >>> 9)) >>> 0
    this.#b = (this.#c + ((this.#c << 3) >>> 0)) >>> 0
    this.#c = (((this.#c << 21) >>> 0) | (this.#c >>> 11)) >>> 0
    this.#c = (this.#c + t) >>> 0
    return t
  }

  /**
   * 返回 [0, bound) 内的整数。
   * 用拒绝采样去掉取模偏置——批量模拟要拿分布做经济验收，有偏就白跑了。
   */
  nextIntBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) throw new Error(`上界必须是正整数：${bound}`)
    const limit = Math.floor(0x100000000 / bound) * bound
    let v = this.nextUint32()
    while (v >= limit) v = this.nextUint32()
    return v % bound
  }

  /**
   * 百分比整数判定（§2.4 第 1 条：概率判定用百分比整数比较，不引入浮点）。
   * 抽取值与结果都要写进事件载荷——docs/15 §7.4 明写缺任何一项都会让重放漂移。
   */
  rollPercent(probabilityPercent: number): { readonly draw: number; readonly success: boolean } {
    if (!Number.isInteger(probabilityPercent) || probabilityPercent < 0 || probabilityPercent > 100) {
      throw new Error(`概率必须是 0–100 的整数：${probabilityPercent}`)
    }
    const draw = this.nextIntBelow(100)
    return { draw, success: draw < probabilityPercent }
  }

  /** Fisher-Yates。不改动入参。 */
  shuffled<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextIntBelow(i + 1)
      const a = out[i]
      const b = out[j]
      if (a === undefined || b === undefined) throw new Error('洗牌越界')
      out[i] = b
      out[j] = a
    }
    return out
  }

  /** 从非空数组中抽一个。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('不能从空集合抽取')
    const chosen = items[this.nextIntBelow(items.length)]
    if (chosen === undefined) throw new Error('抽取越界')
    return chosen
  }

  /** 不放回抽取 count 个。 */
  sample<T>(items: readonly T[], count: number): T[] {
    if (count > items.length) throw new Error(`抽取数 ${count} 超过集合大小 ${items.length}`)
    return this.shuffled(items).slice(0, count)
  }

  snapshot(): RandomSnapshot {
    return { a: this.#a, b: this.#b, c: this.#c, d: this.#d, drawCount: this.#drawCount }
  }

  static restore(snapshot: RandomSnapshot): SeededRandom {
    const random = new SeededRandom(0)
    random.#a = snapshot.a
    random.#b = snapshot.b
    random.#c = snapshot.c
    random.#d = snapshot.d
    random.#drawCount = snapshot.drawCount
    return random
  }
}
