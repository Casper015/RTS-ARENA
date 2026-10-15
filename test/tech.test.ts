// 科技前置、研究、挂件、建筑起飞、能量技能、加快的增益、治疗、修理、护甲、坚守、巡逻、限时存在的召唤物（D-270）
import assert from "node:assert/strict"
import { test } from "node:test"
import type { Commands, Entity, GameEvent, View } from "../src/api/bot-api.ts"
import { runMatch } from "../src/core/match.ts"
import type { ModeSpec, RuleContext, Ruleset, SetupContext, TypeSpec } from "../src/core/types.ts"
import { checkRulesetData } from "../src/sandbox/rules-check.ts"
import { STANDARD_TERRAIN } from "../rulesets/common/standard.ts"
import { fnBot } from "./helpers.ts"

const look = { shape: "circle" as const }
const LIFT: ModeSpec[] = [
  { id: "land", name: "着陆", switchTicks: 2 },
  { id: "fly", name: "飞行", switchTicks: 2, layer: "air", moveTicks: 1 },
]
const TYPES: Record<string, TypeSpec> = {
  hq: { kind: "building", w: 2, h: 2, maxHp: 500, sight: 8, cost: { gold: 100 }, buildTicks: 100, produces: ["grunt", "elite"], addons: ["lab", "boost"], modes: LIFT, look },
  lab: { kind: "building", w: 2, h: 2, maxHp: 200, sight: 2, cost: { gold: 20 }, buildTicks: 4, addon: { parallel: 1 }, look },
  boost: { kind: "building", w: 2, h: 2, maxHp: 200, sight: 2, cost: { gold: 20 }, buildTicks: 4, addon: { parallel: 2 }, look },
  school: { kind: "building", maxHp: 200, sight: 4, cost: { gold: 10 }, buildTicks: 3, researches: ["plate", "plate2", "zap"], look },
  grunt: { kind: "unit", maxHp: 100, moveTicks: 1, sight: 6, cost: { gold: 10 }, buildTicks: 3, tags: ["bio"], attack: { damage: 10, range: 1, cooldown: 4 }, look },
  elite: { kind: "unit", maxHp: 100, moveTicks: 1, sight: 6, cost: { gold: 10 }, buildTicks: 3, requires: ["school"], needsAddon: "lab", look },
  shell: { kind: "unit", maxHp: 100, moveTicks: 1, sight: 6, armor: 3, tags: ["mech"], cost: { gold: 40 }, buildTicks: 20, look },
  gun: { kind: "unit", maxHp: 100, moveTicks: 1, sight: 8, attack: { damage: 10, range: 4, cooldown: 20, splash: 1 }, look },
  tank: {
    kind: "unit",
    maxHp: 100,
    moveTicks: 1,
    sight: 10,
    tags: ["mech"],
    attack: { damage: 5, range: 2, cooldown: 2 },
    modes: [
      { id: "move", name: "行进", switchTicks: 1 },
      { id: "siege", name: "架炮", switchTicks: 1, moveTicks: 0, attack: { damage: 20, range: 6, cooldown: 4 } },
    ],
    look,
  },
  doc: { kind: "unit", maxHp: 50, moveTicks: 1, sight: 6, tags: ["bio"], energy: { max: 10, start: 3, regenTicks: 100 }, heal: { amount: 5, range: 2, cooldown: 2, energy: 1, tags: ["bio"] }, look },
  fixer: { kind: "unit", maxHp: 50, moveTicks: 1, sight: 6, tags: ["bio"], repair: { tags: ["mech"] }, look },
  caster: {
    kind: "unit",
    maxHp: 100,
    moveTicks: 4,
    sight: 8,
    energy: { max: 100, start: 40, regenTicks: 2 },
    attack: { damage: 1, range: 1, cooldown: 10 },
    skills: [
      { id: "zap", name: "电击", cooldown: 1, target: "unit", range: 8, energy: 30, requires: "zap", desc: "打 50" },
      { id: "haste", name: "加速", cooldown: 50, desc: "移动、攻击快一倍" },
      { id: "summon", name: "召唤", cooldown: 50, target: "point", range: 8, desc: "召唤一个限时 10 tick 的步兵" },
    ],
    look,
  },
}
const RESEARCHES: Ruleset["researches"] = {
  plate: { name: "装甲", cost: { gold: 30 }, ticks: 5, effects: { grunt: { armor: 2, attack: { damage: 1 } }, tank: { attack: { damage: 2 } } }, desc: "装甲" },
  plate2: { name: "装甲二", cost: { gold: 30 }, ticks: 5, requires: ["plate"], effects: { grunt: { armor: 1 } }, desc: "装甲二" },
  zap: { name: "电击", cost: { gold: 10 }, ticks: 3, requires: ["school"], desc: "电击" },
}

