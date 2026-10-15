import type { EntSnap, Frame, Replay, RuleFx } from "../core/types.ts"
import type { BattlePose, BattleType } from "./battle-art.ts"

/** Resolve presentation from the active mode for both the live viewer and exported video. */
export function battleTypeOf(replay: Replay, name: string, md?: string): BattleType {
  const t = replay.types[name], m = md ? t.modes?.find(m => m.id === md) : undefined
  return { name, kind: t.kind, label: m?.look?.label ?? t.look?.label, shape: t.look?.shape, worker: t.worker,
    range: m ? m.attack?.range : t.attack?.range, splash: m ? m.attack?.splash : t.attack?.splash,
    art: m?.look?.art ? { ...t.look?.art, ...m.look.art } : t.look?.art, layer: m?.layer ?? t.layer }
}

/** Mode switches resolve before combat; the replay delta has not been applied by the video renderer yet. */
export function shotTypeOf(replay: Replay, frame: Frame, e: EntSnap): BattleType {
  const changed = frame.md?.find(([id]) => id === e.id)
  return battleTypeOf(replay, e.type, changed ? changed[1] ?? undefined : e.md)
}

function distance(replay: Replay, a: EntSnap, b: EntSnap): number {
  const at = replay.types[a.type], bt = replay.types[b.type]
  return Math.max(0,a.x-(b.x+bt.w-1),b.x-(a.x+at.w-1)) + Math.max(0,a.y-(b.y+bt.h-1),b.y-(a.y+at.h-1))
}

/** Match common/farm.ts: ascending farm/worker IDs, one idle owner worker per completed farm. */
export function farmWorkers(replay: Replay, entities: Map<number, EntSnap>): Map<number, EntSnap> {
  const result = new Map<number, EntSnap>()
  const farms = [...entities.values()].filter(e=>e.type==="farm"&&e.owner>=0&&(e.bp??100)>=100&&replay.types[e.type]?.kind==="building").sort((a,b)=>a.id-b.id)
  if (!farms.length) return result
  const workers = [...entities.values()].filter(e=>e.type==="worker"&&e.ord==="idle").sort((a,b)=>a.id-b.id)
  for (const f of farms) {
    const worker = workers.find(e=>e.owner===f.owner&&!result.has(e.id)&&distance(replay,e,f)<=1)
    if(worker) result.set(worker.id,f)
  }
  return result
}

export function trainingQueue(replay: Replay, e: EntSnap) {
  return e.queue?.map((q,i)=>{
    const total=Math.max(1,replay.types[q.type]?.buildTicks??q.ticksLeft)
    const active=(e.bp??100)>=100&&i<(replay.types[e.type]?.parallel??1)
    return {...q,total,active,blocked:active&&q.ticksLeft===0,progress:Math.max(0,Math.min(1,1-q.ticksLeft/total))}
  })
}

/**
 * 侧视的单位只分朝右（0）和朝左（π）（D-234）。还没动过的单位背对自己的主基地：主基地在地图左半边就朝右、右半边就朝左；
 * 主基地是开局每家都有的建筑里生命最多的那种（没有就是自己开局生命最多的建筑）。中立的、开局没有建筑的、主基地正在中线上的，按自己在哪半边朝地图中间
 */
export function homeFacing(replay: Replay): (e: EntSnap) => number {
  const mid = replay.map.width / 2
  const buildings = replay.initial.entities.filter((e) => e.owner >= 0 && replay.types[e.type]?.kind === "building")
  const owners = new Set(buildings.map((e) => e.owner))
  const everyone = (type: string) => replay.players.every((_, p) => !owners.has(p) || buildings.some((e) => e.owner === p && e.type === type))
  const rank = (e: EntSnap) => (everyone(e.type) ? 1e9 : 0) + (replay.types[e.type].maxHp ?? 0)
  const home = new Map<number, { x: number; rank: number }>()
  for (const e of buildings) {
    const r = rank(e), cur = home.get(e.owner)
    if (!cur || r > cur.rank) home.set(e.owner, { x: e.x + (replay.types[e.type].w ?? 1) / 2, rank: r })
  }
  return (e) => {
    const base = home.get(e.owner)?.x
    const x = base === undefined || base === mid ? e.x + (replay.types[e.type]?.w ?? 1) / 2 : base
    return x < mid ? 0 : Math.PI
  }
}

