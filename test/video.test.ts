// 联赛视频：素材包（代码风格指标、成绩）、脚本检查、场景编排；本机有 Chrome / Edge 时再真的渲染一段
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { after, test } from "node:test"
import { checkScript, codeFacts, botTag, contestantNames, factTags, sparringBots, spotlightFor, gameScores, highlightPlayerWarnings, isReferenceBot, readSeries, resolveBotFile, scriptWarnings, videoBrief, type SeriesFile, type VideoScript } from "../src/video/brief.ts"
import { findBrowser } from "../src/video/browser.ts"
import { buildScenes, colorGap, explainReason, fightWindows, idleHighlightWarnings, PALETTE, pacing, relabelSeats, tidy, timelineOf, videoColors } from "../src/video/render.ts"
import { analyzeLeague, baseTypeOf, fitWinModel, twoSides, winCurve } from "../src/video/analysis.ts"
import { matchPortraits } from "../src/video/workspace.ts"
import { crc32, deflateSync } from "node:zlib"
import type { Replay } from "../src/core/types.ts"
import { ReplayModel } from "../src/core/replay-model.ts"
import type { ReplayFrame } from "../src/video/page.ts"

const ROOT = join(import.meta.dirname, "..")
const CLI = join(ROOT, "src", "cli", "arena.ts")
const TMP = mkdtempSync(join(tmpdir(), "rts-arena-video-"))
after(() => rmSync(TMP, { recursive: true, force: true }))

const sh = (args: string[], cwd = TMP) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return r.stdout
}

// 一场小联赛：两个参考 bot，每对 2 局
sh(["league", "koth", "baseline", "rush", "--per-pair", "2", "--seed", "3", "--out", "lg", "--no-check"])
const seriesFile = join(TMP, "lg", readdirSync(join(TMP, "lg")).find((f) => f.endsWith(".series.json"))!)

test("代码风格指标：行数、注释比例、开头的注释、常量、写法特征", () => {
  const f = codeFacts(`// 速攻 bot：凑够 6 个就上！
// 数值是实测调出来的

const WAVE = 6
let attacking = false

function nearest(a: number) { return a }
export function onTick(view: View, cmd: Commands): void {
  const go = (x: number) => x + 1 // 实测
  if (!attacking) cmd.attackMove(1, 2, 3)
}
`)
  assert.deepEqual(f.header, ["速攻 bot：凑够 6 个就上！", "数值是实测调出来的"])
  assert.equal(f.lines, 12)
  assert.equal(f.functions, 3)
  assert.equal(f.topLevelState, 1)
  assert.deepEqual(f.constants, ["WAVE = 6"])
  assert.equal(f.features["cmd.attackMove"], 1)
  assert.equal(f.features["实测或调参注释"], 3) // "实测" 两处、"调出来" 一处
  // 只数注释里的感叹号（代码里的 ! 不算）
  assert.equal(f.features["注释里的感叹号"], 1)
})

test("规则包看点（D-249）：每局平均、在参赛选手里排第几（参考 bot 不比，一样多并列）；lower 越小越前；没报过的项不显示", () => {
  const bot = (name: string, games: number, custom: Record<string, number>) => ({ name, games, custom })
  const series = {
    ruleset: { id: "siege-frontier", name: "攻城拓荒", spotlight: [{ stat: "吃队友的钱", unit: "金", note: "花掉的 − 挣来的" }, { stat: "白送", lower: true }, { stat: "没人报" }] },
    participants: [{ name: "A", file: "A.ts" }, { name: "B", file: "B.ts" }, { name: "C", file: "C.ts" }, { name: "baseline", file: "rulesets/siege-frontier/bots/baseline.ts" }],
    summary: { stats: { bots: [bot("A", 10, { 吃队友的钱: 14100, 白送: 30 }), bot("B", 10, { 吃队友的钱: -4930, 白送: 4 }), bot("C", 4, { 吃队友的钱: 5640, 白送: 1.2 }), bot("baseline", 10, { 吃队友的钱: 99999, 白送: 0 })] } },
  } as unknown as SeriesFile
  const own = contestantNames(series)
  const a = spotlightFor(series, own, "A")!
  assert.deepEqual(a[0], { label: "吃队友的钱", value: "1410 金", rank: 1, of: 3, note: "花掉的 − 挣来的" }, "参考 bot 吃得更多也不比")
  assert.equal(a.length, 2, "没人报的那项不显示")
  assert.deepEqual([a[1].value, a[1].rank], ["3", 3])
  const b = spotlightFor(series, own, "B")!
  assert.deepEqual([b[0].value, b[0].rank], ["−493 金", 3])
  const c = spotlightFor(series, own, "C")!
  assert.deepEqual([c[0].value, c[0].rank, c[1].value, c[1].rank], ["1410 金", 1, "0.3", 1], "C 打得少，按自己的局数平均；1410 和 A 并列第一")
  assert.equal(spotlightFor({ ...series, ruleset: { id: "x", name: "x" } }, own, "A"), null, "规则包没写看点")
})

test("只介绍参赛 bot（D-221）：规则包 bots/ 里的参考 bot 是陪练，不用写进 players、不出现在视频的选手页；全是参考 bot 时都算参赛", () => {
  assert.ok(isReferenceBot("..\\..\\Code\\rts-arena\\rulesets\\regicide-annihilation\\bots\\llm.ts", "regicide-annihilation"))
  assert.ok(!isReferenceBot("GPT.ts", "regicide-annihilation"))
  assert.ok(!isReferenceBot("../rulesets/capture/bots/x.ts", "regicide-annihilation"))
  const mixed = { ruleset: { id: "capture", name: "夺点" }, participants: [{ name: "GPT", file: "GPT.ts" }, { name: "baseline", file: "../rulesets/capture/bots/baseline.ts" }] } as unknown as SeriesFile
  assert.deepEqual(contestantNames(mixed), ["GPT"])
  const refs = { ...mixed, participants: [{ name: "baseline", file: "rulesets/capture/bots/baseline.ts" }, { name: "rush", file: "rulesets/capture/bots/rush.ts" }] } as SeriesFile
  assert.deepEqual(contestantNames(refs), ["baseline", "rush"])
})

