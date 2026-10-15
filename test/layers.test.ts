// 空中、地下、大型单位、几种状态、驻扎（D-269）：内核的移动、找目标、探测、切换、进出建筑，以及格式检查
import assert from "node:assert/strict"
import { test } from "node:test"
import type { Commands, Entity, GameEvent, View } from "../src/api/bot-api.ts"
import { runMatch } from "../src/core/match.ts"
import type { Ruleset, TypeSpec } from "../src/core/types.ts"
import { checkRulesetData } from "../src/sandbox/rules-check.ts"
import { STANDARD_TERRAIN } from "../rulesets/common/standard.ts"
import { fnBot } from "./helpers.ts"

const look = { shape: "circle" as const }
const TYPES: Record<string, TypeSpec> = {
  grunt: { kind: "unit", maxHp: 100, moveTicks: 1, sight: 6, attack: { damage: 10, range: 1, cooldown: 2 }, look },
  flak: { kind: "unit", maxHp: 100, moveTicks: 1, sight: 6, attack: { damage: 10, range: 3, cooldown: 2, hits: ["air"] }, look },
  flyer: { kind: "unit", layer: "air", maxHp: 50, moveTicks: 1, sight: 6, attack: { damage: 5, range: 1, cooldown: 2, hits: ["ground", "air"] }, look },
  big: { kind: "unit", w: 2, h: 2, maxHp: 300, moveTicks: 1, sight: 6, look },
  tank: {
    kind: "unit",
    maxHp: 100,
    moveTicks: 1,
    sight: 10,
    attack: { damage: 5, range: 2, cooldown: 2 },
    modes: [
      { id: "move", name: "行进", switchTicks: 3 },
      { id: "siege", name: "架炮", switchTicks: 5, moveTicks: 0, attack: { damage: 20, range: 6, cooldown: 4 } },
    ],
    look,
  },
  mine: {
    kind: "unit",
    maxHp: 20,
    moveTicks: 1,
    sight: 2,
    modes: [
      { id: "roll", name: "移动", switchTicks: 2 },
      { id: "buried", name: "埋设", switchTicks: 3, moveTicks: 0, layer: "under", attack: { damage: 50, range: 1, cooldown: 1, splash: 1, suicide: true } },
    ],
    look,
  },
  eye: { kind: "building", maxHp: 100, sight: 5, detect: 5, look },
  bunker: { kind: "building", w: 2, h: 2, maxHp: 200, sight: 4, garrison: { capacity: 2, types: ["grunt"], rangeBonus: 1 }, look },
}

type Spawn = [type: string, owner: number, x: number, y: number]

function mini(spawns: Spawn[], rows: string[] = Array(8).fill(".".repeat(16)), extra: Partial<Ruleset> = {}): Ruleset {
  return {
    id: "layers",
    name: "测试",
    players: { min: 2, max: 2 },
    maxTicks: 40,
    tickRate: 10,
    decisionInterval: 1,
    fuel: 100,
    unitCap: 0,
    fog: false,
    resources: ["gold"],
    terrain: STANDARD_TERRAIN,
    types: TYPES,
    setup(ctx) {
      ctx.setTerrain(rows)
      for (const [type, owner, x, y] of spawns) ctx.spawn(type, owner, x, y)
    },
    objectives: () => ({}),
    result: () => null,
    timeUp: () => ({ winner: null, reason: "到时间" }),
    ...extra,
  }
}

function play(rules: Ruleset, p0: (view: View, cmd: Commands) => void, p1: (view: View, cmd: Commands) => void = () => {}) {
  return runMatch({ ruleset: rules, seed: 1, bots: [{ name: "a", file: "", runner: fnBot(p0) }, { name: "b", file: "", runner: fnBot(p1) }] })
}

const one = (v: View, type: string, owner = v.me): Entity | undefined => v.entities.find((e) => e.owner === owner && e.type === type)
const rejectedOf = (evs: GameEvent[]) => evs.filter((e): e is Extract<GameEvent, { kind: "rejected" }> => e.kind === "rejected")

/** 中间一道从上到下的墙（x = 8），gaps 是开口的行 */
function wall(gaps: number[] = []): string[] {
  return Array.from({ length: 8 }, (_, y) => ".".repeat(8) + (gaps.includes(y) ? "." : "#") + ".".repeat(7))
}

test("空中单位（D-269）：飞过墙，直线走到；地面单位过不去", () => {
  const seen: { tick: number; flyer?: Entity; grunt?: Entity }[] = []
  play(mini([["flyer", 0, 2, 3], ["grunt", 0, 2, 5], ["grunt", 1, 14, 0]], wall()), (v, cmd) => {
    const flyer = one(v, "flyer")
    const grunt = one(v, "grunt")
    seen.push({ tick: v.tick, flyer, grunt })
    if (v.tick === 0) {
      cmd.move(flyer!, 13, 3)
      cmd.move(grunt!, 13, 5)
    }
  })
  const at = seen.find((s) => s.flyer && s.flyer.x === 13 && s.flyer.y === 3)
  assert.ok(at && at.tick <= 13, "空中单位 11 步直线飞到")
  assert.equal(at!.flyer!.layer, "air")
  assert.ok(seen.every((s) => !s.grunt || s.grunt.x < 8), "地面单位过不了墙")
})

