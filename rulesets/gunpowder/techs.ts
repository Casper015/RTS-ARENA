// 火药科技的单位、建筑和科技（D-257）：攻城拓荒的单位和建筑，加上线列步兵、火药工坊和 4 种科技建筑。
// - 线列步兵（musketeer）：火药工坊造，一下伤害高（30，弓兵 7）、射程 3（比弓兵少一格）、命中 50%（attack.accuracy，打偏落在目标旁边一格，
//   那格有敌人就打中它）；打枪兵 ×1.5，打骑兵不吃亏（弓兵打骑兵 ×0.5），骑兵冲它 ×1.5、弓兵射它 ×1.5；
// - 火药工坊（gunworks）：造线列步兵和炮（兵营不再造炮）；
// - 科技建筑：建好的在，加成就在（被拆了就没了），同一种建几座也只算一份；加成用局中改数值（ctx.setTypeStats）实现（同原来的科技规则包 D-154）
import type { RuleContext, StatPatch, TypeSpec } from "../../src/core/types.ts"
import { siegeTypes } from "../common/siege.ts"
import type { TechId } from "./objectives.ts"

interface Tech {
  name: string
  /** 加成说明（战况、RULES.md 用） */
  text: string
  /** 改哪类单位的什么数值（改成多少） */
  patches: Record<string, StatPatch>
}

export const TECHS: Record<TechId, Tech> = {
  forge: { name: "铁匠铺", text: "枪兵伤害 8 → 10、骑兵 10 → 13", patches: { spearman: { attack: { damage: 10 } }, cavalry: { attack: { damage: 13 } } } },
  armory: { name: "护甲坊", text: "枪兵生命 110 → 140、骑兵 160 → 200、线列步兵 95 → 120", patches: { spearman: { maxHp: 140 }, cavalry: { maxHp: 200 }, musketeer: { maxHp: 120 } } },
  range: { name: "靶场", text: "弓兵射程 4 → 5、视野 7 → 8，线列步兵命中 50% → 65%", patches: { archer: { attack: { range: 5 }, sight: 8 }, musketeer: { attack: { accuracy: 65 } } } },
  mining: { name: "矿业所", text: "工人每 4 tick 采 1 金（原来 5 tick）、最多带 6（原来 5）", patches: { worker: { gather: { ticks: 4, capacity: 6 } } } },
}
export const TECH_IDS = Object.keys(TECHS) as TechId[]
const isTech = (type: string): type is TechId => TECH_IDS.includes(type as TechId)

/** 火药科技的单位和建筑（每次返回新对象） */
export function gunpowderTypes(): Record<string, TypeSpec> {
  const t = siegeTypes()
  // 线列步兵（D-257，用户：攻击比弓兵高很多、射程少一格、命中率 50% 左右，打偏可能打中旁边一格；数值我定）
  t.musketeer = {
    kind: "unit",
    maxHp: 95,
    cost: { gold: 85 },
    buildTicks: 60,
    moveTicks: 4,
    sight: 6,
    attack: { damage: 30, range: 3, cooldown: 16, accuracy: 50, vs: { spearman: 1.5, cannon: 0.5, wall: 0.25, tower: 0.25, base: 0.25 } },
    look: { shape: "triangle", label: "铳", name: "线列步兵" },
  }
  // 骑兵冲进火枪阵 ×1.5（线列步兵装填慢、近身吃亏）；弓兵射得远、射得快，打线列步兵 ×1.5（不然「枪兵在前、火枪在后」的方阵没有克星，参考 bot 联赛里火枪方阵赢 92%）
  t.cavalry = { ...t.cavalry, attack: { ...t.cavalry.attack!, vs: { ...t.cavalry.attack!.vs, musketeer: 1.5 } } }
  t.archer = { ...t.archer, attack: { ...t.archer.attack!, vs: { ...t.archer.attack!.vs, musketeer: 1.5 } } }
  t.barracks = { ...t.barracks, produces: ["spearman", "archer", "cavalry"] }
  // 箭塔工作量 200 → 400（D-260，用户：塔爆在参考联赛里一家独大）
  t.tower = { ...t.tower, buildTicks: 400 }
  const building = (name: string, label: string, gold: number, buildTicks: number, maxHp: number, produces?: string[]): TypeSpec => ({
    kind: "building",
    w: 2,
    h: 2,
    maxHp,
    cost: { gold },
    buildTicks,
    sight: 4,
    ...(produces ? { produces } : {}),
    look: { shape: "hex", label, name },
  })
  t.gunworks = building("火药工坊", "火", 150, 200, 700, ["musketeer", "cannon"])
  t.forge = building("铁匠铺", "锻", 150, 240, 600)
  t.armory = building("护甲坊", "甲", 150, 240, 600)
  t.range = building("靶场", "靶", 125, 200, 500)
  t.mining = building("矿业所", "矿", 100, 150, 450)
  t.worker = { ...t.worker, builds: [...(t.worker.builds ?? []), "gunworks", ...TECH_IDS] }
  return t
}

