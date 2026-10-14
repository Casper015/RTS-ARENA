// 拓荒（frontier）、克制拓荒、攻城拓荒、火药科技共用：地图、开局、单位、击杀价值、胜负判定。
// 原来的科技规则包（D-154）在拓荒的基础上加科技建筑，D-257 删掉，科技建筑并进了火药科技
import type { MatchResult, RuleContext, SetupContext, TypeSpec } from "../../src/core/types.ts"
import { seatCorners } from "./corners.ts"
import {
  baseStarts,
  cornerImage,
  mirror4Terrain,
  randomSymmetricMap,
  spawnMirrored,
  STANDARD_HOME,
  STANDARD_OBSTACLE_CHARS,
  STANDARD_SHAPES,
  STANDARD_TERRAIN,
  standardTypes,
  symmetricTerrain,
} from "./standard.ts"

/** 开局每人的金子（分队共用时整队是人数倍） */
export const START_GOLD = 300
export const FRONTIER_W = 56
export const FRONTIER_H = 40

/** 拓荒的单位：工人能建兵营、箭塔、仓库（每次返回新对象，可以放心改） */
export function frontierTypes(): Record<string, TypeSpec> {
  const t = standardTypes()
  t.worker.builds = ["barracks", "tower", "depot"]
  t.barracks.cost = { gold: 150 }
  t.barracks.buildTicks = 240
  // 箭塔射程 5，比弓手远 1 格；三个战士大约 120 tick 拆掉一座，期间它能打死其中一个
  t.tower = {
    kind: "building",
    maxHp: 450,
    cost: { gold: 100 },
    buildTicks: 200,
    sight: 7,
    attack: { damage: 12, range: 5, cooldown: 10 },
    look: { shape: "square", label: "塔" },
  }
  // 仓库：开分矿用的交货点
  t.depot = {
    kind: "building",
    w: 2,
    h: 2,
    maxHp: 400,
    cost: { gold: 100 },
    buildTicks: 150,
    sight: 4,
    dropOff: true,
    look: { shape: "square", label: "仓" },
  }
  return t
}

/** 拓荒的开局：随机地图、主基地、5 个工人、金矿、300 金 */
export function frontierSetup(ctx: SetupContext, types: Record<string, TypeSpec>): void {
  const W = FRONTIER_W
  const H = FRONTIER_H
  // 地图按种子随机生成（中心对称，两边一样）：家、分矿和把分矿隔开的那道墙固定，别的石墙、水和地图中间的两个矿每局不同；
  // 生成不出合格的地图时用经典布局（D-141 之前的固定地图）
  const FIXED_WALL = { ch: "#", x: 0, y: 16, w: 7, h: 2 }
  const map = randomSymmetricMap(ctx.rng, {
    width: W,
    height: H,
    symmetry: "point",
    base: symmetricTerrain(W, H, ".", [FIXED_WALL]),
    terrain: STANDARD_TERRAIN,
    solid: [
      { x: 2, y: 27, w: 1, h: 1 },
      { x: 4, y: 28, w: 1, h: 1 },
      { x: 2, y: 30, w: 1, h: 1 },
    ],
    // 家；分矿旁边留出建仓库的地方
    keepClear: [STANDARD_HOME, { x: 0, y: 24, w: 9, h: 10 }],
    obstacles: { count: [7, 10], shapes: STANDARD_SHAPES, chars: STANDARD_OBSTACLE_CHARS },
    mines: [{ region: { x: 19, y: 12, w: 10, h: 9 }, offsets: [{ x: 0, y: 0 }, { x: 2, y: -2 }] }],
    connect: [{ x: 7, y: 7 }, { x: 6, y: 28 }],
  })
  ctx.setTerrain(
    map?.terrain ??
      symmetricTerrain(W, H, ".", [
        { ch: "#", x: 15, y: 0, w: 2, h: 8 },
        FIXED_WALL,
        { ch: "#", x: 21, y: 5, w: 4, h: 3 },
        { ch: "#", x: 11, y: 29, w: 3, h: 5 },
        { ch: "#", x: 17, y: 20, w: 4, h: 2 },
        { ch: "~", x: 26, y: 9, w: 4, h: 3 },
      ]),
  )
  spawnMirrored(ctx, W, H, types, [
    { type: "base", owner: 0, x: 3, y: 3 },
    { type: "worker", owner: 0, x: 6, y: 3 },
    { type: "worker", owner: 0, x: 6, y: 4 },
    { type: "worker", owner: 0, x: 6, y: 5 },
    { type: "worker", owner: 0, x: 3, y: 6 },
    { type: "worker", owner: 0, x: 4, y: 6 },
    // 家门口
    { type: "goldmine", owner: -1, x: 1, y: 9 },
    { type: "goldmine", owner: -1, x: 3, y: 9 },
    { type: "goldmine", owner: -1, x: 5, y: 9 },
    { type: "goldmine", owner: -1, x: 9, y: 1 },
    // 分矿：主基地往下绕过石墙，离家远，适合在旁边建仓库
    { type: "goldmine", owner: -1, x: 2, y: 27, amount: 600 },
    { type: "goldmine", owner: -1, x: 4, y: 28, amount: 600 },
    { type: "goldmine", owner: -1, x: 2, y: 30, amount: 600 },
    // 地图中间（随机地图里位置每局不同，见下面）
    ...(map
      ? []
      : [
          { type: "goldmine", owner: -1 as const, x: 25, y: 17, amount: 700 },
          { type: "goldmine", owner: -1 as const, x: 27, y: 15, amount: 700 },
        ]),
  ])
  if (map) for (const m of map.mines) ctx.spawn("goldmine", -1, m.x, m.y, { amount: 700 })
  for (let p = 0; p < ctx.playerCount; p++) ctx.setResources(p, { gold: START_GOLD })
}

