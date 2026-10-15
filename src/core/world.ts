// 世界状态：地形、实体、占位、视野；同时实现规则包用的 SetupContext 和 RuleContext
import type { Game, GameEvent, PlayerInfo, ResearchDef, TypeDef } from "../api/bot-api.ts"
import { resetOrder } from "./commands.ts"
import { FlowCache } from "./nav.ts"
import { PathFinder } from "./path.ts"
import { markSight, rectSeen } from "./vision.ts"
import { Mulberry32, mixSeed } from "./rng.ts"
import type {
  BuffSpec,
  CastInfo,
  EntityFilter,
  EntityState,
  Marker,
  MatchResult,
  NeutralOrder,
  PlayerState,
  Rect,
  Rng,
  RuleContext,
  RuleEvent,
  RuleFx,
  ResearchSpec,
  Ruleset,
  SetupContext,
  StatDiff,
  StatPatch,
  TypeSpec,
} from "./types.ts"

/** 每个玩家等着交给 bot 的事件上限，超出后丢弃新的 damaged 事件 */
const PENDING_SOFT_CAP = 200

export function resolveType(name: string, s: TypeSpec): TypeDef {
  return {
    name,
    kind: s.kind,
    w: s.w ?? 1,
    h: s.h ?? 1,
    maxHp: s.kind === "resource" ? 0 : (s.maxHp ?? 0),
    cost: s.cost ?? {},
    buildTicks: s.buildTicks ?? 0,
    moveTicks: s.kind === "unit" ? (s.moveTicks ?? 0) : 0,
    sight: s.sight ?? 0,
    attack: s.attack ?? null,
    gather: s.gather ?? null,
    dropOff: s.dropOff ?? false,
    produces: s.produces ?? [],
    parallel: s.parallel ?? 1,
    builds: s.kind === "unit" ? (s.builds ?? []) : [],
    resource: s.resource ?? null,
    skills: (s.skills ?? []).map((k) => ({ id: k.id, name: k.name, cooldown: k.cooldown, initialCooldown: k.initialCooldown ?? 0, target: k.target ?? "none", range: k.range ?? 0, cost: { ...(k.cost ?? {}) }, situational: k.situational ?? false, energy: k.energy ?? 0, requires: k.requires ?? null, desc: k.desc })),
    auras: (s.auras ?? []).map((a) => ({
      name: a.name,
      radius: a.radius ?? -1,
      affects: a.affects ?? "own",
      types: a.types ?? [],
      self: a.self ?? false,
      damagePct: a.damagePct ?? 0,
      defensePct: a.defensePct ?? 0,
    })),
    passives: (s.passives ?? []).map((x) => ({ ...x })),
    layer: s.kind === "unit" ? (s.layer ?? "ground") : "ground",
    detect: s.detect ?? 0,
    // 建筑也能有几种状态（D-270：起飞、降落）
    modes:
      s.kind !== "resource"
        ? (s.modes ?? []).map((m, i) => ({
            id: m.id,
            name: m.name,
            switchTicks: m.switchTicks ?? 0,
            moveTicks: i === 0 || m.moveTicks === undefined ? (s.moveTicks ?? 0) : m.moveTicks,
            sight: i === 0 || m.sight === undefined ? (s.sight ?? 0) : m.sight,
            attack: i === 0 || m.attack === undefined ? (s.attack ?? null) : m.attack,
            layer: i === 0 || m.layer === undefined ? (s.layer ?? "ground") : m.layer,
          }))
        : [],
    garrison: s.kind === "building" && s.garrison ? { capacity: s.garrison.capacity, types: s.garrison.types ?? [], rangeBonus: s.garrison.rangeBonus ?? 0 } : null,
    armor: s.armor ?? 0,
    tags: s.tags ?? [],
    requires: s.requires ?? [],
    needsAddon: s.needsAddon ?? null,
    addons: s.kind === "building" ? (s.addons ?? []) : [],
    addon: s.kind === "building" && s.addon ? { parallel: s.addon.parallel ?? 1 } : null,
    researches: s.kind === "building" ? (s.researches ?? []) : [],
    energy: s.energy && s.kind !== "resource" ? { max: s.energy.max, start: s.energy.start ?? Math.floor(s.energy.max / 2), regenTicks: s.energy.regenTicks ?? 8 } : null,
    heal: s.heal && s.kind !== "resource" ? { amount: s.heal.amount, range: s.heal.range, cooldown: s.heal.cooldown, energy: s.heal.energy ?? 0, tags: s.heal.tags } : null,
    repair: s.repair && s.kind === "unit" ? { tags: s.repair.tags, buildings: s.repair.buildings ?? true, costPct: s.repair.costPct ?? 25 } : null,
    lifetime: s.kind === "unit" ? (s.lifetime ?? 0) : 0,
  }
}

/** 规则包写的研究补上默认值（D-270） */
export function resolveResearch(id: string, r: ResearchSpec): ResearchDef {
  return { id, name: r.name, cost: { ...r.cost }, ticks: r.ticks, requires: r.requires ?? [], effects: r.effects ?? {}, desc: r.desc }
}

/** 换到某个状态（D-269）的数值：moveTicks、sight、attack、layer 换成那个状态的 */
export function modeDef(base: TypeDef, mode: string): TypeDef {
  const m = base.modes.find((x) => x.id === mode)
  if (!m || m === base.modes[0]) return base
  const out = { ...base, moveTicks: m.moveTicks, sight: m.sight, attack: m.attack, layer: m.layer }
  PATCHED.add(out)
  return out
}

/** 攻击能不能打这一层（D-269）：不写 hits 是只打地面；地下的算地面 */
export function hitsLayer(atk: NonNullable<TypeDef["attack"]>, layer: TypeDef["layer"]): boolean {
  return (atk.hits ?? ["ground"]).includes(layer === "air" ? "air" : "ground")
}

/** 增益合计的上下限：伤害最多减到 0，减伤最多 90%（不会无敌） */
export const DMG_PCT_MIN = -100
export const DEF_PCT_MAX = 90

/** 增益合计的移动加快、攻击加快的上下限（D-270） */
export const SPEED_PCT_MIN = -50
export const SPEED_PCT_MAX = 300

/** 加快 pct% 之后的间隔（D-270）：走一格、攻击冷却除以 1 + pct%，四舍五入，至少 1 */
export function hastened(ticks: number, pct: number): number {
  return pct === 0 ? ticks : Math.max(1, Math.round((ticks * 100) / (100 + pct)))
}

/** 增益之后一次攻击的伤害（D-186）：原伤害 ×（1 + 伤害加成）×（1 − 减伤），四舍五入；原伤害大于 0 时至少 1 */
export function buffedDamage(base: number, dmgPct: number, defPct: number): number {
  if (base <= 0 || (dmgPct === 0 && defPct === 0)) return base
  return Math.max(1, Math.round((base * (100 + dmgPct) * (100 - defPct)) / 10_000))
}

/** 两个矩形之间的曼哈顿距离（重叠为 0，贴着为 1） */
export function rectDist(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1))
  const dy = Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1))
  return dx + dy
}

/** 被局中改过数值的类型定义（setTypeStats / setStats 生成的）；没改过的实体用的就是 world.types 里的那一份 */
export const PATCHED = new WeakSet<TypeDef>()

function applyPatch(d: TypeDef, p: StatPatch): TypeDef {
  const out: TypeDef = {
    ...d,
    maxHp: p.maxHp ?? d.maxHp,
    moveTicks: p.moveTicks ?? d.moveTicks,
    sight: p.sight ?? d.sight,
    armor: p.armor ?? d.armor,
    attack: d.attack && p.attack ? { ...d.attack, ...p.attack } : d.attack,
    gather: d.gather && p.gather ? { ...d.gather, ...p.gather } : d.gather,
  }
  PATCHED.add(out)
  return out
}

