import type { EntSnap, Frame, Replay, RuleFx } from "../core/types.ts"
import type { BattlePose } from "./battle-art.ts"

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
  pose.angle = Math.atan2(target.y + tt.h / 2 - e.y - type.h / 2, target.x + tt.w / 2 - e.x - type.w / 2)
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
    const radius = source && replay.types[source.type]?.attack?.splash
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
