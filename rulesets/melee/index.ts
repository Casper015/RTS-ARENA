// 混战：2～4 人各占地图一角，可以分队（如 2v2）。
// - 主基地被摧毁的玩家出局（剩下的单位和建筑一起清掉）；一队的人全部出局，这队就输了。
// - 最后剩下的一队赢，赢家是这队的所有人（包括已经出局的队友）。
// - 名次按队伍排：越晚全队出局越好；到时间上限时，还有人在场的队按全队击杀价值、再按主基地剩余生命排。
// - 不分队时每人一队，就是各自为战。
import type { Ruleset } from "../../src/core/types.ts"
import { eliminatedPlayers, seatCorners, teamResult, teamStatus, teamTimeUp } from "../common/corners.ts"
import {
  randomSymmetricMap,
  rotateK,
  rotationalTerrain,
  STANDARD_HOME,
  STANDARD_OBSTACLE_CHARS,
  STANDARD_SHAPES,
  STANDARD_TERRAIN,
  standardTypes,
} from "../common/standard.ts"
import type { Objectives } from "./objectives.ts"

const SIZE = 64
const types = standardTypes()
const BUILDING_VALUE: Record<string, number> = { base: 1000, barracks: 400 }

function valueOf(type: string): number {
  return BUILDING_VALUE[type] ?? types[type].cost?.gold ?? 0
}

/** 左上角那一家的开局摆法，其他角转过去 */
const HOME: { type: string; x: number; y: number }[] = [
  { type: "base", x: 3, y: 3 },
  { type: "barracks", x: 9, y: 6 },
  { type: "worker", x: 6, y: 3 },
  { type: "worker", x: 6, y: 4 },
  { type: "worker", x: 6, y: 5 },
  { type: "worker", x: 3, y: 6 },
]
/** 每个角都有的金矿（没人坐的角也有，谁去采都行） */
const MINES: { x: number; y: number; amount: number }[] = [
  { x: 1, y: 9, amount: 400 },
  { x: 3, y: 9, amount: 400 },
  { x: 5, y: 9, amount: 400 },
  { x: 8, y: 1, amount: 400 },
  // 地图正中，转四次正好是一个 2×2 的矿群
  { x: 31, y: 31, amount: 800 },
]
/** 两家之间的中立矿（一对，每个 500）：经典布局在 (18, 14)，随机地图里每局换地方 */
const BETWEEN = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
]
const CLASSIC_BETWEEN = { x: 18, y: 14 }
const CLASSIC_WALLS = [
  { ch: "#", x: 14, y: 0, w: 2, h: 8 },
  { ch: "#", x: 22, y: 6, w: 4, h: 3 },
  { ch: "#", x: 8, y: 20, w: 3, h: 4 },
  { ch: "~", x: 24, y: 24, w: 4, h: 3 },
]

function size(type: string) {
  return { w: types[type].w ?? 1, h: types[type].h ?? 1 }
}

function baseStart(corner: number): { x: number; y: number } {
  const r = rotateK(SIZE, { x: 3, y: 3, w: 3, h: 3 }, corner)
  return { x: r.x, y: r.y }
}

const ruleset: Ruleset = {
  id: "melee",
  name: "混战",
  summary: "2～4 人各占一角混战，主基地被拆就出局，最后剩下的一队赢",
  players: { min: 2, max: 4 },
  teams: true,
  maxTicks: 8000,
  tickRate: 10,
  decisionInterval: 5,
  fuel: 100,
  unitCap: 60,
  fog: true,
  resources: ["gold"],
  terrain: STANDARD_TERRAIN,
  types,

  setup(ctx) {
    // 地图按种子随机生成（四重旋转对称，四个角一样）：各角的家、家门口的矿和正中的矿群固定，
    // 石墙、水和两家之间的那对矿每局不同；生成不出合格的地图时用经典布局（D-141 之前的固定地图）
    const map = randomSymmetricMap(ctx.rng, {
      width: SIZE,
      height: SIZE,
      symmetry: "rot4",
      base: rotationalTerrain(SIZE, ".", []),
      terrain: STANDARD_TERRAIN,
      solid: [{ x: 31, y: 31, w: 1, h: 1 }],
      keepClear: [STANDARD_HOME, { x: 28, y: 28, w: 8, h: 8 }],
      obstacles: { count: [6, 8], shapes: STANDARD_SHAPES, chars: STANDARD_OBSTACLE_CHARS },
      mines: [{ region: { x: 14, y: 10, w: 12, h: 10 }, offsets: BETWEEN }],
      connect: [{ x: 7, y: 7 }, { x: 30, y: 30 }],
    })
    ctx.setTerrain(map?.terrain ?? rotationalTerrain(SIZE, ".", CLASSIC_WALLS))
    const fixed = map ? MINES : [...MINES, ...BETWEEN.map((o) => ({ x: CLASSIC_BETWEEN.x + o.x, y: CLASSIC_BETWEEN.y + o.y, amount: 500 }))]
    for (const m of fixed)
      for (let k = 0; k < 4; k++) {
        const r = rotateK(SIZE, { x: m.x, y: m.y, w: 1, h: 1 }, k)
        ctx.spawn("goldmine", -1, r.x, r.y, { amount: m.amount })
      }
    if (map) for (const m of map.mines) ctx.spawn("goldmine", -1, m.x, m.y, { amount: 500 })
    seatCorners(ctx.teams).forEach((corner, p) => {
      for (const it of HOME) {
        const r = rotateK(SIZE, { x: it.x, y: it.y, ...size(it.type) }, corner)
        ctx.spawn(it.type, p, r.x, r.y)
      }
      ctx.setResources(p, { gold: 200 })
    })
  },

  onTick(ctx) {
    for (const ev of ctx.events) {
      if (ev.kind === "died" && ev.killer >= 0 && ev.owner >= 0 && !ctx.isAlly(ev.killer, ev.owner)) ctx.addScore(ev.killer, valueOf(ev.type))
    }
    ctx.setStatus(teamStatus(ctx))
  },

  objectives(ctx, player): Objectives {
    const corners = seatCorners(ctx.teams)
    const bases = corners.map((c, owner) => ({ owner, ...baseStart(c) })).filter((b) => b.owner !== player && ctx.players[b.owner].alive)
    return {
      enemyBases: bases.filter((b) => !ctx.isAlly(player, b.owner)),
      allyBases: bases.filter((b) => ctx.isAlly(player, b.owner)),
      killValue: ctx.players.map((p) => p.score),
      eliminated: eliminatedPlayers(ctx),
    }
  },

  // 主基地被拆就出局清场，最后剩下的一队赢；到时间按还在场的队伍比击杀价值（../common/corners.ts）
  result: teamResult,
  timeUp: teamTimeUp,
}

export default ruleset