/** 研究加的数值（D-270，加减）：加完生命、走一格、射程、冷却至少 1，伤害、视野、护甲至少 0；原来没有的能力不会加出来 */
function addDelta(d: TypeDef, p: StatPatch): TypeDef {
  const at = d.attack
  const pa = p.attack
  const g = d.gather
  const pg = p.gather
  const out: TypeDef = {
    ...d,
    maxHp: d.maxHp > 0 && p.maxHp ? Math.max(1, d.maxHp + p.maxHp) : d.maxHp,
    moveTicks: d.moveTicks > 0 && p.moveTicks ? Math.max(1, d.moveTicks + p.moveTicks) : d.moveTicks,
    sight: Math.max(0, d.sight + (p.sight ?? 0)),
    armor: Math.max(0, d.armor + (p.armor ?? 0)),
    attack:
      at && pa
        ? {
            ...at,
            damage: Math.max(0, at.damage + (pa.damage ?? 0)),
            range: Math.max(1, at.range + (pa.range ?? 0)),
            cooldown: Math.max(1, at.cooldown + (pa.cooldown ?? 0)),
            ...(at.accuracy !== undefined ? { accuracy: Math.min(100, Math.max(1, at.accuracy + (pa.accuracy ?? 0))) } : {}),
          }
        : at,
    gather: g && pg ? { ...g, amount: Math.max(1, g.amount + (pg.amount ?? 0)), ticks: Math.max(1, g.ticks + (pg.ticks ?? 0)), capacity: Math.max(1, g.capacity + (pg.capacity ?? 0)) } : g,
  }
  PATCHED.add(out)
  return out
}

/** 两份研究加的数值相加 */
function sumDelta(a: StatPatch, b: StatPatch): StatPatch {
  const out: StatPatch = { ...a }
  for (const k of ["maxHp", "moveTicks", "sight", "armor"] as const) if (b[k] !== undefined) out[k] = (a[k] ?? 0) + b[k]!
  for (const k of ["attack", "gather"] as const) {
    const x = b[k] as Record<string, number> | undefined
    if (!x) continue
    const y: Record<string, number> = { ...(a[k] as Record<string, number> | undefined) }
    for (const [kk, v] of Object.entries(x)) y[kk] = (y[kk] ?? 0) + v
    ;(out as Record<string, unknown>)[k] = y
  }
  return out
}

function mergePatch(a: StatPatch, b: StatPatch): StatPatch {
  const out: StatPatch = { ...a, ...b }
  if (a.attack || b.attack) out.attack = { ...a.attack, ...b.attack }
  if (a.gather || b.gather) out.gather = { ...a.gather, ...b.gather }
  return out
}

