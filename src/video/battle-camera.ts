import { applyFrame, type State } from "../core/replay-model.ts"
import type { Replay } from "../core/types.ts"

/** 画中画（D-242）：另一处战场的镜头，zoom 按小窗自己的宽度算（小窗里横着看到 地图宽 / zoom 格）；alpha 是小窗的淡入淡出 */
export interface PipCamera { x: number; y: number; zoom: number; alpha: number }
/**
 * left、bottom：横屏地图里的小地图、小窗放在哪个角（默认右上；主战场靠到右上那块时换到对角，D-242，免得挡住交战），只在为 true 时有这个字段
 */
export interface BattleCamera { x: number; y: number; zoom: number; pip?: PipCamera; left?: true; bottom?: true }

/** 一处战场：最近一段时间的攻击、死亡连成的一团（坐标是格），w 是热度（攻击 1、单位死亡 4、建筑倒塌 6，越早的越轻） */
interface Front { id: number; x: number; y: number; x0: number; y0: number; x1: number; y1: number; w: number }
type Box = [number, number, number, number]

/** 相距这么多格以内的攻击、死亡算同一处战场 */
const LINK = 12
/** 看最近多少 tick 的攻击和死亡（按游戏时间，不随倍速变；4 倍速下约 1.2 秒视频） */
const WINDOW = 50
/** 一个放大镜头至少拍几秒；回全图至少停几秒；退回全图、推近各要几秒（两个镜头中间凑不够「退 + 停 + 推」就不回全图） */
const MIN_SHOT = 2.5
const MIN_OVERVIEW = 2
const OUT = 0.7
const IN = 1
/** 主战场至少拍几秒才允许换；另一处要热多少倍才换过去 */
const DWELL = 3
const SWITCH = 1.5
/** 主战场的交火断了，等几秒再换到别处（也许马上又打起来） */
const GRACE = 1
/** 几处战场一起框进来还能放大这么多倍，就一个镜头拍全（不开小窗） */
const UNION_ZOOM = 1.6
/** 太小的交火（热度不到 3）不影响镜头 */
const MIN_WEIGHT = 3
/** 小窗：另一处热度至少这么多（也至少是主战场的 20%）、连着出现这么多秒才开；开了至少留几秒；小窗里横着看到几格 */
const PIP_WEIGHT = 6
const PIP_SHOW = 0.4
const PIP_HOLD = 2
const PIP_TILES = 16

/** 回放里每 tick 的攻击（攻守双方中点）和死亡（不算资源、规则包移除的），按 tick 排好 */
function combatEvents(replay: Replay, lastTick: number): { t: number; x: number; y: number; w: number }[] {
  const state: State = { tick: 0, ents: new Map(replay.initial.entities.map((e) => [e.id, { ...e }])), players: replay.initial.players, markers: replay.initial.markers, status: replay.initial.status }
  const out: { t: number; x: number; y: number; w: number }[] = []
  for (let k = 1; k <= Math.min(lastTick, replay.frames.length); k++) {
    const frame = replay.frames[k - 1], shots = frame.shots ?? []
    for (let j = 0; j < shots.length; j += 2) {
      const a = state.ents.get(shots[j]) ?? frame.spawn?.find((e) => e.id === shots[j])
      const b = state.ents.get(shots[j + 1]) ?? frame.spawn?.find((e) => e.id === shots[j + 1])
      const ta = a && replay.types[a.type], tb = b && replay.types[b.type]
      if (!a || !b || !ta || !tb) continue
      out.push({ t: k, x: (a.x + ta.w / 2 + b.x + tb.w / 2) / 2, y: (a.y + ta.h / 2 + b.y + tb.h / 2) / 2, w: 1 })
    }
    const removed = new Set(frame.removed ?? [])
    for (const id of frame.die ?? []) {
      const e = state.ents.get(id), ty = e && replay.types[e.type]
      if (!e || !ty || removed.has(id) || ty.kind === "resource") continue
      out.push({ t: k, x: e.x + ty.w / 2, y: e.y + ty.h / 2, w: ty.kind === "building" ? 6 : 4 })
    }
    applyFrame(state, frame)
  }
  return out
}

