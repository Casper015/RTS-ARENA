// 并行打局的 worker（D-209，用户：compare 并行）：自己加载一份规则包，主线程发一局（座位顺序、种子），打完把回放发回去
import { parentPort, workerData } from "node:worker_threads"
import { runMatch } from "../core/match.ts"
import { loadRulesetRef, type RulesetRef } from "./catalog.ts"
import { makeBots } from "./play.ts"
import type { GameJob } from "./game-pool.ts"

const port = parentPort!
const { src, names } = workerData as { src: RulesetRef; names: [string, string][] }
const nameMap = new Map(names)

try {
  const rules = await loadRulesetRef(src)
  port.on("message", async (job: GameJob) => {
    try {
      const bots = await makeBots(rules, job.order, job.seed, nameMap)
      const replay = runMatch({ ruleset: rules, bots, seed: job.seed, teams: job.teams })
      port.postMessage({ id: job.id, replay })
    } catch (e) {
      port.postMessage({ id: job.id, error: (e as Error).message })
    }
  })
  port.postMessage({ ready: true })
} catch (e) {
  port.postMessage({ fatal: (e as Error).message })
}
