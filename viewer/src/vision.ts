// 按某一队的视野看回放：用和引擎相同的规则（src/core/vision.ts）从回放局面算出这一队当时看得见什么
import type { EntSnap, Replay } from "../../src/core/types.ts"
import { layerOf, modeOf } from "../../src/core/replay-model.ts"
import { markSight, rectSeen } from "../../src/core/vision.ts"
import type { State } from "./model.ts"

export class Vision {
  private readonly replay: Replay
  /** 这一队看得见的格子 */
  readonly vis: Uint8Array
  /** 这一队探测得到的格子（D-266：地下的东西要探测到才看得见） */
  readonly det: Uint8Array

  constructor(replay: Replay) {
    this.replay = replay
    this.vis = new Uint8Array(replay.map.width * replay.map.height)
    this.det = new Uint8Array(replay.map.width * replay.map.height)
  }

  /** 回放里有没有算视野需要的信息（老回放没有 sight 和 fog） */
  static supported(replay: Replay): boolean {
    return typeof replay.fog === "boolean" && Object.values(replay.types).every((t) => typeof t.sight === "number")
  }

  teamOf(player: number): number {
    return this.replay.players[player]?.team ?? player
  }

  /** 实体的占地（驻扎在建筑里的按建筑算，D-266） */
  private rect(state: State, e: EntSnap): { x: number; y: number; w: number; h: number } {
    const b = e.in ? state.ents.get(e.in) : undefined
    const t = this.replay.types[(b ?? e).type]
    return { x: (b ?? e).x, y: (b ?? e).y, w: t?.w ?? 1, h: t?.h ?? 1 }
  }

  /** 算 team 在这个局面下看得见、探测得到的格子 */
  compute(state: State, team: number): void {
    const { width, height } = this.replay.map
    this.vis.fill(0)
    this.det.fill(0)
    for (const e of state.ents.values()) {
      if (e.owner < 0 || this.teamOf(e.owner) !== team) continue
      const t = this.replay.types[e.type]
      const r = this.rect(state, e)
      markSight(this.vis, width, height, r, e.st?.sight ?? modeOf(this.replay, e)?.sight ?? t?.sight ?? 0)
      if (t?.detect && e.bp === undefined) markSight(this.det, width, height, r, t.detect)
    }
  }

  /** 和引擎的 visibleTo 一样：自己和盟友的、资源点都看得见；驻扎在建筑里的看不见，地下的要探测到；其余没迷雾就看得见、有迷雾要有一格在视野里（先 compute） */
  visible(e: EntSnap, team: number): boolean {
    const t = this.replay.types[e.type]
    if ((e.owner >= 0 && this.teamOf(e.owner) === team) || t?.kind === "resource") return true
    const r = { x: e.x, y: e.y, w: t?.w ?? 1, h: t?.h ?? 1 }
    if (e.in) return false
    if (layerOf(this.replay, e) === "under" && !rectSeen(this.det, this.replay.map.width, r)) return false
    return !this.replay.fog || rectSeen(this.vis, this.replay.map.width, r)
  }

  /** 某一格在不在视野里（没有迷雾时都在） */
  tileSeen(x: number, y: number): boolean {
    return !this.replay.fog || this.vis[y * this.replay.map.width + x] === 1
  }
}
