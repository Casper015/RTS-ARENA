// 并行打局（D-209，用户：compare 并行；D-210 run、league 也用）：开几个 worker 线程，每个自己加载一份规则包，一局一局分出去打；
// 每局只看种子和座位，谁先打完都一样，结果和一个线程按顺序打完全相同。只开 1 个时就在当前线程里打
import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
import { runMatch } from "../core/match.ts"
import type { Replay, Ruleset } from "../core/types.ts"
import type { RulesetRef } from "./catalog.ts"
import { makeBots } from "./play.ts"

/** 一局：id 是第几局（报错和日志用），order 是按座位排的 bot 文件 */
export interface GameJob {
  id: number
  order: string[]
  seed: number
  teams?: number[]
}

/** 默认开几个线程：CPU 逻辑核数减 2（至少 1、最多 6），留一些给别的程序。8 核的机器上 compare 24 局：1 个线程 91 秒、4 个 36 秒、6 个 28 秒、8 个 26 秒 */
export function defaultJobs(): number {
  return Math.max(1, Math.min(6, availableParallelism() - 2))
}

/**
 * 打一批局，每打完一局调用一次 onDone（完成的先后不定，按 job 对回去）。有一局打不完（规则包抛错之类）就停下、抛错。
 * names 是 bot 文件 → 显示名
 */
export async function runGames(
  rules: Ruleset,
  src: RulesetRef,
  names: Map<string, string>,
  jobs: GameJob[],
  threads: number,
  onDone: (job: GameJob, replay: Replay, ms: number) => void,
): Promise<void> {
  const failOf = (job: GameJob, msg: string) => new Error(`第 ${job.id} 局（种子 ${job.seed}）没打完：${msg}`)
  if (threads <= 1 || jobs.length <= 1) {
    for (const job of jobs) {
      let replay: Replay
      const bots = await makeBots(rules, job.order, job.seed, names)
      const t0 = performance.now()
      try {
        replay = runMatch({ ruleset: rules, bots, seed: job.seed, teams: job.teams })
      } catch (e) {
        throw failOf(job, (e as Error).message)
      }
      onDone(job, replay, performance.now() - t0)
    }
    return
  }
  // 编译好的包里是 .js，在仓库里直接跑的是 .ts
  const url = new URL(`./game-worker${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`, import.meta.url)
  const n = Math.min(threads, jobs.length)
  let next = 0
  let failed: Error | null = null
  await new Promise<void>((resolveAll, rejectAll) => {
    let running = n
    for (let i = 0; i < n; i++) {
      const w = new Worker(url, { workerData: { src, names: [...names] } })
      let current: GameJob | null = null
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        void w.terminate()
        if (--running === 0) {
          if (failed) rejectAll(failed)
          else resolveAll()
        }
      }
      const give = () => {
        if (failed || next >= jobs.length) return close()
        current = jobs[next++]
        w.postMessage(current)
      }
      w.on("message", (m: { ready?: true; fatal?: string; error?: string; replay?: Replay; ms?: number }) => {
        if (m.fatal !== undefined) failed ??= new Error(`加载规则包失败：${m.fatal}`)
        else if (m.error !== undefined) failed ??= failOf(current!, m.error)
        else if (m.replay) {
          try {
            onDone(current!, m.replay, m.ms ?? 0)
          } catch (e) {
            failed ??= e as Error
          }
        }
        if (m.fatal !== undefined || m.error !== undefined) return close()
        give()
      })
      w.on("error", (e: Error) => {
        failed ??= current ? failOf(current, e.message) : e
        close()
      })
      w.on("exit", () => {
        if (!closed && !failed) failed = new Error("打局的线程意外退出")
        close()
      })
    }
  })
}

/**
 * 和 runGames 一样，但按 jobs 的顺序调用 onDone（后面的先打完就先存着，等前面的）：run、league 的输出、汇总、排名
 * 和一个线程按顺序打的完全一样（D-210）
 */
export async function runInOrder<J extends GameJob>(
  rules: Ruleset,
  src: RulesetRef,
  names: Map<string, string>,
  jobs: J[],
  threads: number,
  onDone: (job: J, replay: Replay, ms: number) => void,
): Promise<void> {
  const pos = new Map<GameJob, number>(jobs.map((j, i) => [j, i]))
  const done = new Map<number, { replay: Replay; ms: number }>()
  let next = 0
  await runGames(rules, src, names, jobs, threads, (job, replay, ms) => {
    done.set(pos.get(job)!, { replay, ms })
    for (let r = done.get(next); r; r = done.get(next)) {
      done.delete(next)
      onDone(jobs[next++], r.replay, r.ms)
    }
  })
}