/** 窗口里的攻击、死亡按 3 格一格汇总，再把相距 LINK 以内的连成一处战场；范围框只算比较新的（还剩三成热度以上） */
function cluster(ev: { t: number; x: number; y: number; w: number }[], lo: number, hi: number, t: number): Front[] {
  const cells = new Map<string, { w: number; sx: number; sy: number; box: Box | null }>()
  for (let k = lo; k < hi; k++) {
    const e = ev[k], decay = 1 - (t - e.t) / WINDOW, w = e.w * decay
    const key = `${Math.floor(e.x / 3)},${Math.floor(e.y / 3)}`
    const c = cells.get(key) ?? { w: 0, sx: 0, sy: 0, box: null }
    c.w += w
    c.sx += e.x * w
    c.sy += e.y * w
    if (decay >= 0.3) c.box = c.box ? [Math.min(c.box[0], e.x), Math.min(c.box[1], e.y), Math.max(c.box[2], e.x), Math.max(c.box[3], e.y)] : [e.x, e.y, e.x, e.y]
    cells.set(key, c)
  }
  const list = [...cells.values()].filter((c) => c.w > 0).map((c) => ({ ...c, x: c.sx / c.w, y: c.sy / c.w }))
  const root = list.map((_, k) => k)
  const find = (k: number): number => (root[k] === k ? k : (root[k] = find(root[k])))
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) if (Math.hypot(list[a].x - list[b].x, list[a].y - list[b].y) < LINK) root[find(a)] = find(b)
  const groups = new Map<number, typeof list>()
  list.forEach((c, k) => groups.set(find(k), [...(groups.get(find(k)) ?? []), c]))
  const fronts: Front[] = []
  for (const g of groups.values()) {
    const w = g.reduce((s, c) => s + c.w, 0)
    if (w < MIN_WEIGHT) continue
    const x = g.reduce((s, c) => s + c.x * c.w, 0) / w, y = g.reduce((s, c) => s + c.y * c.w, 0) / w
    const boxes = g.map((c) => c.box).filter((b): b is Box => !!b)
    const box: Box = boxes.length ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))] : [x, y, x, y]
    fronts.push({ id: 0, x, y, x0: box[0], y0: box[1], x1: box[2], y1: box[3], w })
  }
  return fronts.sort((a, b) => b.w - a.w)
}

/**
 * 整局的镜头（D-242 起先排镜头再播，原来是每帧追最近 0.65 秒的攻击点）：预先算好，拖进度、预览图、连续导出用的是同一条。横屏、竖屏共用。
 * 1. 战场：最近 WINDOW tick 的攻击、死亡按空间连成几团，按位置跟踪成同一处战场（编号不变）；
 * 2. 什么时候放大：combat[i] 为 false 的帧（不是交战、或者这段交战死的单位不到 2 个，D-236）不放大；放大镜头至少拍 MIN_SHOT 秒，
 *    两个镜头中间凑不够「退回全图 + 停 MIN_OVERVIEW 秒 + 推近」就不回全图（用户：镜头缩放中间间隔太短导致反复拉扯）；
 * 3. 拍哪：主战场至少拍 DWELL 秒，另一处热 SWITCH 倍才换过去；几处框进来还能放大 UNION_ZOOM 倍就一起拍；中间没仗的帧从上一处平移到下一处；
 *    目标没挪出画面中间那块（各方向 20%）、倍数变化不到 15% 就不动，免得来回晃；
 * 4. 小窗（用户：2v2、多方混战选画中画）：离得远、拍不进主画面的另一处战场放进小窗，开了至少留 PIP_HOLD 秒，两处都打完才回全图
 */
