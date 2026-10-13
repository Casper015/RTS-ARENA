// 同队共用金子时谁挣、谁花（D-249，用户：联赛视频的选手页上看谁最能坑队友）。
// 吃队友的钱 = 花掉的 − 自己挣的 − 开局分到的那份：正数是花了队友挣的钱，负数是倒贴给队友（或者挣了没花，留在队里）
import type { RuleContext, SpotlightItem } from "../../src/core/types.ts"

/** 规则包的 spotlight：选手页列出这三项和排名（称号由写视频脚本的大模型看着数字自己起，比如吃得最多的叫「最坑队友」） */
export const TEAMMATE_SPOTLIGHT: SpotlightItem[] = [
  { stat: "吃队友的钱", unit: "金", note: "花掉的 − 挣来的 − 开局分到的那份" },
  { stat: "花掉的钱", unit: "金" },
  { stat: "挣来的钱", unit: "金" },
]

/** 对局结果的 stats 用：有队友的局才报（两人局、各自为战不报）；start 是开局每人分到的 */
export function teammateStats(ctx: RuleContext, resource: string, start: number): Record<string, number[]> {
  if (!ctx.teams.some((t, p) => ctx.teams.indexOf(t) !== p)) return {}
  const spent = ctx.players.map((p) => p.spent[resource] ?? 0)
  const gathered = ctx.players.map((p) => p.gathered[resource] ?? 0)
  return {
    吃队友的钱: spent.map((s, p) => s - gathered[p] - start),
    花掉的钱: spent,
    挣来的钱: gathered,
  }
}
