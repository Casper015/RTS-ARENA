import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { referenceBots } from "../src/cli/catalog.ts"
import { buildDts, buildPrompt, rulesetDir, typecheck } from "../src/cli/docgen.ts"
import { runMatch } from "../src/core/match.ts"
import { gameSeatStats } from "../src/cli/league-stats.ts"
import type { Replay, Ruleset } from "../src/core/types.ts"
import { compileBot, createBot } from "../src/sandbox/quickjs.ts"
import annihilation from "../rulesets/annihilation/index.ts"
import frontier from "../rulesets/frontier/index.ts"
import gunpowder from "../rulesets/gunpowder/index.ts"
import harvest from "../rulesets/harvest/index.ts"
import koth from "../rulesets/koth/index.ts"
import melee from "../rulesets/melee/index.ts"
import beacons from "../rulesets/beacons/index.ts"
import wildHerd from "../rulesets/wild-herd/index.ts"
import caravanRaid from "../rulesets/caravan-raid/index.ts"
import flagRun from "../rulesets/flag-run/index.ts"
import counterAnnihilation from "../rulesets/counter-annihilation/index.ts"
import counterFrontier from "../rulesets/counter-frontier/index.ts"
import regicideAnnihilation from "../rulesets/regicide-annihilation/index.ts"
import siegeFrontier from "../rulesets/siege-frontier/index.ts"
import { fnBot, idle } from "./helpers.ts"

const ROOT = join(import.meta.dirname, "..")
/** 从不进攻的陪练（D-251 攻城拓荒 hog：抢钱队友），打不动的对手也赢不了 */
const NEVER_ATTACKS = new Set(["siege-frontier/hog", "gunpowder/hog"])

const load = async (rules: Ruleset, file: string, p: number) => {
  const c = compileBot(readFileSync(file, "utf8"))
  if ("error" in c) throw new Error(c.error)
  return { name: file, file, runner: await createBot(c.code, p, { fuel: rules.fuel }) }
}