type Spawn = [type: string, owner: number, x: number, y: number]

function mini(spawns: Spawn[], extra: Partial<Ruleset> = {}, rows: string[] = Array(10).fill(".".repeat(20))): Ruleset {
  return {
    id: "tech",
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
    researches: RESEARCHES,
    setup(ctx) {
      ctx.setTerrain(rows)
      for (const [type, owner, x, y] of spawns) ctx.spawn(type, owner, x, y)
      ctx.setResources(0, { gold: 1000 })
      ctx.setResources(1, { gold: 1000 })
    },
    onCast(ctx, c) {
      if (c.skill === "zap") ctx.damage(c.target!, 50, c.unit)
      if (c.skill === "haste") ctx.addBuff(c.unit, { name: "加速", speedPct: 100, ratePct: 100, ticks: 30 })
      if (c.skill === "summon") ctx.spawnNear("grunt", c.player, c.x!, c.y!, { lifetime: 10 })
      return null
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
const rejectedOf = (evs: GameEvent[]) => evs.filter((e): e is Extract<GameEvent, { kind: "rejected" }> => e.kind === "rejected").map((e) => e.reason)

test("研究（D-270）：排进队列、扣钱，好了按加多少改数值（每种状态都加），发事件、记进 view.researched；前置、重复、取消退钱", () => {
  const events: GameEvent[] = []
  const views: View[] = []
  play(mini([["school", 0, 1, 1], ["grunt", 0, 5, 5], ["tank", 0, 7, 5], ["grunt", 1, 18, 8]]), (v, cmd) => {
    events.push(...v.events)
    views.push(v)
    const school = one(v, "school")!
    if (v.tick === 0) {
      cmd.research(school, "plate2") // 要先研究 plate
      cmd.research(school, "plate")
      cmd.research(school, "plate") // 已经在研究
    }
    if (v.tick === 1) {
      cmd.research(school, "zap")
      cmd.cancel(school) // 取消最后一个（zap），退钱
    }
    if (v.tick === 12) cmd.mode(one(v, "tank")!, "siege")
  })
  const rej = rejectedOf(events)
  assert.equal(rej.length, 2, rej.join("；"))
  assert.match(rej[0], /要先研究装甲/)
  assert.match(rej[1], /已经在 #\d+（school）里研究了/)
  assert.equal(views[1].resources.gold, 970, "研究立即扣钱")
  assert.equal(views[2].resources.gold, 970, "取消退钱")
  const done = events.find((e) => e.kind === "researched")
  assert.ok(done && done.kind === "researched" && done.id === "plate")
  const after = views[10]
  assert.deepEqual(after.researched, ["plate"])
  assert.deepEqual(one(after, "grunt")!.stats, { armor: 2, attack: { damage: 11, range: 1, cooldown: 4 } })
  assert.equal(one(after, "tank")!.stats?.attack?.damage, 7)
  // 换到架炮：那个状态的伤害也加了 2
  const sieged = views.find((v) => v.tick > 12 && one(v, "tank")!.mode === "siege")!
  assert.equal(one(sieged, "tank")!.stats?.attack?.damage, 22)
  assert.equal(views[0].entities.find((e) => e.type === "school")!.queue?.length, 0)
  assert.deepEqual(views[1].entities.find((e) => e.type === "school")!.queue, [{ type: "plate", ticksLeft: 4, research: true }])
})

test("科技前置和挂件（D-270）：缺前置、缺挂件被拒；建筑自己在右边建挂件（期间不能生产），挡路的自己人挪开；反应挂件同时造两个", () => {
  const events: GameEvent[] = []
  const views: View[] = []
  play(
    mini([["hq", 0, 2, 2], ["grunt", 0, 4, 3]], { maxTicks: 30 }),
    (v, cmd) => {
      events.push(...v.events)
      views.push(v)
      const hq = one(v, "hq")!
      if (v.tick === 0) {
        cmd.produce(hq, "elite") // 没有 school
        cmd.addon(hq, "lab") // 右边 (4, 2) 2×2，grunt 站在 (4, 3) 被挪开
        cmd.produce(hq, "grunt") // 正在建挂件
      }
      if (v.tick === 8) {
        cmd.produce(hq, "grunt")
        cmd.produce(hq, "grunt")
      }
    },
  )
  const rej = rejectedOf(events)
  assert.equal(rej.length, 2, rej.join("；"))
  assert.match(rej[0], /要先有建好的 school/)
  assert.match(rej[1], /正在建挂件/)
  const v1 = views[1]
  const lab = one(v1, "lab")!
  assert.deepEqual([lab.x, lab.y], [4, 2])
  assert.ok(lab.construction, "挂件地基")
  const g = one(v1, "grunt")!
  assert.ok(g.x < 4 || g.x > 5 || g.y < 2 || g.y > 3, `挂件占地上的单位被挪开了：(${g.x}, ${g.y})`)
  const v7 = views[7]
  assert.equal(one(v7, "hq")!.addon, one(v7, "lab")!.id)
  assert.equal(one(v7, "lab")!.host, one(v7, "hq")!.id)
  assert.equal(one(v7, "lab")!.construction, undefined)
  // 科技挂件 parallel 1：两个排队的一个一个造
  const v10 = views[10]
  assert.deepEqual(one(v10, "hq")!.queue!.map((q) => q.ticksLeft), [1, 3])
})

test("反应挂件同时造两个；挂件要的兵种在别的挂件下造不了（D-270）", () => {
  const events: GameEvent[] = []
  const views: View[] = []
  play(mini([["hq", 0, 2, 2], ["school", 0, 0, 8]], { maxTicks: 20 }), (v, cmd) => {
    events.push(...v.events)
    views.push(v)
    const hq = one(v, "hq")!
    if (v.tick === 0) cmd.addon(hq, "boost")
    if (v.tick === 8) {
      cmd.produce(hq, "elite")
      cmd.produce(hq, "grunt")
      cmd.produce(hq, "grunt")
    }
  })
  assert.match(rejectedOf(events)[0], /要挂着建好的 lab/)
  assert.deepEqual(one(views[10], "hq")!.queue!.map((q) => q.ticksLeft), [1, 1])
})

test("建筑起飞、降落（D-270）：队列不空不能起飞；飞着能走、不能生产，挂件留在原地；落回原位又挂上，落地处的自己人挪开", () => {
  const events: GameEvent[] = []
  const views: View[] = []
  play(mini([["hq", 0, 2, 2]], { maxTicks: 40 }), (v, cmd) => {
    events.push(...v.events)
    views.push(v)
    const hq = one(v, "hq")!
    if (v.tick === 0) cmd.addon(hq, "lab")
    if (v.tick === 6) {
      cmd.produce(hq, "grunt")
      cmd.mode(hq, "fly") // 队列不空
    }
    if (v.tick === 12) cmd.mode(hq, "fly")
    if (v.tick === 16) {
      cmd.produce(hq, "grunt") // 飞着
      cmd.move(hq, 2, 6)
    }
    if (v.tick === 24) {
      cmd.move(hq, 2, 2)
      const g = one(v, "grunt")!
      cmd.move(g, 3, 3) // 站到落地的地方
    }
    if (v.tick === 32) cmd.mode(hq, "land")
  })
  const rej = rejectedOf(events)
  assert.equal(rej.length, 2, rej.join("；"))
  assert.match(rej[0], /正在生产，生产队列空了才能起飞/)
  assert.match(rej[1], /飞起来了/)
  const flying = views[16]
  assert.equal(one(flying, "hq")!.layer, "air")
  assert.equal(one(flying, "hq")!.addon, undefined, "起飞时挂件留在原地")
  assert.equal(one(flying, "lab")!.host, undefined)
  // 飞起来的建筑 move 是把左上角挪到目标格
  const moved = views[23]
  assert.deepEqual([one(moved, "hq")!.x, one(moved, "hq")!.y], [2, 6])
  const landed = views[views.length - 1]
  const hq = one(landed, "hq")!
  assert.equal(hq.mode, "land")
  assert.equal(hq.layer, undefined)
  assert.equal(hq.addon, one(landed, "lab")!.id, "落回原位又挂上")
  const g = one(landed, "grunt")!
  assert.ok(g.x < 2 || g.x > 3 || g.y < 2 || g.y > 3, `落地处的单位被挪开了：(${g.x}, ${g.y})`)
})

test("能量技能、加快的增益、直接伤害（D-270）：要先研究、能量不够被拒，放完扣能量；伤害算施法者的主人打死的；加速让走路、攻击变快", () => {
  const events: GameEvent[] = []
  const views: View[] = []
  play(mini([["school", 0, 1, 1], ["caster", 0, 4, 4], ["grunt", 1, 10, 4], ["grunt", 1, 10, 6]], { maxTicks: 30 }), (v, cmd) => {
    events.push(...v.events)
    views.push(v)
    const c = one(v, "caster")!
    const foes = v.entities.filter((e) => e.owner === 1)
    if (v.tick === 0) {
      cmd.cast(c, "zap", foes[0]) // 没研究
      cmd.research(one(v, "school")!, "zap")
    }
    if (v.tick === 5) cmd.cast(c, "zap", foes[0])
    if (v.tick === 6) cmd.cast(c, "zap", foes[0]) // 能量不够
    if (v.tick === 8) {
      cmd.cast(c, "haste")
      cmd.move(c, 4, 9)
    }
  })
  const rej = rejectedOf(events)
  assert.equal(rej.length, 2, rej.join("；"))
  assert.match(rej[0], /要先研究电击/)
  assert.match(rej[1], /要 30 点能量/)
  // 研究好时能量回到 40 + 2 = 42；放一下扣 30
  const after = views[7]
  assert.ok(one(after, "caster")!.energy! < 20, `能量 ${one(after, "caster")!.energy}`)
  assert.equal(after.entities.filter((e) => e.owner === 1)[0].hp, 50)
  // 加速：走一格 4 tick → 2 tick，5 格 10 tick 内走完
  const fast = views[19]
  assert.deepEqual([one(fast, "caster")!.y], [9])
  assert.deepEqual(one(fast, "caster")!.buffs?.[0], { name: "加速", damagePct: 0, defensePct: 0, speedPct: 100, ratePct: 100, ticksLeft: 20 })
})

test("直接伤害打死的算施法者的主人杀的（D-270）", () => {
  let killer = -2
  play(
    mini([["school", 0, 1, 1], ["caster", 0, 4, 4], ["grunt", 1, 10, 4]], {
      maxTicks: 20,
      researches: { ...RESEARCHES, zap: { ...RESEARCHES!.zap, ticks: 1 } },
      onCast(ctx, c) {
        ctx.damage(c.target!, 100, c.unit)
        return null
      },
      onTick(ctx) {
        for (const e of ctx.events) if (e.kind === "died" && e.type === "grunt") killer = e.killer
      },
    }),
    (v, cmd) => {
      if (v.tick === 0) cmd.research(one(v, "school")!, "zap")
      if (v.tick === 4) cmd.cast(one(v, "caster")!, "zap", v.entities.find((e) => e.owner === 1)!)
    },
  )
  assert.equal(killer, 0)
})

test("治疗（D-270）：给射程里受伤的、带标签的自己人回血，先治血最少的，每次花能量；能量用完就停；机械的不治", () => {
  const hp: number[][] = []
  play(
    mini([["doc", 0, 4, 4], ["grunt", 0, 5, 4], ["grunt", 0, 4, 5], ["tank", 0, 3, 4]], {
      maxTicks: 12,
      setup(setup) {
        const ctx = setup as SetupContext & RuleContext
        ctx.setTerrain(Array(10).fill(".".repeat(20)))
        ctx.spawn("doc", 0, 4, 4)
        const a = ctx.spawn("grunt", 0, 5, 4)
        const b = ctx.spawn("grunt", 0, 4, 5)
        const t = ctx.spawn("tank", 0, 3, 4)
        ctx.spawn("grunt", 1, 18, 8)
        ctx.setHp(a, 50)
        ctx.setHp(b, 80)
        ctx.setHp(t, 10)
      },
    }),
    (v, cmd) => {
      hp.push([...v.entities.filter((e) => e.owner === 0 && e.type !== "doc").map((e) => e.hp), one(v, "doc")!.energy!])
      if (v.tick === 0) for (const e of v.entities) if (e.owner === 0 && e.type !== "doc") cmd.hold(e)
    },
  )
  const last = hp[hp.length - 1]
  // 3 点能量治 3 次：50 → 55 → 60（血最少的先治）→ 65，80 的没轮到；坦克是机械的不治
  assert.ok(last.includes(65) && last.includes(80) && last.includes(10), JSON.stringify(hp))
  assert.equal(last[last.length - 1], 0)
})

test("修理（D-270）：工人走过去修机械单位，按修的比例花造价的 25%；修满停下；生物的修不了", () => {
  const events: GameEvent[] = []
  const views: View[] = []
  play(
    mini([], {
      maxTicks: 40,
      setup(setup) {
        const ctx = setup as SetupContext & RuleContext
        ctx.setTerrain(Array(10).fill(".".repeat(20)))
        ctx.spawn("fixer", 0, 1, 1)
        const s = ctx.spawn("shell", 0, 6, 1)
        const g = ctx.spawn("grunt", 0, 1, 5)
        ctx.spawn("grunt", 1, 18, 8)
        ctx.setHp(s, 60)
        ctx.setHp(g, 60)
        ctx.setResources(0, { gold: 100 })
      },
    }),
    (v, cmd) => {
      events.push(...v.events)
      views.push(v)
      if (v.tick === 0) {
        cmd.repair(one(v, "fixer")!, one(v, "grunt")!)
        cmd.repair(one(v, "fixer")!, one(v, "shell")!)
      }
    },
  )
  const rej = rejectedOf(events)
  assert.equal(rej.length, 1)
  assert.match(rej[0], /修不了/)
  const last = views[views.length - 1]
  assert.equal(one(last, "shell")!.hp, 100)
  assert.equal(one(last, "fixer")!.order?.kind, "idle")
  // 修了 40 血 = 40% 生命，花 40 × 25% × 40% = 4 金
  assert.equal(last.resources.gold, 96)
})

test("护甲（D-270）：每一下减护甲（至少 1）；溅射到的每个目标各按自己的护甲减", () => {
  const views: View[] = []
  play(
    mini([["gun", 0, 2, 4], ["shell", 1, 5, 4], ["grunt", 1, 5, 5]], {
      maxTicks: 3,
      types: { ...TYPES, grunt: { ...TYPES.grunt, armor: 12, attack: undefined } },
    }),
    (v, cmd) => {
      views.push(v)
      if (v.tick === 0) cmd.attack(one(v, "gun")!, one(v, "shell", 1)!)
    },
  )
  const v = views[views.length - 1]
  assert.equal(one(v, "shell", 1)!.hp, 93, "10 − 护甲 3")
  assert.equal(one(v, "grunt", 1)!.hp, 99, "溅射 10 − 护甲 12，至少 1")
})

test("坚守、巡逻（D-270）：坚守的不追，只打射程里的；巡逻在两点之间来回走", () => {
  const views: View[] = []
  play(
    mini([["grunt", 0, 2, 2], ["grunt", 0, 2, 9], ["grunt", 1, 5, 2]], { maxTicks: 30 }),
    (v, cmd) => {
      views.push(v)
      const [a, b] = v.entities.filter((e) => e.owner === 0)
      if (v.tick === 0) {
        cmd.hold(a.y === 2 ? a : b)
        cmd.patrol(a.y === 2 ? b : a, 6, 9)
      }
    },
    (v, cmd) => {
      // 对手站在射程外两格，坚守的不过去
      if (v.tick === 0) cmd.hold(one(v, "grunt")!)
    },
  )
  const xs = views.map((v) => v.entities.filter((e) => e.owner === 0).find((e) => e.y === 9)?.x)
  const holder = views.map((v) => v.entities.filter((e) => e.owner === 0).find((e) => e.y === 2)!.x)
  assert.ok(holder.every((x) => x === 2), "坚守的不动")
  // 巡逻：先到 6，再回到 2，再往 6 走
  const first6 = xs.indexOf(6)
  const back2 = xs.indexOf(2, first6)
  assert.ok(first6 > 0 && back2 > first6 && xs.indexOf(6, back2) > back2, JSON.stringify(xs))
  assert.equal(views[5].entities.find((e) => e.owner === 0 && e.y === 9)!.order?.kind, "patrol")
})

test("召唤物（D-270）：spawnNear 给 lifetime 的到时间消失（算移除、没有凶手），不占单位上限，bot 看得到还剩几 tick", () => {
  const views: View[] = []
  let removed = false
  play(
    mini([["caster", 0, 4, 4], ["grunt", 1, 18, 8]], {
      maxTicks: 20,
      unitCap: 1,
      onTick(ctx) {
        for (const e of ctx.events) if (e.kind === "died" && e.type === "grunt" && e.owner === 0) removed = e.removed === true && e.killer === -1
      },
    }),
    (v, cmd) => {
      views.push(v)
      if (v.tick === 0) cmd.cast(one(v, "caster")!, "summon", { x: 6, y: 4 })
    },
  )
  const g = one(views[3], "grunt")!
  assert.equal(g.lifeLeft, 8)
  assert.ok(!views[12].entities.some((e) => e.owner === 0 && e.type === "grunt"), "10 tick 后消失")
  assert.ok(removed)
})

test("格式检查（D-270）：研究、前置、挂件、能量、治疗、修理、建筑的状态、召唤物写错会报出来", () => {
  const rules = mini([])
  const bad = (types: Record<string, unknown>, researches?: unknown) =>
    checkRulesetData({ ...rules, types: { ...TYPES, ...types }, researches: researches ?? RESEARCHES }, ["setup", "objectives", "result", "timeUp", "onCast"]).join("\n")
  assert.equal(bad({}), "")
  assert.match(bad({ x: { ...TYPES.grunt, requires: ["nope"] } }), /types\.x\.requires 要是建筑类型名或研究 id/)
  assert.match(bad({ x: { ...TYPES.grunt, needsAddon: "school" } }), /needsAddon 要写挂件类型名/)
  assert.match(bad({ x: { ...TYPES.hq, addons: ["school"] } }), /addons 要是挂件类型名的数组/)
  assert.match(bad({ x: { ...TYPES.school, researches: ["nope"] } }), /researches 要是规则包 researches 里的 id/)
  assert.match(bad({ x: { ...TYPES.doc, energy: undefined } }), /heal\.energy：要写 energy/)
  assert.match(bad({ x: { ...TYPES.school, repair: { tags: ["mech"] } } }), /只有单位能修理/)
  assert.match(bad({ x: { ...TYPES.hq, modes: [LIFT[0], { id: "fly", name: "飞", layer: "air" }] } }), /建筑飞起来的状态要写 moveTicks/)
  assert.match(bad({ x: { ...TYPES.school, lifetime: 5 } }), /lifetime：只有单位能写/)
  assert.match(bad({}, { plate: { name: "装甲", cost: { gold: 1 }, ticks: 1, desc: "x", effects: { grunt: { hp: 1 } } } }), /只能加 maxHp/)
  assert.match(bad({}, { grunt: { name: "装甲", cost: { gold: 1 }, ticks: 1, desc: "x" } }), /研究 id 不能和类型名一样/)
  assert.match(bad({ x: { ...TYPES.caster, skills: [{ ...TYPES.caster.skills![0], requires: "nope" }] } }), /skills\[0\]\.requires 要写规则包 researches 里的 id/)
})
