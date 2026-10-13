// 联赛视频：把联赛汇总 + 大模型写的脚本排成一串场景（开场阵容 → 规则介绍（带平台署名）→ 每个参赛选手「介绍 → 他的高光对局」→ 联赛排名 → 片尾署名，横竖屏一样，D-221、D-237），
// 用本机的 Chrome / Edge 无头模式逐帧画出来、编成 MP4。回放场景每帧的局面在这边从回放算好再送进页面
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"
import { applyFrame, ReplayModel, type State } from "../core/replay-model.ts"
import type { Replay } from "../core/types.ts"
import { findBrowser, launchBrowser } from "./browser.ts"
import { checkScript, codeFacts, contestantNames, highlightPlayerWarnings, playerGames, PLAYER_PAGE_CHARS, PLAYER_PAGE_MIN, readSeries, resolveBotFile, RULES_PAGE_CHARS, SCRIPT_LIMITS, scriptWarnings, type SeriesFile, type VideoScript } from "./brief.ts"
import { installVideoPage, type ReplayFrame, type SceneData } from "./page.ts"
import { createBattleArt, type BattleAttack } from "./battle-art.ts"
import { FACTION_COLORS, FACTION_COLOR_NAMES } from "./battle-colors.ts"
import { faceToward, farmWorkers, homeFacing, legacySplashEffects, trainingQueue, workerPose } from "./visual-state.ts"
import { battleCameraTrack } from "./battle-camera.ts"
import { excitement, gameFacts } from "../cli/highlights.ts"
import { fighterTest, groupBattles, isRout } from "../cli/battles.ts"
import { importRuleset, listRulesets } from "../cli/catalog.ts"
import { analyzeLeague, baseTypeOf, twoSides, winCurve, type LeagueAnalysis } from "./analysis.ts"
import { PKG_ROOT } from "../paths.ts"

/** 联赛没挑中的局：现场从回放算看点（不算爆冷） */
export function gameReasons(replay: Replay, seatNames: string[]): string[] {
  const f = gameFacts(replay)
  const sideName = (side: number) => [...new Set(seatNames.filter((_, p) => (replay.players[p]?.team ?? p) === side))].join("+")
  return excitement(f, null, sideName).reasons
}

export const PALETTE = FACTION_COLORS
/** 每个选手在视频里的颜色（按参赛顺序），写在 PROMPT.md 里 */
export const PALETTE_NAMES = FACTION_COLOR_NAMES

/** 两个颜色看上去差多少（CIE Lab 空间里的距离，D-230） */
export function colorGap(a: string, b: string): number {
  const lab = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255).map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92))
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
    const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
    const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}
/** 一局里两家的颜色差得比这还少就算分不清（D-230：绿和草绿 40、黄和橙 26、黄和草绿 38，用户：不知道哪个兵是谁家的） */
const CLOSE_COLORS = 50
/** 换色用的备选：鲜明阵营色，再加白色用于人数很多的对局。 */
const SPARE_COLORS = [...PALETTE, "#ffffff"]
/**
 * 一局里每个参赛者（编号）用什么颜色（D-230）：keep 那个用自己的颜色，其余的按出现的顺序，和前面已经定下的颜色太近（或者撞色）就换成
 * 和它们都差得最多的备选色。只在这一局里换，选手页、片尾还是原来的颜色
 */
export function contrastColors(ids: number[], keep: number): Map<number, string> {
  const out = new Map<number, string>()
  for (const id of [keep, ...ids]) {
    if (out.has(id)) continue
    const own = PALETTE[id % PALETTE.length]
    const used = [...out.values()]
    const clash = used.some((c) => colorGap(c, own) < CLOSE_COLORS)
    const best = clash ? SPARE_COLORS.filter((c) => !used.includes(c)).sort((x, y) => Math.min(...used.map((u) => colorGap(u, y))) - Math.min(...used.map((u) => colorGap(u, x))))[0] : own
    out.set(id, best ?? own)
  }
  return out
}
/** 标准单位的中文名（事件文字用）；规则包自己的类型用原名 */
const TYPE_NAMES: Record<string, string> = { base: "主基地", barracks: "兵营", worker: "工人", soldier: "战士", archer: "弓手", goldmine: "金矿", tower: "箭塔", depot: "仓库" }
/** 类型的中文名：规则包写了 look.name 就用它，否则常见类型用上面的表，再不行显示类型名 */
function typeName(replay: Replay, k: string): string {
  return replay.types[k]?.look?.name ?? TYPE_NAMES[k] ?? k
}

export interface RenderOptions {
  seriesFile: string
  script: VideoScript
  out: string
  /** 浏览器路径（不给就找本机的 Chrome / Edge） */
  browser?: string
  fps?: number
  /** 只出这几秒的预览图（PNG），不出视频；"auto" 是每段各出一张（回放段两张） */
  preview?: number[] | "auto"
  /** 输出尺寸，默认 1920×1080（16:9） */
  width?: number
  height?: number
  /** 出完视频后，从成品里截这几秒的画面（PNG）检查 */
  check?: number[] | "auto"
  /** 预览图和检查截图放在哪个目录（默认视频旁边的 preview/）；--out 指到别处时截图也不跟过去 */
  imagesDir?: string
  onProgress?: (done: number, total: number) => void
  /** 竖屏版（1080×1920，D-183）：段落和横屏一样（D-221），按竖屏排版 */
  vertical?: boolean
}

interface Scene {
  /** 时间表里显示的名字 */
  label: string
  data: SceneData
  /** 回放场景：第 i 帧的局面 */
  frame?: (i: number) => ReplayFrame
}

