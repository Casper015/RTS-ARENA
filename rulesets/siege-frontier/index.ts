// 攻城拓荒（D-217）：克制拓荒的地图、建造和胜负，加上城墙和炮，三种兵重新调克制；主基地会开火
// 地图、开局和胜负判定在 ../common/frontier.ts，单位和建筑在 ../common/siege.ts
// 3～4 人（各自为战或分队，D-244）：64×64 四角地图，主基地被拆就出局清场，最后剩下的一队赢（同混战，../common/corners.ts）
import type { Ruleset } from "../../src/core/types.ts"
import { STANDARD_TERRAIN } from "../common/standard.ts"
import { cornerBaseStart, enemyBasesOf, FRONTIER_H, FRONTIER_W, frontierCornersSetup, frontierResult, frontierSetup, frontierTimeUp, scoreKills } from "../common/frontier.ts"
import { eliminatedPlayers, seatCorners, teamResult, teamStatus, teamTimeUp } from "../common/corners.ts"
import { spawnScouts } from "../common/counter.ts"
import { siegeTypes } from "../common/siege.ts"
import { farmInfo, farmStats, farmTick, resetFarms } from "../common/farm.ts"
import type { Objectives } from "./objectives.ts"

const types = siegeTypes()

const ruleset: Ruleset = {
  id: "siege-frontier",
  name: "攻城拓荒",
  summary: "自己建兵营、箭塔、城墙、农田；炮专拆塔和墙、怕骑兵；主基地会开火，摧毁对方主基地获胜",
  players: { min: 2, max: 4 },
  teams: true,
  // 分队时队友共用一份金子（D-245，用户）
  sharedResources: true,
  maxTicks: 9000,
  tickRate: 10,
  decisionInterval: 5,
  fuel: 130,
  unitCap: 60,
  fog: true,
  resources: ["gold"],
  terrain: STANDARD_TERRAIN,
  types,

  setup(ctx) {
    resetFarms()
    if (ctx.playerCount > 2) {
      frontierCornersSetup(ctx, types, [{ type: "scout", x: 1, y: 1 }], true)
      return
    }
    frontierSetup(ctx, types)
    spawnScouts(ctx, FRONTIER_W, FRONTIER_H, types)
  },

  onTick(ctx) {
    // 主基地开火打死的不算击杀价值（同弑君歼灭 D-203：守在家里不白拿分）
    scoreKills(ctx, types, ["base"])
    farmTick(ctx)
    ctx.setStatus(ctx.playerCount > 2 ? teamStatus(ctx) : `击杀价值 ${ctx.players.map((p) => p.score).join(" : ")}`)
  },

  objectives(ctx, player): Objectives {
    // 多人局只列还没出局的（同混战）；两人局照旧（主基地被拆就结束了）
    const bases = ctx.playerCount > 2 ? seatCorners(ctx.teams).map((c, owner) => ({ owner, ...cornerBaseStart(c) })).filter((b) => b.owner !== player && ctx.players[b.owner].alive) : enemyBasesOf(player)
    return {
      enemyBases: bases.filter((b) => !ctx.isAlly(player, b.owner)),
      allyBases: bases.filter((b) => ctx.isAlly(player, b.owner)),
      killValue: ctx.players.map((p) => p.score),
      farms: farmInfo(ctx, player),
      eliminated: eliminatedPlayers(ctx),
    }
  },

  result(ctx) {
    const r = ctx.playerCount > 2 ? teamResult(ctx) : frontierResult(ctx)
    return r && { ...r, stats: farmStats(ctx.playerCount) }
  },
  timeUp: (ctx) => ({ ...(ctx.playerCount > 2 ? teamTimeUp(ctx) : frontierTimeUp(ctx)), stats: farmStats(ctx.playerCount) }),
}

export default ruleset