test("素材包：每个选手的文件名、成绩、代码指标，脚本模板；脚本检查列出所有问题", () => {
  const b = videoBrief(seriesFile)
  assert.deepEqual(
    b.players.map((p) => p.name),
    ["baseline", "rush"],
  )
  assert.ok(b.players.every((p) => p.code && p.code.lines > 10 && p.standing))
  const series = readSeries(seriesFile)
  // 模板本身还没填，检查不过；开场大字待填（D-230 加回来），每个选手挑好一局高光对局，highlights 里同一局待填标题和解说（D-221）
  assert.ok(checkScript(b.scriptTemplate, series).some((e) => e.includes("待填")))
  assert.match(b.scriptTemplate.hook?.text ?? "", /待填/)
  assert.ok(b.scriptTemplate.players.every((p) => typeof p.highlight === "number"))
  assert.deepEqual(new Set(b.scriptTemplate.highlights!.map((h) => h.index)), new Set(b.scriptTemplate.players.map((p) => p.highlight)))
  const bad = checkScript({ players: [{ name: "nobody", tagline: "x", intro: [] }], highlights: [{ index: 99 }] }, series)
  assert.ok(bad.some((e) => e.includes("联赛里的名字")))
  assert.ok(bad.some((e) => e.includes("intro")))
  assert.ok(bad.some((e) => e.includes("少了选手 rush")))
  assert.ok(bad.some((e) => e.includes("局号")))
})

/** 一张渐变的 PNG（测试用的选手形象图） */
function testPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4
      raw[o] = 230
      raw[o + 1] = Math.floor((x * 255) / w)
      raw[o + 2] = Math.floor((y * 255) / h)
      raw[o + 3] = 255
    }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

const script: VideoScript = {
  players: [
    { name: "baseline", displayName: "基准", byline: "平台自带", tagline: "均衡的标准对手", intro: ["经济、防守、集火都做全了。", "先出 6 个战士再混编。"] },
    { name: "rush", tagline: "拆家速攻", intro: ["凑够 6 个战士就去拆家。"] },
  ],
  outro: "完。",
}

test("联赛汇总记下每局比分；全联赛之最（最快、最久、比分最接近）的标签打在对应那局上", () => {
  const series = readSeries(seriesFile)
  assert.ok(series.results.every((r) => Array.isArray(r.scores) && r.scores.length === r.names.length))
  const tags = factTags(series, gameScores(series, seriesFile))
  const fastest = [...series.results].filter((r) => r.winners.length).sort((a, b) => a.tick - b.tick || a.index - b.index)[0]
  assert.match(tags.get(fastest.index)!.join("；"), /全联赛结束得最快的胜局（\d+ tick）/)
  assert.ok([...tags.values()].flat().some((t) => /比分最接近/.test(t)))
})

test("脚本提醒（D-171）：精彩对局的标题、解说提到了不在这局的选手（按全名、显示名、简称找）", () => {
  const series = {
    participants: [{ name: "GPTbot" }, { name: "大肥鱼" }, { name: "哈基米" }],
    results: [{ index: 109, names: ["大肥鱼", "哈基米"] }],
  } as unknown as Parameters<typeof highlightPlayerWarnings>[1]
  const script = {
    players: [{ name: "GPTbot", displayName: "GPT 6.1 sol" }, { name: "大肥鱼" }, { name: "哈基米" }],
    highlights: [{ index: 109, title: "哈基米没输给 GPT 的那局", commentary: "大肥鱼先清掉中央守卫" }],
  }
  const w = highlightPlayerWarnings(script, series)
  assert.equal(w.length, 1)
  assert.match(w[0], /highlights\[0\]\.title 提到了「GPT」，可第 109 局是 大肥鱼 对 哈基米/)
  // 照这局写的不提醒
  assert.deepEqual(highlightPlayerWarnings({ ...script, highlights: [{ index: 109, title: "大肥鱼翻盘", commentary: "哈基米先手" }] }, series), [])
})

test("脚本提醒（D-185）：精彩对局后半局没人打仗（最后一仗打完还剩整局 30% 以上）", () => {
  const series = readSeries(seriesFile)
  const g = series.results[0]
  // 原样：仗打到最后（拆家结束）不提醒
  assert.deepEqual(idleHighlightWarnings({ players: [], highlights: [{ index: g.index }] }, seriesFile), [])
  // 把这局拉长到 3 倍、后面什么都没发生：提醒，highlights 和 players[].highlight 都查
  const dir = join(TMP, "idle")
  mkdirSync(dir, { recursive: true })
  const replay = JSON.parse(readFileSync(join(dirname(seriesFile), g.replay), "utf8")) as Replay
  replay.result.tick *= 3
  writeFileSync(join(dir, "g.json"), JSON.stringify(replay))
  const file = join(dir, "x.series.json")
  writeFileSync(file, JSON.stringify({ ...series, results: [{ ...g, replay: "g.json", tick: replay.result.tick, reason: "时间到，击杀价值 1 : 0" }] }))
  const w = idleHighlightWarnings({ players: [{ name: g.names[0], tagline: "", intro: [], highlight: g.index }], highlights: [{ index: g.index }] }, file)
  assert.equal(w.length, 2)
  assert.match(w[0], new RegExp(`^highlights\\[0\\] 是第 ${g.index} 局：t\\d+ 以后到第 ${replay.result.tick} tick 打满时间比分都没人打仗（占整局 \\d+%）`))
  assert.match(w[1], /^players\[0\]（.+）\.highlight 是第/)
})