const sec = (fps: number, s: number) => Math.round(fps * s)
/** 片头片尾、选手页的节奏：时长和页内动画都比原来快这么多倍（D-146，用户要求快 1.3 倍左右） */
export const BRISK = 1.3
/** 规则页、选手页的时长又砍一半（D-221，用户），页内的动画也快一倍，免得没出全就切走了 */
const HALF = 2
/** 平台拼出来的文字在名字前后留了空格（给英文名用的）；名字是中文时，汉字之间的空格去掉："98% 的 大肥鱼" → "98% 的大肥鱼" */
export const tidy = (s: string) => s.replace(/([一-鿿）」』]) (?=[一-鿿（「『])/g, "$1")
/** 按要读的字数定时长（大约每秒读 11 个字），限制在 min～max 秒 */
const readSecs = (chars: number, base: number, min: number, max: number) => Math.min(max, Math.max(min, base + chars / 11))
const len = (...xs: (string | null | undefined)[]) => xs.reduce((a, x) => a + [...(x ?? "")].length, 0)
/** 代码卡片上不值得占行的：空注释、分隔线 */
const BLANKISH = /^\s*(?:\/\/+|\/\*+|\*+\/?)?\s*[-=*#~_/]*\s*$/

/** 规则包的单位数值（老回放里没记攻击数据时，规则介绍的图例从这里补） */
type TypeSpecs = Record<string, { attack?: { damage: number; range: number; cooldown: number; vs?: Partial<Record<string, number>> } | null; gather?: unknown; builds?: string[]; look?: { name?: string } }>

/** 头像默认从形象图哪里裁：[脸中心 x, 脸中心 y, 边长]（按图宽、图高的比例），立绘一般是脸在上部居中 */
export const DEFAULT_AVATAR = [0.49, 0.115, 0.32]

/**
 * analysis 是这次联赛的分析（雷达图、胜率模型，见 analysis.ts）；不给（只核对脚本、算时间表时）就不画雷达图和胜率。
 * 选手有形象图（脚本的 portrait）时，页面里按选手的联赛名字取图（renderLeagueVideo 先把图送进页面）
 */

export function buildScenes(
  series: SeriesFile,
  script: VideoScript,
  seriesFile: string,
  fps: number,
  specs?: TypeSpecs,
  analysis?: LeagueAnalysis | null,
  opts: { vertical?: boolean } = {},
): Scene[] {
  const sum = series.summary!
  const names = series.participants.map((p) => p.name)
  const color = (i: number) => PALETTE[i % PALETTE.length]
  const sp = (name: string) => script.players.find((p) => p.name === name)
  const display = (name: string) => sp(name)?.displayName || name
  /** 把文字里的联赛名字换成显示名 */
  const relabel = (s: string) => tidy(names.reduce((acc, n) => acc.split(n).join(display(n)), s))
  // 读回放；老回放里没记中文名（look.name）时用当前规则包里写的
  const loadReplay = (file: string) => {
    const r = JSON.parse(readFileSync(join(dirname(resolve(seriesFile)), file), "utf8")) as Replay
    for (const [k, t] of Object.entries(r.types)) {
      const name = specs?.[k]?.look?.name
      if (name && t.look && !t.look.name) t.look = { ...t.look, name }
    }
    return r
  }
  const scenes: Scene[] = []
  /** 选手有形象图就用联赛名字当图的名字（页面里按它取），头像按 avatar 裁 */
  const imageOf = (name: string) => (sp(name)?.portrait ? name : null)
  const avatarOf = (name: string) => (sp(name)?.avatar?.length === 3 ? sp(name)!.avatar! : DEFAULT_AVATAR)
  // 每个选手那局高光对局的标题和解说（脚本的 highlights）；脚本没写就从联赛挑的前 3 局里挑
  const picks: { index: number; title?: string; commentary?: string }[] = script.highlights?.length
    ? script.highlights
    : (sum.highlights ?? []).slice(0, 3).map((h) => ({ index: h.index }))
  /** 一局高光对局要用的东西：回放、结果、标题、解说、座位 */
  const hlData = (pick: { index: number; title?: string; commentary?: string }, focus?: string) => {
    const g = series.results.find((r) => r.index === pick.index)!
    const replay = loadReplay(g.replay)
    // 每个座位是哪个参赛者；颜色太近的这一局里换（D-230），这局是谁的高光对局，谁保留自己的颜色
    const seatOf = g.names.map((n) => names.indexOf(n))
    const shown = contrastColors(seatOf, focus !== undefined && names.includes(focus) ? names.indexOf(focus) : seatOf[0])
    const sides = [...new Set(g.teams)].map((t) => {
      const seats = g.teams.map((tt, p) => (tt === t ? p : -1)).filter((p) => p >= 0)
      return { name: [...new Set(seats.map((p) => display(g.names[p])))].join("+"), color: shown.get(seatOf[seats[0]])! }
    })
    const winners = [...new Set(g.winners.map((p) => display(g.names[p])))]
    const result = tidy(winners.length ? `${winners.join("、")} 获胜` : "平局")
    const title = pick.title || sides.map((s) => s.name).join(" 对 ")
    const commentary = pick.commentary || null
    const seats = seatOf.map((i, p) => ({ name: display(g.names[p]), color: shown.get(i)!, avatar: imageOf(g.names[p]), crop: avatarOf(g.names[p]) }))
    return { g, replay, result, title, commentary, seats }
  }
  // 开场阵容（D-179 加、D-221 删，D-230 用户要求加回来）：第一帧就是全体参赛选手的立绘阵容和一句大字（不从黑屏淡入，也当封面），
  // 平台署名和仓库地址用小字放在它最下面
  const entrants = new Set(contestantNames(series))
  const lineupPlayers = script.players.filter((p) => entrants.has(p.name))
  scenes.push({
    label: "开场阵容",
    data: {
      kind: "lineup",
      frames: sec(fps, 2.5),
      title: script.hook?.text || `${lineupPlayers.length} 位选手的${series.ruleset.name}联赛，谁能夺冠？`,
      sub: `${series.ruleset.name}联赛 · ${lineupPlayers.length} 位选手 · ${series.results.length} 局`,
      players: lineupPlayers.map((p) => ({ name: display(p.name), color: color(names.indexOf(p.name)), portrait: imageOf(p.name) })),
    },
  })
  // 规则介绍（开场阵容之后）：脚本写的几句（不写就用规则包的一句话简介），配第一局高光对局的开局地图和单位图例
  const rulesLines = script.rules?.length ? script.rules : series.ruleset.summary ? [series.ruleset.summary] : []
  const mapIndex = script.highlights?.[0]?.index ?? sum.highlights?.[0]?.index ?? series.results[0]?.index
  const mapGame = series.results.find((r) => r.index === mapIndex)
  if (mapGame) {
    const replay = loadReplay(mapGame.replay)
    const seatOf = mapGame.names.map((n) => names.indexOf(n))
    const shown = contrastColors(seatOf, seatOf[0])
    scenes.push({ label: "规则介绍", data: rulesScene(replay, series.ruleset.name, rulesLines, `第 ${mapGame.index} 局的开局地图`, seatOf.map((i) => shown.get(i)!), fps, specs) })
  }
  // 只介绍参赛 bot，平台自带的参考 bot（陪练）不进视频（D-221 只出现在排名页，D-225 排名页也删了）
  const own = new Set(contestantNames(series))
  // 选手按联赛名次倒着出场，最后一名先上、冠军压轴（D-181，用户要求）；名次一样的按脚本里的顺序
  const rankOf = (name: string) => sum.standings.find((x) => x.index === names.indexOf(name))?.rank ?? names.length
  const byRank = script.players
    .filter((p) => own.has(p.name))
    .map((p, k) => ({ p, k }))
    .sort((a, b) => rankOf(b.p.name) - rankOf(a.p.name) || a.k - b.k)
  const playerScene = (p: VideoScript["players"][number]): Scene => {
    const i = names.indexOf(p.name)
    const st = sum.standings.find((s) => s.index === i)
    const file = resolveBotFile(series.participants[i].file, seriesFile)
    const facts = file ? codeFacts(readFileSync(file, "utf8")) : null
    const factLines = facts
      ? [
          `${facts.lines} 行 · 注释占 ${Math.round(facts.commentRatio * 100)}%`,
          `${facts.functions} 个函数 · ${facts.interfacesAndTypes} 个类型 · ${facts.topLevelState} 个顶层变量`,
          `attackMove ×${facts.features["cmd.attackMove"]} · attack ×${facts.features["cmd.attack"]}`,
        ]
      : ["（没找到代码文件）"]
    return {
      label: `选手 ${p.displayName || p.name}`,
      data: {
        kind: "player",
        // 按字数算：原来按每秒 11 字的 1.3 倍（约 14 字）读、4.6～13 秒；D-183、D-221 时长两次减半、字数不变
        // （用户：观众是读长文本很快的程序员），1.15～3.25 秒，页内动画也快一倍
        frames: sec(fps, Math.min(13, Math.max(4.6, len(p.tagline, ...p.intro) / (11 * BRISK))) / 2 / HALF),
        speed: BRISK * HALF,
        color: color(i),
        displayName: p.displayName || p.name,
        name: p.name,
        byline: p.byline || null,
        tagline: p.tagline,
        intro: p.intro,
        // 文件开头的 12 行（原样，注释和代码都有；跳过空行、空注释和分隔线）
        codeHeader: file ? readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => !BLANKISH.test(l)).slice(0, 12).map((l) => l.replace(/\t/g, "  ")) : [],
        facts: factLines,
        record: st ? [`联赛 ${st.wins} 胜 ${st.draws} 平 ${st.losses} 负`, `得分率 ${Math.round(st.rate * 100)}% · 等级分 ${st.elo}`] : [],
        rank: st?.rank ?? names.length,
        total: names.length,
        // 背后的半透明半身像、能力雷达图（D-177）
        portrait: imageOf(p.name),
        radar: analysis?.radar[p.name] ?? null,
      },
    }
  }
  const players = byRank.map(({ p }) => playerScene(p))
  // 每个参赛选手：介绍，紧接着整局放他的高光对局（D-183 竖屏这样排，D-221 横屏也一样，没有标题卡；回放顶上写「<选手>的高光对局」、标题和解说）
  const games = playerGames(series, byRank.map(({ p }) => p), picks.map((x) => x.index))
  byRank.forEach(({ p }, k) => {
    scenes.push(players[k])
    const idx = games.get(p.name)
    if (idx === null || idx === undefined) return
    const { g, replay, result, title, commentary, seats } = hlData(picks.find((x) => x.index === idx) ?? { index: idx }, p.name)
    const label = tidy(`${p.displayName || p.name} 的高光对局`)
    const rs = replayScene(replay, k + 1, title, commentary, seats, result, fps, analysis?.weights ?? null)
    scenes.push({ label: `${label} 回放（第 ${g.index} 局）`, ...rs, data: { ...rs.data, kicker: label } as SceneData })
  })
  // 联赛排名（D-237，片尾之前）
  scenes.push({ label: "联赛排名和对阵胜负", data: standingsScene(series, display, own, fps) })
  // 片尾名单：参赛选手，按脚本里的顺序
  const credits = script.players.filter((s) => own.has(s.name)).map((s) => `${s.displayName || s.name}${s.byline ? ` · ${s.byline}` : ""}`)
  scenes.push({ label: "总结、片尾署名和选手名单", data: { kind: "brandClose", frames: sec(fps, 6.5 / BRISK), speed: BRISK, outro: script.outro || null, credits: [...credits, "比赛、回放、精彩对局和这段视频都由平台自动生成"] } })
  // 第一段（开场阵容，D-230 加回来）的第一帧就是完整画面，不从黑屏淡入（也当封面，D-179）
  if (scenes[0]) scenes[0] = { ...scenes[0], data: { ...scenes[0].data, first: true } }
  return scenes
}

/**
 * 联赛排名页（D-237，用户：结尾仓库介绍之前再把联赛同款的互相胜败的排名加回去）：和联赛命令行一样的排行榜（名次、胜-平-负、得分率），
 * 每行后面接这个 bot 对每个对手的胜负（D-223 的对战胜负表，行、列都按名次）；平台自带的参考 bot 也列上、标「陪练」。时长按人数算，3.5～6 秒
 */
