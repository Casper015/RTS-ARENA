// 攻城拓荒（D-217）：克制拓荒的地图、建造和胜负，加上城墙、炮，三种兵重新调：
// - 克制靠很重的伤害倍数：枪兵打骑兵 ×3.5，骑兵打弓兵 ×2.5、打炮 ×3，弓兵打枪兵 ×2；
// - 速度拉开：骑兵走一格 2 tick，枪兵、弓兵 4 tick（骑兵快一倍），炮 6 tick；
// - 射击打骑兵、打炮吃亏：弓兵、箭塔、主基地打骑兵 ×0.5、打炮 ×0.25，
//   所以炮怕骑兵（还有枪兵）近身，不怕弓兵和箭塔；
// - 炮射程 5，比箭塔（4）远一格，打城墙、箭塔 ×5，打别的建筑 ×4，落点外扩一格溅射（attack.splash）；
// - 箭塔射程 5 → 4、攻击 12 → 24（用户：射程减一格，攻击翻倍让它更有价值）；主基地像弑君歼灭一样会开火（一下 24、射程 6）
import type { TypeSpec } from "../../src/core/types.ts"
import { frontierTypes } from "./frontier.ts"
import { scoutType } from "./counter.ts"
import { farmType } from "./farm.ts"

/** 攻城拓荒的单位和建筑（每次返回新对象，可以放心改） */
export function siegeTypes(): Record<string, TypeSpec> {
  const f = frontierTypes()
  const units: Record<string, TypeSpec> = {
    // 枪兵：便宜、皮实，打骑兵 ×3.5
    spearman: {
      kind: "unit",
      maxHp: 110,
      cost: { gold: 60 },
      buildTicks: 50,
      moveTicks: 4,
      sight: 5,
      attack: { damage: 8, range: 1, cooldown: 8, vs: { cavalry: 3.5 } },
      look: { shape: "diamond", label: "枪", name: "枪兵" },
    },
    // 弓兵：血薄、射程 4，打枪兵 ×2；打骑兵 ×0.5、打炮 ×0.25（射击打它们吃亏）
    archer: {
      kind: "unit",
      maxHp: 60,
      cost: { gold: 70 },
      buildTicks: 60,
      moveTicks: 4,
      sight: 7,
      attack: { damage: 7, range: 4, cooldown: 8, vs: { spearman: 2, cavalry: 0.5, cannon: 0.25 } },
      look: { shape: "triangle", label: "弓", name: "弓兵" },
    },
    // 骑兵：贵、快（走一格 2 tick，步兵 4 tick），打弓兵 ×2.5、打炮 ×3
    cavalry: {
      kind: "unit",
      maxHp: 160,
      cost: { gold: 110 },
      buildTicks: 70,
      moveTicks: 2,
      sight: 6,
      attack: { damage: 10, range: 1, cooldown: 8, vs: { archer: 2.5, cannon: 3 } },
      look: { shape: "circle", label: "骑", name: "骑兵" },
    },
    // 炮：慢、贵、打得慢，射程 5（比箭塔远 1 格），打城墙、箭塔 ×5，打别的建筑 ×4，落点外扩一格溅射；不怕射击，怕近身
    cannon: {
      kind: "unit",
      maxHp: 140,
      cost: { gold: 180 },
      buildTicks: 120,
      moveTicks: 6,
      sight: 6,
      attack: { damage: 12, range: 5, cooldown: 30, splash: 1, vs: { wall: 5, tower: 5, base: 4, barracks: 4, depot: 4 } },
      look: { shape: "square", label: "炮", name: "炮" },
    },
  }
  const out: Record<string, TypeSpec> = {}
  for (const [k, v] of Object.entries(f)) {
    if (k === "soldier") Object.assign(out, units, { scout: scoutType() })
    else if (k !== "archer") out[k] = v
  }
  // 主基地会开火（D-217，用户：基地要有弑君歼灭同款的攻击能力），打骑兵、炮吃亏
  out.base = { ...out.base, attack: { damage: 24, range: 6, cooldown: 10, vs: { cavalry: 0.5, cannon: 0.25 } } }
  out.barracks = { ...out.barracks, produces: ["spearman", "archer", "cavalry", "cannon"] }
  out.worker = { ...out.worker, builds: ["barracks", "tower", "depot", "wall", "farm"] }
  // 箭塔：射程 5 → 4、攻击 12 → 24（用户），打骑兵、炮吃亏
  out.tower = { ...out.tower, attack: { damage: 24, range: 4, cooldown: 10, vs: { cavalry: 0.5, cannon: 0.25 } } }
  // 城墙：便宜、血厚、1×1，挡路（自己的兵也挡），炮打它 ×5
  out.wall = {
    kind: "building",
    maxHp: 400,
    // 15 → 5（D-250，用户：两人局 4 个模型写的 bot 都没造墙）
    cost: { gold: 5 },
    buildTicks: 40,
    sight: 2,
    look: { shape: "square", label: "墙", name: "城墙" },
  }
  // 农田（D-218，用户）：工人建，工人停在旁边耕作，每 56 tick 给 5 金，不会采完（见 farm.ts）
  out.farm = farmType()
  return out
}