test("空中单位（D-269）：只打地面的打不到它，能打空中的打得到；只打地面的对它下 attack 被拒", () => {
  const hitsOnFlyer: GameEvent[] = []
  let rejected: string[] = []
  play(
    mini([["flyer", 0, 5, 3], ["grunt", 1, 5, 4], ["flak", 1, 5, 6]]),
    (v) => {
      for (const ev of v.events) if (ev.kind === "damaged") hitsOnFlyer.push(ev)
    },
    (v, cmd) => {
      if (v.tick === 1) cmd.attack(one(v, "grunt")!, one(v, "flyer", 0)!)
      rejected = rejected.concat(rejectedOf(v.events).map((e) => e.reason))
    },
  )
  assert.ok(hitsOnFlyer.length > 0)
  assert.ok(hitsOnFlyer.every((e) => e.kind === "damaged" && e.byType === "flak"), "只有防空的打它")
  assert.ok(rejected.some((r) => r.includes("打不到空中")), rejected.join("；"))
})

test("大型单位（D-269）：2×2 走得下的开口才走，整块不压墙；占的 4 格别的单位站不上", () => {
  const rows = wall([1, 5, 6])
  let passedAt: number[] = []
  let arrived = false
  play(mini([["big", 0, 2, 2], ["grunt", 0, 5, 7]], rows), (v, cmd) => {
    const big = one(v, "big")!
    for (let y = big.y; y < big.y + 2; y++) for (let x = big.x; x < big.x + 2; x++) assert.equal(rows[y][x], ".", `第 ${v.tick} tick 压到墙了 (${x}, ${y})`)
    if (big.x <= 8 && big.x + 1 >= 8) passedAt.push(big.y)
    if (big.x <= 12 && big.x + 1 >= 12 && big.y <= 2 && big.y + 1 >= 2) arrived = true
    if (v.tick === 0) cmd.move(big, 12, 2)
  })
  assert.ok(arrived, "走到了")
  passedAt = [...new Set(passedAt)]
  assert.deepEqual(passedAt, [5], "从两格宽的开口过墙（一格宽的那个过不去）")
})

test("几种状态（D-269）：架炮要换 5 tick，换的时候不能打、不能走；换好射程变远、不能移动；换回来又能走", () => {
  const log: { tick: number; mode?: string; switching?: { to: string; ticksLeft: number }; hasStats: boolean }[] = []
  const reasons: string[] = []
  const dmg: number[] = []
  play(
    mini([["tank", 0, 2, 3], ["grunt", 1, 7, 3]]),
    (v, cmd) => {
      const t = one(v, "tank")!
      log.push({ tick: v.tick, mode: t.mode, switching: t.switching, hasStats: t.stats !== undefined })
      reasons.push(...rejectedOf(v.events).map((e) => e.reason))
      if (v.tick === 1) cmd.mode(t, "siege")
      if (v.tick === 3) cmd.move(t, 2, 0)
      if (v.tick === 12) cmd.move(t, 2, 0)
      if (v.tick === 20) cmd.mode(t, "move")
      if (v.tick === 26) cmd.move(t, 2, 0)
    },
    (v) => {
      for (const ev of v.events) if (ev.kind === "damaged") dmg.push(ev.tick, ev.damage)
    },
  )
  assert.equal(log[0].mode, "move")
  assert.deepEqual(log.find((l) => l.tick === 2)?.switching, { to: "siege", ticksLeft: 4 })
  assert.ok(reasons.some((r) => r.includes("正在换状态")), "换的时候下 move 被拒")
  const ready = log.find((l) => l.mode === "siege")!
  assert.ok(ready.tick >= 6 && ready.tick <= 8, `换好的 tick：${ready.tick}`)
  assert.equal(ready.hasStats, false, "状态的数值不算被规则包改过")
  assert.ok(reasons.some((r) => r.includes("不能移动")), "架炮时不能走")
  assert.ok(dmg.length > 0 && dmg[0] >= 6 && dmg[1] === 20, `架炮后射程 6 打得到 5 格外的枪兵、一下 20：${dmg.slice(0, 4).join(",")}`)
  const back = log.find((l) => l.tick > 20 && l.mode === "move")!
  assert.ok(back.tick >= 23, "换回来要 3 tick")
  assert.ok(log.some((l) => l.tick > 27) && reasons.filter((r) => r.includes("不能移动")).length === 1, "换回来以后能走")
})

