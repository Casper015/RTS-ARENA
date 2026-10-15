// 立体战线的单位和建筑（D-269）：用来演示、检验平台的空中和地下单位、多格的大型单位、两种状态切换、驻扎。
// - 步枪兵：便宜，地面、空中都打得到，能进地堡；
// - 坦克：两种状态。行进时能走、射程 5；架炮后不能走，射程 9、一下 40、溅射一格，切换 40 tick；
// - 地雷：两种状态。移动时跑得快、不能打；埋设后钻到地下（对手要防空塔探测到才看得见），敌方地面单位走到旁边就炸（溅射一格），炸完自己也没了；
// - 重型机甲：2×2 的大型地面单位，又慢又硬，地面、空中都打，打空中战舰 ×2；
// - 空中战舰：2×2 的空中单位，飞过一切，地面、空中都打，只有步枪兵、重型机甲、防空塔打得到它；
// - 地堡：最多进 4 个步枪兵，在里面的对手看不见、打不到，射程 +1；
// - 防空塔：只打空中，能探测地下的地雷（7 格）。
import type { TypeSpec } from "../../src/core/types.ts"
import { frontierTypes } from "../common/frontier.ts"

/** 立体战线的单位和建筑（每次返回新对象） */
export function combinedTypes(): Record<string, TypeSpec> {
  const f = frontierTypes()
  const art = (name: string) => `art/${name}.svg`
  const building = (name: string, label: string, w: number, h: number, gold: number, buildTicks: number, maxHp: number, extra: Partial<TypeSpec> = {}): TypeSpec => ({
    kind: "building",
    w,
    h,
    maxHp,
    cost: { gold },
    buildTicks,
    sight: 5,
    look: { shape: "hex", label, name, art: { sprite: art(extra.look?.art?.sprite ?? labelArt[label]) } },
    ...extra,
  })
  const labelArt: Record<string, string> = { 车: "factory", 机: "airport", 堡: "bunker", 塔: "turret" }
  return {
    base: { ...f.base, look: { ...f.base.look, name: "主基地" } },
    worker: { ...f.worker, builds: ["barracks", "factory", "airport", "bunker", "turret", "depot"], look: { ...f.worker.look, name: "工人" } },
    goldmine: f.goldmine,
    depot: { ...f.depot, look: { ...f.depot.look, name: "仓库" } },
    barracks: { ...f.barracks, produces: ["rifleman"], look: { ...f.barracks.look, name: "兵营" } },
    factory: building("战车工厂", "车", 3, 2, 200, 300, 1000, { produces: ["tank", "mine", "mech"] }),
    airport: building("机场", "机", 3, 2, 250, 360, 900, { produces: ["warship"] }),
    // 地堡：最多 4 个步枪兵，从里面开火射程 +1（D-269 驻扎）
    bunker: building("地堡", "堡", 2, 2, 100, 200, 700, { sight: 7, garrison: { capacity: 4, types: ["rifleman"], rangeBonus: 1 } }),
    // 防空塔：只打空中，探测 7 格内的地下单位（D-269 层、探测）
    turret: building("防空塔", "塔", 1, 1, 100, 160, 450, { sight: 8, detect: 7, attack: { damage: 18, range: 7, cooldown: 10, hits: ["air"] } }),
    // 步枪兵：地面、空中都打
    rifleman: {
      kind: "unit",
      maxHp: 60,
      cost: { gold: 60 },
      buildTicks: 50,
      moveTicks: 4,
      sight: 6,
      attack: { damage: 8, range: 4, cooldown: 10, hits: ["ground", "air"] },
      look: { shape: "triangle", label: "枪", name: "步枪兵", art: { sprite: art("rifleman") } },
    },
    // 坦克：行进 / 架炮（D-269 两种状态）
    tank: {
      kind: "unit",
      maxHp: 170,
      cost: { gold: 150 },
      buildTicks: 120,
      moveTicks: 5,
      sight: 8,
      attack: { damage: 15, range: 5, cooldown: 15 },
      modes: [
        { id: "move", name: "行进", switchTicks: 30 },
        { id: "siege", name: "架炮", switchTicks: 40, moveTicks: 0, sight: 10, attack: { damage: 40, range: 9, cooldown: 30, splash: 1, vs: { rifleman: 1.5 } }, look: { label: "炮", art: { sprite: art("tank-siege") } } },
      ],
      look: { shape: "square", label: "坦", name: "坦克", art: { sprite: art("tank") } },
    },
    // 地雷：移动 / 埋设（埋设后在地下，D-269 层；敌方地面单位贴过来就炸，炸完自己没了）
    mine: {
      kind: "unit",
      maxHp: 25,
      cost: { gold: 30 },
      buildTicks: 30,
      moveTicks: 2,
      sight: 4,
      modes: [
        { id: "roll", name: "移动", switchTicks: 20 },
        { id: "buried", name: "埋设", switchTicks: 20, moveTicks: 0, layer: "under", attack: { damage: 80, range: 1, cooldown: 1, splash: 1, suicide: true }, look: { art: { sprite: art("mine-buried") } } },
      ],
      look: { shape: "circle", label: "雷", name: "地雷", art: { sprite: art("mine") } },
    },
    // 重型机甲：2×2 的大型地面单位（D-269），地面、空中都打，打空中战舰 ×2
    mech: {
      kind: "unit",
      w: 2,
      h: 2,
      maxHp: 520,
      cost: { gold: 300 },
      buildTicks: 200,
      moveTicks: 7,
      sight: 7,
      attack: { damage: 22, range: 6, cooldown: 20, hits: ["ground", "air"], vs: { warship: 2 } },
      look: { shape: "hex", label: "甲", name: "重型机甲", art: { sprite: art("mech") } },
    },
    // 空中战舰：2×2 的空中单位（D-269），飞过一切
    warship: {
      kind: "unit",
      w: 2,
      h: 2,
      layer: "air",
      maxHp: 600,
      cost: { gold: 350 },
      buildTicks: 220,
      moveTicks: 6,
      sight: 9,
      attack: { damage: 30, range: 6, cooldown: 20, hits: ["ground", "air"] },
      look: { shape: "diamond", label: "舰", name: "空中战舰", art: { sprite: art("warship") } },
    },
  }
}