/** 击杀价值：建好的建筑是造价的 2 倍，没建好的按造价算；主基地 1000；单位按造价 */
export function killValueOf(types: Record<string, TypeSpec>, type: string, finished: boolean): number {
  if (type === "base") return 1000
  const cost = types[type].cost?.gold ?? 0
  return types[type].kind === "building" && finished ? cost * 2 : cost
}

/** 读这一 tick 的死亡事件，给击杀者加击杀价值（拆自己的地基、盟友的不算）；ignore 里的类型打死的不算（攻城拓荒：主基地开火打死的，D-217） */
export function scoreKills(ctx: RuleContext, types: Record<string, TypeSpec>, ignore: string[] = []): void {
  for (const ev of ctx.events) {
    if (ev.kind === "died" && ev.killer >= 0 && ev.owner >= 0 && ev.killer !== ev.owner && !ctx.isAlly(ev.killer, ev.owner) && !ignore.includes(ev.killerType ?? "")) ctx.addScore(ev.killer, killValueOf(types, ev.type, !ev.unfinished))
  }
}

export function enemyBasesOf(player: number): { owner: number; x: number; y: number }[] {
  return baseStarts(FRONTIER_W, FRONTIER_H).filter((b) => b.owner !== player)
}

export function baseHp(ctx: RuleContext, p: number): number {
  let hp = 0
  for (const e of ctx.entities({ owner: p, type: "base" })) hp += e.hp
  return hp
}

/** 主基地被摧毁的出局，只剩一家就赢 */
export function frontierResult(ctx: RuleContext): MatchResult | null {
  for (const p of ctx.players) if (p.alive && baseHp(ctx, p.id) === 0) ctx.eliminate(p.id)
  const alive = ctx.players.filter((p) => p.alive)
  if (alive.length === 1) return { winner: alive[0].id, reason: "摧毁了对方的主基地" }
  if (alive.length === 0) return { winner: null, reason: "双方主基地同时被摧毁" }
  return null
}

/** 到时间上限：比击杀价值，再比主基地剩余生命 */
export function frontierTimeUp(ctx: RuleContext): MatchResult {
  const [a, b] = ctx.players
  if (a.score !== b.score) return { winner: a.score > b.score ? 0 : 1, reason: `时间到，击杀价值 ${a.score} : ${b.score}` }
  const ha = baseHp(ctx, 0)
  const hb = baseHp(ctx, 1)
  if (ha !== hb) return { winner: ha > hb ? 0 : 1, reason: `时间到，击杀价值相同，主基地剩余生命 ${ha} : ${hb}` }
  return { winner: null, reason: "时间到，击杀价值和主基地生命都相同，平局" }
}

// ---------- 3～4 人的四角地图（D-244，攻城拓荒；D-261 起是 80×56 的长方形，左右、上下都对称） ----------