function standingsScene(series: SeriesFile, display: (name: string) => string, own: Set<string>, fps: number): SceneData {
  const sum = series.summary!
  const m = sum.matrix
  const order = [...sum.standings].sort((a, b) => a.rank - b.rank)
  const multi = (series.size ?? 2) > 2 || !!series.teams
  const hasDraw = order.some((a) => order.some((b) => (m[a.index]?.[b.index]?.d ?? 0) > 0))
  const perPair = Math.max(0, ...order.flatMap((a) => order.map((b) => (a === b || !m[a.index]?.[b.index] ? 0 : m[a.index][b.index].w + m[a.index][b.index].d + m[a.index][b.index].l))))
  const what = multi ? `同一局里行排在列前面-${hasDraw ? "并列-" : ""}后面的次数` : `行对列的${hasDraw ? "胜-平-负" : "胜-负"}${perPair ? `（每对 ${perPair} 局）` : ""}`
  return {
    kind: "standings",
    frames: sec(fps, Math.min(6, Math.max(3.5, 2 + order.length * 0.3))),
    speed: HALF,
    title: "联赛排名",
    sub: tidy(`${order.length} 个 bot · ${series.results.length} 局 · 右边是${what}，绿色是赢多输少${order.some((x) => !own.has(x.name)) ? " · 灰色的是平台自带的陪练" : ""}`),
    rows: order.map((st) => ({ name: display(st.name), color: PALETTE[st.index % PALETTE.length], rank: st.rank, record: `${st.wins}-${st.draws}-${st.losses}`, rate: st.rate, ref: !own.has(st.name) })),
    cells: order.map((a) =>
      order.map((b) => {
        const c = a === b ? null : m[a.index]?.[b.index]
        return c && c.w + c.d + c.l ? { text: hasDraw ? `${c.w}-${c.d}-${c.l}` : `${c.w}-${c.l}`, rate: c.w + c.l ? c.w / (c.w + c.l) : 0.5 } : null
      }),
    ),
  }
}

/** 单位、建筑的一句话数值（图例用）：造价、生命、攻击 */
function typeDetail(t: Replay["types"][string], spec?: TypeSpecs[string], nameOf: (type: string) => string = (x) => x): string {
  const parts: string[] = []
  const cost = Object.values(t.cost ?? {}).reduce((a: number, c) => a + (c ?? 0), 0)
  if (t.kind === "resource") return "可采集"
  if (cost) parts.push(`${cost} 金`)
  if (t.maxHp) parts.push(`${t.maxHp} 血`)
  const attack = t.attack ?? spec?.attack
  // 克制（D-166）：倍数大于 1 的写「克骑兵」，放在射程前面（图例排两栏、说明被截断时先留住它）
  const counters = Object.entries(attack?.vs ?? {}).filter(([, m]) => (m ?? 1) > 1)
  if (counters.length) parts.push(`克${counters.map(([k]) => nameOf(k)).join("、")}`)
  if (attack) parts.push(attack.range > 1 ? `射程 ${attack.range}` : "近战")
  // 能力按规则包里实际的写（歼灭的工人只采矿、不能建造）；老回放没记就看规则包，都没有就按"工人"笼统写采矿
  const gather = t.gather ?? (spec ? !!spec.gather : t.worker)
  const builds = t.builds ?? spec?.builds ?? []
  const can = [gather ? "采矿" : "", builds.length ? "建造" : ""].filter(Boolean)
  if (can.length) parts.push(can.join("、"))
  // 技能、光环、被动（D-186）：写名字
  const ab = [...(t.auras ?? []).map((a) => `光环${a.name}`), ...(t.skills ?? []).map((k) => `技能${k.name}`), ...(t.passives ?? []).map((p) => p.name)]
  if (ab.length) parts.push(ab.join("、"))
  return parts.join(" · ")
}

/** 规则介绍的画面：文字 + 一局的开局地图 + 单位图例 */
function rulesScene(replay: Replay, ruleset: string, lines: string[], mapNote: string, seatColors: string[], fps: number, specs?: TypeSpecs): SceneData {
  const typeNames = Object.keys(replay.types)
  const ents: number[] = []
  // 每个实体朝左还是朝右（D-234：背对自己的主基地）
  const faces: number[] = []
  const homeFace = homeFacing(replay)
  for (const e of replay.initial.entities) {
    const t = replay.types[e.type]
    if (!t) continue
    ents.push(e.x, e.y, t.w ?? 1, t.h ?? 1, e.owner, typeNames.indexOf(e.type))
    faces.push(homeFace(e))
  }
  const order = { building: 0, unit: 1, resource: 2 } as Record<string, number>
  // 最多 12 项（两栏 6 行）；放不下时先留单位和资源，建筑按定义的顺序从后往前删（科技规则包有 12 种）
  const cand = typeNames.map((k) => ({ k, t: replay.types[k] })).filter((x) => x.t.look?.label || x.t.kind === "resource")
  const keep = { unit: 0, resource: 1, building: 2 } as Record<string, number>
  const kept = new Set([...cand].sort((a, b) => (keep[a.t.kind] ?? 3) - (keep[b.t.kind] ?? 3)).slice(0, 12).map((x) => x.k))
  const legend = cand
    .filter((x) => kept.has(x.k))
    .sort((a, b) => (order[a.t.kind] ?? 3) - (order[b.t.kind] ?? 3))
    .map(({ k, t }) => ({ shape: t.look?.shape ?? "circle", label: t.look?.label ?? "", color: t.look?.color ?? null, kind: t.kind, name: typeName(replay, k), detail: typeDetail(t, specs?.[k], (x) => typeName(replay, x)), art: { name: k, kind: t.kind, worker: t.worker, range: t.attack?.range, splash: t.attack?.splash, label: t.look?.label, art: t.look?.art } }))
  const chars = lines.reduce((a, l) => a + [...l].length, 0)
  return {
    kind: "rules",
    // 按字数算，再两次减半（D-183、D-221：用户让规则介绍时长减半、字数不变），1.5～3 秒，页内动画也快一倍
    frames: sec(fps, readSecs(chars, 4, 6, 12) / 2 / HALF),
    speed: HALF,
    ruleset,
    lines,
    mapNote,
    width: replay.map.width,
    height: replay.map.height,
    terrain: replay.map.terrain,
    colors: replay.map.colors,
    ents,
    faces,
    markers: replay.initial.markers?.length ? replay.initial.markers : (replay.frames.find((f) => f.markers?.length)?.markers ?? []),
    types: typeNames.map((k) => ({ name: k, shape: replay.types[k].look?.shape ?? "circle", label: replay.types[k].look?.label ?? "", color: replay.types[k].look?.color ?? null, kind: replay.types[k].kind, worker: replay.types[k].worker, range: replay.types[k].attack?.range, splash: replay.types[k].attack?.splash, art: replay.types[k].look?.art })),
    seatColors,
    legend,
    tickNote: `时间单位 tick：1 秒 = ${replay.tickRate} tick，一局最多 ${replay.maxTicks} tick`,
  }
}

/** 战斗前后多放几 tick：交火往往在第一个死亡之前就开始了 */
const BATTLE_LEAD = 40
const BATTLE_TAIL = 20
/** 没动静的地方一共最多放几秒（快进至少 4 倍速） */
const QUIET_SECONDS = 10
const QUIET_MIN_SPEED = 4
/**
 * 有单位倒下的交战按几倍速放：D-172 大战 2 倍速（用户看了一倍速说太慢），D-174 小冲突 4 倍速（用户：快进太快不知道发生了什么），
 * D-225 大战也 4 倍速（用户嫌节奏慢），D-226 不再分大战、小冲突（用户：都是 4 倍速没区别）
 */
const FIGHT_SPEED = 4
/** 被击退的单位滑到落点要几帧（D-226，30 帧一秒：0.6 秒，4 倍速下也看得出谁被推走了） */
const KNOCK_FRAMES = 18
/** 眩晕在回放里跟增益记在一起（recorder.ts），视频里不画金圈（D-226：被击退的敌人套着金圈，像吃了增益） */
const STUN = "眩晕"
/** 两段交火中间只空了这么几 tick 就不快进了，免得快进一闪而过 */
const SKIRMISH_GAP = 40

/** 最后一仗打完以后，还剩整局的这么多才结束，就算「后半局挂机」 */
const IDLE_TAIL = 0.3

/**
 * 精彩对局（含竖屏的 players[].highlight）里后半局没人打仗的局（D-185，用户：精彩对局 2 和 4 一半以上的时间都是挂机等时间结束）：
 * 最后一仗打完以后还剩整局的 30% 以上才结束（多半是打满时间比分），回放里观众只能看着进度条快进，提醒换一局
 */