test("脚本提醒：粗体字段里的「一」像破折号，常规字重的介绍不管", () => {
  const w = scriptWarnings({ players: [{ name: "a", tagline: "只输 1 局", intro: ["一稿流"] }], highlights: [{ index: 1, commentary: "一波带走" }], outro: "唯一一胜" }).filter((x) => x.includes("是粗体"))
  assert.equal(w.length, 2)
  assert.ok(w[0].startsWith("outro 是粗体") && w[1].startsWith("highlights[0].commentary 是粗体"))
  // 不再有标题页（D-177）：老脚本的 title、userText、theme 提醒删掉
  assert.ok(scriptWarnings({ title: "x", userText: "y", players: [] }).some((x) => /title、userText 不再使用/.test(x)))
  // 开场阵容（D-230 加回来）：hook.text 是粗体；冷开场的 hook.index 不再使用（D-181）
  assert.ok(scriptWarnings({ hook: { text: "唯一一个" }, players: [] }).some((x) => x.startsWith("hook.text 是粗体")))
  assert.ok(scriptWarnings({ hook: { text: "x", index: 3 }, players: [] }).some((x) => /hook\.index 不再使用/.test(x)))
  assert.deepEqual(scriptWarnings(null), [])
  // 选手页：tagline 加 intro 超过 260 字太挤，少于 160 字页面显得空，都提醒（4～5 句、180～260 字；D-183 只减半时长、字数不变）
  const long = scriptWarnings({ players: [{ name: "a", tagline: "定位", intro: ["很长".repeat(70), "很长".repeat(70)] }] })
  assert.match(long[0], /players\[0\]（a）的 tagline 加 intro 共 282 字/)
  const short = scriptWarnings({ players: [{ name: "a", tagline: "定位", intro: ["很短".repeat(20)] }] })
  assert.match(short[0], /players\[0\]（a）的 tagline 加 intro 只有 42 字，选手页显得空/)
  assert.deepEqual(scriptWarnings({ players: [{ name: "a", tagline: "定位", intro: ["正好".repeat(30), "正好".repeat(30), "正好".repeat(30)] }] }), [])
  // 规则介绍提到别的规则包：观众不一定玩过，提醒直接讲规则（D-155）
  const other = scriptWarnings({ rules: ["在拓荒的基础上加了 4 种科技建筑。", "先拆掉对方主基地的赢。"] }, ["拓荒", "夺点"])
  assert.equal(other.length, 1)
  assert.match(other[0], /rules\[0\] 提到了别的规则包「拓荒」/)
})

test("场景编排（D-221、D-225、D-230、D-237）：开场阵容 → 规则介绍 → 每个参赛选手「介绍 → 他的高光对局」→ 联赛排名 → 片尾，横竖屏一样", () => {
  const series = readSeries(seriesFile)
  assert.deepEqual(checkScript(script, series), [])
  const scenes = buildScenes(series, script, seriesFile, 10)
  const kinds = scenes.map((s) => s.data.kind)
  // 开场阵容（D-221 删掉、D-230 用户要求加回来）→ 规则 → 选手；没有标题卡；D-225 删掉的排名、对战胜负合成一页放在片尾前（D-237）
  assert.deepEqual(kinds, ["lineup", "rules", "player", "replay", "player", "replay", "standings", "brandClose"])
  // 排名页：按名次一行一个 bot，每行接它对每个对手的胜负（自己对自己是空的），和联赛汇总的对阵表一致
  const st = scenes.at(-2)!.data as { rows: { name: string; rank: number; record: string }[]; cells: ({ text: string; rate: number } | null)[][]; sub: string }
  const sum = series.summary!
  assert.deepEqual(st.rows.map((r) => r.rank), [...sum.standings].sort((a, b) => a.rank - b.rank).map((x) => x.rank))
  const top = [...sum.standings].sort((a, b) => a.rank - b.rank)
  assert.equal(st.rows[0].record, `${top[0].wins}-${top[0].draws}-${top[0].losses}`)
  assert.equal(st.cells[0][0], null)
  const c01 = sum.matrix[top[0].index][top[1].index]
  assert.equal(st.cells[0][1]!.text, st.sub.includes("胜-平-负") ? `${c01.w}-${c01.d}-${c01.l}` : `${c01.w}-${c01.l}`)
  // 第一段（开场阵容）从第一帧起就是完整画面（不从黑屏淡入，也当封面），别的段不是
  assert.equal(scenes[0].data.first, true)
  assert.ok(scenes.slice(1).every((x) => !x.data.first))
  const lineup = scenes[0].data as { frames: number; title: string; players: { name: string }[] }
  assert.equal(lineup.frames, 25)
  assert.equal(lineup.title, "2 位选手的夺点联赛，谁能夺冠？")
  assert.equal(lineup.players.length, 2)
  assert.equal((buildScenes(series, { ...script, hook: { text: "谁先占住正中？" } }, seriesFile, 10)[0].data as { title: string }).title, "谁先占住正中？")
  assert.match(checkScript({ ...script, hook: { text: "长".repeat(31) } }, series).join("\n"), /hook\.text 最多 30 字/)
  // 规则页、选手页时长再砍一半、页内动画快一倍（D-221）：规则 1.5～3 秒，选手 1.15～3.25 秒
  assert.equal((scenes[1].data as { speed?: number }).speed, 2)
  assert.ok(scenes[1].data.frames >= 15 && scenes[1].data.frames <= 30, String(scenes[1].data.frames))
  const pages = scenes.filter((x) => x.data.kind === "player")
  for (const x of pages) assert.ok((x.data as { speed?: number }).speed === 2.6 && x.data.frames >= 11 && x.data.frames <= 33, String(x.data.frames))
  // 选手页按名次倒着出场：最后一名先上
  const order = pages.map((x) => (x.data as { rank: number }).rank)
  assert.deepEqual(order, [...order].sort((a, b) => b - a))
  // 片尾名单按脚本里的出场顺序
  const close = scenes.at(-1)!.data as { credits: string[] }
  assert.deepEqual(close.credits.slice(0, 2), ["基准 · 平台自带", "rush"])
  // 规则介绍：没写 rules 就用规则包的一句话简介；右边是规则包自带的陪练（不管进没进联赛）和单位图例（带近战 / 射程），不再有开局地图（D-252）
  const rules = scenes[1].data as unknown as { lines: string[]; sparring: { name: string; text: string }[]; ents?: unknown; legend: { name: string; detail: string }[]; tickNote: string }
  assert.match(rules.tickNote, /1 秒 = 10 tick，一局最多 \d+ tick/)
  assert.equal(rules.lines.length, 1)
  assert.deepEqual(rules.sparring.map((x) => x.name), ["baseline", "boom", "hold", "rush", "sneak", "steady"])
  assert.equal(rules.ents, undefined)
  assert.ok(rules.legend.some((l) => l.name === "弓手" && /射程 4/.test(l.detail)) && rules.legend.some((l) => l.name === "战士" && /近战/.test(l.detail)))
  // 能力按规则包里实际的写：夺点的工人只采矿、不能建造
  const worker = rules.legend.find((l) => l.name === "工人")!
  assert.ok(/采矿/.test(worker.detail) && !/建造/.test(worker.detail), worker.detail)
  // 选手页按字数定时长（介绍长的那页更长）
  const longIntro = buildScenes(series, { ...script, players: [{ ...script.players[0], intro: ["一句比较长的介绍，".repeat(8)] }, script.players[1]] }, seriesFile, 10)
  const players = longIntro.filter((s) => s.data.kind === "player")
  const long0 = players.find((x) => (x.data as { name: string }).name === script.players[0].name)!
  const long1 = players.find((x) => (x.data as { name: string }).name === script.players[1].name)!
  assert.ok(long0.data.frames > long1.data.frames, players.map((s) => s.data.frames).join(","))
  const withRules = buildScenes(series, { ...script, rules: ["占住正中的控制点，点里只有你的单位时每 tick 得 1 分", "先拿满 600 分的赢"] }, seriesFile, 10)
  assert.equal((withRules.find((x) => x.data.kind === "rules")!.data as { lines: string[] }).lines.length, 2)
  // 竖屏的段落和横屏一样
  const vert = buildScenes(series, script, seriesFile, 10, undefined, null, { vertical: true })
  assert.deepEqual(vert.map((x) => x.data.kind), kinds)
  // 没写 players[].highlight：从精彩对局里挑有他的，两个人不重复
  const vIdx = vert.filter((x) => x.data.kind === "replay").map((x) => Number(/（第 (\d+) 局）$/.exec(x.label)![1]))
  assert.equal(new Set(vIdx).size, 2)
  // 写了就用它；局号不对、这局没有他都报错
  const pin = series.results.at(-1)!.index
  const pinned = { ...script, players: [{ ...script.players[0], highlight: pin }, script.players[1]] }
  assert.deepEqual(checkScript(pinned, series), [])
  assert.ok(buildScenes(series, pinned, seriesFile, 10).some((x) => x.label === `基准的高光对局 回放（第 ${pin} 局）` && x.data.kind === "replay" && (x.data as { kicker?: string }).kicker === "基准的高光对局"))
  assert.match(checkScript({ ...script, players: [{ ...script.players[0], highlight: 9999 }, script.players[1]] }, series).join("\n"), /players\[0\]\.highlight 要是联赛里的局号/)
  // 时间表：每段都有名字，首尾相接
  const tl = timelineOf(scenes, 10)
  assert.equal(tl[0].label, "开场阵容")
  assert.equal(tl[1].label, "规则介绍")
  assert.ok(tl.every((x, k) => x.label && (k === 0 || x.from === tl[k - 1].to)))
  assert.ok(tl.some((x) => /^选手 基准$/.test(x.label)))
  // 联赛排名在片尾前面（D-237）
  assert.deepEqual(tl.slice(-2).map((x) => x.label), ["联赛排名和对阵胜负", "总结、片尾署名和选手名单"])
  // 回放场景每帧都能算出局面，最后一帧定格显示结果；往回要的帧从头重算，结果一样
  const rs = scenes.find((s) => s.data.kind === "replay")
  if (rs) {
    const mid = rs.frame!(Math.floor(rs.data.frames / 2))
    let last = rs.frame!(0)
    for (let i = 1; i < rs.data.frames; i++) last = rs.frame!(i)
    assert.ok(last.final && last.progress === 1 && last.ents.length > 0)
    // 夺点：控制点标记、规则包的状态栏、规则包写的事件（P0/P1 换成了选手名）
    assert.ok(last.markers.some((m) => m.kind === "zone"))
    assert.ok(last.status.length > 0)
    assert.ok(last.events.some((e) => /夺下控制点/.test(e) && !/\bP\d/.test(e)), last.events.join(" | "))
    assert.deepEqual(rs.frame!(Math.floor(rs.data.frames / 2)).ents, mid.ents)
  }
})

