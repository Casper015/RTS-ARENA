// 立体战线的单位和建筑（D-269）：用来演示、检验平台的空中和地下单位、多格的大型单位、两种状态切换、驻扎。
// - 步枪兵：便宜，地面、空中都打得到，能进地堡；研究好兴奋剂以后能扣血换加速（D-270）；
// - 医疗兵：自动给周围受伤的生物单位回血，花能量（D-270）；
// - 坦克：两种状态。行进时能走、射程 5；架炮后不能走，射程 9、一下 40、溅射一格，切换 40 tick；
// - 地雷：两种状态。移动时跑得快、不能打；埋设后钻到地下（对手要防空塔探测到才看得见），敌方地面单位走到旁边就炸（溅射一格），炸完自己也没了；
// - 重型机甲：2×2 的大型地面单位，又慢又硬，地面、空中都打，打空中战舰 ×2；
// - 空中战舰：2×2 的空中单位，飞过一切，地面、空中都打，只有步枪兵、重型机甲、防空塔打得到它；研究好主炮充能以后能花能量打一发 240（D-270）；
// - 采矿机：主基地花能量空投下来，采得快，600 tick 后自己消失，不占单位上限（D-270 召唤、限时存在）；
// - 地堡：最多进 4 个步枪兵，在里面的对手看不见、打不到，射程 +1；
// - 防空塔：只打空中，能探测地下的地雷（7 格）；
// - 兵营、战车工厂、机场能在右边建挂件（科技挂件解锁高级兵种和研究、反应挂件同时造两个），能起飞挪地方（D-270）；
// - 研究所、军械库、聚变核心：研究攻防升级和主炮（D-270）。
// 护甲（D-270）：每挨一下减护甲那么多（最少还是 1），溅射的每个目标各算各的。
import type { ModeSpec, ResearchSpec, TypeSpec } from "../../src/core/types.ts"
import { frontierTypes } from "../common/frontier.ts"

/** 兴奋剂扣多少血、管多久 */
export const STIM_HP = 10
export const STIM_TICKS = 110
/** 主炮一下多少伤害 */
export const CANNON_DAMAGE = 240

/** 兵营、战车工厂、机场能起飞（D-270）：飞起来能走、不能生产，落地要整块空地；飞着用同一张素材（平台抬高、画影子和推进火光） */
const lift = (sprite: string): ModeSpec[] => [
  { id: "land", name: "着陆", switchTicks: 30 },
  { id: "fly", name: "飞行", switchTicks: 30, layer: "air", moveTicks: 8, look: { art: { sprite: `art/${sprite}.svg` } } },
]

