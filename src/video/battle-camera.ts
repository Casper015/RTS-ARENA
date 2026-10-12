import { applyFrame, type State } from "../core/replay-model.ts"
import type { Replay } from "../core/types.ts"

export interface BattleCamera { x: number; y: number; zoom: number }

/**
 * Precompute once so scrubbing, preview stills and sequential export use exactly the same camera.
 * 横屏、竖屏共用（竖屏 D-182 起，横屏 D-236）；combat[i] 为 false 的帧不放大（不是交战、或者这段交战死的单位不到 2 个）
 */
export function battleCameraTrack(replay: Replay, ticks: number[], fps: number, combat?: boolean[]): BattleCamera[] {
  const state: State = { tick: 0, ents: new Map(replay.initial.entities.map(e => [e.id, { ...e }])), players: replay.initial.players, markers: replay.initial.markers, status: replay.initial.status }
  let points: { x: number; y: number; frame: number }[] = []
  const center = { x: replay.map.width / 2, y: replay.map.height / 2 }
  let camera: BattleCamera = { ...center, zoom: 1 }, focus = { ...center }
  const track: BattleCamera[] = []
  const cell = 6, radius = 9
  const zoom = Math.max(1, Math.min(3.8, replay.map.width / 20))
  const ease = 1 - Math.exp(-1 / (fps * .55))
  let overview: { frame: number; from: BattleCamera } | undefined
  for (let i = 0; i < ticks.length; i++) {
    for (let k = state.tick + 1; k <= ticks[i]; k++) {
      const frame = replay.frames[k - 1], shots = frame.shots ?? []
      for (let j = 0; j < shots.length; j += 2) {
        const a = state.ents.get(shots[j]) ?? frame.spawn?.find(e => e.id === shots[j])
        const b = state.ents.get(shots[j + 1]) ?? frame.spawn?.find(e => e.id === shots[j + 1])
        if (!a || !b) continue
        const ta = replay.types[a.type], tb = replay.types[b.type]
        points.push({ x: (a.x + ta.w / 2 + b.x + tb.w / 2) / 2, y: (a.y + ta.h / 2 + b.y + tb.h / 2) / 2, frame: i })
      }
      applyFrame(state, frame)
    }
    points = combat?.[i] === false ? [] : points.filter(p => i - p.frame < fps * .65).slice(-192)
    if (points.length) {
      const buckets = new Map<string, { x: number; y: number }>()
      for (const p of points) {
        const x = Math.floor(p.x / cell), y = Math.floor(p.y / cell)
        buckets.set(`${x},${y}`, { x: (x + .5) * cell, y: (y + .5) * cell })
      }
      const weight = (p: (typeof points)[number]) => 1 - (i - p.frame) / (fps * 2)
      const nearby = (c: { x: number; y: number }) => points.filter(p => Math.hypot(p.x - c.x, p.y - c.y) < radius)
      const score = (c: { x: number; y: number }) => nearby(c).reduce((sum, p) => sum + weight(p), 0)
      let best = focus, bestScore = score(focus)
      for (const c of buckets.values()) {
        const value = score(c)
        // A secondary skirmish must be substantially busier before taking over the shot.
        if (value > bestScore * 1.35) { best = c; bestScore = value }
      }
      const group = nearby(best), total = group.reduce((sum, p) => sum + weight(p), 0)
      if (total) focus = { x: group.reduce((sum, p) => sum + p.x * weight(p), 0) / total, y: group.reduce((sum, p) => sum + p.y * weight(p), 0) / total }
    }
    if(points.length) {
      overview=undefined
      camera = { x: camera.x + (focus.x - camera.x) * ease, y: camera.y + (focus.y - camera.y) * ease, zoom: camera.zoom + (zoom - camera.zoom) * ease }
    } else {
      // Finish the return in a bounded time, then show every tile exactly (no asymptotic cropping).
      overview ??= { frame:i, from:camera }
      const p=Math.min(1,(i-overview.frame)/Math.ceil(fps*.7)), q=p*p*(3-2*p)
      const from=overview.from
      camera=p===1?{...center,zoom:1}:{x:from.x+(center.x-from.x)*q,y:from.y+(center.y-from.y)*q,zoom:from.zoom+(1-from.zoom)*q}
    }
    track.push(camera)
  }
  return track
}