test("规则页（D-252）：右边列出规则包自带的陪练（不管进没进这场联赛）和一句话介绍，脚本没写用打法说明冒号前的标签；图例用规则包写的中文名 look.name", () => {
  const dir = join(TMP, "lg-sparring")
  cpSync(join(TMP, "lg"), dir, { recursive: true })
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && !x.endsWith(".series.json") && !x.endsWith(".analysis.json"))) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as Replay
    r.types.archer.look = { ...r.types.archer.look!, name: "射手" }
    writeFileSync(join(dir, f), JSON.stringify(r))
  }
  const sf = join(dir, basename(seriesFile))
  const series = readSeries(sf)
  // 这场联赛只有 baseline、rush，夺点自带的 6 个陪练都列出来
  assert.deepEqual(sparringBots(series).map((b) => b.name), ["baseline", "boom", "hold", "rush", "sneak", "steady"])
  const rulesOf = (sc: VideoScript) => buildScenes(series, sc, sf, 10).find((x) => x.data.kind === "rules")!.data as unknown as { sparring: { name: string; text: string }[]; legend: { name: string }[] }
  assert.equal(rulesOf(script).sparring.find((x) => x.name === "rush")!.text, "拆家速攻")
  assert.equal(rulesOf({ ...script, sparring: [{ name: "rush", text: "不管点，6 个战士直接拆家" }] }).sparring.find((x) => x.name === "rush")!.text, "不管点，6 个战士直接拆家")
  assert.ok(rulesOf(script).legend.some((l) => l.name === "射手") && rulesOf(script).legend.some((l) => l.name === "战士"))
  // 脚本检查：sparring 只能写规则包自带的陪练、一句话最多 30 字；模板里给每个陪练留了待填，素材包里有它们的打法说明
  const errs = checkScript({ ...script, sparring: [{ name: "GPT", text: "x" }, { name: "rush", text: "很长".repeat(16) }] }, series).join("\n")
  assert.match(errs, /sparring\[0\]\.name 要是规则包自带的陪练之一：baseline、boom/)
  assert.match(errs, /sparring\[1\]\.text/)
  const brief = videoBrief(sf)
  assert.deepEqual(brief.scriptTemplate.sparring?.map((x) => x.name), ["baseline", "boom", "hold", "rush", "sneak", "steady"])
  assert.ok(brief.sparring.every((b) => b.about.length > 10))
  // 标签：冒号前那几个字，括号里的冒号不算
  assert.equal(botTag("爆经济（多人局：只打离家最近的）：第 300 tick 开分矿"), "爆经济（多人局：只打离家最近的）")
  assert.equal(botTag("没有冒号的一句很长很长很长很长很长的说明"), "没有冒号的一句很长很长很长很长很", "没有冒号取前 16 个字")
})