export function battleCameraTrack(replay: Replay, ticks: number[], fps: number, combat?: boolean[]): BattleCamera[] {
  const W = replay.map.width, H = replay.map.height, n = ticks.length
  const center = { x: W / 2, y: H / 2 }
  const maxZoom = Math.max(1, Math.min(3.8, W / 20))
  const events = combatEvents(replay, ticks.reduce((a, b) => Math.max(a, b), 0))
  // 1. 每帧的战场，按位置接上一帧的编号
  const fronts: Front[][] = []
  let lo = 0, hi = 0, prev: Front[] = [], nextId = 1
  for (let i = 0; i < n; i++) {
    const t = ticks[i]
    while (hi < events.length && events[hi].t <= t) hi++
    while (lo < hi && events[lo].t <= t - WINDOW) lo++
    const cur = cluster(events, lo, hi, t)
    const taken = new Set<number>()
    for (const f of cur) {
      let best: Front | null = null, bd = LINK
      for (const p of prev) {
        const d = Math.hypot(p.x - f.x, p.y - f.y)
        if (!taken.has(p.id) && d < bd) { best = p; bd = d }
      }
      f.id = best ? best.id : nextId++
      taken.add(f.id)
    }
    fronts.push(cur)
    prev = cur
  }
  // 2. 什么时候放大：镜头至少拍 MIN_SHOT 秒；中间短的全图段填上
  const on = fronts.map((fs, i) => combat?.[i] !== false && fs.length > 0)
  for (let i = 0; i < n; ) {
    if (!on[i]) { i++; continue }
    let j = i
    while (j < n && on[j]) j++
    const end = Math.min(n, i + Math.round(MIN_SHOT * fps))
    for (let k = j; k < end; k++) on[k] = true
    i = Math.max(j, end)
  }
  const gapMin = Math.round((OUT + MIN_OVERVIEW + IN) * fps)
  for (let i = 0; i < n; ) {
    if (on[i]) { i++; continue }
    let j = i
    while (j < n && !on[j]) j++
    if (i > 0 && j < n && j - i < gapMin) on.fill(true, i, j)
    i = j
  }
  // 3. 拍哪：主战场（带停留时间）、一起框进来的近处战场、放进小窗的远处战场
  const fit = (b: Box) => Math.max(1, Math.min(maxZoom, W / Math.max(1, b[2] - b[0]), H / Math.max(1, b[3] - b[1])))
  const padded = (f: Front): Box => [f.x0 - 3, f.y0 - 3, f.x1 + 3, f.y1 + 3]
  const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
  const target: ({ x: number; y: number; zoom: number } | null)[] = new Array(n).fill(null)
  const pipCands: Front[][] = fronts.map(() => [])
  let primary = -1, since = 0, lost = -1
  let last: { x: number; y: number } | null = null
  for (let i = 0; i < n; i++) {
    const fs = fronts[i]
    if (!on[i]) { primary = -1; last = null; continue }
    let cur = fs.find((f) => f.id === primary)
    // 主战场的编号对不上了（一团分成两团、热度一时掉到门槛以下）：原来那处附近还有交火就接着拍它；真没了先等 GRACE 秒再换，等的时候镜头不动
    if (!cur && last) cur = fs.find((f) => Math.hypot(f.x - last!.x, f.y - last!.y) < LINK * 1.5)
    if (cur) { primary = cur.id; lost = -1 }
    else if (primary !== -1) {
      if (lost < 0) lost = i
      if (i - lost < GRACE * fps) continue
    }
    if (!fs.length) continue
    if (!cur || (i - since >= DWELL * fps && fs[0].id !== cur.id && fs[0].w > SWITCH * cur.w)) {
      cur = fs[0]
      primary = cur.id
      since = i
      lost = -1
    }
    last = { x: cur.x, y: cur.y }
    let box = padded(cur)
    const far: Front[] = []
    for (const f of fs) {
      if (f === cur) continue
      const u = union(box, padded(f))
      if (fit(u) >= Math.min(UNION_ZOOM, maxZoom)) box = u
      else far.push(f)
    }
    target[i] = { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, zoom: fit(box) }
    pipCands[i] = far.filter((f) => f.w >= Math.max(PIP_WEIGHT / 2, 0.1 * cur.w))
  }
  // 镜头中间没仗的帧（凑出来的、拉长的）：从上一处平移到下一处，只有一边就停在那边
  for (let i = 0; i < n; ) {
    if (!on[i] || target[i]) { i++; continue }
    let j = i
    while (j < n && on[j] && !target[j]) j++
    const a = i > 0 && on[i - 1] ? target[i - 1] : null, b = j < n && on[j] ? target[j] : null
    for (let k = i; k < j; k++) {
      const p = (k - i + 1) / (j - i + 1), q = p * p * (3 - 2 * p)
      target[k] = a && b ? { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, zoom: a.zoom + (b.zoom - a.zoom) * q } : (a ?? b)
    }
    i = j
  }
  // 4. 平滑：主镜头指数缓动（目标在死区里不动），回全图限时 OUT 秒；小窗单独跟
  const ease = 1 - Math.exp(-1 / (fps * 0.55))
  const fade = 1 / Math.max(1, fps * 0.3)
  const pipZoom = Math.max(1, W / PIP_TILES)
  const track: BattleCamera[] = []
  let cam = { ...center, zoom: 1 }
  let held: { x: number; y: number; zoom: number } | null = null
  let overview: { frame: number; from: { x: number; y: number; zoom: number } } | undefined
  type PipState = { id: number; x: number; y: number; zoom: number; since: number; alpha: number; on: boolean }
  let pip: PipState | null = null
  let seen = 0
  // 小地图、小窗的角：主战场进了现在那个角的范围（横 40%、竖 42%）才换到对角，换了至少留 1 秒
  let corner = { left: false, bottom: false }, cornerSince = -fps
  for (let i = 0; i < n; i++) {
    const tg = on[i] ? target[i] : null
    if (tg) {
      if (!held || Math.abs(tg.x - held.x) > (0.2 * W) / held.zoom || Math.abs(tg.y - held.y) > (0.2 * H) / held.zoom || Math.abs(tg.zoom - held.zoom) > 0.15 * held.zoom) held = tg
      overview = undefined
      cam = { x: cam.x + (held.x - cam.x) * ease, y: cam.y + (held.y - cam.y) * ease, zoom: cam.zoom + (held.zoom - cam.zoom) * ease }
    } else {
      held = null
      // Finish the return in a bounded time, then show every tile exactly (no asymptotic cropping).
      overview ??= { frame: i, from: cam }
      const p = Math.min(1, (i - overview.frame) / Math.ceil(fps * OUT)), q = p * p * (3 - 2 * p)
      const from = overview.from
      cam = p === 1 ? { ...center, zoom: 1 } : { x: from.x + (center.x - from.x) * q, y: from.y + (center.y - from.y) * q, zoom: from.zoom + (1 - from.zoom) * q }
    }
    // 小窗：另一处够热、连着出现 PIP_SHOW 秒才开；跟着原来那处，那处没了换最热的另一处，都没了留够 PIP_HOLD 秒再关
    const cands = on[i] ? pipCands[i] : []
    const strong = cands.find((f) => f.w >= PIP_WEIGHT)
    seen = strong ? seen + 1 : 0
    const p: PipState | null = pip
    const lastAlpha: number = p ? p.alpha : 0
    if (p?.on) {
      const same = cands.find((f) => f.id === p.id)
      if (!on[i]) p.on = false
      else if (same) {
        p.x += (same.x - p.x) * ease
        p.y += (same.y - p.y) * ease
      } else if (strong) Object.assign(p, { id: strong.id, x: strong.x, y: strong.y, since: i })
      else if (i - p.since >= PIP_HOLD * fps) p.on = false
    } else if (strong && seen >= PIP_SHOW * fps) pip = { id: strong.id, x: strong.x, y: strong.y, zoom: pipZoom, since: i, alpha: lastAlpha, on: true }
    if (pip) {
      pip.alpha = Math.max(0, Math.min(1, pip.alpha + (pip.on ? fade : -fade)))
      if (!pip.on && pip.alpha === 0) pip = null
    }
    if (tg && held) {
      const vw = W / cam.zoom, vh = H / cam.zoom
      const rx = (held.x - Math.max(0, Math.min(W - vw, cam.x - vw / 2))) / vw, ry = (held.y - Math.max(0, Math.min(H - vh, cam.y - vh / 2))) / vh
      const inside = (corner.left ? rx < 0.4 : rx > 0.6) && (corner.bottom ? ry > 0.58 : ry < 0.42)
      if (inside && i - cornerSince >= fps) {
        corner = { left: rx > 0.5, bottom: ry < 0.5 }
        cornerSince = i
      }
    } else if (!tg) corner = { left: false, bottom: false }
    const out: BattleCamera = { ...cam, ...(corner.left ? { left: true as const } : {}), ...(corner.bottom ? { bottom: true as const } : {}) }
    if (pip) out.pip = { x: pip.x, y: pip.y, zoom: pip.zoom, alpha: pip.alpha }
    track.push(out)
  }
  return track
}