/** 检查规则包给的数值改动（字段、取值范围、这类实体有没有这项能力），返回只含认识字段的副本 */
export function checkPatch(base: TypeDef, p: unknown, what: string): StatPatch {
  if (p === null || typeof p !== "object" || Array.isArray(p)) throw new Error(`${what}：要改的数值要写成对象，比如 { attack: { damage: 13 } }`)
  const o = p as Record<string, unknown>
  const KEYS = ["maxHp", "moveTicks", "sight", "armor", "attack", "gather"]
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) throw new Error(`${what}：不能改 ${k}（能改的是 ${KEYS.join("、")}）`)
  const int = (v: unknown, name: string, min: number, max: number): number => {
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new Error(`${what}：${name} 要是 ${min}～${max} 的整数（现在是 ${JSON.stringify(v)}）`)
    return v as number
  }
  const out: StatPatch = {}
  if (o.maxHp !== undefined) {
    if (base.kind === "resource" || base.maxHp <= 0) throw new Error(`${what}：${base.name} 没有生命（资源点或无敌），不能改 maxHp`)
    out.maxHp = int(o.maxHp, "maxHp", 1, 1_000_000)
  }
  if (o.moveTicks !== undefined) {
    if (base.moveTicks <= 0) throw new Error(`${what}：${base.name} 不能移动，不能改 moveTicks`)
    out.moveTicks = int(o.moveTicks, "moveTicks", 1, 1000)
  }
  if (o.sight !== undefined) out.sight = int(o.sight, "sight", 0, 50)
  if (o.armor !== undefined) out.armor = int(o.armor, "armor", 0, 1000)
  const sub = (v: unknown, name: string, fields: Record<string, [number, number]>): Record<string, number> => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what}：${name} 要写成对象`)
    const r: Record<string, number> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!(k in fields)) throw new Error(`${what}：${name} 里不能改 ${k}（能改的是 ${Object.keys(fields).join("、")}）`)
      r[k] = int(x, `${name}.${k}`, fields[k][0], fields[k][1])
    }
    return r
  }
  if (o.attack !== undefined) {
    if (!base.attack) throw new Error(`${what}：${base.name} 不能攻击，不能改 attack`)
    out.attack = sub(o.attack, "attack", { damage: [0, 100_000], range: [1, 30], cooldown: [1, 10_000], accuracy: [1, 100] })
    if (out.attack.accuracy !== undefined && base.attack.accuracy === undefined) throw new Error(`${what}：${base.name} 没有命中率（attack.accuracy），不能改`)
  }
  if (o.gather !== undefined) {
    if (!base.gather) throw new Error(`${what}：${base.name} 不能采集，不能改 gather`)
    out.gather = sub(o.gather, "gather", { amount: [1, 10_000], ticks: [1, 10_000], capacity: [1, 100_000] })
  }
  return out
}

/** 实体现在的数值和它类型原值不一样的项（bot 视图的 stats、回放的 st 用） */
export function statDiff(d: TypeDef, base: TypeDef): StatDiff | undefined {
  if (d === base) return undefined
  const o: StatDiff = {}
  if (d.maxHp !== base.maxHp) o.maxHp = d.maxHp
  if (d.moveTicks !== base.moveTicks) o.moveTicks = d.moveTicks
  if (d.sight !== base.sight) o.sight = d.sight
  if (d.armor !== base.armor) o.armor = d.armor
  const a = d.attack
  const b = base.attack
  if (a && b && (a.damage !== b.damage || a.range !== b.range || a.cooldown !== b.cooldown || a.accuracy !== b.accuracy))
    o.attack = { damage: a.damage, range: a.range, cooldown: a.cooldown, ...(a.accuracy !== undefined ? { accuracy: a.accuracy } : {}) }
  const g = d.gather
  const h = base.gather
  if (g && h && (g.amount !== h.amount || g.ticks !== h.ticks || g.capacity !== h.capacity)) o.gather = { amount: g.amount, ticks: g.ticks, capacity: g.capacity }
  return Object.keys(o).length ? o : undefined
}

export function attackable(e: EntityState): boolean {
  return e.def.kind !== "resource" && e.def.maxHp > 0 && e.inside === 0
}

export class World implements SetupContext, RuleContext {
  readonly rules: Ruleset
  readonly types: Record<string, TypeDef> = {}
  readonly seed: number
  readonly playerCount: number
  /** 规则包用的随机数 */
  readonly rng: Rng
  /** 内核用的随机数（移动先后顺序） */
  readonly simRng: Rng
  tick = 0
  /** 最近一次结算（sim.step）是第几 tick：等于 tick 说明这一 tick 已经结算过（在 onTick 里），下一次结算是 tick + 1 */
  lastStep = 0
  width = 0
  height = 0
  terrain: string[] = []
  /** 规则包 remove 掉、回放还没记下的实体 id（回放用它区分"移除"和"打死"） */
  readonly removed = new Set<number>()
  /** setup 时的提醒（spawnNear 没找到空位），rts-arena check 打印 */
  readonly notes: string[] = []
  /** 地形能否通行 */
  walk = new Uint8Array(0)
  /** 建筑、资源点占的格子（存 id） */
  staticOcc = new Int32Array(0)
  /** 单位占的格子（存 id） */
  unitOcc = new Int32Array(0)
  /** 按创建先后插入，遍历顺序即创建顺序 */
  readonly ents = new Map<number, EntityState>()
  /**
   * id 随机分配、不重复使用：递增的 id 会让 bot 从自己新单位的 id 跳号推算出对手的产量。
   * 范围随实体数扩大，正常对局 id 都在 7 位以内。
   */
  private idRng: Rng
  private usedIds = new Set<number>()
  readonly players: PlayerState[]
  /** 本 tick 的事件（规则包看） */
  events: RuleEvent[] = []
  /** 本 tick 的攻击 [攻击者, 目标, ...]（回放用） */
  shots: number[] = []
  /** 这一 tick 打偏的落点（D-257）：[攻击方 id, x, y, ...] */
  misses: number[] = []
  markers: Marker[] = []
  status = ""
  /** 每个玩家的视野格（tick 开始时算） */
  vis: Uint8Array[] = []
  /** 每个玩家（按队伍共用）的探测格（D-269，有地下单位的规则包才算） */
  det: Uint8Array[] = []
  /** 规则包里有没有空中、地下的单位，有没有几种状态、能驻扎的（没有的话相关的结算都跳过） */
  readonly hasOffGrid: boolean
  readonly hasUnder: boolean
  readonly hasModes: boolean
  readonly hasGarrison: boolean
  /** 有没有能量、治疗、修理、挂件（D-270，没有的话相关的结算都跳过） */
  readonly hasEnergy: boolean
  readonly hasHeal: boolean
  readonly hasRepair: boolean
  readonly hasAddons: boolean
  /** 能研究的东西（D-270） */
  readonly researches: Record<string, ResearchDef> = {}
  /** 这一 tick 研究好的 [玩家, 研究 id, ...]（回放用；记下后清空） */
  researchedNow: (number | string)[] = []
  /** 对局循环这一 tick 已经清空过 events、shots（执行命令之前）：结算时接着往里加，执行命令时发生的事规则包也看得到（D-270） */
  freshTick = false
  /** 限时存在的实体（D-270，召唤物）的 id */
  readonly timed = new Set<number>()
  /** 修理攒下的不到 1 点的生命（D-270，按被修的实体 id） */
  private repairFrac = new Map<number, number>()
  pf!: PathFinder
  flow!: FlowCache
  /** 建筑、资源点每增减一次加 1，流场缓存据此作废 */
  staticVersion = 0

  /** 每个玩家的队伍编号 */
  readonly teams: number[]
  /** setTypeStats 的改动，键是 "玩家|类型"（D-153） */
  private typePatches = new Map<string, StatPatch>()
  /** 研究加的数值，键是 "玩家|类型"（D-270，加减，叠在每个状态上、在 setTypeStats 之前） */
  private researchDelta = new Map<string, StatPatch>()
  /** setStats 的改动，键是实体 id */
  private entPatches = new Map<number, StatPatch>()
  /** 按 "玩家|类型" 算好的数值（setTypeStats 改了就作废） */
  private defCache = new Map<string, TypeDef>()

  // ---------- 技能、光环、被动（D-186） ----------
  /** 规则包 addBuff 加的增益：实体 id → 名字 → 数值和到期的 tick（null 是一直有效） */
  readonly ruleBuffs = new Map<number, Map<string, { damagePct: number; defensePct: number; speedPct: number; ratePct: number; until: number | null }>>()
  /** 有没有带光环的类型（没有就不用每 tick 算光环） */
  readonly hasAuras: boolean
  /** 有没有带技能或被动的类型 */
  readonly hasSkills: boolean
  readonly hasPassives: boolean
  /** 这一 tick 放成功的技能（回放、规则包的 cast 事件用；记下回放后清空） */
  casts: CastInfo[] = []
  /** 这一 tick 被动回血的 [id, 回了多少, ...]（回放用；记下后清空） */
  heals: number[] = []
  /** 这一 tick 规则包放的画面特效（D-205） */
  fx: RuleFx[] = []
  /** 上一 tick 身上有增益的实体（这一 tick 没有了要清掉） */
  buffed = new Set<number>()

  constructor(rules: Ruleset, names: string[], seed: number, teams?: number[]) {
    this.rules = rules
    this.seed = seed
    this.playerCount = names.length
    if (teams && teams.length !== names.length) throw new Error(`队伍编号有 ${teams.length} 个，玩家有 ${names.length} 个`)
    this.teams = teams ? [...teams] : names.map((_, i) => i)
    this.rng = new Mulberry32(mixSeed(seed, "rules"))
    this.simRng = new Mulberry32(mixSeed(seed, "sim"))
    this.idRng = new Mulberry32(mixSeed(seed, "ids"))
    for (const [name, spec] of Object.entries(rules.types)) this.types[name] = resolveType(name, spec)
    for (const d of Object.values(this.types))
      for (const b of d.builds)
        if (this.types[b]?.kind !== "building") throw new Error(`规则包 ${rules.id}：${d.name} 的 builds 里 "${b}" 不是建筑类型`)
    const defs = Object.values(this.types)
    this.hasAuras = defs.some((d) => d.auras.length > 0)
    this.hasSkills = defs.some((d) => d.skills.length > 0)
    this.hasPassives = defs.some((d) => d.passives.length > 0)
    const layers = defs.flatMap((d) => [d.layer, ...d.modes.map((m) => m.layer)])
    this.hasOffGrid = layers.some((l) => l !== "ground")
    this.hasUnder = layers.includes("under")
    this.hasModes = defs.some((d) => d.modes.length > 0)
    this.hasGarrison = defs.some((d) => d.garrison !== null)
    this.hasEnergy = defs.some((d) => d.energy !== null)
    this.hasHeal = defs.some((d) => d.heal !== null)
    this.hasRepair = defs.some((d) => d.repair !== null)
    this.hasAddons = defs.some((d) => d.addons.length > 0)
    for (const [id, r] of Object.entries(rules.researches ?? {})) this.researches[id] = resolveResearch(id, r)
    this.players = names.map((name, id) => ({
      id,
      name,
      alive: true,
      score: 0,
      resources: Object.fromEntries(rules.resources.map((r) => [r, 0])),
      // 每人各记各的（D-248、D-249）：同队共用一份资源时靠它们分清谁挣的、谁花的
      gathered: Object.fromEntries(rules.resources.map((r) => [r, 0])),
      spent: Object.fromEntries(rules.resources.map((r) => [r, 0])),
      researched: [],
      pending: [],
      repairDebt: {},
    }))
    // 同队共用一份资源（D-245）：队友的 resources 指向同一个对象，扣钱、交货、规则包加钱都算在一起，同一 tick 两个队友也花不超
    if (rules.sharedResources) for (const p of this.players) p.resources = this.players[this.teams.indexOf(this.teams[p.id])].resources
  }

  get maxTicks(): number {
    return this.rules.maxTicks
  }

  // ---------- 地形与占位 ----------

  setTerrain(rows: string[]): void {
    if (rows.length === 0 || rows[0].length === 0) throw new Error("地图不能为空")
    const w = rows[0].length
    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error(`地图第 ${y} 行长度 ${row.length}，应为 ${w}`)
      for (const ch of row) if (!this.rules.terrain[ch]) throw new Error(`地图第 ${y} 行有未定义的地形字符 "${ch}"`)
    })
    this.width = w
    this.height = rows.length
    this.terrain = rows.slice()
    const n = w * rows.length
    this.walk = new Uint8Array(n)
    this.staticOcc = new Int32Array(n)
    this.unitOcc = new Int32Array(n)
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < w; x++) this.walk[y * w + x] = this.rules.terrain[rows[y][x]].walkable ? 1 : 0
    this.pf = new PathFinder(w, this.height)
    this.flow = new FlowCache(this)
    this.staticVersion++
    // 视野按队伍算：同队的玩家共用一张视野格
    const byTeam = new Map<number, Uint8Array>()
    this.vis = this.players.map((p) => {
      const t = this.teams[p.id]
      if (!byTeam.has(t)) byTeam.set(t, new Uint8Array(n))
      return byTeam.get(t)!
    })
    const detByTeam = new Map<number, Uint8Array>()
    this.det = this.players.map((p) => {
      const t = this.teams[p.id]
      if (!detByTeam.has(t)) detByTeam.set(t, new Uint8Array(n))
      return detByTeam.get(t)!
    })
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** 地形可走且没有建筑、资源点 */
  staticFree(i: number): boolean {
    return this.walk[i] === 1 && this.staticOcc[i] === 0
  }

  canPlace(def: TypeDef, x: number, y: number): boolean {
    // 空中单位（D-269）、飞起来的建筑（D-270）：只要整个占地在地图里
    if (def.layer === "air") return this.inBounds(x, y) && this.inBounds(x + def.w - 1, y + def.h - 1)
    for (let yy = y; yy < y + def.h; yy++)
      for (let xx = x; xx < x + def.w; xx++) {
        if (!this.inBounds(xx, yy)) return false
        const i = yy * this.width + xx
        if (!this.staticFree(i) || this.unitOcc[i] !== 0) return false
      }
    return true
  }

  /** 占不占地面的格子（D-269）：空中、地下的单位，飞起来的建筑（D-270），驻扎在建筑里的单位不占 */
  onGrid(e: EntityState): boolean {
    return e.def.layer === "ground" && e.inside === 0
  }

  private occupy(e: EntityState, val: number): void {
    if (!this.onGrid(e)) return
    if (e.def.kind !== "unit") this.staticVersion++
    const grid = e.def.kind === "unit" ? this.unitOcc : this.staticOcc
    for (let yy = e.y; yy < e.y + e.h; yy++)
      for (let xx = e.x; xx < e.x + e.w; xx++) grid[yy * this.width + xx] = val
  }

  /** 把单位挪到左上角是 to 这一格（大型单位整块挪；空中、地下的不占格子，只改位置） */
  moveUnit(e: EntityState, to: number): void {
    this.occupy(e, 0)
    e.x = to % this.width
    e.y = (to - e.x) / this.width
    this.occupy(e, e.id)
  }

  /** 地面单位能不能站到左上角 (x, y)：占地都在图里、地形能走、没有建筑，也没有别的单位（自己占着的格子不算） */
  footFree(e: EntityState, x: number, y: number): boolean {
    for (let yy = y; yy < y + e.h; yy++)
      for (let xx = x; xx < x + e.w; xx++) {
        if (!this.inBounds(xx, yy)) return false
        const i = yy * this.width + xx
        if (!this.staticFree(i)) return false
        const u = this.unitOcc[i]
        if (u !== 0 && u !== e.id) return false
      }
    return true
  }

  // ---------- 实体 ----------

  private create(type: string, owner: number, x: number, y: number, amount?: number, lifetime?: number): EntityState {
    const def = this.types[type]
    if (!def) throw new Error(`未定义的实体类型 "${type}"`)
    if (owner < -1 || owner >= this.playerCount || !Number.isInteger(owner)) throw new Error(`玩家编号 ${owner} 不存在`)
    const e: EntityState = {
      id: this.newId(),
      type,
      def: this.defFor(owner, type),
      owner,
      x,
      y,
      w: def.w,
      h: def.h,
      hp: this.defFor(owner, type).maxHp,
      amount: def.kind === "resource" ? (amount ?? this.rules.types[type].amount ?? 0) : 0,
      order: { kind: "idle" },
      carrying: null,
      queue: [],
      construction: null,
      attackCd: 0,
      moveCd: 0,
      gatherCd: 0,
      lastHitBy: -1,
      lastHitNeutral: false,
      lastHitType: "",
      path: [],
      pathKey: "",
      planX: 0,
      planY: 0,
      stuck: 0,
      want: -1,
      alive: true,
      buffs: [],
      skillCooldowns: Object.fromEntries(def.skills.map((k) => [k.id, k.initialCooldown])),
      dmgPct: 0,
      defPct: 0,
      lastCombat: -1_000_000,
      stunUntil: 0,
      mode: def.modes[0]?.id ?? "",
      switchTo: null,
      switchLeft: 0,
      inside: 0,
      cargo: [],
      energy: def.energy?.start ?? 0,
      energyCd: 0,
      healCd: 0,
      addon: 0,
      host: 0,
      addonSite: 0,
      speedPct: 0,
      ratePct: 0,
      expires: 0,
    }
    const life = lifetime ?? def.lifetime
    if (life > 0) {
      e.expires = this.tick + life
      this.timed.add(e.id)
    }
    this.ents.set(e.id, e)
    this.occupy(e, e.id)
    return e
  }

  private newId(): number {
    const range = Math.max(1_000_000, this.usedIds.size * 4)
    for (;;) {
      const id = 1 + this.idRng.int(range - 1)
      if (this.usedIds.has(id)) continue
      this.usedIds.add(id)
      return id
    }
  }

  spawn(type: string, owner: number, x: number, y: number, opts?: { amount?: number }): number {
    const def = this.types[type]
    if (!def) throw new Error(`未定义的实体类型 "${type}"`)
    if (!this.canPlace(def, x, y)) throw new Error(`${type} 放不到 (${x}, ${y})：越界、地形不可走或已被占`)
    return this.create(type, owner, x, y, opts?.amount).id
  }

  /** 生产出来的单位、规则包刷出来的实体都走这里，会发 created 事件 */
  spawnLive(type: string, owner: number, x: number, y: number, amount?: number, lifetime?: number): EntityState {
    const e = this.create(type, owner, x, y, amount, lifetime)
    this.events.push({ kind: "created", id: e.id, type, owner })
    if (owner >= 0) this.pushEvent(owner, { kind: "created", tick: this.tick, id: e.id, type })
    return e
  }

  /** 放下地基：生命从 1/10 开始，随建造进度涨到满（被打掉的不补） */
  placeSite(type: string, owner: number, x: number, y: number): EntityState {
    const e = this.spawnLive(type, owner, x, y)
    e.construction = { done: 0, total: Math.max(1, e.def.buildTicks) }
    e.hp = Math.max(1, Math.ceil(e.def.maxHp / 10))
    return e
  }

  /** 实体死亡或被移除：发事件、清占位 */
  destroy(e: EntityState, killer: number, removed = false, byNeutral = false): void {
    if (!e.alive) return
    e.alive = false
    this.occupy(e, 0)
    this.ents.delete(e.id)
    // 驻扎（D-269）：在里面的被放到旁边（建筑的占地已经空出来了），放不下的跟着死；自己在里面的从建筑里拿掉
    if (e.inside) {
      const b = this.ents.get(e.inside)
      if (b) b.cargo = b.cargo.filter((id) => id !== e.id)
    }
    for (const id of e.cargo.splice(0)) {
      const u = this.ents.get(id)
      if (!u) continue
      if (!this.unboard(u, e)) {
        u.inside = 0
        u.lastHitBy = e.lastHitBy
        u.lastHitNeutral = e.lastHitNeutral
        u.lastHitType = e.lastHitType
        this.destroy(u, killer, removed, byNeutral)
      }
    }
    // 挂件（D-270）：建筑没了，挂着的挂件留在原地（没有主了），正在建的挂件地基跟着没了；挂件没了，建筑上的记录清掉
    if (e.host) {
      const h = this.ents.get(e.host)
      if (h && h.addon === e.id) h.addon = 0
      if (h && h.addonSite === e.id) h.addonSite = 0
    }
    if (e.addon) {
      const a = this.ents.get(e.addon)
      if (a) a.host = 0
    }
    if (e.addonSite) {
      const site = this.ents.get(e.addonSite)
      e.addonSite = 0
      if (site) {
        site.host = 0
        this.destroy(site, -1)
      }
    }
    this.repairFrac.delete(e.id)
    this.timed.delete(e.id)
    this.entPatches.delete(e.id)
    this.ruleBuffs.delete(e.id)
    if (removed) this.removed.add(e.id)
    const flags = { ...(e.construction ? { unfinished: true as const } : {}), ...(removed ? { removed: true as const } : {}) }
    const by = (killer >= 0 || byNeutral) && e.lastHitType ? { killerType: e.lastHitType } : {}
    this.events.push({ kind: "died", id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, killer, ...by, ...flags, ...(byNeutral ? { byNeutral: true as const } : {}) })
    for (const p of this.players) {
      if (p.id === e.owner || this.visibleTo(p.id, e)) this.pushEvent(p.id, { kind: "died", tick: this.tick, id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, ...flags })
    }
  }

  /** 单位钻进建筑（D-269）：不占格子、位置记成建筑左上角，命令变 idle */
  board(u: EntityState, b: EntityState): void {
    this.occupy(u, 0)
    u.inside = b.id
    u.x = b.x
    u.y = b.y
    resetOrder(u, { kind: "idle" })
    b.cargo.push(u.id)
  }

  /** 单位从建筑 b 里出来，放到旁边；放不下返回 false（还在里面） */
  unboard(u: EntityState, b: EntityState): boolean {
    const was = u.inside
    u.inside = 0
    const spot = this.findSpotAround(u.def, b, 4)
    if (!spot) {
      u.inside = was
      return false
    }
    u.x = spot.x
    u.y = spot.y
    this.occupy(u, u.id)
    b.cargo = b.cargo.filter((id) => id !== u.id)
    u.path.length = 0
    u.pathKey = ""
    return true
  }

  /**
   * 让出 r 这块地（D-270，建挂件、建筑降落）：上面自己和盟友能走的 1×1 地面单位挪到旁边。
   * 有别人的、大型的、正在换状态的单位挡着，或者挪不开，返回原因（这时可能已经挪了几个）
   */
  clearFootprint(owner: number, r: Rect): string | null {
    const movers: EntityState[] = []
    for (let yy = r.y; yy < r.y + r.h; yy++)
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        if (!this.inBounds(xx, yy)) continue
        const u = this.ents.get(this.unitOcc[yy * this.width + xx])
        if (!u || movers.includes(u)) continue
        if ((u.owner !== owner && !this.isAlly(owner, u.owner)) || u.def.moveTicks <= 0 || u.w > 1 || u.h > 1 || u.switchTo !== null)
          return `(${xx}, ${yy}) 有 #${u.id}（${u.type}）挡着`
        movers.push(u)
      }
    for (const u of movers) {
      const spot = this.findUnitSpot(r, 6)
      if (!spot) return `#${u.id}（${u.type}）挪不开：旁边没有空位`
      this.moveUnit(u, spot.y * this.width + spot.x)
      u.path.length = 0
      u.pathKey = ""
      u.stuck = 0
      u.want = -1
    }
    return null
  }

  /** 挂件让建筑同时造几个（D-270）：挂着建好的挂件就是挂件的 parallel，和建筑自己的取大的 */
  slotsOf(b: EntityState): number {
    const a = b.addon ? this.ents.get(b.addon) : undefined
    return Math.max(b.def.parallel, a && !a.construction && a.def.addon ? a.def.addon.parallel : 1)
  }

  /** 降落的建筑（D-270）：右边、底边对齐的位置正好有没主的、它能挂的自己的挂件，就挂上 */
  attachAddon(b: EntityState): void {
    if (b.addon || b.def.addons.length === 0) return
    for (const a of this.ents.values()) {
      if (a.owner !== b.owner || a.host || a.construction || !a.def.addon || !b.def.addons.includes(a.type)) continue
      if (a.x !== b.x + b.w || a.y !== b.y + b.h - a.h) continue
      a.host = b.id
      b.addon = a.id
      return
    }
  }

  /** 前置（D-270）：缺哪一样返回原因；建筑类型要有建好的（飞起来的也算），研究 id 要研究好 */
  lacking(player: number, reqs: readonly string[]): string | null {
    for (const r of reqs) {
      const res = this.researches[r]
      if (res) {
        if (!this.players[player].researched.includes(r)) return `要先研究${res.name}（${r}）`
        continue
      }
      let ok = false
      for (const e of this.ents.values())
        if (e.owner === player && e.type === r && !e.construction) {
          ok = true
          break
        }
      if (!ok) return `要先有建好的 ${r}`
    }
    return null
  }

  /** u 能不能修 t（D-270）：不能修返回原因（满血的也算不能修） */
  repairProblem(u: EntityState, t: EntityState): string | null {
    const r = u.def.repair
    if (!r) return `#${u.id}（${u.type}）不能修理`
    if (t === u) return `#${u.id} 不能修自己`
    if (!this.isAlly(u.owner, t.owner)) return `#${t.id}（${t.type}）不是你和盟友的，不能修`
    if (!attackable(t)) return `#${t.id}（${t.type}）不能修（资源点、无敌、驻扎在建筑里）`
    if (t.construction) return `#${t.id}（${t.type}）还没建好：用 build 接着建`
    if (t.def.kind === "building" ? !r.buildings : !t.def.tags.some((x) => r.tags.includes(x)))
      return `#${u.id}（${u.type}）修不了 #${t.id}（${t.type}）：能修${r.buildings ? "建筑和" : ""}带 ${r.tags.join("、")} 标签的单位`
    if (t.hp >= t.def.maxHp) return `#${t.id}（${t.type}）是满血`
    return null
  }

  /**
   * 修一个 tick（D-270）：每个修理的每 tick 修 生命上限 ÷ 造价用时（攒到 1 才加），花造价 × costPct% × 修的比例（攒到 1 才扣）。
   * 钱不够返回 false（这一下不修）
   */
  repairTick(u: EntityState, t: EntityState): boolean {
    const max = t.def.maxHp
    let frac = (this.repairFrac.get(t.id) ?? 0) + max / Math.max(1, t.def.buildTicks)
    const gain = Math.min(Math.floor(frac), max - t.hp)
    if (gain <= 0) {
      this.repairFrac.set(t.id, frac)
      return true
    }
    frac -= gain
    const p = this.players[u.owner]
    const pct = u.def.repair!.costPct
    const owe: [string, number][] = Object.entries(this.types[t.type].cost).map(([r, n]) => [r, (p.repairDebt[r] ?? 0) + ((n ?? 0) * pct * gain) / (100 * max)])
    for (const [r, n] of owe) if (Math.floor(n) > (p.resources[r] ?? 0)) return false
    for (const [r, n] of owe) {
      const pay = Math.floor(n)
      p.resources[r] -= pay
      p.spent[r] += pay
      p.repairDebt[r] = n - pay
    }
    t.hp += gain
    this.repairFrac.set(t.id, t.hp >= max ? 0 : frac)
    this.heals.push(t.id, gain)
    return true
  }

  pushEvent(player: number, ev: GameEvent): void {
    const p = this.players[player]
    if (ev.kind === "damaged" && p.pending.length >= PENDING_SOFT_CAP) return
    p.pending.push(ev)
  }