test("整片视频每个参赛者一种颜色（D-253）：选手先用自己的默认色，和前面的分不清就换；陪练和所有选手、同场放的陪练分得清", () => {
  // 红和橙、紫和粉太近
  assert.ok(colorGap(PALETTE[1], PALETTE[6]) < 50 && colorGap(PALETTE[4], PALETTE[7]) < 50)
  const ref = (n: string) => ({ name: n, file: `rulesets/siege-frontier/bots/${n}.ts` })
  const eight = { ruleset: { id: "siege-frontier", name: "攻城拓荒" }, participants: "ABCDEFGH".split("").map((n) => ({ name: n, file: `${n}.ts` })), results: [] } as unknown as SeriesFile
  const c8 = videoColors(eight, [])
  assert.deepEqual("ABCDEF".split("").map((n) => c8.get(n)), PALETTE.slice(0, 6), "前 6 个用自己的默认色")
  assert.equal(c8.get("G"), "#ffffff", "第 7 个的橙色和红、黄分不清，换成白色")
  assert.equal(new Set(c8.values()).size, 8)
  // 2 个选手 + 陪练：陪练避开选手的颜色；同一局放出来的两个陪练也分得清，不同场的可以同色
  const mixed = {
    ruleset: { id: "siege-frontier", name: "攻城拓荒" },
    participants: [{ name: "A", file: "A.ts" }, { name: "B", file: "B.ts" }, ref("baseline"), ref("counter"), ref("expand"), ref("hog"), ref("rush"), ref("turtle")],
    results: [{ index: 1, names: ["hog", "rush"] }, { index: 2, names: ["A", "turtle"] }],
  } as unknown as SeriesFile
  const cm = videoColors(mixed, [1, 2])
  assert.deepEqual([cm.get("A"), cm.get("B")], [PALETTE[0], PALETTE[1]])
  for (const n of ["baseline", "counter", "expand", "hog", "rush", "turtle"]) assert.ok(colorGap(cm.get(n)!, PALETTE[0]) >= 50 && colorGap(cm.get(n)!, PALETTE[1]) >= 50, n)
  assert.ok(colorGap(cm.get("hog")!, cm.get("rush")!) >= 50)
})

test("结束原因写给观众看（D-256）：座位换成名字，按座位或按队排的比分每个数前面写上是谁的", () => {
  const two = [{ name: "baseline" }, { name: "turtle" }]
  assert.equal(explainReason("时间到，击杀价值 4620 : 4960", two), "时间到，击杀价值 baseline 4620 : turtle 4960")
  assert.equal(explainReason("先到 600 分（600 : 420）", [{ name: "甲" }, { name: "乙" }]), "先到 600 分（甲 600 : 乙 420）")
  assert.equal(explainReason("时间到，击杀价值 4620 : 4960", [{ name: "选手甲" }, { name: "选手乙" }]), "时间到，击杀价值 选手甲 4620 : 选手乙 4960", "中文名前面的空格留着")
  const four = [{ name: "A", team: 0 }, { name: "B", team: 0 }, { name: "C", team: 1 }, { name: "D", team: 1 }]
  assert.equal(explainReason("时间到，还在场的队伍里击杀价值最高（0 : 7680 : 7140 : 1430）", four), "时间到，还在场的队伍里击杀价值最高（A 0 : B 7680 : C 7140 : D 1430）")
  assert.equal(explainReason("时间到，队伍分数 30 : 20", four), "时间到，队伍分数 A+B 30 : C+D 20")
  assert.equal(explainReason("其他队伍都出局了（获胜队伍：P0、P1）", four), "其他队伍都出局了（获胜队伍：A、B）")
  assert.equal(explainReason("摧毁了对方的主基地", two), "摧毁了对方的主基地")
})

test("平台拼的文字：中文名前后的空格去掉，英文名的留着", () => {
  // 规则包的状态栏用空格隔开几项，换成选手名后空格要留着；事件句子照样去掉
  const seats = [{ name: "大肥鱼" }, { name: "哈基米" }]
  assert.equal(relabelSeats("台址 P0 P1 空 争", seats, false), "台址 大肥鱼 哈基米 空 争")
  assert.equal(relabelSeats("P1 夺下控制点", seats), "哈基米夺下控制点")
  assert.equal(tidy("联赛得分率 50% 的 Gemini 赢了 98% 的 大肥鱼"), "联赛得分率 50% 的 Gemini 赢了 98% 的大肥鱼")
  assert.equal(tidy("t1044～1169 大战：大肥鱼 损失 7，Gemini 3.8 flash 损失 11"), "t1044～1169 大战：大肥鱼损失 7，Gemini 3.8 flash 损失 11")
  assert.equal(tidy("大肥鱼 获胜"), "大肥鱼获胜")
})

test("回放变速（D-172、D-174、D-225、D-226）：tick 随帧单调往前、首尾对齐；有单位倒下的交战（大战和小冲突）都 4 倍速，没动静的快进至少 4 倍", () => {
  const series = readSeries(seriesFile)
  const g = [...series.results].sort((a, b) => b.tick - a.tick)[0]
  const replay = JSON.parse(readFileSync(join(TMP, "lg", g.replay), "utf8")) as Replay
  const fps = 30
  const p = pacing(replay, fps)
  const n = p.playFrames
  const ticks = Array.from({ length: n }, (_, i) => p.tickOf(i))
  assert.equal(ticks[0], 0)
  assert.equal(ticks[n - 1], replay.result.tick)
  assert.ok(ticks.every((t, i) => i === 0 || t >= ticks[i - 1]))
  const { battles, skirmishes } = fightWindows(replay)
  assert.ok(skirmishes.length > 0, "这局应该有小冲突")
  const rate = replay.tickRate
  const T = replay.result.tick
  const wins = [...battles, ...skirmishes]
  const fightTicks = new Set<number>()
  for (const [x, y] of wins) for (let t = x; t < y; t++) fightTicks.add(t)
  // 交战一共放 fightTicks / (4 × rate) 秒（两段之间空得少的也按交战放，会多一些），没动静的最多 10 秒
  const lo = (fightTicks.size / (4 * rate)) * fps
  const hi = (T / (4 * rate)) * fps
  assert.ok(n >= lo - 2 && n <= Math.max(hi, lo + 10 * fps) + 2, `${n} 帧（${lo}～${hi}）`)
  // 交战段中间的帧：一秒正好推进 4 × rate 个 tick
  for (const [x, y] of wins) {
    const inside = ticks.map((_, i) => i).filter((i) => ticks[i] > x + 1 && ticks[i + fps] !== undefined && ticks[i + fps] < y - 1)
    for (const i of inside.slice(0, 5)) assert.ok(Math.abs(ticks[i + fps] - ticks[i] - 4 * rate) <= 1, `第 ${i} 帧起一秒推进了 ${ticks[i + fps] - ticks[i]} tick`)
    for (const i of inside) assert.equal(p.mode(i), "fight")
  }
  const quiet = ticks.slice(0, -1).map((_, i) => i).filter((i) => p.mode(i) === "quiet")
  if (quiet.length > fps) assert.ok(ticks[quiet[0] + fps] - ticks[quiet[0]] >= rate * 4 - 1)
})

