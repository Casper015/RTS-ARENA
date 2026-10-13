// 建 bot 目录（rts-arena init，D-254 起网页对战页的「生成 bot 模板」也用它）：arena.json、bot.ts 模板、PROMPT.md、arena.d.ts、tsconfig.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import type { Ruleset } from "../core/types.ts"
import { looksLikePath, WORKSPACE_FILE, type RulesetRef, type Workspace } from "./catalog.ts"
import { botTsconfig, buildDts, buildPrompt } from "./docgen.ts"

export const BOT_TEMPLATE = `// 一个最简单的 bot：闲着的采集单位去采最近的资源点。从这里改起（还不会生产，也不会打仗）。
// 每改一版都要在这个目录里运行 rts-arena check、rts-arena league 真的打几局，看结果再改（见 PROMPT.md 开头）。

export function onTick(view: View, cmd: Commands): void {
  const mine = view.entities.filter((e) => e.owner === view.me)
  const resources = view.entities.filter((e) => game.types[e.type].kind === "resource")
  for (const u of mine) {
    if (u.order?.kind !== "idle" || !game.types[u.type].gather || resources.length === 0) continue
    const target = resources.reduce((a, b) => (dist(u, a) <= dist(u, b) ? a : b))
    cmd.gather(u, target)
  }
}
`

/** 说明书和接口：rulesDir 是规则包目录，out 是写到哪 */
export function writeDocs(rules: Ruleset, rulesDir: string, out: string): void {
  mkdirSync(out, { recursive: true })
  const dts = buildDts(rules, rulesDir)
  writeFileSync(join(out, "arena.d.ts"), dts)
  writeFileSync(join(out, "PROMPT.md"), buildPrompt(rules, rulesDir, dts))
}

/**
 * 在 dir 建 bot 目录，或者更新已有 bot 目录的说明书和接口（bot 文件已经有了就不动）。返回 bot 文件名和是不是新建的。
 * 自己写的规则包在 arena.json 里记相对 bot 目录的路径
 */
export function initBotDir(rules: Ruleset, src: RulesetRef, dir: string): { bot: string; created: boolean } {
  mkdirSync(dir, { recursive: true })
  const wsFile = join(dir, WORKSPACE_FILE)
  const old = existsSync(wsFile) ? (JSON.parse(readFileSync(wsFile, "utf8")) as Partial<Workspace>) : {}
  const bot = old.bot ?? "bot.ts"
  // 自己写的规则包记相对 bot 目录的路径（正斜杠，换台机器、换系统也能用）
  const rulesetField = src.builtin ? rules.id : relative(resolve(dir), src.dir).split(sep).join("/") || "."
  writeFileSync(wsFile, JSON.stringify({ ruleset: looksLikePath(rulesetField) || src.builtin ? rulesetField : `./${rulesetField}`, bot }, null, 2) + "\n")
  writeDocs(rules, src.dir, dir)
  writeFileSync(join(dir, "tsconfig.json"), botTsconfig(["arena.d.ts", bot]))
  const created = !existsSync(join(dir, bot))
  if (created) writeFileSync(join(dir, bot), BOT_TEMPLATE)
  if (!existsSync(join(dir, ".gitignore"))) writeFileSync(join(dir, ".gitignore"), "replays/\n")
  // 每一版存一份的地方（说明书「版本、能看什么、交付」一节）
  mkdirSync(join(dir, "versions"), { recursive: true })
  return { bot, created }
}