/** 立体战线的单位和建筑（每次返回新对象） */
export function combinedTypes(): Record<string, TypeSpec> {
  const f = frontierTypes()
  const art = (name: string) => `art/${name}.svg`
  const building = (name: string, label: string, sprite: string, w: number, h: number, gold: number, buildTicks: number, maxHp: number, extra: Partial<TypeSpec> = {}): TypeSpec => ({
    kind: "building",
    w,
    h,
    maxHp,
    armor: 1,
    cost: { gold },
    buildTicks,
    sight: 5,
    look: { shape: "hex", label, name, art: { sprite: art(sprite) } },
    ...extra,
  })
  const ADDONS = ["techlab", "reactor"]
  return {
    // 主基地：有能量，能空投采矿机（D-270 召唤）
    base: {
      ...f.base,
      armor: 1,
      energy: { max: 200, start: 50, regenTicks: 6 },
      skills: [{ id: "calldown", name: "空投采矿机", cooldown: 20, target: "point", range: 40, energy: 50, desc: `花 50 能量往看得见的一格空投一台采矿机：一趟采 15 金，600 tick 后自己消失，不占单位上限` }],
      look: { ...f.base.look, name: "主基地", art: { sprite: art("base") } },
    },
    // 工人：生物；能修机械单位和建筑（D-270，修满一次花造价的 25%）
    worker: {
      ...f.worker,
      tags: ["bio"],
      repair: { tags: ["mech"], buildings: true, costPct: 25 },
      builds: ["barracks", "factory", "airport", "bunker", "turret", "depot", "academy", "armory", "fusion"],
      look: { ...f.worker.look, name: "工人", art: { sprite: art("worker"), motion: "armored" } },
    },
    goldmine: { ...f.goldmine, look: { ...f.goldmine.look, name: "金矿", art: { sprite: art("goldmine") } } },
    depot: { ...f.depot, armor: 1, look: { ...f.depot.look, name: "仓库", art: { sprite: art("depot") } } },
    barracks: { ...f.barracks, armor: 1, produces: ["rifleman", "medic"], addons: ADDONS, modes: lift("barracks"), look: { ...f.barracks.look, name: "兵营", art: { sprite: art("barracks") } } },
    factory: building("战车工厂", "车", "factory", 3, 2, 200, 300, 1000, { requires: ["barracks"], produces: ["tank", "mine", "mech"], addons: ADDONS, modes: lift("factory") }),
    airport: building("机场", "机", "airport", 3, 2, 250, 360, 900, { requires: ["factory"], produces: ["warship"], addons: ADDONS, modes: lift("airport") }),
    // 地堡：最多 4 个步枪兵，从里面开火射程 +1（D-269 驻扎）
    bunker: building("地堡", "堡", "bunker", 2, 2, 100, 200, 700, { requires: ["barracks"], sight: 7, garrison: { capacity: 4, types: ["rifleman"], rangeBonus: 1 } }),
    // 防空塔：只打空中，探测 7 格内的地下单位（D-269 层、探测）；要先有研究所
    turret: building("防空塔", "塔", "turret", 1, 1, 100, 160, 450, {
      requires: ["academy"],
      sight: 8,
      detect: 7,
      attack: { damage: 18, range: 7, cooldown: 10, hits: ["air"] },
      look: { shape: "hex", label: "塔", name: "防空塔", art: { sprite: art("turret"), weapon: "missile" } },
    }),
    // 挂件（D-270）：建在兵营、战车工厂、机场右边，由那座建筑自己建
    techlab: building("科技挂件", "科", "techlab", 2, 2, 50, 120, 400, { addon: { parallel: 1 }, researches: ["stim", "shield"] }),
    reactor: building("反应挂件", "反", "reactor", 2, 2, 75, 160, 400, { addon: { parallel: 2 } }),
    // 研究建筑（D-270）
    academy: building("研究所", "研", "academy", 2, 2, 125, 200, 750, { requires: ["barracks"], researches: ["inf_weapons_1", "inf_armor_1", "inf_weapons_2", "inf_armor_2"] }),
    armory: building("军械库", "械", "armory", 2, 2, 150, 240, 750, { requires: ["factory"], researches: ["veh_weapons_1", "veh_plating_1"] }),
    fusion: building("聚变核心", "聚", "fusion", 2, 2, 150, 260, 750, { requires: ["airport"], researches: ["main_cannon"] }),
    // 步枪兵：地面、空中都打；兴奋剂（D-270，要先研究）
    rifleman: {
      kind: "unit",
      maxHp: 60,
      cost: { gold: 60 },
      buildTicks: 50,
      moveTicks: 4,
      sight: 6,
      tags: ["bio"],
      attack: { damage: 8, range: 4, cooldown: 10, hits: ["ground", "air"] },
      skills: [{ id: "stim", name: "兴奋剂", cooldown: 10, requires: "stim", situational: true, desc: `扣 ${STIM_HP} 血，${STIM_TICKS} tick 内移动、攻击都快 50%（生命要多于 ${STIM_HP}）` }],
      look: { shape: "triangle", label: "枪", name: "步枪兵", art: { sprite: art("rifleman"), weapon: "autocannon", motion: "armored" } },
    },
    // 医疗兵（D-270）：自动治疗，要挂着科技挂件的兵营
    medic: {
      kind: "unit",
      maxHp: 60,
      armor: 1,
      cost: { gold: 50 },
      buildTicks: 60,
      moveTicks: 4,
      sight: 7,
      tags: ["bio"],
      needsAddon: "techlab",
      energy: { max: 200, start: 60, regenTicks: 8 },
      heal: { amount: 3, range: 2, cooldown: 4, energy: 1, tags: ["bio"] },
      look: { shape: "triangle", label: "医", name: "医疗兵", art: { sprite: art("medic"), motion: "armored" } },
    },
    // 坦克：行进 / 架炮（D-269 两种状态），要挂着科技挂件的战车工厂
    tank: {
      kind: "unit",
      maxHp: 170,
      cost: { gold: 150 },
      buildTicks: 120,
      moveTicks: 5,
      sight: 8,
      tags: ["mech"],
      needsAddon: "techlab",
      attack: { damage: 15, range: 5, cooldown: 15 },
      modes: [
        { id: "move", name: "行进", switchTicks: 30 },
        { id: "siege", name: "架炮", switchTicks: 40, moveTicks: 0, sight: 10, attack: { damage: 40, range: 9, cooldown: 30, splash: 1, vs: { rifleman: 1.5, medic: 1.5 } }, look: { label: "炮", art: { sprite: art("tank-siege"), weapon: "siege-shell" } } },
      ],
      look: { shape: "square", label: "坦", name: "坦克", art: { sprite: art("tank"), weapon: "autocannon", motion: "tracked" } },
    },
    // 地雷：移动 / 埋设（埋设后在地下，D-269 层；敌方地面单位贴过来就炸，炸完自己没了）
    mine: {
      kind: "unit",
      maxHp: 25,
      cost: { gold: 30 },
      buildTicks: 30,
      moveTicks: 2,
      sight: 4,
      tags: ["mech"],
      modes: [
        { id: "roll", name: "移动", switchTicks: 20 },
        { id: "buried", name: "埋设", switchTicks: 20, moveTicks: 0, layer: "under", attack: { damage: 80, range: 1, cooldown: 1, splash: 1, suicide: true }, look: { art: { sprite: art("mine-buried"), weapon: "detonation", motion: "burrow" } } },
      ],
      look: { shape: "circle", label: "雷", name: "地雷", art: { sprite: art("mine"), motion: "tracked" } },
    },
    // 重型机甲：2×2 的大型地面单位（D-269），地面、空中都打，打空中战舰 ×2；要有军械库、挂着科技挂件的战车工厂
    mech: {
      kind: "unit",
      w: 2,
      h: 2,
      maxHp: 520,
      armor: 1,
      cost: { gold: 300 },
      buildTicks: 200,
      moveTicks: 7,
      sight: 7,
      tags: ["mech"],
      requires: ["armory"],
      needsAddon: "techlab",
      attack: { damage: 22, range: 6, cooldown: 20, hits: ["ground", "air"], vs: { warship: 2 } },
      look: { shape: "hex", label: "甲", name: "重型机甲", art: { sprite: art("mech"), weapon: "missile", motion: "walker" } },
    },
    // 空中战舰：2×2 的空中单位（D-269），飞过一切；有能量，研究好主炮充能能打主炮（D-270）；要挂着科技挂件的机场
    warship: {
      kind: "unit",
      w: 2,
      h: 2,
      layer: "air",
      maxHp: 600,
      armor: 2,
      cost: { gold: 350 },
      buildTicks: 220,
      moveTicks: 6,
      sight: 9,
      tags: ["mech"],
      needsAddon: "techlab",
      energy: { max: 200, start: 50, regenTicks: 6 },
      attack: { damage: 30, range: 6, cooldown: 20, hits: ["ground", "air"] },
      skills: [{ id: "main_cannon", name: "主炮", cooldown: 40, target: "unit", range: 10, energy: 150, requires: "main_cannon", situational: true, desc: `花 150 能量打一个对手的单位或建筑 ${CANNON_DAMAGE}（不算护甲），射程 10` }],
      look: { shape: "diamond", label: "舰", name: "空中战舰", art: { sprite: art("warship"), weapon: "plasma", motion: "hover" } },
    },
    // 采矿机（D-270）：只能由主基地空投，600 tick 后消失、不占单位上限，一趟采 15 金
    harvester: {
      kind: "unit",
      maxHp: 60,
      moveTicks: 3,
      sight: 4,
      tags: ["mech"],
      lifetime: 600,
      gather: { amount: 3, ticks: 5, capacity: 15 },
      look: { shape: "circle", label: "矿", name: "采矿机", art: { sprite: art("harvester"), motion: "tracked" } },
    },
  }
}