test("击退这类一下挪好几格的（D-226）：滑过去、拖轨迹，落点那团特效和眩晕的金圈不画", () => {
  const series = readSeries(seriesFile)
  const g = [...series.results].sort((a, b) => b.tick - a.tick)[0]
  const replay = JSON.parse(readFileSync(join(dirname(seriesFile), g.replay), "utf8")) as Replay
  // 挑一个单位往右推 3 格，眩晕；落点一团没字的特效、原地一圈带字的。挑推完以后 40 tick 都不动的（免得它自己走开又算一次）
  const model = new ReplayModel(replay)
  const still = (id: number, K: number) => replay.frames.slice(K - 1, K + 40).every((f) => !(f.move ?? []).some((v, j) => j % 3 === 0 && v === id))
  let K = 0
  let u: { id: number; x: number; y: number } | undefined
  for (let k = 30; k < replay.frames.length - 60 && !u; k += 10) {
    u = [...model.stateAt(k - 1).ents.values()].find((e) => replay.types[e.type]?.kind === "unit" && e.owner >= 0 && still(e.id, k))
    K = k
  }
  assert.ok(u, "这局找不到站着不动的单位")
  const fr = replay.frames[K - 1]
  fr.move = [...(fr.move ?? []), u.id, u.x + 3, u.y]
  fr.fx = [...(fr.fx ?? []), { x: u.x + 3, y: u.y, w: 1, h: 1, color: "#9fd8ff", radius: 1 }, { x: u.x, y: u.y, w: 1, h: 1, color: "#9fd8ff", radius: 8, text: "击退" }]
  fr.bf = [...(fr.bf ?? []), [u.id, ["眩晕"]]]
  const dir = join(TMP, "knock")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "g.json"), JSON.stringify(replay))
  const file = join(dir, "x.series.json")
  writeFileSync(file, JSON.stringify({ ...series, results: series.results.map((r) => (r.index === g.index ? { ...r, replay: "g.json" } : { ...r, replay: `../${basename(dirname(seriesFile))}/${r.replay}` })) }))
  const sc = buildScenes(readSeries(file), { ...script, players: [{ ...script.players[0], highlight: g.index }, script.players[1]] }, file, 30).find((x) => x.label.endsWith(`（第 ${g.index} 局）`))!
  let i = 0
  while (sc.frame!(i).t < K) i++
  const at = (j: number) => sc.frame!(j) as ReplayFrame & { knockFx?: number[] }
  const first = at(i)
  // 刚推的那帧：轨迹从原来的位置开始，单位还在原处；6 帧后滑到半路
  const kf = first.knockFx!
  assert.ok(kf && kf[0] === u.x && kf[1] === u.y && kf[4] < 0.1, JSON.stringify(kf))
  // 落点那团没字的特效不画，带字的照画；眩晕不算增益（没有金圈）
  assert.deepEqual((first.ruleFx ?? []).filter((r) => r.radius === 1 && r.x === u.x + 3), [])
  assert.ok((first.ruleFx ?? []).some((r) => r.text === "击退"))
  const bf = first.buffed ?? []
  for (let k = 0; k < bf.length; k += 2) assert.ok(bf[k + 1] !== u.y || Math.abs(bf[k] - kf[2]) > 0.01)
  const mid = at(i + 6).knockFx!
  assert.ok(mid && mid[0] === u.x && mid[2] > u.x + 0.5 && mid[2] < u.x + 3, JSON.stringify(mid))
  // 0.6 秒（18 帧）后滑完：没有轨迹了
  assert.ok(!at(i + 18).knockFx?.some((v, k) => k % 5 === 0 && v === u.x))
})

