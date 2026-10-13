// 火药科技（D-257，用户：把科技和攻城拓荒融合起来，删掉原来的科技规则包，加一个新单位线列步兵）：
// 攻城拓荒的地图、开局、建造、城墙、炮、农田、主基地开火和胜负（两人局；3～4 人各自为战或分队，队友共用金子），
// 加上火药工坊（造线列步兵和炮）和 4 种科技建筑（建筑在加成就在）。单位、建筑、科技见 ./techs.ts
import type { RuleContext, Ruleset } from "../../src/core/types.ts"
import { STANDARD_TERRAIN } from "../common/standard.ts"
import { cornerBaseStart, enemyBasesOf, FRONTIER_H, FRONTIER_W, frontierCornersSetup, frontierResult, frontierSetup, frontierTimeUp, scoreKills, START_GOLD } from "../common/frontier.ts"
import { eliminatedPlayers, seatCorners, teamResult, teamStatus, teamTimeUp } from "../common/corners.ts"
import { spawnScouts } from "../common/counter.ts"
import { farmInfo, farmStats, farmTick, resetFarms } from "../common/farm.ts"
import { TEAMMATE_SPOTLIGHT, teammateStats } from "../common/teammates.ts"
import { activeTechs, gunpowderTypes, resetTechs, techText, updateTechs } from "./techs.ts"
import type { Objectives } from "./objectives.ts"

const types = gunpowderTypes()

const ruleset: Ruleset = {
  id: "gunpowder",
  name: "火药科技",
  summary: "攻城拓荒加火药工坊和科技建筑：线列步兵一下打得重、射程短、一半会打偏；摧毁对方主基地获胜",
  players: { min: 2, max: 4 },
  teams: true,
  // 分队时队友共用金子（同攻城拓荒 D-245），选手页看每人吃了队友多少钱（D-249）
  sharedResources: true,
  spotlight: TEAMMATE_SPOTLIGHT,
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
    resetTechs()
    if (ctx.playerCount > 2) {
      frontierCornersSetup(ctx, types, [{ type: "scout", x: 1, y: 1 }], true)
      return
    }
    frontierSetup(ctx, types)
    spawnScouts(ctx, FRONTIER_W, FRONTIER_H, types)
  },

  onTick(ctx) {
    // 主基地开火打死的不算击杀价值（同攻城拓荒）
    scoreKills(ctx, types, ["base"])
    farmTick(ctx)
    updateTechs(ctx, types)
    ctx.setStatus(
      ctx.playerCount > 2
        ? teamStatus(ctx)
        : `击杀价值 ${ctx.players.map((p) => p.score).join(" : ")}  科技 ${ctx.players.map((p) => `P${p.id}：${techText(p.id)}`).join("  ")}`,
    )
  },

  objectives(ctx, player): Objectives {
    const bases = ctx.playerCount > 2 ? seatCorners(ctx.teams).map((c, owner) => ({ owner, ...cornerBaseStart(c) })).filter((b) => b.owner !== player && ctx.players[b.owner].alive) : enemyBasesOf(player)
    return {
      enemyBases: bases.filter((b) => !ctx.isAlly(player, b.owner)),
      allyBases: bases.filter((b) => ctx.isAlly(player, b.owner)),
      killValue: ctx.players.map((p) => p.score),
      farms: farmInfo(ctx, player),
      techs: ctx.players.map((p) => activeTechs(p.id)),
      eliminated: eliminatedPlayers(ctx),
    }
  },

  result(ctx) {
    const r = ctx.playerCount > 2 ? teamResult(ctx) : frontierResult(ctx)
    return r && { ...r, stats: stats(ctx) }
  },
  timeUp: (ctx) => ({ ...(ctx.playerCount > 2 ? teamTimeUp(ctx) : frontierTimeUp(ctx)), stats: stats(ctx) }),
}

/** 农田收入；分队时加上每人花掉、挣来的和吃队友的钱 */
function stats(ctx: RuleContext): Record<string, number[]> {
  return { ...farmStats(ctx.playerCount), ...teammateStats(ctx, "gold", START_GOLD) }
}

export default ruleset