/** 研究（D-270）：effects 是加多少 */
export function combinedResearches(): Record<string, ResearchSpec> {
  return {
    stim: { name: "兴奋剂", cost: { gold: 100 }, ticks: 400, requires: ["barracks"], desc: `步枪兵能打兴奋剂：扣 ${STIM_HP} 血，${STIM_TICKS} tick 内移动、攻击都快 50%` },
    shield: { name: "战斗护盾", cost: { gold: 100 }, ticks: 300, requires: ["barracks"], effects: { rifleman: { maxHp: 10 } }, desc: "步枪兵生命 +10" },
    inf_weapons_1: { name: "步兵武器一级", cost: { gold: 100 }, ticks: 450, effects: { rifleman: { attack: { damage: 1 } } }, desc: "步枪兵伤害 +1" },
    inf_armor_1: { name: "步兵护甲一级", cost: { gold: 100 }, ticks: 450, effects: { rifleman: { armor: 1 }, medic: { armor: 1 } }, desc: "步枪兵、医疗兵护甲 +1" },
    inf_weapons_2: { name: "步兵武器二级", cost: { gold: 175 }, ticks: 600, requires: ["armory", "inf_weapons_1"], effects: { rifleman: { attack: { damage: 1 } } }, desc: "步枪兵伤害再 +1（要有军械库、先研究一级）" },
    inf_armor_2: { name: "步兵护甲二级", cost: { gold: 175 }, ticks: 600, requires: ["armory", "inf_armor_1"], effects: { rifleman: { armor: 1 }, medic: { armor: 1 } }, desc: "步枪兵、医疗兵护甲再 +1（要有军械库、先研究一级）" },
    veh_weapons_1: { name: "车辆武器一级", cost: { gold: 150 }, ticks: 600, effects: { tank: { attack: { damage: 1 } }, mech: { attack: { damage: 2 } } }, desc: "坦克伤害 +1（行进、架炮都算）、重型机甲伤害 +2" },
    veh_plating_1: { name: "车辆装甲一级", cost: { gold: 150 }, ticks: 600, effects: { tank: { armor: 1 }, mech: { armor: 1 }, warship: { armor: 1 } }, desc: "坦克、重型机甲、空中战舰护甲 +1" },
    main_cannon: { name: "主炮充能", cost: { gold: 150 }, ticks: 600, desc: `空中战舰能打主炮：花 150 能量打一个目标 ${CANNON_DAMAGE}` },
  }
}
