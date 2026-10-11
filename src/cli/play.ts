// 打一局要用的：bot 的显示名、编译 bot 开沙箱（arena 命令和并行打局的 worker 共用，D-209）
import { readFileSync } from "node:fs"
import { basename, dirname, relative, resolve, sep } from "node:path"
import type { MatchBot } from "../core/match.ts"
import { mixSeed } from "../core/rng.ts"
import type { Ruleset } from "../core/types.ts"
import { compileBot, createBot } from "../sandbox/quickjs.ts"
import { PKG_ROOT } from "../paths.ts"

/** 显示名：文件名去掉 .ts；init 建出来的都叫 bot.ts，改用所在目录名 */
export function botName(file: string): string {
  const name = basename(file).replace(/\.ts$/, "")
  return name === "bot" ? basename(dirname(resolve(file))) : name
}

/** 回放和日志里显示的 bot 文件：平台自带的写成"平台自带 bots/xxx.ts"，不写一长串相对路径 */
export function displayFile(file: string): string {
  const abs = resolve(file)
  return abs.startsWith(PKG_ROOT + sep) ? `平台自带 ${relative(PKG_ROOT, abs).split(sep).join("/")}` : file
}

/** 按座位顺序编译 bot、开沙箱；编译不过的座位 runner 是 null（这一局它不动） */
export async function makeBots(rules: Ruleset, files: string[], seed: number, names: Map<string, string>): Promise<MatchBot[]> {
  const bots: MatchBot[] = []
  for (const [p, file] of files.entries()) {
    const name = names.get(file) ?? botName(file)
    const compiled = compileBot(readFileSync(file, "utf8"))
    if ("error" in compiled) bots.push({ name, file: displayFile(file), runner: null, loadError: compiled.error })
    else bots.push({ name, file: displayFile(file), runner: await createBot(compiled.code, mixSeed(seed, "bot", p), { fuel: rules.fuel }) })
  }
  return bots
}
