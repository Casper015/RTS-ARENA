// 弑君歼灭（D-187）：歼灭的地图、兵种和击杀价值，开局每家送 1 个领主；主基地被拆或领主阵亡就输
// 地图和开局在 ../common/annihilation.ts，领主、击退和胜负在 ../common/regicide.ts（D-197：歼灭的领主不点金，放击退）
import type { Ruleset } from "../../src/core/types.ts"
import { STANDARD_TERRAIN, standardTypes } from "../common/standard.ts"
import { ANNIHILATION_H, ANNIHILATION_W, annihilationEnemyBases, annihilationSetup, annihilationTimeUp, scoreAnnihilationKills } from "../common/annihilation.ts"
import { regicideCast, regicideResult, regicideStats, spawnLords, withLord } from "../common/regicide.ts"
import { campInfo, creepBounty, creepTick, creepTimeUp, creepType, setupCamps } from "../common/creeps.ts"
import type { Objectives } from "./objectives.ts"

const types = withLord(standardTypes(), ["soldier", "archer"], "repel")
// D-209（用户）：野怪 300 → 200 血。中央宝箱（D-202～D-208）也删掉了
types.creep = { ...creepType(), maxHp: 200 }
// D-196（用户：钱没处花，又不想加建造把歼灭弄复杂）：兵营排进队列的 5 个同时造，出兵快慢看钱
types.barracks.parallel = 5
// D-198（用户：想让两边打得更焦灼、时间更长）：战士 120 → 180 血（实测势均力敌的团战从 136 tick 打到 228 tick）；
// 主基地像拓荒的箭塔一样能打射程 5 内的敌人（一波推平变难）；领主 500 → 800 血（不那么容易被秒）
types.soldier.maxHp = 180
// D-209（用户）：主基地攻击力翻倍、射程加一：一下 12 → 24，射程 5 → 6
types.base.attack = { damage: 24, range: 6, cooldown: 10 }
// D-199（用户）：主基地 1500 → 3000 血（D-198 后拆家结束的局从 35 涨到 48：领主难杀就去拆家，180 血的战士扛得住主基地的炮火）
types.base.maxHp = 3000
// D-200（用户）：领主 800 → 1500 血（主基地改 3000 以后杀领主成了最主要的结束方式）
types.lord.maxHp = 1500
// D-206（用户）：家门口的 4 个金矿 400 → 600；D-209（用户）：所有金矿都改成 800（家门口的按类型的默认储量，中间的在 annihilationSetup 里传）
types.goldmine = { ...types.goldmine, amount: 800 }
const MINE_AMOUNT = 800

const ruleset: Ruleset = {
  id: "regicide-annihilation",
  name: "弑君歼灭",
  summary: "两人对战，开局送一个领主（光环加攻防、能把周围的敌人击退），地图上有定时刷新的野怪赏金，主基地被拆或领主阵亡就输",
  players: { min: 2, max: 2 },
  maxTicks: 6000,
  tickRate: 10,
  decisionInterval: 5,
  fuel: 100,
  unitCap: 60,
  fog: true,
  resources: ["gold"],
  terrain: STANDARD_TERRAIN,
  types,

  setup(ctx) {
    // D-215（用户：放到侧面一点，不要挡住金矿位置）：兵营放在主基地东北侧 (10, 2)，离主基地 5 格、离 (8, 1) 的金矿 3 格（不占矿旁边的格子）；
    // 兵营四周的 8 个攻击位置一半在主基地射程内（西边、南边），一半在射程外（东边、北边）。
    // 之前：D-210 挪到 (10, 7)、全在射程外（给骚扰一个目标）；D-214 放到主基地正西边、全在射程内（时间到的局涨到 47%）
    annihilationSetup(ctx, types, { mineAmount: MINE_AMOUNT, barracks: { x: 10, y: 2 } })
    spawnLords(ctx, ANNIHILATION_W, ANNIHILATION_H, types)
    // 野怪营地（D-189）：内圈、外圈各一对，都在离两家主基地一样远的斜线上
    // D-193（用户）：赏金 150，死了的野怪每 900 tick 定时补满（拓荒是 100、营地清空后才刷新）
    // D-207（第八轮试写：中间矿挨着营地采不了）：营地离金矿至少 5 格，在矿边上采矿的工人惹不醒野怪；
    // D-210（第十轮试写：中间矿离营地 5～8 格几乎没人采）：10 格，营地打起来野怪也追不到采矿的工人（追打范围 8 格；附近矿太多放不下时一格格放宽）
    setupCamps(ctx, ANNIHILATION_W, ANNIHILATION_H, { x: 20, y: 19 }, { x: 14, y: 25 }, { bounty: 150, respawn: "periodic", mineGap: 10 })
  },

  onTick(ctx) {
    // D-203（用户）：主基地打死的不算击杀价值（一个兵不出的 bot 靠主基地点掉来拆家的兵，时间到时击杀价值领先，守家白拿分）
    scoreAnnihilationKills(ctx, types, ["base"])
    creepTick(ctx)
  },

  objectives(ctx, player): Objectives {
    return {
      enemyBases: annihilationEnemyBases(player),
      killValue: ctx.players.map((p) => p.score),
      creepCamps: campInfo(),
      creepBounty: creepBounty(ctx.playerCount),
    }
  },

  onCast: regicideCast,
  result: regicideResult,
  timeUp: (ctx) => ({ ...creepTimeUp(ctx, annihilationTimeUp(ctx)), stats: regicideStats(ctx.playerCount) }),
}

export default ruleset