export function idleHighlightWarnings(script: VideoScript, seriesFile: string): string[] {
  const series = readSeries(seriesFile)
  const refs = [
    ...(Array.isArray(script.highlights) ? script.highlights.map((h, i) => ({ index: h?.index, where: `highlights[${i}]` })) : []),
    ...(Array.isArray(script.players) ? script.players.map((pl, i) => ({ index: pl?.highlight, where: `players[${i}]（${pl?.name}）.highlight` })) : []),
  ]
  const tailOf = new Map<number, { last: number; T: number; reason: string } | null>()
  const out: string[] = []
  for (const { index, where } of refs) {
    if (typeof index !== "number") continue
    if (!tailOf.has(index)) {
      const g = series.results.find((r) => r.index === index)
      let v: { last: number; T: number; reason: string } | null = null
      try {
        if (g) {
          const replay = JSON.parse(readFileSync(join(dirname(resolve(seriesFile)), g.replay), "utf8")) as Replay
          const { battles, skirmishes } = fightWindows(replay)
          const ends = [...battles, ...skirmishes].map((w) => w[1])
          v = { last: ends.length ? Math.max(...ends) : 0, T: Math.max(1, replay.result.tick), reason: g.reason }
        }
      } catch {
        // 回放读不了：不提醒（出视频时会报错）
      }
      tailOf.set(index, v)
    }
    const v = tailOf.get(index)
    if (!v || (v.T - v.last) / v.T <= IDLE_TAIL) continue
    const end = v.reason.startsWith("时间到") ? "打满时间比分" : "结束"
    out.push(
      `${where} 是第 ${index} 局：t${v.last} 以后到第 ${v.T} tick ${end}都没人打仗（占整局 ${Math.round(((v.T - v.last) / v.T) * 100)}%），回放里观众只能看着进度条快进：换一局仗打到最后的（拆家结束的最好）`,
    )
  }
  return out
}

/** 回放这一段怎么放：交战（有单位倒下，4 倍速，D-226 不再分大战、小冲突）、没动静快进 */
export type PaceMode = "fight" | "quiet"

/**
 * 回放里的交火时段（D-172、D-174）：同一套切分里，死 BIG_BATTLE 个以上、又不是一边倒的是大战（和视频侧栏标「大战」的一样），
 * 其余有单位倒下的（哪怕只死一个、一边倒的屠杀）是小冲突。每段从第一个死亡前 BATTLE_LEAD tick 到最后一个死亡后
 * BATTLE_TAIL tick，挨着的合并；小冲突和大战重叠的部分算大战
 */
/** 回放里每个单位、建筑的死亡（不算资源和规则包移除的），和战报「战斗」一节同一套 */
function deathsOf(replay: Replay): { t: number; x: number; y: number; owner: number; fighter: boolean; unit: boolean }[] {
  const s = new ReplayModel(replay).initialState()
  const fighter = fighterTest(replay.types)
  const deaths: { t: number; x: number; y: number; owner: number; fighter: boolean; unit: boolean }[] = []
  for (const f of replay.frames) {
    const removed = new Set(f.removed ?? [])
    for (const id of f.die ?? []) {
      const e = s.ents.get(id)
      if (!e || removed.has(id) || replay.types[e.type]?.kind === "resource") continue
      deaths.push({ t: f.t, x: e.x, y: e.y, owner: e.owner, fighter: fighter(e.type), unit: replay.types[e.type]?.kind === "unit" })
    }
    applyFrame(s, f)
  }
  return deaths
}

export function fightWindows(replay: Replay): { battles: [number, number][]; skirmishes: [number, number][] } {
  const T = Math.max(1, replay.result.tick)
  const team = (p: number) => replay.players[p]?.team ?? p
  const deaths = deathsOf(replay)
  const big = (b: (typeof deaths)[number][]) => b.length >= BIG_BATTLE && !isRout(b, team)
  const merged = (bs: (typeof deaths)[number][][]) => {
    const out: [number, number][] = []
    const wins = bs.map((b): [number, number] => [Math.max(0, b[0].t - BATTLE_LEAD), Math.min(T, b[b.length - 1].t + BATTLE_TAIL)]).sort((a, b) => a[0] - b[0])
    for (const w of wins) {
      const last = out[out.length - 1]
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1])
      else out.push([w[0], w[1]])
    }
    return out
  }
  const groups = groupBattles(deaths)
  return { battles: merged(groups.filter(big)), skirmishes: merged(groups.filter((b) => !big(b))) }
}

/**
 * 回放每帧对应的 tick（D-171、D-172、D-174、D-225、D-226，用户定）：有单位倒下的交战（大战、小冲突）按 FIGHT_SPEED 倍速放
 * （1 秒 = FIGHT_SPEED × 规则包的 tickRate 个 tick），没动静的时间快进，加起来最多 QUIET_SECONDS 秒、至少 QUIET_MIN_SPEED 倍速。
 * 返回一共放多少帧
 */
/**
 * 哪些帧放大交战（横屏 D-236、竖屏 D-182）：交战段里死的单位（不算建筑）有 2 个以上才放大，
 * 只死 0～1 个的那段照旧看全图（用户：如果死亡单位小于等于 1 则不进行缩放）
 */
export function zoomFrames(replay: Replay, pace: { mode: (i: number) => PaceMode; tickOf: (i: number) => number }, playFrames: number): boolean[] {
  const died = deathsOf(replay).filter((d) => d.unit).map((d) => d.t)
  const zoom = new Array<boolean>(playFrames).fill(false)
  for (let a = 0; a < playFrames; ) {
    let b = a
    while (b < playFrames && pace.mode(b) === pace.mode(a)) b++
    if (pace.mode(a) === "fight") {
      const t0 = pace.tickOf(a), t1 = pace.tickOf(b - 1)
      if (died.filter((t) => t >= t0 && t <= t1).length >= 2) zoom.fill(true, a, b)
    }
    a = b
  }
  return zoom
}

export function pacing(replay: Replay, fps: number): { playFrames: number; tickOf: (i: number) => number; mode: (i: number) => PaceMode; speed: (i: number) => number } {
  const T = Math.max(1, replay.result.tick)
  const rate = Math.max(1, replay.tickRate || 10)
  const { battles, skirmishes } = fightWindows(replay)
  // 每个 tick 归哪一类：0 没动静、1 交战
  const cls = new Uint8Array(T)
  for (const [x, y] of [...skirmishes, ...battles]) cls.fill(1, x, y)
  for (let t = 0; t < T; ) {
    let e = t
    while (e < T && cls[e] === cls[t]) e++
    if (cls[t] === 0 && t > 0 && e < T && e - t < SKIRMISH_GAP) cls.fill(1, t, e)
    t = e
  }
  const quietTicks = cls.reduce((a, c) => a + (c === 0 ? 1 : 0), 0)
  const quietSpeed = Math.max(QUIET_MIN_SPEED, quietTicks / (rate * QUIET_SECONDS))
  const MODES: PaceMode[] = ["quiet", "fight"]
  const SPEEDS = [quietSpeed, FIGHT_SPEED]
  // 一段一段：从哪个 tick 到哪个 tick、每 tick 几帧、怎么放
  const segs: { t0: number; t1: number; perTick: number; mode: PaceMode; speed: number; f0: number }[] = []
  let f = 0
  for (let t = 0; t < T; ) {
    let e = t
    while (e < T && cls[e] === cls[t]) e++
    const perTick = fps / (rate * SPEEDS[cls[t]])
    segs.push({ t0: t, t1: e, perTick, mode: MODES[cls[t]], speed: SPEEDS[cls[t]], f0: f })
    f += (e - t) * perTick
    t = e
  }
  const playFrames = Math.max(2, Math.round(f))
  const segAt = (i: number) => {
    let k = 0
    while (k < segs.length - 1 && segs[k + 1].f0 <= i) k++
    return segs[k]
  }
  return {
    playFrames,
    tickOf: (i) => {
      if (i >= playFrames - 1) return T
      const g = segAt(i)
      return Math.min(T, Math.max(0, Math.floor(g.t0 + (i - g.f0) / g.perTick)))
    },
    mode: (i) => segAt(Math.min(i, playFrames - 1)).mode,
    speed: (i) => segAt(Math.min(i, playFrames - 1)).speed,
  }
}

