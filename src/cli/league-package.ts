// 联赛包（D-254，网页对战页「导出联赛包」）：做联赛视频要的东西打成一个 zip——联赛汇总、每局回放、参赛 bot 的代码和参赛报告。
// 解压后运行 rts-arena video-init <解压出的目录> 就能建视频目录。本机路径都换掉（用户：bot 文件会随视频公开，本机信息要屏蔽）：
// 参赛 bot 放进 bots/<名字>.ts，平台自带的参考 bot 记成 rulesets/<规则包>/bots/<名字>.ts（在别的机器上也按平台目录找得到），
// 规则包所在的目录不记
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { isReferenceBot } from "../video/brief.ts"
import type { ZipWriter } from "./zip.ts"

interface SeriesLike {
  kind?: string
  replays?: boolean
  summary?: unknown
  ruleset: { id: string; dir?: string }
  participants: { name: string; file: string }[]
  results: { replay: string | null }[]
}

/** 这场比赛能不能导出联赛包；能就返回 null */
export function leaguePackageProblem(series: SeriesLike): string | null {
  if (series.kind !== "league") return "只有联赛能导出联赛包（做视频要联赛的排名和统计）"
  if (series.replays === false) return "这场联赛没存回放（--no-replays），做不了视频"
  if (!series.summary) return "联赛还没打完"
  return null
}

/** 文件名里不能有的字符换成 - */
const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-")
const fileName = (file: string) => file.split(/[\\/]/).pop() ?? file

/**
 * 把 seriesFile 这场联赛打进 zip（都放在一个以汇总文件名命名的目录里），返回这个目录名。cwd 是跑联赛时的工作目录（bot 路径相对它）。
 * 不能导出时抛错，这时还没往 zip 里写东西
 */
export function packLeague(seriesFile: string, cwd: string, zip: ZipWriter): string {
  const series = JSON.parse(readFileSync(seriesFile, "utf8")) as SeriesLike & Record<string, unknown>
  const problem = leaguePackageProblem(series)
  if (problem) throw new Error(problem)
  const id = series.ruleset.id
  const folder = basename(seriesFile).replace(/\.series\.json$/, "")
  // 参赛者的新路径：按原路径和名字都能查（回放里记的是原路径，同一个 bot 报名两次时路径一样、名字不一样）
  const byFile = new Map<string, string>()
  const byName = new Map<string, string>()
  const written = new Set<string>()
  for (const p of series.participants) {
    let rel: string
    if (isReferenceBot(p.file, id)) rel = `rulesets/${id}/bots/${fileName(p.file)}`
    else {
      rel = `bots/${safe(p.name.replace(/#\d+$/, ""))}.ts`
      const src = resolve(cwd, p.file)
      if (!written.has(rel) && existsSync(src)) {
        zip.file(`${folder}/${rel}`, readFileSync(src))
        // 参赛报告：和代码放在一起的 <文件名>.REPORT.md；代码叫 bot.ts（bot 目录）时是同目录或上一层的 REPORT.md（同 video-init）
        const stem = fileName(src).replace(/\.ts$/, "")
        const report = [join(dirname(src), `${stem}.REPORT.md`), ...(stem === "bot" ? [join(dirname(src), "REPORT.md"), join(dirname(dirname(src)), "REPORT.md")] : [])].find((f) => existsSync(f))
        if (report) zip.file(`${folder}/${rel.replace(/\.ts$/, ".REPORT.md")}`, readFileSync(report))
      }
      written.add(rel)
    }
    byFile.set(p.file, rel)
    byName.set(p.name, rel)
  }
  const out = { ...series, ruleset: { ...series.ruleset }, participants: series.participants.map((p) => ({ ...p, file: byName.get(p.name)! })) }
  delete out.ruleset.dir
  zip.file(`${folder}/${basename(seriesFile)}`, JSON.stringify(out, null, 1))
  // 每局回放：里面每个座位记的 bot 路径也换掉
  const dir = dirname(seriesFile)
  for (const r of series.results) {
    if (!r.replay || !existsSync(join(dir, r.replay))) continue
    const replay = JSON.parse(readFileSync(join(dir, r.replay), "utf8")) as { players?: { name: string; bot: string }[]; bots?: { bot?: string }[] }
    const scrub = (name: string | undefined, file: string | undefined) => (name !== undefined && byName.get(name)) || (file !== undefined && byFile.get(file)) || (file !== undefined ? fileName(file) : "")
    for (const p of replay.players ?? []) p.bot = scrub(p.name, p.bot)
    // 每个座位的统计和座位一一对应
    replay.bots?.forEach((b, i) => {
      if (b.bot !== undefined) b.bot = replay.players?.[i]?.bot ?? scrub(undefined, b.bot)
    })
    zip.file(`${folder}/${r.replay}`, JSON.stringify(replay))
  }
  return folder
}