test("地下单位（D-269）：埋下的地雷对手看不见，走到旁边就炸（溅射、自己也没了）；有探测的看得见、能下 attack", () => {
  let p1SawMine = false
  let grunt: Entity | undefined
  let mineDied = false
  play(
    mini([["mine", 0, 5, 3], ["grunt", 1, 12, 3]]),
    (v, cmd) => {
      if (v.tick === 1) cmd.mode(one(v, "mine")!, "buried")
      if (v.events.some((e) => e.kind === "died" && e.type === "mine")) mineDied = true
    },
    (v, cmd) => {
      if (v.tick > 5 && one(v, "mine", 0)) p1SawMine = true
      grunt = one(v, "grunt") ?? grunt
      if (v.tick === 8) cmd.move(one(v, "grunt")!, 1, 3)
    },
  )
  assert.equal(p1SawMine, false, "没有探测看不见埋下的地雷")
  assert.ok(mineDied, "地雷炸了，自己也没了")
  assert.equal(grunt!.hp, 50, "枪兵挨了 50")
  // 有探测的建筑：看得见、能下 attack
  let seen: Entity | undefined
  let reasons: string[] = []
  play(
    mini([["mine", 0, 5, 3], ["eye", 1, 8, 1], ["grunt", 1, 12, 6]]),
    (v, cmd) => {
      if (v.tick === 1) cmd.mode(one(v, "mine")!, "buried")
    },
    (v, cmd) => {
      seen = one(v, "mine", 0) ?? seen
      if (v.tick === 10) cmd.attack(one(v, "grunt")!, one(v, "mine", 0)!)
      reasons = reasons.concat(rejectedOf(v.events).map((e) => e.reason))
    },
  )
  assert.equal(seen?.layer, "under")
  assert.equal(seen?.mode, "buried")
  assert.deepEqual(reasons, [])
})

test("驻扎（D-269）：钻进地堡后对手看不见、打不到，从地堡开火射程 +1；unload 放到旁边；地堡被拆时里面的被放出来", () => {
  let p1SawGrunt = false
  let p0: { grunt?: Entity; bunker?: Entity }[] = []
  const hitsOnP1: string[] = []
  play(
    mini([["bunker", 0, 6, 3], ["grunt", 0, 3, 3], ["grunt", 1, 9, 3]]),
    (v, cmd) => {
      const g = one(v, "grunt")!
      const b = one(v, "bunker")!
      p0.push({ grunt: g, bunker: b })
      if (v.tick === 0) cmd.enter(g, b)
      if (v.tick === 25) cmd.unload(b)
    },
    (v) => {
      if (v.tick > 6 && v.tick < 25 && one(v, "grunt", 0)) p1SawGrunt = true
      for (const ev of v.events) if (ev.kind === "damaged") hitsOnP1.push(ev.byType)
    },
  )
  const inside = p0.find((s) => s.grunt?.inside)
  assert.ok(inside, "钻进去了")
  assert.deepEqual(inside!.bunker!.garrison, [inside!.grunt!.id])
  assert.equal(p1SawGrunt, false, "对手看不见里面的兵")
  assert.ok(hitsOnP1.includes("grunt"), "从地堡里打到 2 格外的敌人（射程 1 + 1）")
  const out = p0.find((s, i) => i > 25 && s.grunt && !s.grunt.inside)!
  assert.ok(out && Math.abs(out.grunt!.x - 6.5) <= 2 && out.bunker!.garrison!.length === 0, "unload 放到旁边")
  // 地堡被拆：里面的被放出来，不跟着死
  const ruled = mini([["bunker", 0, 6, 3], ["grunt", 0, 5, 3]], undefined, {
    onTick(ctx) {
      if (ctx.tick === 10) ctx.setHp(ctx.entities({ type: "bunker" })[0].id, 0)
    },
  })
  let after: Entity | undefined
  play(ruled, (v, cmd) => {
    const g = one(v, "grunt")!
    if (v.tick === 0) cmd.enter(g, one(v, "bunker")!)
    if (v.tick > 10) after = g
  })
  assert.ok(after && !after.inside && after.hp === 100, "地堡没了，兵在原地附近、满血")
})

test("格式检查（D-269）：单位最大 3×3，层、探测、状态、驻扎、能打哪一层的写法", () => {
  const base = mini([])
  const check = (types: Record<string, unknown>) => checkRulesetData({ ...base, types: { ...TYPES, ...types } } as never, ["setup", "objectives", "result", "timeUp"])
  assert.deepEqual(check({}), [])
  assert.ok(check({ huge: { kind: "unit", w: 4, look } }).some((e) => e.includes("最大 3×3")))
  assert.ok(check({ hut: { kind: "building", layer: "air", look } }).some((e) => e.includes("layer")))
  assert.ok(check({ x: { kind: "unit", attack: { damage: 1, range: 1, cooldown: 1, hits: ["sea"] }, look } }).some((e) => e.includes("hits")))
  assert.ok(check({ x: { kind: "unit", modes: [{ id: "a", name: "甲", moveTicks: 2 }, { id: "b", name: "乙" }], look } }).some((e) => e.includes("第一个状态")))
  assert.ok(check({ x: { kind: "unit", garrison: { capacity: 2 }, look } }).some((e) => e.includes("只有建筑")))
})
