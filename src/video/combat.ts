import { applyFrame, ReplayModel } from "../core/replay-model.ts"
import type { Replay } from "../core/types.ts"
import { fighterTest } from "../cli/battles.ts"

/** 回放里的单位、建筑死亡，不计资源耗尽和规则包主动移除。 */
export function deathsOf(replay: Replay): { t: number; x: number; y: number; owner: number; fighter: boolean; unit: boolean }[] {
  const s = new ReplayModel(replay).initialState(), fighter = fighterTest(replay.types)
  const deaths: ReturnType<typeof deathsOf> = []
  for (const f of replay.frames) {
    const removed = new Set(f.removed ?? [])
    for (const id of f.die ?? []) {
      const e = s.ents.get(id)
      if (!e || removed.has(id) || replay.types[e.type]?.kind === "resource") continue
      deaths.push({ t: f.t, x: e.x, y: e.y, owner: e.owner, fighter: fighter(e.type), unit: replay.types[e.type]?.kind === "unit" })
    }
    applyFrame(s, f)
  }
  return deaths
}

/** 缩放门槛：同一处（半径 12 格）在 60 tick 内至少死 4 个单位。建筑不凑数。 */
const ZOOM_DEATHS = 4
const ZOOM_WINDOW = 60
const ZOOM_RADIUS = 12
export const BATTLE_LEAD = 40
export const BATTLE_TAIL = 20
export interface ZoomBattle { start: number; end: number; x: number; y: number }

/** 滚动时间窗独立检查每处战场，2v2 两端的零散死亡不会凑成一次缩放。 */
export function zoomBattles(replay: Replay): ZoomBattle[] {
  const deaths = deathsOf(replay).filter((d) => d.unit), battles: ZoomBattle[] = []
  let lo = 0
  for (let i = 0; i < deaths.length; i++) {
    const d = deaths[i]
    while (lo < i && deaths[lo].t < d.t - ZOOM_WINDOW) lo++
    const near = deaths.slice(lo, i + 1).filter((e) => Math.hypot(e.x - d.x, e.y - d.y) <= ZOOM_RADIUS)
    if (near.length < ZOOM_DEATHS) continue
    battles.push({ start: Math.max(0, near[0].t - BATTLE_LEAD), end: Math.min(replay.result.tick, d.t + BATTLE_TAIL),
      x: near.reduce((s, e) => s + e.x, 0) / near.length, y: near.reduce((s, e) => s + e.y, 0) / near.length })
  }
  return battles.sort((a, b) => a.start - b.start)
}

/** 视频和网页导播使用同一份逐 tick 缩放资格，包含必要的交火前后镜头。 */
export function zoomBattleTicks(replay: Replay): Uint8Array {
  const ticks = new Uint8Array(Math.max(1, replay.result.tick) + 1)
  for (const b of zoomBattles(replay)) ticks.fill(1, b.start, b.end + 1)
  return ticks
}