/** 科技改到的数值的原值（关掉加成时改回去用） */
function baseOf(types: Record<string, TypeSpec>, type: string, p: StatPatch): StatPatch {
  const s = types[type]
  const out: StatPatch = {}
  if (p.maxHp !== undefined) out.maxHp = s.maxHp
  if (p.moveTicks !== undefined) out.moveTicks = s.moveTicks
  if (p.sight !== undefined) out.sight = s.sight
  if (p.attack && s.attack) out.attack = Object.fromEntries(Object.keys(p.attack).map((k) => [k, s.attack![k as keyof typeof s.attack]]))
  if (p.gather && s.gather) out.gather = Object.fromEntries(Object.keys(p.gather).map((k) => [k, s.gather![k as keyof typeof s.gather]]))
  return out
}

function merge(a: StatPatch, b: StatPatch): StatPatch {
  return { ...a, ...b, ...(a.attack || b.attack ? { attack: { ...a.attack, ...b.attack } } : {}), ...(a.gather || b.gather ? { gather: { ...a.gather, ...b.gather } } : {}) }
}

/** 每个玩家现在生效的科技（一局的状态，setup 时清空） */
let active: Set<TechId>[] = []

export function resetTechs(): void {
  active = []
}

export function activeTechs(player: number): TechId[] {
  return TECH_IDS.filter((t) => active[player]?.has(t))
}

/** 按玩家现在有的科技重设他各类单位的数值：科技改到的每一项，有这个科技就是加成后的值，没有就是原值 */
function applyTechs(ctx: RuleContext, types: Record<string, TypeSpec>, p: number, have: Set<TechId>): void {
  const want = new Map<string, StatPatch>()
  for (const id of TECH_IDS)
    for (const [type, patch] of Object.entries(TECHS[id].patches)) want.set(type, merge(want.get(type) ?? {}, have.has(id) ? patch : baseOf(types, type, patch)))
  for (const [type, patch] of want) ctx.setTypeStats(p, type, patch)
}

/** 每 tick：建好、被拆的科技建筑变了就重设数值，战况里写一句 */
export function updateTechs(ctx: RuleContext, types: Record<string, TypeSpec>): void {
  const now = ctx.players.map(() => new Set<TechId>())
  for (const e of ctx.entities({ kind: "building" })) if (e.owner >= 0 && isTech(e.type) && !e.construction) now[e.owner].add(e.type)
  for (const p of ctx.players) {
    const before = active[p.id] ?? new Set<TechId>()
    const gained = TECH_IDS.filter((t) => now[p.id].has(t) && !before.has(t))
    const lost = TECH_IDS.filter((t) => !now[p.id].has(t) && before.has(t))
    if (gained.length === 0 && lost.length === 0) continue
    for (const t of gained) ctx.note(`P${p.id} 的${TECHS[t].name}建好了：${TECHS[t].text}`, p.id)
    for (const t of lost) ctx.note(`P${p.id} 没有${TECHS[t].name}了，加成取消（${TECHS[t].text}）`, p.id)
    applyTechs(ctx, types, p.id, now[p.id])
  }
  active = now
}

/** 状态栏里一家的科技 */
export function techText(player: number): string {
  const have = activeTechs(player)
  return have.length ? have.map((t) => TECHS[t].name).join("、") : "无"
}
