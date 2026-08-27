/**
 * 内核状态：纯数据容器。
 *
 * docs/15 §2.2：状态字段一律只读暴露，写句柄只交给归约。
 * 本模块用 DeepReadonly 在类型层兑现这条——校验、产出、推进拿到的都是只读视图，
 * 只有 reduce 拿到可变引用。
 */

/** 座位标识。整局固定，按座次从 1 开始。 */
export type SeatId = number

/** 阶段标识。由模板的阶段表声明，内核不认识具体取值。 */
export type PhaseId = string

export interface SeatState {
  id: SeatId
  /** 余命，整数日。docs/15 §2.4 第 1 条：规则数值一律用整数。 */
  lifespan: number
  /** 失守：余命归零后的状态，不能再行动、持有、投票或获奖。 */
  fallen: boolean
}

export interface KernelState<TemplateState = unknown> {
  /** 始终按 seatId 升序。docs/15 §2.4 第 3 条禁止依赖容器的偶然顺序。 */
  seats: SeatState[]
  levelRound: number
  negotiationRound: number
  phase: PhaseId
  /** 模板专属状态对象。内核不读它的内部结构。 */
  template: TemplateState
}

type AnyFunction = (...args: never[]) => unknown

export type DeepReadonly<T> = T extends AnyFunction
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends ReadonlySet<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends object
          ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
          : T

/** 按 seatId 升序返回全部座位。调用方不得依赖数组的插入顺序。 */
export function seatsInOrder<S>(state: DeepReadonly<KernelState<S>>): readonly DeepReadonly<SeatState>[] {
  return [...state.seats].sort((a, b) => a.id - b.id)
}

/** 按 seatId 升序返回未失守的座位。 */
export function livingSeats<S>(state: DeepReadonly<KernelState<S>>): readonly DeepReadonly<SeatState>[] {
  return seatsInOrder(state).filter((s) => !s.fallen)
}

export function findSeat<S>(
  state: DeepReadonly<KernelState<S>>,
  id: SeatId,
): DeepReadonly<SeatState> | undefined {
  return state.seats.find((s) => s.id === id)
}

/** 归约内部使用：拿到可变座位引用。找不到即为缺陷，直接抛。 */
export function mutableSeat<S>(state: KernelState<S>, id: SeatId): SeatState {
  const seat = state.seats.find((s) => s.id === id)
  if (seat === undefined) throw new Error(`座位不存在：${id}`)
  return seat
}

export function isLiving<S>(state: DeepReadonly<KernelState<S>>, id: SeatId): boolean {
  const seat = findSeat(state, id)
  return seat !== undefined && !seat.fallen
}