/** 回放场景：交火（大战、小冲突）都按 4 倍速放、没动静快进（D-172、D-174、D-225），最后定格 1.5 秒显示结果 */
export function replayScene(
  replay: Replay,
  no: number,
  title: string,
  commentary: string | null,
  seats: { name: string; color: string; avatar?: string | null; crop?: number[] }[],
  result: string,
  fps: number,
  weights: number[] | null = null,
): Omit<Scene, "label"> {
  const T = replay.result.tick
  const hold = sec(fps, 1.5)
  const typeNames = Object.keys(replay.types)
  // 主基地（每家开局都有、生命最多的建筑）：选手有形象图时画成头像（D-177）
  const baseType = baseTypeOf(replay)
  const homeFace = homeFacing(replay)
  const types = typeNames.map((name) => {
    const t = replay.types[name]
    return { name, kind: t.kind, shape: t.look?.shape ?? "circle", label: t.look?.label ?? "", color: t.look?.color ?? null, worker: t.worker === true, base: name === baseType, range: t.attack?.range, splash: t.attack?.splash, art: t.look?.art }
  })
  // 实时胜率（D-177）：两方对打、有胜率模型时，每 WIN_STEP tick 一个点；两方各取第一个座位的名字和颜色
  const sides = twoSides(replay)
  const curve = weights && sides ? winCurve(replay, weights, WIN_STEP) : null
  const win =
    curve && sides
      ? {
          step: WIN_STEP,
          ticks: T,
          curve,
          sides: sides.map((t) => {
            const p = replay.players.findIndex((pl, i) => (pl.team ?? i) === t)
            return { name: seats[p]?.name ?? `P${p}`, color: seats[p]?.color ?? "#ccc" }
          }),
        }
      : null
  const eventsAt = replayEvents(replay, seats)
  const pace = pacing(replay, fps)
  const playFrames = pace.playFrames
  const model = new ReplayModel(replay)
  let state: State = model.initialState()
  const tickOf = (i: number) => (i >= playFrames ? T : pace.tickOf(i))
  const cameras = battleCameraTrack(replay, Array.from({ length: playFrames }, (_, i) => tickOf(i)), fps, zoomFrames(replay, pace, playFrames))
  const art = createBattleArt()
  // Canonical output-frame timestamps make effects deterministic when seeking or rendering previews.
  const displayedAt = new Int32Array(T + 1)
  for (let i = 0, tick = 0; i < playFrames; i++) {
    const end = tickOf(i)
    while (tick <= end) displayedAt[tick++] = i
  }
  let attacks: (BattleAttack & { frame: number })[] = []
  let fallen: (NonNullable<ReplayFrame["fallen"]>[number] & { frame: number })[] = []
  let attacking = new Map<number, { angle: number; frame: number; duration: number }>()
  let facing = new Map<number, number>()
  let walking = new Map<number, { x: number; y: number; tick: number; duration: number }>()
  let hitAt = new Map<number, number>()
  let deaths: { x: number; y: number; frame: number }[] = []
  // 特效（D-190）：最近放的技能（释放者、目标）、最近的回血、每个实体放技能和出现的 tick（算冷却环）、最近一次回血的 tick
  let casts: { x: number; y: number; targets: { x: number; y: number }[]; frame: number }[] = []
  let heals: { x: number; y: number; amount: number; frame: number }[] = []
  // 规则包放的画面特效（D-205，比如击退的冲击波）
  let ruleFxs: { x: number; y: number; w: number; h: number; text?: string; color?: string; radius?: number; frame: number }[] = []
  let castAt = new Map<string, number>()
  let bornAt = new Map<number, number>()
  let healedAt = new Map<number, number>()
  // 被击退的单位（D-226）：从哪儿、滑到哪儿、第几帧开始滑
  let knocks = new Map<number, { x0: number; y0: number; x1: number; y1: number; frame: number }>()
  /** 第 i 帧画在哪：在滑的按缓出插值（先快后慢），滑完或没在滑就是实际位置；p 是滑了多少（0～1） */
  const drawnAt = (id: number, e: { x: number; y: number }, i: number) => {
    const k = knocks.get(id)
    // 落地后又走开了（快进时一帧好几 tick）：不再滑，免得拖尾一直拉到它现在的位置（D-235）
    if (!k || e.x !== k.x1 || e.y !== k.y1) {
      const step = walking.get(id)
      const p = !step || i >= playFrames ? 1 : Math.min(1, Math.max(0, (tickOf(i) - step.tick) / step.duration))
      return { x: step ? step.x + (e.x - step.x) * p : e.x, y: step ? step.y + (e.y - step.y) * p : e.y, p: 1 }
    }
    const p = Math.min(1, Math.max(0, (i - k.frame) / KNOCK_FRAMES))
    const q = 1 - (1 - p) ** 2
    return { x: k.x0 + (e.x - k.x0) * q, y: k.y0 + (e.y - k.y0) * q, p }
  }
  const resetFx = () => {
    casts = []
    heals = []
    ruleFxs = []
    castAt = new Map()
    bornAt = new Map(replay.initial.entities.map((e) => [e.id, 0]))
    healedAt = new Map()
    knocks = new Map()
    attacks = []
    fallen = []
    attacking = new Map()
    facing = new Map()
    walking = new Map()
    hitAt = new Map()
  }
  resetFx()
  let lastTick = 0
  let lastFrame = -1
  /** 第 i 帧的局面：局面只能往前推，往回要的话从头再来（预览时会这样） */
  const frame = (i: number): ReplayFrame => {
    if (i <= lastFrame) {
      state = model.initialState()
      deaths = []
      resetFx()
      lastTick = 0
    }
    lastFrame = i
    const t = tickOf(i)
    for (let k = lastTick + 1; k <= t; k++) {
      const f = replay.frames[k - 1]
      const removed = new Set(f.removed ?? [])
      for (const id of f.die ?? []) {
        const e = state.ents.get(id)
        const ty = e && replay.types[e.type]
        if (e && ty && !removed.has(id) && ty.kind !== "resource") {
          deaths.push({ x: e.x, y: e.y, frame: displayedAt[k] })
          fallen.push({ x: e.x, y: e.y, w: ty.w, h: ty.h, owner: e.owner, age: 0, frame: displayedAt[k], duration: Math.round(fps * (ty.kind === "building" ? 1.2 : .65)), building: ty.kind === "building" })
        }
      }
      // 被击退的（规则包 teleport 一下挪 2 格以上，落点有规则包放的特效、或者这一 tick 被眩晕）：画成从原来的位置滑过去（D-226，用户：4 倍速下根本看不出谁被击退）；
      // 光看挪了几格不算：自己人互相让路时一 tick 里能被连着换好几次位置，一下挪 2～4 格，那是走路（D-235，用户：兵营出来的兵快进会错误触发击退效果）；
      // 规则包在落点放的那团特效不画（用户：被击退的不用再显示这个意义不明的效果），带字的（领主身上的「击退」冲击波）照画
      const landed = new Set<string>()
      const mv = f.move ?? []
      for (let j = 0; j < mv.length; j += 3) {
        const e = state.ents.get(mv[j])
        if (!e) continue
        const dx = mv[j + 1] - e.x, dy = mv[j + 2] - e.y
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        const displaced = distance >= 2 && (f.fx?.some((fx) => fx.x === mv[j + 1] && fx.y === mv[j + 2]) || f.bf?.some(([id, bf]) => id === e.id && bf?.includes(STUN)))
        if (!displaced) {
          // 走一步才转身；被击退的照旧面朝原来的方向往后滑（D-234）
          facing.set(e.id, faceToward(facing.get(e.id) ?? homeFace(e), dx))
          walking.set(e.id, { x: e.x, y: e.y, tick: k, duration: Math.max(1, e.st?.moveTicks ?? replay.types[e.type]?.moveTicks ?? 1) })
          continue
        }
        const from = drawnAt(mv[j], e, displayedAt[k])
        knocks.set(mv[j], { x0: from.x, y0: from.y, x1: mv[j + 1], y1: mv[j + 2], frame: displayedAt[k] })
        landed.add(`${mv[j + 1]},${mv[j + 2]}`)
      }
      for (const e of f.spawn ?? []) bornAt.set(e.id, f.t)
      for (const c of f.casts ?? []) {
        castAt.set(`${c.u}|${c.s}`, f.t)
        const caster = state.ents.get(c.u)
        if (!caster) continue
        const targets: { x: number; y: number }[] = []
        if (c.x !== undefined && c.y !== undefined) targets.push({ x: c.x, y: c.y })
        const tg = c.t !== undefined ? state.ents.get(c.t) : undefined
        if (tg) targets.push({ x: tg.x, y: tg.y })
        // 同一 tick 在释放者 4 格内刷出来的资源点（点金的金矿）
        for (const e of f.spawn ?? []) if (replay.types[e.type]?.kind === "resource" && Math.abs(e.x - caster.x) + Math.abs(e.y - caster.y) <= 4) targets.push({ x: e.x, y: e.y })
        casts.push({ x: caster.x, y: caster.y, targets, frame: displayedAt[k] })
      }
      const splashFx = legacySplashEffects(replay, f, state.ents)
      for (const fx of f.fx ?? []) if (!splashFx.has(fx) && (fx.text || !landed.has(`${fx.x},${fx.y}`))) ruleFxs.push({ ...fx, frame: displayedAt[k] })
      const hl = f.heal ?? []
      for (let j = 0; j < hl.length; j += 2) {
        healedAt.set(hl[j], f.t)
        const e = state.ents.get(hl[j])
        if (e) heals.push({ x: e.x, y: e.y, amount: hl[j + 1], frame: displayedAt[k] })
      }
      // Preserve every recorded strike, including melee and events crossed while fast-forwarding.
      // Combat resolves after spawning and before movement or removal of dead entities.
      const sh = f.shots ?? []
      for (let j = 0; j < sh.length; j += 2) {
        const a = state.ents.get(sh[j]) ?? f.spawn?.find((e) => e.id === sh[j])
        const b = state.ents.get(sh[j + 1]) ?? f.spawn?.find((e) => e.id === sh[j + 1])
        if (!a || !b) continue
        const ta = replay.types[a.type], tb = replay.types[b.type]
        if (!ta || !tb) continue
        const x1 = a.x + ta.w / 2, y1 = a.y + ta.h / 2, x2 = b.x + tb.w / 2, y2 = b.y + tb.h / 2
        const style = art.attackStyle({ name: a.type, kind: ta.kind, worker: ta.worker, range: a.st?.attack?.range ?? ta.attack?.range, splash: ta.attack?.splash })
        const duration = Math.max(3, Math.round(fps * (style === "shell" ? .48 : style === "arrow" ? .30 : .24)))
        const frame = displayedAt[k]
        const angle = Math.atan2(y2 - y1, x2 - x1)
        attacks.push({ source: a.id, target: b.id, x1, y1, x2, y2, owner: a.owner, style, age: 0, duration, frame })
        attacking.set(a.id, { angle, frame, duration })
        facing.set(a.id, faceToward(facing.get(a.id) ?? homeFace(a), x2 - x1))
        hitAt.set(b.id, frame)
      }
      applyFrame(state, f)
    }
    lastTick = t
    const ents: number[] = []
    const poses: number[] = []
    const workers: NonNullable<ReplayFrame["workers"]> = []
    const production: NonNullable<ReplayFrame["production"]> = []
    const farms=farmWorkers(replay,state.ents)
    const auras: number[] = []
    const buffed: number[] = []
    // 技能冷却环 [x, y, w, h, 冷却好了的比例]、正在回血的 [x, y, w, h]（D-190）
    const cds: number[] = []
    const healing: number[] = []
    // 正在滑的：[原来的 x, y, 现在画在的 x, y, 滑了多少] 一组 5 个（D-226）
    const knockFx: number[] = []
    for (const e of state.ents.values()) {
      const ty = replay.types[e.type]
      if (!ty) continue
      const max = e.st?.maxHp ?? ty.maxHp
      const hp = ty.kind === "resource" || !max ? 100 : Math.max(0, Math.min(100, Math.round((100 * e.hp) / max)))
      const d = drawnAt(e.id, e, i)
      const kn = knocks.get(e.id)
      if (kn && d.p < 1) knockFx.push(kn.x0, kn.y0, d.x, d.y, d.p)
      ents.push(d.x, d.y, ty.w, ty.h, e.owner, typeNames.indexOf(e.type), hp, e.bp ?? 100)
      const queue=trainingQueue(replay,e)
      if(queue?.length)production.push({x:d.x,y:d.y,w:ty.w,h:ty.h,count:queue.length,active:queue.filter(q=>q.active).map(q=>({progress:q.progress,blocked:q.blocked}))})
      const act = attacking.get(e.id)
      const age = act ? i - act.frame : Infinity
      const step = walking.get(e.id)
      const walk = step && t - step.tick <= step.duration && i < playFrames ? Math.sin(t / step.duration * Math.PI + e.id * 1.7) : 0
      const hit = hitAt.get(e.id)
      const labor = workerPose(replay, state.ents, e, Math.min(i, playFrames - 1) / fps, !!step && t - step.tick < step.duration, farms)
      if (labor) {
        if (act && age < act.duration) labor.work = -1
        workers.push({ index: ents.length / 8 - 1, pose: labor })
      }
      poses.push(facing.get(e.id) ?? homeFace(e), walk, act && age < act.duration ? age / act.duration : -1, hit === undefined ? 0 : Math.max(0, 1 - (i - hit) / Math.max(1, fps * .1)))
      // 光环范围、身上有增益的单位（D-186；眩晕不算，D-226）
      if (e.bp === undefined) for (const a of ty.auras ?? []) auras.push(d.x, d.y, ty.w, ty.h, a.radius < 0 ? (e.st?.sight ?? ty.sight ?? 0) : a.radius, e.owner)
      if (e.bf?.some((b) => b !== STUN) && ty.kind === "unit") buffed.push(d.x, d.y)
      for (const k of ty.skills ?? []) {
        const last = castAt.get(`${e.id}|${k.id}`)
        const left = last !== undefined ? Math.max(0, last + k.cooldown - 1 - t) : Math.max(0, k.initialCooldown - (t - (bornAt.get(e.id) ?? 0)))
        cds.push(d.x, d.y, ty.w, ty.h, left === 0 ? 1 : 1 - left / Math.max(1, k.cooldown))
      }
      const regen = ty.passives?.find((x) => x.kind === "regen")
      const lh = healedAt.get(e.id)
      if (regen && lh !== undefined && t - lh <= regen.every + 1) healing.push(d.x, d.y, ty.w, ty.h)
    }
    for (const [id, k] of knocks) {
      const e = state.ents.get(id)
      if (!e || e.x !== k.x1 || e.y !== k.y1 || i - k.frame >= KNOCK_FRAMES) knocks.delete(id)
    }
    casts = casts.filter((c) => i - c.frame < 18)
    heals = heals.filter((h) => i - h.frame < 14)
    ruleFxs = ruleFxs.filter((r) => i - r.frame < 24)
    const ruleFx = ruleFxs.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, age: i - r.frame, ...(r.text ? { text: r.text } : {}), ...(r.color ? { color: r.color } : {}), ...(r.radius ? { radius: r.radius } : {}) }))
    const castFx = casts.flatMap((c) => (c.targets.length ? c.targets.flatMap((tg) => [c.x, c.y, tg.x, tg.y, i - c.frame]) : [c.x, c.y, -1, -1, i - c.frame]))
    const healFx = heals.flatMap((h) => [h.x, h.y, h.amount, i - h.frame])
    const counts = seats.map((_, p) => {
      let army = 0
      let workers = 0
      let buildings = 0
      for (const e of state.ents.values()) {
        if (e.owner !== p) continue
        const ty = replay.types[e.type]
        if (ty?.kind === "building") buildings++
        else if (ty?.kind === "unit") ty.worker ? workers++ : army++
      }
      return { army, workers, buildings, score: Math.round(state.players[p]?.score ?? 0), alive: state.players[p]?.alive ?? true }
    })
    const recent = deaths.filter((d) => i - d.frame < 8).flatMap((d) => [d.x, d.y, i - d.frame])
    attacks = attacks.filter((a) => i - a.frame < a.duration)
    // Fast-forward can cross several attacks by one soldier in one output frame. Show its latest
    // stroke rather than stacking many identical weapons over the same body.
    const visibleAttacks = new Map<number, (typeof attacks)[number]>()
    for (const a of attacks) visibleAttacks.set(a.source, a)
    fallen = fallen.filter((d) => i - d.frame < d.duration)
    for (const id of walking.keys()) if (!state.ents.has(id)) { walking.delete(id); facing.delete(id); attacking.delete(id); hitAt.delete(id) }
    return {
      t,
      ents,
      // Legacy endpoints are derived from the same timeline, so seeking gives identical frames.
      shots: [...visibleAttacks.values()].filter((a) => i - a.frame <= 1).flatMap((a) => [a.x1 - .5, a.y1 - .5, a.x2 - .5, a.y2 - .5, a.owner]),
      combat: [...visibleAttacks.values()].map(({ frame, ...a }) => ({ ...a, age: i - frame })),
      poses,
      workers,
      production,
      camera: cameras[Math.min(i, playFrames - 1)],
      fallen: fallen.map(({ frame, ...d }) => ({ ...d, age: i - frame })),
      deaths: recent,
      counts,
      events: eventsAt(t),
      progress: T ? t / T : 1,
      final: i >= playFrames,
      pace: pace.mode(Math.min(i, playFrames - 1)),
      speed: Math.round(pace.speed(Math.min(i, playFrames - 1))),
      markers: state.markers,
      status: relabelSeats(state.status, seats, false),
      ...(auras.length ? { auras } : {}),
      ...(buffed.length ? { buffed } : {}),
      ...(castFx.length ? { castFx } : {}),
      ...(healFx.length ? { healFx } : {}),
      ...(ruleFx.length ? { ruleFx } : {}),
      ...(knockFx.length ? { knockFx } : {}),
      ...(cds.length ? { cds } : {}),
      ...(healing.length ? { healing } : {}),
    }
  }
  return {
    data: {
      kind: "replay",
      frames: playFrames + hold,
      no,
      title,
      commentary,
      width: replay.map.width,
      height: replay.map.height,
      terrain: replay.map.terrain,
      colors: replay.map.colors,
      types,
      seats,
      result,
      win,
    },
    frame,
  }
}