/** 往横向差 dx 格的地方走一步、打过去之后朝哪边：横向差不到半格（正上正下）就不转身，不然走台阶形的路时一会儿朝左一会儿朝右，像倒着走 */
export function faceToward(facing: number, dx: number): number {
  return dx <= -.5 ? Math.PI : dx >= .5 ? 0 : facing
}

/** Old replays already contain enough order and position data to animate work without changing simulation. */
export function workerPose(replay: Replay, entities: Map<number, EntSnap>, e: EntSnap, seconds: number, moving: boolean, farms?: Map<number, EntSnap>): BattlePose | undefined {
  const type = replay.types[e.type]
  if (!type?.worker || type.kind !== "unit") return undefined
  const match = /^(gather|build) #(\d+)(.*)$/.exec(e.ord)
  const carrying = match?.[1] === "gather" && match[3].includes("回程")
  const pose: BattlePose = { work: -1, carrying: !!carrying, job: "mine" }
  const farm = e.ord==="idle" ? (farms??farmWorkers(replay,entities)).get(e.id) : undefined
  if (!match && !farm) return pose
  const target = farm ?? entities.get(Number(match![2])), tt = target && replay.types[target.type]
  if (!target || !tt) return pose
  pose.job = farm ? "farm" : match![1] === "build" ? "build" : /tree|wood|forest|timber/.test(target.type) ? "chop" : /farm|food|berry|wheat|fruit/.test(target.type) ? "harvest" : "mine"
  const dx = Math.max(0, e.x - (target.x + tt.w - 1), target.x - (e.x + type.w - 1))
  const dy = Math.max(0, e.y - (target.y + tt.h - 1), target.y - (e.y + type.h - 1))
  const valid = !!farm || (match![1] === "gather" ? tt.kind === "resource" && target.hp > 0 : target.bp !== undefined && target.bp < 100)
  if (!valid || carrying || moving || dx + dy > 1 || e.bf?.includes("眩晕")) return pose
  pose.work = ((seconds * 1.1 + e.id * .173) % 1 + 1) % 1
  // 干活时面朝目标；目标在正上正下就照旧朝着原来的方向（D-234）
  const side = target.x + tt.w / 2 - e.x - type.w / 2
  if (Math.abs(side) >= .5) pose.angle = side < 0 ? Math.PI : 0
  return pose
}

/** Suppress only the old splash-area flash paired with a recorded cannon hit, now drawn by the projectile. */
export function legacySplashEffects(replay: Replay, frame: Frame, entities: Map<number, EntSnap>): Set<RuleFx> {
  const result = new Set<RuleFx>()
  const candidates = frame.fx?.filter((fx) => !fx.text && fx.color === "#ff9a3c" && fx.radius === 1) ?? []
  if (!candidates.length) return result
  const shots = frame.shots ?? []
  for (let i = 0; i < shots.length; i += 2) {
    const source = entities.get(shots[i]) ?? frame.spawn?.find((e) => e.id === shots[i])
    const target = entities.get(shots[i + 1]) ?? frame.spawn?.find((e) => e.id === shots[i + 1])
    const radius = source && shotTypeOf(replay, frame, source).splash
    const type = target && replay.types[target.type]
    if (!radius || !target || !type) continue
    // Combat resolves before movement. Callers supply the positions at the start of this tick.
    const tx = target.x, ty = target.y
    const x = Math.max(0, tx - radius), y = Math.max(0, ty - radius)
    const w = Math.min(replay.map.width, tx + type.w + radius) - x
    const h = Math.min(replay.map.height, ty + type.h + radius) - y
    for (const fx of candidates) if (fx.x === x && fx.y === y && fx.w === w && fx.h === h) result.add(fx)
  }
  return result
}
