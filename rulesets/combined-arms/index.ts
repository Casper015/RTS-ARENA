// 立体战线（D-269，用户：新规则包，用来让平台兼容空中、地下单位，多格的大型单位，两种状态切换，驻扎）：
// 拓荒的两人地图和经济（主基地、5 个工人、家门口的矿、分矿），工人建兵营、战车工厂、机场、地堡、防空塔、仓库；
// 单位见 ./types.ts。摧毁对方主基地获胜，到时间比击杀价值
import type { Ruleset } from "../../src/core/types.ts"
import { STANDARD_TERRAIN } from "../common/standard.ts"
import { enemyBasesOf, frontierResult, frontierSetup, frontierTimeUp, scoreKills } from "../common/frontier.ts"
import { combinedTypes } from "./types.ts"
import type { Objectives } from "./objectives.ts"

const types = combinedTypes()

const ruleset: Ruleset = {
  id: "combined-arms",
  name: "立体战线",
  summary: "地面、空中、地下一起打：坦克能架炮、地雷埋在地下、地堡能进兵、2×2 的战舰和机甲；摧毁对方主基地获胜",
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
  },

  onTick(ctx) {
    scoreKills(ctx, types)
    ctx.setStatus(`击杀价值 ${ctx.players.map((p) => p.score).join(" : ")}`)
  },

  objectives(ctx, player): Objectives {
    return { enemyBases: enemyBasesOf(player), killValue: ctx.players.map((p) => p.score) }
  },

  result: (ctx) => frontierResult(ctx),
  timeUp: (ctx) => frontierTimeUp(ctx),
}

export default ruleset