for (const rules of [annihilation, koth, harvest, melee, frontier, gunpowder, beacons, wildHerd, caravanRaid, flagRun, counterAnnihilation, counterFrontier, regicideAnnihilation, siegeFrontier] as Ruleset[]) {
  test(`示例 bot 能通过「${rules.name}」生成的 arena.d.ts 类型检查`, () => {
    const dir = join(ROOT, "rulesets", rules.id, "bots")
    const files = [join(ROOT, "bots", "idle.ts"), ...readdirSync(dir).map((f) => join(dir, f))]
    assert.equal(typecheck(rules, rulesetDir(rules.id), files), "")
  })

  test(`「${rules.name}」自己加的实体类型都写了中文名（look.name，视频图例和战况用）`, () => {
    const common = new Set(["base", "barracks", "worker", "soldier", "archer", "goldmine", "tower", "depot"])
    for (const [k, t] of Object.entries(rules.types)) if (!common.has(k) || (k === "tower" && rules.id === "flag-run")) assert.ok(t.look.name, `${k} 没写 look.name`)
  })

  test(`「${rules.name}」的参考 bot 和规则包放在一起，每个都写了打法、列进 PROMPT.md，至少有 3 种打法`, () => {
    const bots = referenceBots(rulesetDir(rules.id))
    const own = bots.filter((b) => b.name !== "idle")
    assert.ok(own.length >= 3, own.map((b) => b.name).join("、"))
    assert.equal(own[0].name, "baseline")
    const prompt = buildPrompt(rules, rulesetDir(rules.id), buildDts(rules, rulesetDir(rules.id)))
    // 说明书一开头就要求自己跑对战（有的 agent 只写代码不执行命令），排在「玩法」之前
    const runFirst = prompt.indexOf("## 最重要：写完必须自己跑对战")
    assert.ok(runFirst > 0 && runFirst < prompt.indexOf("## 玩法"))
    assert.match(prompt, /rts-arena league\s+# 3\. 和所有参考 bot 循环对打/)
    for (const b of bots) {
      assert.ok(b.file.startsWith(b.name === "idle" ? join(ROOT, "bots") : join(ROOT, "rulesets", rules.id, "bots")), b.file)
      assert.ok(b.about.length >= 10, `${b.name} 第一行没写打法`)
      // 只取第一行：要是一句完整的话（以句号结尾），别写成半句，list 和说明书里看着像被截断了
      assert.match(b.about, /。$/, `${b.name} 的第一行要以句号结尾`)
      assert.ok(prompt.includes(`| \`${b.name}\` | ${b.about} |`), `PROMPT.md 里没有 ${b.name}`)
    }
  })

  for (const b of referenceBots(rulesetDir(rules.id)).filter((x) => x.name !== "idle" && x.name !== "baseline"))
    test(`「${rules.name}」的参考 bot ${b.name} 打不动的对手：能赢，不报错、不被拒命令${NEVER_ATTACKS.has(`${rules.id}/${b.name}`) ? "（从不进攻的陪练：不输就行）" : ""}`, async () => {
      const replay = runMatch({ ruleset: rules, seed: 2, bots: [await load(rules, join(ROOT, "bots", "idle.ts"), 0), await load(rules, b.file, 1)] })
      if (NEVER_ATTACKS.has(`${rules.id}/${b.name}`)) assert.notEqual(replay.result.winner, 0, replay.result.reason)
      else assert.equal(replay.result.winner, 1, replay.result.reason)
      assert.equal(replay.bots[1].errors + replay.bots[1].fuelOuts + replay.bots[1].rejected, 0)
    })

  test(`「${rules.name}」的基准 bot 在沙箱里能打赢不动的对手`, async () => {
    const replay = runMatch({
      ruleset: rules,
      seed: 1,
      bots: [await load(rules, join(ROOT, "rulesets", rules.id, "bots", "baseline.ts"), 0), await load(rules, join(ROOT, "bots", "idle.ts"), 1)],
    })
    assert.equal(replay.result.winner, 0, replay.result.reason)
    assert.equal(replay.bots[0].errors + replay.bots[0].fuelOuts + replay.bots[0].rejected, 0)
  })
}

test("拓荒：基准 bot 自己建兵营、箭塔、仓库，打赢速攻", async () => {
  const replay = runMatch({
    ruleset: frontier,
    seed: 1,
    bots: [await load(frontier, join(ROOT, "rulesets", "frontier", "bots", "baseline.ts"), 0), await load(frontier, join(ROOT, "rulesets", "frontier", "bots", "rush.ts"), 1)],
  })
  assert.equal(replay.result.winner, 0, replay.result.reason)
  assert.equal(replay.bots[0].errors + replay.bots[0].fuelOuts + replay.bots[0].rejected, 0)
  const built = new Set<string>()
  const owner = new Map(replay.initial.entities.map((e) => [e.id, e]))
  for (const f of replay.frames) {
    for (const e of f.spawn ?? []) owner.set(e.id, e)
    const bp = f.bp ?? []
    for (let i = 0; i < bp.length; i += 2) {
      const e = owner.get(bp[i])!
      if (bp[i + 1] === 100 && e.owner === 0) built.add(e.type)
    }
  }
  assert.deepEqual([...built].sort(), ["barracks", "depot", "tower"])
})

test("类型不对的 bot 过不了检查", () => {
  const bad = join(ROOT, "test", "fixtures", "bad-bot.ts")
  const out = typecheck(harvest, rulesetDir("harvest"), [bad])
  assert.match(out, /enemyBases/)
})

test("混战：三家里基准 bot 把两个不动的对手打出局，名次按出局先后", async () => {
  const idle = join(ROOT, "bots", "idle.ts")
  const replay = runMatch({
    ruleset: melee,
    seed: 2,
    bots: [await load(melee, idle, 0), await load(melee, join(ROOT, "rulesets", "melee", "bots", "baseline.ts"), 1), await load(melee, idle, 2)],
  })
  const r = replay.result
  assert.equal(r.winner, 1, r.reason)
  assert.equal(r.ranking!.length, 3)
  assert.deepEqual(r.ranking![0], [1])
  // 出局的两家：先出局的排最后
  const outOrder = [...r.ranking![2], ...r.ranking![1]]
  assert.deepEqual([...outOrder].sort(), [0, 2])
  // 出局后不再有那两家的实体
  const owners = new Set<number>()
  const ents = new Map(replay.initial.entities.map((e) => [e.id, e.owner]))
  for (const f of replay.frames) {
    for (const s of f.spawn ?? []) ents.set(s.id, s.owner)
    for (const id of f.die ?? []) ents.delete(id)
  }
  for (const owner of ents.values()) owners.add(owner)
  assert.ok(!owners.has(0) && !owners.has(2))
})

test("混战 2v2：按队伍判胜负，什么都不做的队友也算赢", async () => {
  const idle = join(ROOT, "bots", "idle.ts")
  const base = join(ROOT, "rulesets", "melee", "bots", "baseline.ts")
  const replay = runMatch({
    ruleset: melee,
    seed: 3,
    teams: [0, 0, 1, 1],
    bots: [await load(melee, base, 0), await load(melee, idle, 1), await load(melee, idle, 2), await load(melee, idle, 3)],
  })
  const r = replay.result
  assert.deepEqual(r.winners, [0, 1], r.reason)
  assert.deepEqual(r.ranking, [
    [0, 1],
    [2, 3],
  ])
  assert.deepEqual(
    replay.players.map((p) => p.team),
    [0, 0, 1, 1],
  )
})

test("同一 tick 各家的命令按这次调用用的燃料从少到多执行（D-251）：共用金子只够一个工人时燃料少的队友拿到，一样多的随机先后", () => {
  // 开局整队只有 50 金：两个队友第 0 tick 都要在主基地造一个工人（50 金）
  const poor: Ruleset = {
    ...siegeFrontier,
    maxTicks: 3,
    setup(ctx) {
      siegeFrontier.setup(ctx)
      for (let p = 0; p < ctx.playerCount; p++) ctx.setResources(p, { gold: 50 })
    },
  }
  const worker = (fuel: number) => {
    const r = fnBot((v, cmd) => {
      const b = v.entities.find((e) => e.owner === v.me && e.type === "base")
      if (v.tick === 0 && b) cmd.produce(b, "worker")
    })
    return { ...r, tick: (json: string) => ({ ...r.tick(json), fuel }) }
  }
  const play = (f0: number, f1: number, seed = 1): Replay =>
    runMatch({ ruleset: poor, seed, teams: [0, 0, 1, 1], bots: [0, 1, 2, 3].map((p) => ({ name: `b${p}`, file: "", runner: p === 0 ? worker(f0) : p === 1 ? worker(f1) : idle() })) })
  const got = (r: Replay) => [0, 1].filter((p) => r.bots[p].rejected === 0)
  assert.deepEqual(got(play(5, 0)), [1], "P1 燃料少，先扣到钱")
  assert.deepEqual(got(play(0, 5)), [0])
  const first = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => got(play(2, 2, seed))[0]))
  assert.deepEqual([...first].sort(), [0, 1], "燃料一样多时谁先随种子变")
})