/** 四角地图的宽、高（D-261，用户：和 2v2 左边一队、右边一队一致，长宽比和两人图 56×40 一样是 7:5） */
export const CORNERS_W = 80
export const CORNERS_H = 56
/** 左上角那一家的开局（主基地、5 个工人），其他角左右、上下翻过去；和两人图的家一样 */
const CORNER_HOME: { type: string; x: number; y: number }[] = [
  { type: "base", x: 3, y: 3 },
  { type: "worker", x: 6, y: 3 },
  { type: "worker", x: 6, y: 4 },
  { type: "worker", x: 6, y: 5 },
  { type: "worker", x: 3, y: 6 },
  { type: "worker", x: 4, y: 6 },
]
/** 每个角的矿（没人坐的角也有）：家门口 4 个、往下绕过石墙的分矿 3 个（600），地图正中翻四次是一个 2×2 的矿群（700） */
const CORNER_MINES: { x: number; y: number; amount?: number }[] = [
  { x: 1, y: 9 },
  { x: 3, y: 9 },
  { x: 5, y: 9 },
  { x: 9, y: 1 },
  { x: 2, y: 22, amount: 600 },
  { x: 4, y: 23, amount: 600 },
  { x: 2, y: 25, amount: 600 },
  { x: 39, y: 27, amount: 700 },
]
/** 把分矿和家隔开的石墙（同两人图） */
const CORNER_WALL = { ch: "#", x: 0, y: 15, w: 7, h: 2 }
/** 随机地图生成不出来时的经典布局 */
const CORNER_CLASSIC = [
  { ch: "#", x: 14, y: 0, w: 2, h: 8 },
  { ch: "#", x: 22, y: 6, w: 4, h: 3 },
  { ch: "#", x: 11, y: 22, w: 3, h: 4 },
  { ch: "~", x: 24, y: 24, w: 4, h: 3 },
]

/** 玩家 p 的主基地开局左上角（按 seatCorners 的座位翻过去） */
export function cornerBaseStart(corner: number): { x: number; y: number } {
  const r = cornerImage(CORNERS_W, CORNERS_H, { x: 3, y: 3, w: 3, h: 3 }, corner)
  return { x: r.x, y: r.y }
}

/**
 * 3～4 人的开局（D-244）：80×56 左右、上下都对称的随机地图（D-261），每家坐一角（分队时队友坐左边或右边相邻的两个角），家、分矿和两人图一样；
 * 两家之间每局随机一对矿（每个 600）。extra 是规则包自己加的东西（比如侦察兵），按左上角那家写，其他角转过去；
 * 开局每人 300 金，shared（规则包 sharedResources，同队共用一份）时整队 300 × 队伍人数
 */
export function frontierCornersSetup(ctx: SetupContext, types: Record<string, TypeSpec>, extra: { type: string; x: number; y: number }[] = [], shared = false): void {
  const W = CORNERS_W
  const H = CORNERS_H
  const map = randomSymmetricMap(ctx.rng, {
    width: W,
    height: H,
    symmetry: "mirror4",
    base: mirror4Terrain(W, H, ".", [CORNER_WALL]),
    terrain: STANDARD_TERRAIN,
    solid: CORNER_MINES.map((m) => ({ x: m.x, y: m.y, w: 1, h: 1 })),
    keepClear: [STANDARD_HOME, { x: 0, y: 19, w: 9, h: 10 }, { x: 36, y: 24, w: 8, h: 8 }],
    obstacles: { count: [6, 8], shapes: STANDARD_SHAPES, chars: STANDARD_OBSTACLE_CHARS },
    mines: [{ region: { x: 14, y: 8, w: 18, h: 12 }, offsets: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }],
    connect: [{ x: 7, y: 7 }, { x: 6, y: 23 }, { x: 38, y: 26 }],
  })
  ctx.setTerrain(map?.terrain ?? mirror4Terrain(W, H, ".", [CORNER_WALL, ...CORNER_CLASSIC]))
  const size = (type: string) => ({ w: types[type].w ?? 1, h: types[type].h ?? 1 })
  const mines = map ? CORNER_MINES : [...CORNER_MINES, { x: 18, y: 12, amount: 600 }, { x: 20, y: 12, amount: 600 }]
  for (const m of mines)
    for (let k = 0; k < 4; k++) {
      const r = cornerImage(W, H, { x: m.x, y: m.y, w: 1, h: 1 }, k)
      ctx.spawn("goldmine", -1, r.x, r.y, m.amount ? { amount: m.amount } : undefined)
    }
  if (map) for (const m of map.mines) ctx.spawn("goldmine", -1, m.x, m.y, { amount: 600 })
  seatCorners(ctx.teams).forEach((corner, p) => {
    for (const it of [...CORNER_HOME, ...extra]) {
      const r = cornerImage(W, H, { x: it.x, y: it.y, ...size(it.type) }, corner)
      ctx.spawn(it.type, p, r.x, r.y)
    }
    ctx.setResources(p, { gold: START_GOLD * (shared ? ctx.teams.filter((t) => t === ctx.teams[p]).length : 1) })
  })
}