test("视频分析（D-177）：主基地认得出；胜率模型对称、看得出谁占优；雷达图每人 6 项、每项和最好的比；结果缓存", () => {
  const series = readSeries(seriesFile)
  const replays = series.results.map((g) => JSON.parse(readFileSync(join(TMP, "lg", g.replay), "utf8")) as Replay)
  assert.equal(baseTypeOf(replays[0]), "base")
  assert.deepEqual(twoSides(replays[0]), [0, 1])
  // 只有一个特征时：特征为正就是 A 方赢，权重为正；局面一样时 50%
  const w1 = fitWinModel([{ x: [1], y: 1 }, { x: [0.5], y: 1 }, { x: [-0.3], y: 0 }])
  assert.ok(w1[0] > 0)
  const a = analyzeLeague(series, seriesFile)
  assert.equal(a.weights.length, 8)
  assert.deepEqual(Object.keys(a.radar).sort(), series.participants.map((p) => p.name).sort())
  for (const axes of Object.values(a.radar)) {
    assert.equal(axes.length, 6)
    assert.ok(axes.every((x) => x.score >= 0 && x.score <= 1 && x.label && x.text))
  }
  // 6 项（夺点没有兵种克制，第 5 项是速胜；D-180：最后一项是防守，不再是代码行数）
  assert.deepEqual(
    Object.values(a.radar)[0].map((x) => x.label),
    ["经济", "生产", "战斗", "进攻", "速胜", "防守"],
  )
  // 和最好的比的几项总有人是 1（除非大家都是 0）；防守是丢得最多的那个是 0（除非谁都没丢）；战斗是击杀占比
  for (const k of [0, 1, 3, 4]) assert.ok(Object.values(a.radar).some((axes) => axes[k].score === 1 || axes[k].score === 0))
  assert.ok(Object.values(a.radar).some((axes) => axes[5].score === 0) || Object.values(a.radar).every((axes) => axes[5].score === 1))
  assert.ok(existsSync(seriesFile.replace(/\.series\.json$/, ".analysis.json")))
  assert.deepEqual(analyzeLeague(series, seriesFile), a)
  // 胜率曲线：每 20 tick 一个点、在 0～1 之间；终局多数局判对赢家
  let right = 0
  let decided = 0
  for (const r of replays) {
    const c = winCurve(r, a.weights, 20)!
    assert.ok(c.length >= Math.floor(r.result.tick / 20) && c.every((v) => v >= 0 && v <= 1))
    const won = r.result.winners ?? []
    if (won.length !== 1) continue
    decided++
    const aWins = (r.players[won[0]].team ?? won[0]) === twoSides(r)![0]
    if (aWins === c.at(-1)! > 0.5) right++
  }
  assert.ok(right >= decided * 0.7, `终局判对 ${right}/${decided}`)
  // 场景里带上：选手页的雷达图，回放的胜率曲线和主基地
  const scenes = buildScenes(series, script, seriesFile, 10, undefined, a)
  const pl = scenes.find((x) => x.data.kind === "player")!.data as { radar: unknown[] | null; portrait: string | null }
  assert.equal(pl.radar?.length, 6)
  assert.equal(pl.portrait, null)
  const rp = scenes.find((x) => x.data.kind === "replay")!.data as { win: { curve: number[]; sides: { name: string }[] } | null; types: { name: string; base: boolean }[] }
  assert.ok(rp.win && rp.win.curve.length > 10 && rp.win.sides.length === 2)
  assert.deepEqual(rp.types.filter((t) => t.base).map((t) => t.name), ["base"])
})

test("形象图按名字对应选手：文件名里只对上一个选手的词才算", () => {
  const m = matchPortraits(["Fable5.1", "Opus5.5", "Sonnet5.5", "GPT6.1sol-codex", "DeepseekV4.1Flash-DeepseekHarness"], ["claude fable.png", "claude opus.png", "claude sonnet.png", "claude haiku.png", "gpt.png", "deepseek.png", "gemini.png"])
  assert.deepEqual(Object.fromEntries(m), { "Fable5.1": "claude fable.png", "Opus5.5": "claude opus.png", "Sonnet5.5": "claude sonnet.png", "GPT6.1sol-codex": "gpt.png", "DeepseekV4.1Flash-DeepseekHarness": "deepseek.png" })
})

test("选手代码：联赛记的路径找不到时，再找平台目录（自带的参考 bot）和当前目录 bots/ 里的副本", () => {
  const cwd = process.cwd()
  const dir = mkdtempSync(join(TMP, "ws-"))
  process.chdir(dir)
  try {
    assert.equal(resolveBotFile("rulesets/tech/bots/scholar.ts", seriesFile), resolve(ROOT, "rulesets", "tech", "bots", "scholar.ts"))
    assert.equal(resolveBotFile("elsewhere\\mine.ts", seriesFile), null)
    mkdirSync("bots")
    writeFileSync(join("bots", "mine.ts"), "// mine\n")
    assert.equal(resolveBotFile("elsewhere\\mine.ts", seriesFile), resolve(dir, "bots", "mine.ts"))
  } finally {
    process.chdir(cwd)
  }
})