/** 规则包写的文字里的 P0、P1……换成选手名字（汉字之间的空格去掉） */
/**
 * 把规则包文字里的 P0、P1 换成选手名。句子（事件）顺便去掉中文名前后的空格；
 * 状态栏不去（规则包常用空格隔开几项，比如"台址 P0 P1 空"，去掉就粘成一串）
 */
export function relabelSeats(s: string, seats: { name: string }[], sentence = true): string {
  const out = s.replace(/(?<![A-Za-z])P(\d+)/g, (m, d) => seats[Number(d)]?.name ?? m)
  return sentence ? tidy(out) : out
}

/** 胜率曲线每隔几 tick 一个点 */
const WIN_STEP = 20

/** 侧栏里算"大战"的门槛：一场死 6 个以上 */
const BIG_BATTLE = 6

/**
 * 回放里的大事：第一次交火、失去建筑、大战、出局。返回"到第 t tick 为止该显示哪些"。
 * 大战和战报"战斗"一节是同一套切分（battles.ts，死亡算法也一样：不算资源和规则包移除的），时间和损失数对得上；
 * 一开打就显示"交战中"，损失随时间往上加，打完显示起止时间；一边倒的（兵冲进矿区杀工人这类，见 battles.ts）打完标「一边倒」
 */
function replayEvents(replay: Replay, seats: { name: string }[]): (t: number) => string[] {
  const freeUnit = (type: string) => {
    const t = replay.types[type]
    return t?.kind === "unit" && !t.worker && !Object.values(t.cost ?? {}).some((c) => (c ?? 0) > 0)
  }
  const fixed: { t: number; text: string }[] = []
  const deaths: { t: number; x: number; y: number; owner: number; fighter: boolean }[] = []
  const fighter = fighterTest(replay.types)
  const s = new ReplayModel(replay).initialState()
  const team = (p: number) => replay.players[p]?.team ?? p
  const name = (p: number) => (p >= 0 ? (seats[p]?.name ?? `P${p}`) : "中立")
  const tn = (type: string) => typeName(replay, type)
  let contact = false
  const wasAlive = s.players.map((p) => p.alive)
  for (const f of replay.frames) {
    const sh = f.shots ?? []
    for (let j = 0; j < sh.length && !contact; j += 2) {
      const a = s.ents.get(sh[j])
      const b = s.ents.get(sh[j + 1])
      // 侦察兵这类白送的单位（不花钱、不是工人）戳一下不算第一次交火（和战报一样）
      if (a && b && a.owner >= 0 && b.owner >= 0 && team(a.owner) !== team(b.owner) && !freeUnit(a.type) && !freeUnit(b.type)) {
        contact = true
        fixed.push({ t: f.t, text: `t${f.t} 第一次交火` })
      }
    }
    const removed = new Set(f.removed ?? [])
    // 规则包写的事件（夺下控制点、商队被劫……）
    for (const nt of f.notes ?? []) fixed.push({ t: f.t, text: `t${f.t} ${relabelSeats(nt.text, seats)}` })
    for (const id of f.die ?? []) {
      const e = s.ents.get(id)
      if (!e || removed.has(id)) continue
      const ty = replay.types[e.type]
      if (ty?.kind === "resource") continue
      deaths.push({ t: f.t, x: e.x, y: e.y, owner: e.owner, fighter: fighter(e.type) })
      if (ty?.kind === "building" && e.owner >= 0) fixed.push({ t: f.t, text: `t${f.t} ${name(e.owner)} 失去${tn(e.type)}${e.bp !== undefined ? "（没建好）" : ""}` })
    }
    applyFrame(s, f)
    s.players.forEach((p, i) => {
      if (wasAlive[i] && !p.alive) fixed.push({ t: f.t, text: `t${f.t} ${name(i)} 出局` })
      wasAlive[i] = p.alive
    })
  }
  // 门槛：死 6 个以上；这局最大的一仗都不到 6 个（夺点这类小规模交战）时，降到和战报一样的 3 个
  const all = groupBattles(deaths)
  const threshold = Math.max(3, Math.min(BIG_BATTLE, Math.max(0, ...all.map((b) => b.length))))
  const battles = all.filter((b) => b.length >= threshold).map((b) => Object.assign(b, { rout: isRout(b, team) }))
  return (t) => {
    const items = fixed.filter((e) => e.t <= t)
    for (const b of battles) {
      if (b[0].t > t) continue
      const t1 = b[b.length - 1].t
      const owners = [...new Set(b.map((d) => d.owner))].sort((x, y) => x - y)
      const loss = owners.map((p) => `${name(p)} 损失 ${b.filter((d) => d.owner === p && d.t <= t).length}`).join("，")
      items.push({ t: b[0].t, text: t >= t1 ? `t${b[0].t}～${t1} ${b.rout ? "一边倒" : b.length >= BIG_BATTLE ? "大战" : "交战"}：${loss}` : `t${b[0].t} 起交战中：${loss}` })
    }
    return items.sort((x, y) => x.t - y.t).map((e) => tidy(e.text))
  }
}

