// 攻城拓荒（D-217）：克制拓荒的地图、建造和胜负，加上城墙和炮，三种兵重新调克制；主基地会开火
// 地图、开局和胜负判定在 ../common/frontier.ts，单位和建筑在 ../common/siege.ts
import type { Ruleset } from "../../src/core/types.ts"
import { STANDARD_TERRAIN } from "../common/standard.ts"
import { enemyBasesOf, FRONTIER_H, FRONTIER_W, frontierResult, frontierSetup, frontierTimeUp, scoreKills } from "../common/frontier.ts"
import { spawnScouts } from "../common/counter.ts"
import { siegeTypes } from "../common/siege.ts"
import { farmInfo, farmStats, farmTick, resetFarms } from "../common/farm.ts"
import type { Objectives } from "./objectives.ts"

const types = siegeTypes()

const ruleset: Ruleset = {
  id: "siege-frontier",
  name: "攻城拓荒",
  summary: "自己建兵营、箭塔、城墙、农田；炮专拆塔和墙、怕骑兵；主基地会开火，摧毁对方主基地获胜",
  players: { min: 2, max: 2 },
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
    frontierSetup(ctx, types)
    resetFarms()
    spawnScouts(ctx, FRONTIER_W, FRONTIER_H, types)
  },

  onTick(ctx) {
    // 主基地开火打死的不算击杀价值（同弑君歼灭 D-203：守在家里不白拿分）
    scoreKills(ctx, types, ["base"])
    farmTick(ctx)
    ctx.setStatus(`击杀价值 ${ctx.players.map((p) => p.score).join(" : ")}`)
  },

  objectives(ctx, player): Objectives {
    return {
      enemyBases: enemyBasesOf(player),
      killValue: ctx.players.map((p) => p.score),
      farms: farmInfo(ctx, player),
    }
  },

  result(ctx) {
    const r = frontierResult(ctx)
    return r && { ...r, stats: farmStats(ctx.playerCount) }
  },
  timeUp: (ctx) => ({ ...frontierTimeUp(ctx), stats: farmStats(ctx.playerCount) }),
}

export default ruleset