/**
   * 在矩形周围找能放下 def 的位置。单位（1×1）：从贴着矩形的可走格出发按步数往外找（不会隔墙出生），
   * 最多 maxRing 步；多格实体：按曼哈顿圈找。同样远的选离地图中心最近的，再一样随机挑（对称地图上两边一样）。
   */
  findSpotAround(def: TypeDef, around: Rect, maxRing: number): { x: number; y: number } | null {
    if (def.w === 1 && def.h === 1 && def.layer !== "air") return this.findUnitSpot(around, maxRing)
    const cx2 = this.width - def.w
    const cy2 = this.height - def.h
    const ties: { x: number; y: number }[] = []
    for (let d = 1; d <= maxRing; d++) {
      let bestC = Number.MAX_SAFE_INTEGER
      ties.length = 0
      for (let y = around.y - d - def.h + 1; y <= around.y + around.h - 1 + d; y++)
        for (let x = around.x - d - def.w + 1; x <= around.x + around.w - 1 + d; x++) {
          if (rectDist({ x, y, w: def.w, h: def.h }, around) !== d) continue
          if (!this.canPlace(def, x, y)) continue
          // 到中心的距离（坐标乘 2 免得出现小数）
          const c = Math.abs(2 * x - cx2) + Math.abs(2 * y - cy2)
          if (c < bestC) {
            bestC = c
            ties.length = 0
          }
          if (c === bestC) ties.push({ x, y })
        }
      if (ties.length > 0) return ties.length === 1 ? ties[0] : ties[this.simRng.int(ties.length)]
    }
    return null
  }

  /** 离 (x, y) 曼哈顿距离 1～maxRing 里最近的能放的格子；一样近的选离地图中心近的，再一样随机 */
  private ringSpot(def: TypeDef, x: number, y: number, maxRing: number): { x: number; y: number } | null {
    for (let d = 1; d <= maxRing; d++) {
      let bestC = Number.MAX_SAFE_INTEGER
      const ties: { x: number; y: number }[] = []
      for (let dx = -d; dx <= d; dx++)
        for (const dy of Math.abs(dx) === d ? [0] : [d - Math.abs(dx), -(d - Math.abs(dx))]) {
          const px = x + dx
          const py = y + dy
          if (!this.canPlace(def, px, py)) continue
          const c = Math.abs(2 * px - (this.width - 1)) + Math.abs(2 * py - (this.height - 1))
          if (c < bestC) {
            bestC = c
            ties.length = 0
          }
          if (c === bestC) ties.push({ x: px, y: py })
        }
      if (ties.length > 0) return ties.length === 1 ? ties[0] : ties[this.simRng.int(ties.length)]
    }
    return null
  }

  findUnitSpot(around: Rect, maxRing: number): { x: number; y: number } | null {
    const W = this.width
    const depth = new Map<number, number>()
    let frontier: number[] = []
    for (let y = around.y - 1; y <= around.y + around.h; y++)
      for (let x = around.x - 1; x <= around.x + around.w; x++) {
        if (!this.inBounds(x, y) || rectDist({ x, y, w: 1, h: 1 }, around) !== 1) continue
        const i = y * W + x
        if (!this.staticFree(i)) continue
        depth.set(i, 1)
        frontier.push(i)
      }
    for (let d = 1; d <= maxRing && frontier.length > 0; d++) {
      let bestC = Number.MAX_SAFE_INTEGER
      const ties: number[] = []
      for (const i of frontier) {
        if (this.unitOcc[i] !== 0) continue
        const x = i % W
        const y = (i - x) / W
        const c = Math.abs(2 * x - (W - 1)) + Math.abs(2 * y - (this.height - 1))
        if (c < bestC) {
          bestC = c
          ties.length = 0
        }
        if (c === bestC) ties.push(i)
      }
      if (ties.length > 0) {
        const i = ties.length === 1 ? ties[0] : ties[this.simRng.int(ties.length)]
        return { x: i % W, y: Math.floor(i / W) }
      }
      const next: number[] = []
      for (const i of frontier) {
        const x = i % W
        const y = (i - x) / W
        for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
          if (!this.inBounds(nx, ny)) continue
          const ni = ny * W + nx
          // 不往 around 里面找（挪开挂件、降落占地上的单位时 around 还不是建筑，D-270）
          if (depth.has(ni) || !this.staticFree(ni) || rectDist({ x: nx, y: ny, w: 1, h: 1 }, around) === 0) continue
          depth.set(ni, d + 1)
          next.push(ni)
        }
      }
      frontier = next
    }
    return null
  }

  // ---------- 视野 ----------

  computeVisibility(): void {
    // 驻扎在建筑里的单位从建筑的占地算视野、探测（D-269）
    const rectOf = (e: EntityState) => (e.inside ? (this.ents.get(e.inside) ?? e) : e)
    if (this.hasUnder) {
      for (const d of new Set(this.det)) d.fill(0)
      for (const e of this.ents.values()) if (e.owner >= 0 && e.def.detect > 0 && !e.construction) markSight(this.det[e.owner], this.width, this.height, rectOf(e), e.def.detect)
    }
    if (!this.rules.fog) return
    for (const v of new Set(this.vis)) v.fill(0)
    for (const e of this.ents.values()) if (e.owner >= 0) markSight(this.vis[e.owner], this.width, this.height, rectOf(e), e.def.sight)
  }

  /** player 那一队探测得到 e 吗（D-269：地下的东西要在探测范围里） */
  detectedBy(player: number, e: EntityState): boolean {
    return player >= 0 && rectSeen(this.det[player], this.width, e)
  }

  isAlly(a: number, b: number): boolean {
    return a >= 0 && b >= 0 && this.teams[a] === this.teams[b]
  }

  /** 资源点和地形一样始终可见（位置、储量都公开）；盟友的实体总是看得见，盟友看得见的你也看得见 */
  visibleTo(player: number, e: EntityState): boolean {
    // 中立实体（规则包指挥的野怪）什么都看得见
    if (player < 0 || this.isAlly(e.owner, player) || e.def.kind === "resource") return true
    // 驻扎在建筑里的看不见；地下的要探测到（D-269）
    if (e.inside) return false
    if (e.def.layer === "under" && !this.detectedBy(player, e)) return false
    return !this.rules.fog || rectSeen(this.vis[player], this.width, e)
  }

  // ---------- 给 bot 的静态信息 ----------

  gameInfo(player: number): Game {
    const walkable: Record<string, boolean> = {}
    for (const [ch, t] of Object.entries(this.rules.terrain)) walkable[ch] = t.walkable
    return {
      me: player,
      playerNames: this.players.map((p) => p.name),
      teams: [...this.teams],
      width: this.width,
      height: this.height,
      terrain: this.terrain,
      walkable,
      types: this.types,
      researches: this.researches,
      resources: this.rules.resources,
      maxTicks: this.rules.maxTicks,
      decisionInterval: this.rules.decisionInterval,
      fuel: this.rules.fuel,
      unitCap: this.rules.unitCap,
      fog: this.rules.fog,
    }
  }

  playerInfos(): PlayerInfo[] {
    return this.players.map((p) => ({ id: p.id, name: p.name, team: this.teams[p.id], alive: p.alive, score: p.score }))
  }

  /** 玩家现有单位数 + 生产队列里的单位数 */
  unitCount(player: number): number {
    let n = 0
    for (const e of this.ents.values()) {
      if (e.owner !== player) continue
      // 限时存在的召唤物（D-270）不占单位上限
      if (e.def.kind === "unit" && e.expires === 0) n++
      for (const q of e.queue) if (!q.research && this.types[q.type].kind === "unit" && this.types[q.type].lifetime === 0) n++
    }
    return n
  }

  // ---------- SetupContext / RuleContext ----------

  setResources(player: number, resources: Record<string, number>): void {
    for (const [r, n] of Object.entries(resources)) {
      if (!this.rules.resources.includes(r)) throw new Error(`未定义的资源 "${r}"`)
      this.players[player].resources[r] = n
    }
  }

  /** 按创建顺序 */
  entities(filter?: EntityFilter): readonly EntityState[] {
    const all = [...this.ents.values()]
    if (!filter) return all
    const { owner, type, kind } = filter
    return all.filter((e) => (owner === undefined || e.owner === owner) && (type === undefined || e.type === type) && (kind === undefined || e.def.kind === kind))
  }

  get(id: number): EntityState | undefined {
    return this.ents.get(id)
  }

  dist(a: Rect, b: Rect): number {
    return rectDist(a, b)
  }

  entitiesIn(x: number, y: number, w: number, h: number): EntityState[] {
    const r = { x, y, w, h }
    const out: EntityState[] = []
    for (const e of this.ents.values()) if (rectDist(e, r) === 0) out.push(e)
    return out
  }

  addScore(player: number, n: number): void {
    this.players[player].score += n
  }

  setScore(player: number, n: number): void {
    this.players[player].score = n
  }

  addResource(player: number, resource: string, n: number): void {
    if (!this.rules.resources.includes(resource)) throw new Error(`未定义的资源 "${resource}"`)
    this.players[player].resources[resource] += n
    if (n > 0) this.players[player].gathered[resource] += n
  }

  spawnNear(type: string, owner: number, x: number, y: number, opts?: { amount?: number; lifetime?: number }): number | null {
    const def = this.types[type]
    if (!def) throw new Error(`未定义的实体类型 "${type}"`)
    const life = opts?.lifetime
    if (life !== undefined && (def.kind !== "unit" || !Number.isInteger(life) || life < 1 || life > 100_000)) throw new Error(`spawnNear：lifetime 只能给单位，要是 1～100000 的整数（现在是 ${JSON.stringify(life)}）`)
    if (this.canPlace(def, x, y)) return this.spawnLive(type, owner, x, y, opts?.amount, life).id
    // (x, y) 落在建筑、资源点里：从它的外圈开始找（不然单位从建筑中间一步也走不出去）
    const inside = this.inBounds(x, y) ? this.ents.get(this.staticOcc[y * this.width + x]) : undefined
    const around = inside ? { x: inside.x, y: inside.y, w: inside.w, h: inside.h } : { x, y, w: 1, h: 1 }
    // 单位从不能走的地形（水、墙）里开始找：按距离一圈圈找最近能站的格子（按步数走不出去）
    const blocked = !inside && def.w === 1 && def.h === 1 && (!this.inBounds(x, y) || !this.walk[y * this.width + x])
    const spot = blocked ? this.ringSpot(def, x, y, 8) : this.findSpotAround(def, around, 8)
    if (!spot && this.tick === 0) this.notes.push(`setup 里 spawnNear("${type}", ${owner}, ${x}, ${y}) 没找到空位，返回了 null（这个实体没放下）`)
    return spot ? this.spawnLive(type, owner, spot.x, spot.y, opts?.amount, life).id : null
  }

  remove(id: number): void {
    const e = this.ents.get(id)
    if (e) this.destroy(e, -1, true)
  }

  private mustGet(id: number, what: string): EntityState {
    const e = this.ents.get(id)
    if (!e) throw new Error(`${what}：没有 #${id} 这个实体`)
    return e
  }

  orderNeutral(id: number, order: NeutralOrder): void {
    const e = this.mustGet(id, "orderNeutral")
    if (e.owner !== -1) throw new Error(`orderNeutral 只能指挥中立实体，#${id}（${e.type}）属于 P${e.owner}`)
    const xy = (o: { x: unknown; y: unknown }) => {
      if (!Number.isInteger(o.x) || !Number.isInteger(o.y) || !this.inBounds(o.x as number, o.y as number)) throw new Error(`orderNeutral：坐标 (${o.x}, ${o.y}) 不对`)
    }
    switch (order?.kind) {
      case "move":
      case "attackMove":
        if (e.def.moveTicks <= 0) throw new Error(`orderNeutral：#${id}（${e.type}）不能移动`)
        if (order.kind === "attackMove" && !e.def.attack) throw new Error(`orderNeutral：#${id}（${e.type}）不能攻击`)
        xy(order)
        resetOrder(e, { kind: order.kind, x: order.x, y: order.y })
        return
      case "attack": {
        if (!e.def.attack) throw new Error(`orderNeutral：#${id}（${e.type}）不能攻击`)
        const t = this.mustGet(order.target, "orderNeutral 的目标")
        if (t.owner < 0 || !attackable(t)) throw new Error(`orderNeutral：#${t.id}（${t.type}）不能当目标（中立的、资源点、无敌的都不行）`)
        resetOrder(e, { kind: "attack", target: t.id })
        return
      }
      case "stop":
        resetOrder(e, { kind: "idle" })
        return
      default:
        throw new Error(`orderNeutral：不认识的命令 ${JSON.stringify(order)}（能用 move、attack、attackMove、stop）`)
    }
  }

  setHp(id: number, hp: number): void {
    const e = this.mustGet(id, "setHp")
    if (!attackable(e)) throw new Error(`setHp：#${id}（${e.type}）是资源点或无敌的，没有生命`)
    if (!Number.isFinite(hp)) throw new Error("setHp：生命要是数字")
    if (hp <= 0) this.destroy(e, -1)
    else e.hp = Math.min(e.def.maxHp, Math.round(hp))
  }

  effect(o: { x: number; y: number; w?: number; h?: number; text?: string; color?: string; radius?: number }): void {
    const w = o.w ?? 1
    const h = o.h ?? 1
    for (const [k, v] of [["x", o.x], ["y", o.y], ["w", w], ["h", h]] as const) if (!Number.isInteger(v)) throw new Error(`effect：${k} 要是整数`)
    if (w < 1 || h < 1 || w > 16 || h > 16 || !this.inBounds(o.x, o.y) || !this.inBounds(o.x + w - 1, o.y + h - 1)) throw new Error(`effect：区域 (${o.x}, ${o.y}) ${w}×${h} 不对`)
    if (o.text !== undefined && (typeof o.text !== "string" || [...o.text].length > 12)) throw new Error("effect：text 最多 12 个字")
    if (o.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(o.color))) throw new Error("effect：color 要写成 #rrggbb")
    if (o.radius !== undefined && (!Number.isInteger(o.radius) || o.radius < 1 || o.radius > 24)) throw new Error("effect：radius 要是 1～24 的整数")
    if (this.fx.length >= 50) return
    this.fx.push({ x: o.x, y: o.y, w, h, ...(o.text ? { text: o.text } : {}), ...(o.color ? { color: o.color } : {}), ...(o.radius ? { radius: o.radius } : {}) })
  }

  teleport(id: number, x: number, y: number): void {
    const e = this.mustGet(id, "teleport")
    if (e.def.kind !== "unit") throw new Error(`teleport：#${id}（${e.type}）不是单位，只能挪单位`)
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inBounds(x, y)) throw new Error(`teleport：坐标 (${x}, ${y}) 不对`)
    if (e.x === x && e.y === y) return
    const i = y * this.width + x
    if (!this.staticFree(i) || this.unitOcc[i] !== 0) throw new Error(`teleport：(${x}, ${y}) 站不了（地形不能走或者有实体）`)
    this.moveUnit(e, i)
    // 原来的路线作废，下一 tick 从新位置重新找
    e.path = []
    e.pathKey = ""
    e.stuck = 0
    e.want = -1
  }

  stun(id: number, ticks: number): void {
    const e = this.mustGet(id, "stun")
    if (e.def.kind !== "unit") throw new Error(`stun：#${id}（${e.type}）不是单位，只能眩晕单位`)
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > 600) throw new Error(`stun：ticks 要是 1～600 的整数（现在是 ${JSON.stringify(ticks)}）`)
    e.stunUntil = Math.max(e.stunUntil, this.nextStep() + ticks)
  }

  /** 下一次结算是第几 tick */
  nextStep(): number {
    return this.lastStep === this.tick ? this.tick + 1 : this.tick
  }

  /** 眩晕还挡得住接下来几次结算（0 是没眩晕） */
  stunLeft(e: EntityState): number {
    return Math.max(0, e.stunUntil - this.nextStep())
  }

  setOwner(id: number, owner: number): void {
    const e = this.mustGet(id, "setOwner")
    if (e.def.kind === "resource") throw new Error(`setOwner：#${id} 是资源点，资源点只能是中立的`)
    if (!Number.isInteger(owner) || owner < -1 || owner >= this.playerCount) throw new Error(`setOwner：玩家编号 ${owner} 不存在`)
    if (e.owner === owner) return
    e.owner = owner
    resetOrder(e, { kind: "idle" })
    e.queue.length = 0
    this.refreshDef(e)
  }

  // ---------- 局中改数值（D-153） ----------

  /** 这类实体在某个状态下没被改过的数值（D-269；第一个状态就是 world.types 里那一份） */
  private modeCache = new Map<string, TypeDef>()
  baseDef(type: string, mode: string): TypeDef {
    const base = this.types[type]
    if (!mode || base.modes.length === 0 || mode === base.modes[0].id) return base
    const key = `${type}@${mode}`
    let d = this.modeCache.get(key)
    if (!d) this.modeCache.set(key, (d = modeDef(base, mode)))
    return d
  }

  /** owner 的 type 类实体（在 mode 状态下）现在的数值（再叠上实体 id 单独的改动） */
  private defFor(owner: number, type: string, id?: number, mode = ""): TypeDef {
    const base = this.baseDef(type, mode)
    const key = `${owner}|${type}|${mode}`
    let d = base
    const tp = this.typePatches.get(`${owner}|${type}`)
    const rd = this.researchDelta.get(`${owner}|${type}`)
    if (tp || rd) {
      let c = this.defCache.get(key)
      if (!c) {
        c = rd ? addDelta(base, rd) : base
        if (tp) c = applyPatch(c, tp)
      }
      this.defCache.set(key, (d = c))
    }
    const ep = id === undefined ? undefined : this.entPatches.get(id)
    return ep ? applyPatch(d, ep) : d
  }

  /** 换好状态（D-269）：换数值；层变了要改占格（回到地面的那一格被占着时返回 false，等下一 tick 再试） */
  applyMode(e: EntityState, mode: string): boolean {
    const was = this.onGrid(e)
    const next = this.defFor(e.owner, e.type, e.id, mode)
    const landing = !was && next.layer === "ground" && e.inside === 0
    // 建筑降落（D-270）：占地上自己和盟友的小兵挪开
    if (landing && e.def.kind === "building") this.clearFootprint(e.owner, e)
    if (landing && !this.footFree(e, e.x, e.y)) return false
    this.occupy(e, 0)
    e.mode = mode
    this.refreshDef(e)
    this.occupy(e, e.id)
    // 起飞时挂件留在原地，降落到正好的位置又挂上（D-270）
    if (e.def.kind === "building" && e.def.layer === "air" && e.addon) {
      const a = this.ents.get(e.addon)
      if (a) a.host = 0
      e.addon = 0
    } else if (e.def.kind === "building" && landing) this.attachAddon(e)
    return true
  }

  /** 重新算实体的数值；生命上限变大时当前生命加上差值，变小时去掉超出的 */
  private refreshDef(e: EntityState): void {
    const old = e.def.maxHp
    e.def = this.defFor(e.owner, e.type, e.id, e.mode)
    const now = e.def.maxHp
    if (now > old) e.hp = Math.min(now, e.hp + (now - old))
    else if (now < old) e.hp = Math.max(1, Math.min(e.hp, now))
  }

  setTypeStats(player: number, type: string, patch: StatPatch | null): void {
    if (!Number.isInteger(player) || player < -1 || player >= this.playerCount) throw new Error(`setTypeStats：玩家编号 ${player} 不存在（中立写 -1）`)
    const base = this.types[type]
    if (!base) throw new Error(`setTypeStats：未定义的实体类型 "${type}"`)
    const key = `${player}|${type}`
    if (patch === null) this.typePatches.delete(key)
    else {
      const p = checkPatch(base, patch, "setTypeStats")
      const merged = mergePatch(this.typePatches.get(key) ?? {}, p)
      // 只合并检查过的字段；合并后要是和原值完全一样就当没改（实体用回 world.types 那一份）
      if (statDiff(applyPatch(base, merged), base)) this.typePatches.set(key, merged)
      else this.typePatches.delete(key)
    }
    for (const k of [...this.defCache.keys()]) if (k.startsWith(`${key}|`)) this.defCache.delete(k)
    for (const e of this.ents.values()) if (e.owner === player && e.type === type) this.refreshDef(e)
  }

  setStats(id: number, patch: StatPatch | null): void {
    const e = this.mustGet(id, "setStats")
    if (patch === null) this.entPatches.delete(id)
    else {
      const p = checkPatch(this.types[e.type], patch, "setStats")
      this.entPatches.set(id, mergePatch(this.entPatches.get(id) ?? {}, p))
    }
    this.refreshDef(e)
  }

  grantResearch(player: number, id: string): void {
    if (!Number.isInteger(player) || player < 0 || player >= this.playerCount) throw new Error(`grantResearch：玩家编号 ${player} 不存在`)
    const r = this.researches[id]
    if (!r) throw new Error(`grantResearch：没有 "${id}" 这项研究${Object.keys(this.researches).length ? `（有：${Object.keys(this.researches).join("、")}）` : ""}`)
    const p = this.players[player]
    if (p.researched.includes(id)) return
    p.researched.push(id)
    for (const [type, delta] of Object.entries(r.effects)) {
      if (!delta || !this.types[type]) continue
      const key = `${player}|${type}`
      this.researchDelta.set(key, sumDelta(this.researchDelta.get(key) ?? {}, delta as StatPatch))
      for (const k of [...this.defCache.keys()]) if (k.startsWith(`${key}|`)) this.defCache.delete(k)
      for (const e of this.ents.values()) if (e.owner === player && e.type === type) this.refreshDef(e)
    }
    this.researchedNow.push(player, id)
    this.events.push({ kind: "researched", player, id })
    this.pushEvent(player, { kind: "researched", tick: this.tick, id })
  }

  damage(id: number, amount: number, by?: number): void {
    const t = this.mustGet(id, "damage")
    if (!attackable(t)) throw new Error(`damage：#${id}（${t.type}）是资源点、无敌的或者驻扎在建筑里，打不了`)
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) throw new Error(`damage：amount 要是 1～1000000 的整数（现在是 ${JSON.stringify(amount)}）`)
    const a = by === undefined || by === null ? undefined : this.ents.get(by)
    t.hp -= amount
    t.lastCombat = this.tick
    t.lastHitBy = a ? a.owner : -1
    t.lastHitNeutral = a ? a.owner < 0 : false
    t.lastHitType = a ? a.type : ""
    if (a) {
      a.lastCombat = this.tick
      this.shots.push(a.id, t.id)
    }
    if (t.owner >= 0) this.pushEvent(t.owner, { kind: "damaged", tick: this.tick, id: t.id, by: a?.id ?? 0, byOwner: a?.owner ?? -1, byType: a?.type ?? "", damage: amount })
    if (t.hp <= 0) this.destroy(t, t.lastHitBy, false, t.lastHitNeutral)
  }

  eliminate(player: number): void {
    this.players[player].alive = false
  }

  addBuff(id: number, buff: BuffSpec): void {
    const e = this.mustGet(id, "addBuff")
    if (!attackable(e)) throw new Error(`addBuff：#${id}（${e.type}）是资源点或无敌的，不能加增益`)
    if (buff === null || typeof buff !== "object") throw new Error("addBuff：增益要写成 { name, damagePct, defensePct, ticks }")
    const name = buff.name
    if (typeof name !== "string" || name.length === 0 || [...name].length > 12) throw new Error("addBuff：name 要是 1～12 字的字符串")
    const int = (v: unknown, what: string, min: number, max: number): number => {
      if (v === undefined) return 0
      if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new Error(`addBuff：${what} 要是 ${min}～${max} 的整数（现在是 ${JSON.stringify(v)}）`)
      return v as number
    }
    const damagePct = int(buff.damagePct, "damagePct", -100, 1000)
    const defensePct = int(buff.defensePct, "defensePct", -1000, DEF_PCT_MAX)
    const speedPct = int(buff.speedPct, "speedPct", SPEED_PCT_MIN, SPEED_PCT_MAX)
    const ratePct = int(buff.ratePct, "ratePct", SPEED_PCT_MIN, SPEED_PCT_MAX)
    const ticks = buff.ticks === undefined ? null : int(buff.ticks, "ticks", 1, 1_000_000)
    let m = this.ruleBuffs.get(id)
    if (!m) this.ruleBuffs.set(id, (m = new Map()))
    m.set(name, { damagePct, defensePct, speedPct, ratePct, until: ticks === null ? null : this.tick + ticks })
    this.refreshBuffs(e, this.auraOf.get(id) ?? [])
  }

  removeBuff(id: number, name: string): void {
    const e = this.mustGet(id, "removeBuff")
    const m = this.ruleBuffs.get(id)
    if (!m || !m.delete(String(name))) return
    if (m.size === 0) this.ruleBuffs.delete(id)
    this.refreshBuffs(e, this.auraOf.get(id) ?? [])
  }

  setSkillCooldown(id: number, skill: string, ticks: number): void {
    const e = this.mustGet(id, "setSkillCooldown")
    if (!(skill in e.skillCooldowns)) throw new Error(`setSkillCooldown：#${id}（${e.type}）没有技能 "${skill}"${e.def.skills.length ? `（有：${e.def.skills.map((k) => k.id).join("、")}）` : ""}`)
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 1_000_000) throw new Error("setSkillCooldown：ticks 要是 0～1000000 的整数")
    e.skillCooldowns[skill] = ticks
  }

  /** 这一 tick 光环给每个实体的加成（实体 id → 光环名和数值），sim 每 tick 开头算 */
  auraOf = new Map<number, { name: string; damagePct: number; defensePct: number }[]>()

  /** 合并光环和规则包的增益，算出 buffs 和合计的加成 */
  refreshBuffs(e: EntityState, aura: { name: string; damagePct: number; defensePct: number }[]): void {
    const list: EntityState["buffs"] = aura.map((a) => ({ ...a, ticksLeft: null }))
    const rb = this.ruleBuffs.get(e.id)
    if (rb)
      for (const [name, b] of rb)
        list.push({
          name,
          damagePct: b.damagePct,
          defensePct: b.defensePct,
          ...(b.speedPct ? { speedPct: b.speedPct } : {}),
          ...(b.ratePct ? { ratePct: b.ratePct } : {}),
          ticksLeft: b.until === null ? null : Math.max(0, b.until - this.tick),
        })
    e.buffs = list
    let dmg = 0
    let def = 0
    let spd = 0
    let rate = 0
    for (const b of list) {
      dmg += b.damagePct
      def += b.defensePct
      spd += b.speedPct ?? 0
      rate += b.ratePct ?? 0
    }
    e.dmgPct = Math.max(DMG_PCT_MIN, dmg)
    e.defPct = Math.min(DEF_PCT_MAX, def)
    e.speedPct = Math.min(SPEED_PCT_MAX, Math.max(SPEED_PCT_MIN, spd))
    e.ratePct = Math.min(SPEED_PCT_MAX, Math.max(SPEED_PCT_MIN, rate))
    if (list.length) this.buffed.add(e.id)
    else this.buffed.delete(e.id)
  }

  setMarkers(markers: Marker[]): void {
    this.markers = markers
  }

  setStatus(text: string): void {
    this.status = text
  }

  isVisible(player: number, x: number, y: number): boolean {
    if (!this.rules.fog) return true
    if (!this.inBounds(x, y) || !this.vis[player]) return false
    return this.vis[player][y * this.width + x] === 1
  }

  /** 这一 tick 规则包写的事件（回放记下后清空）、整局写了几条 */
  readonly ruleNotes: { p: number; text: string }[] = []
  private noteTotal = 0
  note(text: string, player = -1): void {
    if (this.ruleNotes.length >= 20 || this.noteTotal >= 2000) return
    this.noteTotal++
    this.ruleNotes.push({ p: Number.isInteger(player) && player >= 0 && player < this.players.length ? player : -1, text: String(text).slice(0, 100) })
  }

  // ---------- 结果 ----------

  ended: (MatchResult & { tick: number }) | null = null
}