/** 时间表：每段从第几秒到第几秒、是什么 */
export interface TimelineItem {
  from: number
  to: number
  label: string
}

export function timelineOf(scenes: Scene[], fps: number): TimelineItem[] {
  let f = 0
  return scenes.map((s) => {
    const from = f / fps
    f += s.data.frames
    return { from, to: f / fps, label: s.label }
  })
}

export function timelineText(items: TimelineItem[]): string {
  return items.map((x) => `  ${x.from.toFixed(1).padStart(5)}～${x.to.toFixed(1).padEnd(5)} 秒  ${x.label}`).join("\n")
}

/** --preview auto：每段取一个动画出完、还没淡出的时刻；回放段取中间和最后定格 */
function autoPreview(scenes: Scene[], fps: number): number[] {
  const out: number[] = []
  let f = 0
  const at = (frame: number) => out.push(Math.round((frame / fps) * 10) / 10)
  for (const s of scenes) {
    const n = s.data.frames
    if (s.frame) {
      at(f + Math.round((n - sec(fps, 1.5)) / 2))
      at(f + n - sec(fps, 1.5) - 1) // 最后定格之前的那一帧：终局的局面，不被"获胜"的横幅挡住
    } else at(f + Math.round(n * 0.7))
    f += n
  }
  return out
}

/**
 * 只核对脚本、不出图（video --lint）：格式错误、提醒、每个字段的字数和上限、时间表。
 * 写脚本时反复用它，字数对了再出预览图
 */
export function lintScript(seriesFile: string, script: VideoScript, fps = 30, otherRulesets: string[] = [], vertical = false): { errors: string[]; warnings: string[]; counts: string[]; timeline: TimelineItem[] } {
  const series = readSeries(seriesFile)
  const errors = checkScript(script, series)
  const warnings = [...scriptWarnings(script, otherRulesets), ...highlightPlayerWarnings(script, readSeries(seriesFile)), ...idleHighlightWarnings(script, seriesFile), ...portraitWarnings(script)]
  // 参考 bot（陪练）写进 players 也不会出现在视频里（D-221 只介绍参赛 bot）
  const own = new Set(contestantNames(series))
  if (Array.isArray(script.players))
    for (const p of script.players) if (p && typeof p.name === "string" && series.participants.some((x) => x.name === p.name) && !own.has(p.name)) warnings.push(`players 里的 ${p.name} 是平台自带的参考 bot（陪练），视频里没有它，删掉就行`)
  const L = SCRIPT_LIMITS
  const n = (s?: string) => [...(s ?? "")].length
  const counts: string[] = []
  const row = (k: string, v: unknown, max: number) => {
    if (typeof v === "string") counts.push(`${k}：${n(v)} / ${max}${n(v) > max ? "  ← 超了" : ""}`)
  }
  if (Array.isArray(script.rules)) {
    script.rules.forEach((l, i) => row(`rules[${i}]`, l, L.rulesLine))
    const total = script.rules.reduce((a, l) => a + n(l), 0)
    counts.push(`rules 合计：${total} / ${RULES_PAGE_CHARS}${total > RULES_PAGE_CHARS ? "  ← 超了" : ""}`)
  }
  if (Array.isArray(script.players))
    script.players.forEach((p, i) => {
      row(`players[${i}]（${p.name}）.tagline`, p.tagline, L.tagline)
      if (Array.isArray(p.intro)) p.intro.forEach((l, j) => row(`players[${i}].intro[${j}]`, l, L.introLine))
      const total = n(p.tagline) + (Array.isArray(p.intro) ? p.intro.reduce((a, l) => a + n(l), 0) : 0)
      counts.push(`players[${i}]（${p.name}）tagline 加 intro：${total} / ${PLAYER_PAGE_CHARS}${total > PLAYER_PAGE_CHARS ? "  ← 超了" : total < PLAYER_PAGE_MIN ? `  ← 偏少（写到 180 字以上）` : ""}`)
    })
  if (Array.isArray(script.highlights))
    script.highlights.forEach((h, i) => {
      row(`highlights[${i}]（第 ${h.index} 局）.title`, h.title, L.hlTitle)
      row(`highlights[${i}]（第 ${h.index} 局）.commentary`, h.commentary, L.commentary)
    })
  row("outro", script.outro, L.outro)
  const timeline = errors.length ? [] : timelineOf(buildScenes(series, script, seriesFile, fps, undefined, null, { vertical }), fps)
  return { errors, warnings, counts, timeline }
}

