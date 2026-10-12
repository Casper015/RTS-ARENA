// 农田（D-218，攻城拓荒用；用户：工人可以建农田持续获得经济，产出是家门口往返采金矿效率的 70%）：
// 工人建的 2×2 建筑，不会采完。一块建好的农田同时由 1 个工人耕作：自己的工人停在农田旁边（贴着它，命令是 idle）就算在耕作，
// 每耕 FARM_TICKS 个 tick 直接给主人 FARM_GOLD 金（不用搬回交货点）。工人走开、去采矿、去建造就停；换个工人接着耕，进度不清零。
// 一个工人同时只耕一块（贴着两块时算 id 小的那块），一块田同时只算一个工人（贴着好几个时算 id 小的那个，其余的白站着）。
// 效率：家门口的金矿一矿一个工人，采一趟交 5 金平均约 39 tick（实测每人每 tick 0.128 金）；农田每 56 tick 5 金 = 0.089 金/tick，是它的 70%
import type { RuleContext, TypeSpec } from "../../src/core/types.ts"

/** 每次给多少金 */
export const FARM_GOLD = 5
/** 耕多少 tick 给一次 */
export const FARM_TICKS = 56

export function farmType(): TypeSpec {
  return {
    kind: "building",
    w: 2,
    h: 2,
    maxHp: 300,
    // D-227：100 → 60（用户；第一轮试写测出种田净亏：回本要 1100 多 tick，多数局 3000～5000 tick 就结束）
    cost: { gold: 60 },
    buildTicks: 150,
    sight: 3,
    look: { shape: "square", label: "田", name: "农田" },
  }
}

// 一局的状态（setup 时重置）
const progress = new Map<number, number>()
const farmer = new Map<number, number>()
let gold: number[] = []

export function resetFarms(): void {
  progress.clear()
  farmer.clear()
  gold = []
}

/** 每 tick：给每块建好的农田找耕作的工人，耕够 FARM_TICKS 就给金子 */
export function farmTick(ctx: RuleContext): void {
  const farms = ctx
    .entities({ type: "farm" })
    .filter((f) => !f.construction && f.owner >= 0)
    .sort((a, b) => a.id - b.id)
  const alive = new Set(farms.map((f) => f.id))
  for (const id of [...progress.keys()]) if (!alive.has(id)) progress.delete(id)
  farmer.clear()
  const used = new Set<number>()
  const workers = ctx
    .entities({ type: "worker" })
    .filter((w) => w.order.kind === "idle")
    .sort((a, b) => a.id - b.id)
  for (const f of farms) {
    const w = workers.find((u) => u.owner === f.owner && !used.has(u.id) && ctx.dist(u, f) <= 1)
    if (!w) continue
    used.add(w.id)
    farmer.set(f.id, w.id)
    const p = (progress.get(f.id) ?? 0) + 1
    if (p >= FARM_TICKS) {
      ctx.addResource(f.owner, "gold", FARM_GOLD)
      gold[f.owner] = (gold[f.owner] ?? 0) + FARM_GOLD
      progress.set(f.id, p - FARM_TICKS)
    } else progress.set(f.id, p)
  }
}

/** 给 bot 看的：自己的农田（建好的），谁在耕、还差几 tick 给下一次金子 */
export interface FarmInfo {
  id: number
  x: number
  y: number
  /** 正在耕的工人 id；没人耕是 null */
  farmer: number | null
  /** 再耕几 tick 给下一次金子 */
  nextIn: number
}

export function farmInfo(ctx: RuleContext, player: number): FarmInfo[] {
  return ctx
    .entities({ type: "farm", owner: player })
    .filter((f) => !f.construction)
    .map((f) => ({ id: f.id, x: f.x, y: f.y, farmer: farmer.get(f.id) ?? null, nextIn: FARM_TICKS - (progress.get(f.id) ?? 0) }))
}

/** 每个玩家从农田拿到多少金（对局结果的 stats 用） */
export function farmStats(n: number): Record<string, number[]> {
  return { 农田收入: Array.from({ length: n }, (_, i) => gold[i] ?? 0) }
}
