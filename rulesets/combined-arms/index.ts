// 立体战线（D-269，用户：新规则包，用来让平台兼容空中、地下单位，多格的大型单位，两种状态切换，驻扎）：
// 拓荒的两人地图和经济（主基地、5 个工人、家门口的矿、分矿），工人建兵营、战车工厂、机场、地堡、防空塔、仓库、研究建筑；
// D-270 加了科技前置、研究、挂件、建筑起飞、能量技能（主炮、兴奋剂、空投采矿机）、医疗兵、修理、护甲。
// 单位见 ./types.ts。摧毁对方主基地获胜，到时间比击杀价值
import type { Ruleset } from "../../src/core/types.ts"
import { STANDARD_TERRAIN } from "../common/standard.ts"
import { enemyBasesOf, frontierResult, frontierSetup, frontierTimeUp, scoreKills } from "../common/frontier.ts"
import { CANNON_DAMAGE, combinedResearches, combinedTypes, STIM_HP, STIM_TICKS } from "./types.ts"
import type { Objectives } from "./objectives.ts"

const types = combinedTypes()

const ruleset: Ruleset = {
  id: "combined-arms",
  name: "立体战线",
  summary: "地面、空中、地下一起打：架炮、地雷、地堡、2×2 的战舰机甲，挂件、研究、起飞、主炮；摧毁对方主基地获胜",
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
  researches: combinedResearches(),

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

  // 技能（D-270）：平台已经查过冷却、能量、要先研究的、目标和射程
  onCast(ctx, c) {
    const u = ctx.get(c.unit)!
    if (c.skill === "stim") {
      if (u.hp <= STIM_HP) return `生命要多于 ${STIM_HP} 才能打兴奋剂（现在 ${u.hp}）`
      ctx.setHp(u.id, u.hp - STIM_HP)
      ctx.addBuff(u.id, { name: "兴奋剂", speedPct: 50, ratePct: 50, ticks: STIM_TICKS })
      return null
    }
    if (c.skill === "main_cannon") {
      const t = c.target === undefined ? undefined : ctx.get(c.target)
      if (!t || t.owner < 0 || ctx.isAlly(t.owner, c.player) || t.def.kind === "resource") return "主炮只能打对手的单位、建筑"
      ctx.damage(t.id, CANNON_DAMAGE, u.id)
      ctx.effect({ x: t.x, y: t.y, w: t.w, h: t.h, text: "主炮", color: "#6ee6ff", radius: 2 })
      return null
    }
    if (c.skill === "calldown") {
      if (!ctx.isVisible(c.player, c.x!, c.y!)) return `(${c.x}, ${c.y}) 不在你方视野里，只能空投到看得见的地方`
      const id = ctx.spawnNear("harvester", c.player, c.x!, c.y!)
      if (id === null) return `(${c.x}, ${c.y}) 附近放不下采矿机`
      const h = ctx.get(id)!
      ctx.effect({ x: h.x, y: h.y, text: "空投", color: "#ffce7e", radius: 1 })
      return null
    }
    return `没有技能 ${c.skill}`
  },

  result: (ctx) => frontierResult(ctx),
  timeUp: (ctx) => frontierTimeUp(ctx),
}

export default ruleset