/** 写了形象图、文件却找不到的选手（路径相对视频目录） */
function portraitWarnings(script: VideoScript): string[] {
  if (!Array.isArray(script.players)) return []
  return script.players
    .filter((p) => typeof p?.portrait === "string" && !existsSync(resolve(p.portrait)))
    .map((p) => `${p.name} 的形象图 ${p.portrait} 找不到（路径相对视频目录）：这个选手的页面不放半身像、精彩对局里的主基地照常画`)
}

export interface RenderResult {
  file: string | null
  seconds: number
  frames: number
  bytes: number
  images: string[]
  probe: { duration: number; width: number; height: number } | null
  timeline: TimelineItem[]
  /** 预览总览图（几张以上的预览才有） */
  sheet?: string
}

/** 删掉上一次出的预览图（或成品截图），免得越堆越多；只删这个命令自己起的文件名 */
function cleanOld(stem: string, kind: "preview" | "check"): void {
  const dir = dirname(resolve(stem))
  const base = basename(stem).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = kind === "preview" ? new RegExp(`^${base}-([\\d.]+s|总览)\\.png$`) : new RegExp(`^${base}-check-[\\d.]+s\\.png$`)
  for (const f of readdirSync(dir)) if (re.test(f)) unlinkSync(join(dir, f))
}

export async function renderLeagueVideo(o: RenderOptions): Promise<RenderResult> {
  const series = readSeries(o.seriesFile)
  const errs = checkScript(o.script, series)
  if (errs.length) throw new Error(`脚本有问题：\n- ${errs.join("\n- ")}`)
  const fps = o.fps ?? 30
  // 平台自带的规则包：读一下单位数值（老回放里没记攻击数据）
  let specs: TypeSpecs | undefined
  try {
    if (listRulesets().includes(series.ruleset.id)) {
      const r = await importRuleset(series.ruleset.id)
      specs = r.types as TypeSpecs
      series.ruleset.summary ??= r.summary
    }
  } catch {
    specs = undefined
  }
  // 雷达图、胜率模型要读完全部回放（第一次几十秒，之后用缓存）
  const analysis = analyzeLeague(series, o.seriesFile)
  const scenes = buildScenes(series, o.script, o.seriesFile, fps, specs, analysis, { vertical: o.vertical })
  const total = scenes.reduce((a, s) => a + s.data.frames, 0)
  const timeline = timelineOf(scenes, fps)
  const exe = findBrowser(o.browser)
  if (!exe) throw new Error("找不到 Chrome 或 Edge：视频要用本机的浏览器渲染。装一个，或者用 --browser <路径> / 环境变量 RTS_ARENA_BROWSER 指定")
  const browser = await launchBrowser(exe)
  const images: string[] = []
  const stem = o.out.replace(/\.mp4$/i, "")
  try {
    const muxerFile = createRequire(import.meta.url).resolve("mp4-muxer")
    await browser.evaluate(readFileSync(muxerFile, "utf8") + ";true")
    await browser.evaluate(`(${installVideoPage.toString()})(${createBattleArt.toString()});true`)
    await browser.evaluate(`__brand(${JSON.stringify(readFileSync(join(PKG_ROOT, "assets", "brand", "logo.svg"), "utf8"))})`)
    const width = o.width ?? (o.vertical ? 1080 : 1920)
    const height = o.height ?? (o.vertical ? 1920 : 1080)
    await browser.evaluate(`__size(${width}, ${height})`)
    // 选手的形象图（按联赛名字）：选手页的半身像、精彩对局里的头像都从它来
    for (const p of o.script.players) {
      if (!p.portrait || !existsSync(resolve(p.portrait))) continue
      const b64 = readFileSync(resolve(p.portrait)).toString("base64")
      await browser.evaluate(`__image(${JSON.stringify(p.name)}, ${JSON.stringify(b64)}, ${JSON.stringify(p.avatar?.length === 3 ? p.avatar : DEFAULT_AVATAR)})`)
    }
    const ok = await browser.evaluate<boolean>(`typeof VideoEncoder === "function"`)
    if (!ok) throw new Error("这个浏览器不支持 WebCodecs（VideoEncoder），换一个新一点的 Chrome / Edge")
    // 场景的起始帧
    const starts: number[] = []
    scenes.reduce((a, s) => (starts.push(a), a + s.data.frames), 0)
    const preview = o.preview === "auto" ? autoPreview(scenes, fps) : o.preview
    const check = o.check === "auto" ? autoPreview(scenes, fps) : (o.check ?? [])
    // 预览图、检查截图放进 preview/ 子目录，不和视频目录里的说明、代码混在一起
    const pstem = join(o.imagesDir ?? join(dirname(stem), "preview"), basename(stem))
    if (preview?.length) {
      mkdirSync(dirname(pstem), { recursive: true })
      cleanOld(pstem, "preview")
      const withSheet = preview.length > 1
      if (withSheet) await browser.evaluate(`__sheetBegin(${preview.length}, 4)`)
      for (const [n, t] of preview.entries()) {
        const f = Math.max(0, Math.min(total - 1, Math.round(t * fps)))
        const k = starts.findLastIndex((st) => st <= f)
        const sc = scenes[k]
        await browser.evaluate(`__scene(${JSON.stringify(sc.data)})`)
        const local = f - starts[k]
        // 回放场景要从头推到这一帧（刚死的红圈要知道是哪一帧死的）
        let rf: ReplayFrame | null = null
        if (sc.frame) for (let i = 0; i <= local; i++) rf = sc.frame(i)
        const png = await browser.evaluate<string>(`__png(${local}, ${JSON.stringify(rf)})`)
        const file = `${pstem}-${t}s.png`
        writeFileSync(file, Buffer.from(png, "base64"))
        images.push(file)
        if (withSheet) await browser.evaluate(`__sheetAdd(${n}, ${JSON.stringify(`${t} 秒 · ${sc.label}`)})`)
      }
      let sheet: string | undefined
      if (withSheet) {
        sheet = `${pstem}-总览.png`
        writeFileSync(sheet, Buffer.from(await browser.evaluate<string>("__sheetPng()"), "base64"))
      }
      return { file: null, seconds: total / fps, frames: total, bytes: 0, images, probe: null, timeline, sheet }
    }
    // 码率按像素数算：1080p 约 8 Mbps
    await browser.evaluate(`__init(${JSON.stringify({ fps, bitrate: Math.round((width * height * fps) / 7.8) })})`)
    let done = 0
    for (const sc of scenes) {
      await browser.evaluate(`__scene(${JSON.stringify(sc.data)})`)
      const n = sc.data.frames
      for (let i = 0; i < n; i += 10) {
        const batch: [number, ReplayFrame | null][] = []
        for (let j = i; j < Math.min(n, i + 10); j++) batch.push([j, sc.frame ? sc.frame(j) : null])
        await browser.evaluate(`__frames(${JSON.stringify(batch)})`)
        done += batch.length
        o.onProgress?.(done, total)
      }
    }
    const size = await browser.evaluate<number>("__finish()")
    const parts: Buffer[] = []
    for (let k = 0; k * 3_000_000 < size; k++) parts.push(Buffer.from(await browser.evaluate<string>(`__chunk(${k})`), "base64"))
    const bytes = Buffer.concat(parts)
    writeFileSync(o.out, bytes)
    // 用浏览器把成品解一遍：时长、尺寸对不对，顺便截几张图
    const probe = await browser.evaluate<{ duration: number; width: number; height: number; shots: string[] }>(`__probe(${JSON.stringify(check)})`)
    if (check.length) mkdirSync(dirname(pstem), { recursive: true })
    cleanOld(pstem, "check")
    probe.shots.forEach((b64, k) => {
      const file = `${pstem}-check-${check[k]}s.png`
      writeFileSync(file, Buffer.from(b64, "base64"))
      images.push(file)
    })
    return { file: o.out, seconds: total / fps, frames: total, bytes: bytes.length, images, probe: { duration: probe.duration, width: probe.width, height: probe.height }, timeline }
  } finally {
    await browser.close()
  }
}
