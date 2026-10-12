// 规则包自带的素材（D-233）：look.art 里写的 SVG 路径（相对规则包目录）由宿主读出来、把内容写回 look.art，
// 这样回放里就带着素材，网页回放和联赛视频不用再去找规则包目录。规则包在沙箱里读不了文件，所以由加载规则包的宿主来读
import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import type { TypeSpec } from "../core/types.ts"

/** 一张 SVG 最多多少字节（回放里每种东西带一份） */
export const ART_MAX_BYTES = 64 * 1024

const LAYERS = ["under", "over", "sprite"] as const

/** 已经是 SVG 内容（读过一次，或者回放里的）就不再当路径读 */
const inlined = (v: string) => /^\s*</.test(v)

/**
 * 把 types 里每个 look.art 的 under、over、sprite 从路径换成文件内容（原地改）。
 * 路径只能指向规则包目录里的 .svg、不超过 ART_MAX_BYTES、要有 <svg> 和 viewBox；不符合就抛错，说清是哪个类型的哪一项
 */
export function inlineRulesetArt(types: Record<string, TypeSpec>, dir: string): void {
  const root = resolve(dir)
  for (const [name, spec] of Object.entries(types)) {
    const art = spec.look?.art
    if (!art) continue
    for (const k of LAYERS) {
      const ref = art[k]
      if (typeof ref !== "string" || inlined(ref)) continue
      const at = `types.${name}.look.art.${k}`
      const file = resolve(root, ref)
      const rel = relative(root, file)
      if (isAbsolute(ref) || rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${at}：素材要放在规则包目录里，写相对规则包目录的路径（现在是 ${ref}）`)
      if (!/\.svg$/i.test(file)) throw new Error(`${at}：素材要是 .svg 文件（现在是 ${ref}）`)
      if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${at}：规则包目录里找不到 ${ref}`)
      const size = statSync(file).size
      if (size > ART_MAX_BYTES) throw new Error(`${at}：${ref} 有 ${size} 字节，最多 ${ART_MAX_BYTES}`)
      const text = readFileSync(file, "utf8")
      if (!/<svg[\s>]/.test(text)) throw new Error(`${at}：${ref} 不是 SVG（找不到 <svg> 标签）`)
      if (!/viewBox\s*=/.test(text)) throw new Error(`${at}：${ref} 要写 viewBox（单位以中心为原点、一格是 1；建筑以中心为原点、整个占地是 1）`)
      art[k] = text
    }
  }
}