test("video-init：视频目录里有说明、选手代码、战报、待填脚本；已经有脚本时不覆盖", () => {
  // 选手形象图：按名字对应（"hero rush.png" 的 rush 对上 rush），对不上的不用
  const pics = join(TMP, "pics")
  mkdirSync(pics, { recursive: true })
  writeFileSync(join(pics, "claude baseline.png"), testPng(60, 90))
  writeFileSync(join(pics, "hero rush.png"), testPng(60, 90))
  writeFileSync(join(pics, "nobody.png"), testPng(8, 8))
  sh(["video-init", "lg", "vd", "--portraits", pics, "--about", "rush 是某某模型写的"])
  const dir = join(TMP, "vd")
  const prompt = readFileSync(join(dir, "PROMPT.md"), "utf8")
  assert.match(prompt, /选手形象图\*\*：已经按名字对应好/)
  assert.ok(existsSync(join(dir, "portraits", "claude baseline.png")) && !existsSync(join(dir, "portraits", "nobody.png")))
  assert.doesNotMatch(prompt, /userText/)
  // 用户补充的背景、平台算好的联赛速查（最快的局、每人赢了谁输给谁）
  assert.match(prompt, /用户补充的背景\*\*：rush 是某某模型写的/)
  assert.match(prompt, /### 联赛速查/)
  // 规则说明一起导出，PROMPT 里有规则介绍的写法
  assert.ok(existsSync(join(dir, "RULES.md")))
  // 说明里的例子只用占位，不出现真实的模型名、外号（免得诱导大模型去猜这场的选手是谁写的）
  assert.doesNotMatch(prompt, /DeepSeek|大肥鱼|GPT6\.1sol|Gemini/)
  assert.match(prompt, /1\. \*\*开场阵容\*\*/)
  assert.match(prompt, /2\. \*\*规则介绍\*\*/)
  // 规则之后直接是选手（D-225 删了排名页、对战胜负页）
  assert.match(prompt, /3\. \*\*每个参赛选手/)
  // 联赛排名在片尾前面，平台自动做（D-237）；对战胜负那句克制关系（counterNote）没有加回来
  assert.match(prompt, /4\. \*\*联赛排名\*\*.*脚本不用写/)
  assert.doesNotMatch(prompt, /\*\*对战胜负\*\*|counterNote/)
  assert.doesNotMatch(prompt, /标题卡看点/)
  assert.match(prompt, /照这个目录里的 `RULES\.md` 写/)
  assert.match(prompt, /\| 看点 \|/)
  assert.match(prompt, /全联赛结束得最快的胜局（\d+ tick）/)
  // 速查里每类都有一行，没有的明写"没有"
  for (const k of ["爆冷", "克制环", "逆转", "比分最接近的胜局", "规则包事件最多的局"]) assert.match(prompt, new RegExp(`\\n- ${k}`))
  assert.match(prompt, /`index` 是联赛的\*\*局号\*\*/)
  assert.match(prompt, /结束得最快的胜局：第 \d+ 局/)
  assert.match(prompt, /- baseline（第 \d 名）：赢 \d+ 局/)
  assert.match(prompt, /### 排名/)
  assert.match(prompt, /#### baseline/)
  assert.match(prompt, /rts-arena video --preview/)
  assert.ok(existsSync(join(dir, "bots", "baseline.ts")) && existsSync(join(dir, "bots", "rush.ts")))
  assert.ok(readdirSync(join(dir, "reports")).some((f) => /^game-\d+\.md$/.test(f)))
  const tmpl = JSON.parse(readFileSync(join(dir, "script.json"), "utf8")) as VideoScript
  assert.deepEqual(
    tmpl.players.map((p) => p.portrait),
    ["portraits/claude baseline.png", "portraits/hero rush.png"],
  )
  assert.equal((tmpl as unknown as Record<string, unknown>).userText, undefined)
  // 写给大模型的：每段显示在哪、每人那局都要写进 highlights、每人的颜色、每局数据
  assert.match(prompt, /每个选手那局都要写进/)
  assert.match(prompt, /byline` 会出现在片尾/)
  assert.match(prompt, /视频里的颜色：蓝色/)
  assert.match(prompt, /每局数据/)
  assert.match(prompt, /--preview auto/)
  const again = spawnSync(process.execPath, [CLI, "video-init", "lg", "vd"], { cwd: TMP, encoding: "utf8" })
  assert.equal(again.status, 1)
  assert.match(again.stderr, /已经有 script\.json/)
  // 只写目录名：联赛自己找（当前目录的下一层子目录 lg 里）
  sh(["video-init", "vd2"])
  assert.ok(existsSync(join(TMP, "vd2", "PROMPT.md")))
  // 哪儿都没有联赛：报错里写的是 video-init 自己
  const empty = mkdtempSync(join(tmpdir(), "rts-video-empty-"))
  const none = spawnSync(process.execPath, [CLI, "video-init"], { cwd: empty, encoding: "utf8" })
  rmSync(empty, { recursive: true, force: true })
  assert.equal(none.status, 1)
  assert.match(none.stderr, /rts-arena video-init <联赛汇总/)
})

test("渲染：在视频目录里不写参数出预览图；本机有浏览器时出一段 1920×1080 的 MP4 并用浏览器解码检查", { skip: findBrowser() ? false : "本机没有 Chrome / Edge" }, () => {
  const dir = join(TMP, "vd")
  writeFileSync(join(dir, "script.json"), JSON.stringify(script))
  // 粗体字段里的"一"：提醒但照样出图
  writeFileSync(join(dir, "script.json"), JSON.stringify({ ...script, outro: "唯一一胜" }))
  assert.match(sh(["video", "--preview", "1"], dir), /提醒：outro 是粗体/)
  // 带上形象图：选手页的半身像、精彩对局的头像都要走一遍（D-177）
  const withPics = { ...script, players: script.players.map((p, i) => ({ ...p, portrait: i === 0 ? "portraits/claude baseline.png" : "portraits/hero rush.png" })) }
  writeFileSync(join(dir, "script.json"), JSON.stringify(withPics))
  // --lint：不出图，列出每个字段的字数和上限、时间表
  const lint = sh(["video", "--lint"], dir)
  assert.match(lint, /字数（现在 \/ 上限/)
  assert.match(lint, /players\[0\]（baseline）tagline 加 intro：\d+ \/ 260  ← 偏少/)
  assert.match(lint, /每段的时间/)
  assert.match(lint, /格式没问题/)
  const out = sh(["video", "--preview", "1,6"], dir)
  assert.match(out, /预览图/)
  assert.match(out, /每段的时间（整段 [\d.]+ 秒）：\n\s+0\.0～[\d.]+\s+秒  开场阵容\n\s+[\d.]+～[\d.]+\s+秒  规则介绍\n\s+[\d.]+～[\d.]+\s+秒  选手 \S+\n\s+[\d.]+～[\d.]+\s+秒  .+的高光对局 回放（第 \d+ 局）/)
  assert.ok(statSync(join(dir, "preview", "夺点联赛-6s.png")).size > 10_000)
  // 竖屏（D-179、D-183、D-221）：段落和横屏一样，规则、选手页和回放都按竖屏画，1080×1920
  const vert = sh(["video", "--vertical", "--preview", "1,5", "--out", "竖.mp4"], dir)
  assert.match(vert, /0\.0～[\d.]+\s+秒  开场阵容\n\s+[\d.]+～[\d.]+\s+秒  规则介绍\n\s+[\d.]+～[\d.]+\s+秒  选手 \S+\n\s+[\d.]+～[\d.]+\s+秒  .+的高光对局 回放（第 \d+ 局）/)
  const vpng = readFileSync(join(dir, "preview", "竖-5s.png"))
  assert.deepEqual([vpng.readUInt32BE(16), vpng.readUInt32BE(20)], [1080, 1920])
  // 两张以上的预览拼一张总览
  assert.match(out, /总览：preview[\\/]夺点联赛-总览\.png/)
  assert.ok(statSync(join(dir, "preview", "夺点联赛-总览.png")).size > 10_000)
  // auto：每段一张，回放段两张
  const auto = sh(["video", "--preview", "auto"], dir)
  const shots = /预览图：(.*)/.exec(auto)![1].split("、")
  const segs = auto.split("\n").filter((l) => /^\s+[\d.]+～/.test(l))
  assert.equal(shots.length, segs.length + segs.filter((l) => /回放(（第 \d+ 局）)?$/.test(l)).length)
  assert.ok(shots.every((f) => existsSync(join(dir, f))))
  const full = sh(["video", "--out", "v.mp4", "--fps", "10", "--check", "2"], dir)
  assert.match(full, /浏览器解码检查：时长 [\d.]+ 秒，1920×1080/)
  assert.ok(statSync(join(dir, "v.mp4")).size > 100_000)
  assert.ok(existsSync(join(dir, "preview", "v-check-2s.png")))
})