test("攻城拓荒 3～4 人（D-244、D-245、D-261）：80×56 四角，2v2 队友坐相邻的角、共用一份金子（开局整队 600），各自为战每人 300", async () => {
  const idle = join(ROOT, "bots", "idle.ts")
  const baseline = join(ROOT, "rulesets", "siege-frontier", "bots", "baseline.ts")
  const team = runMatch({
    ruleset: { ...siegeFrontier, maxTicks: 600 },
    seed: 3,
    teams: [0, 0, 1, 1],
    bots: [await load(siegeFrontier, baseline, 0), await load(siegeFrontier, idle, 1), await load(siegeFrontier, idle, 2), await load(siegeFrontier, idle, 3)],
  })
  assert.deepEqual([team.map.width, team.map.height], [80, 56])
  assert.equal(team.sharedResources, true)
  const bases = team.initial.entities.filter((e) => e.type === "base").sort((a, b) => a.owner - b.owner)
  assert.deepEqual(bases.map((b) => [b.x, b.y]), [[3, 3], [3, 50], [74, 50], [74, 3]], "队友（P0、P1）坐左边相邻的两个角")
  assert.deepEqual(team.initial.players.map((p) => p.resources.gold), [600, 600, 600, 600])
  // 只有 P0 在花钱、采矿：队友 P1 的金子一直跟着变，另一队不动
  let moved = false
  for (const f of team.frames) {
    if (!f.players) continue
    assert.equal(f.players[0].resources.gold, f.players[1].resources.gold, `第 ${f.t} tick 队友的金子不一样`)
    if (f.players[0].resources.gold !== 600) moved = true
    assert.equal(f.players[2].resources.gold, 600)
  }
  assert.ok(moved)
  // 每人采到的分开记（D-248）：只有 P0 的工人在采，钱算 P0 的；联赛统计的采集也按它
  assert.ok(team.gathered && team.gathered[0].gold > 0 && team.gathered[1].gold === 0, JSON.stringify(team.gathered))
  const seatStats = gameSeatStats(team)
  assert.equal(seatStats[0].income, team.gathered![0].gold)
  assert.equal(seatStats[1].income, 0)
  // 每人花掉的也分开记（D-249）：只有 P0 下命令花钱；规则包报吃队友的钱 = 花掉的 − 挣来的 − 开局那份 300（P1 一分没花，倒贴 300）
  const st = team.result.stats!
  assert.ok(st["花掉的钱"][0] > 0 && st["花掉的钱"][1] === 0, JSON.stringify(st))
  assert.deepEqual(st["吃队友的钱"], [0, 1, 2, 3].map((p) => st["花掉的钱"][p] - st["挣来的钱"][p] - 300))
  assert.equal(st["吃队友的钱"][1], -300)
  const ffa = runMatch({
    ruleset: { ...siegeFrontier, maxTicks: 50 },
    seed: 3,
    bots: await Promise.all([0, 1, 2, 3].map((p) => load(siegeFrontier, idle, p))),
  })
  assert.equal(ffa.sharedResources, true)
  assert.deepEqual(ffa.initial.players.map((p) => p.resources.gold), [300, 300, 300, 300])
  assert.equal(ffa.initial.entities.filter((e) => e.type === "scout").length, 4)
  // 各自为战没有队友，不报吃队友的钱
  assert.equal(ffa.result.stats!["吃队友的钱"], undefined)
})
