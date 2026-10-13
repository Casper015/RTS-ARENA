// 网页对战页的下载（D-254）：zip 写法、bot 模板、联赛包（本机路径都换掉）
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { inflateRawSync } from "node:zlib"
import { createArenaApi } from "../src/cli/arena-api.ts"
import { leaguePackageProblem, packLeague } from "../src/cli/league-package.ts"
import { ZipWriter } from "../src/cli/zip.ts"

const ROOT = join(import.meta.dirname, "..")
const TMP = mkdtempSync(join(tmpdir(), "rts-arena-package-"))
after(() => rmSync(TMP, { recursive: true, force: true }))

/** 按目录区读出 zip 里的每一项（名字 → 内容；目录是 null） */
function readZip(buf: Buffer): Map<string, Buffer | null> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, "没有 zip 结尾")
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const out = new Map<string, Buffer | null>()
  for (let k = 0; k < count; k++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50)
    assert.ok(buf.readUInt16LE(p + 8) & 0x0800, "文件名按 UTF-8 记")
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8")
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const body = buf.subarray(start, start + csize)
    out.set(name, name.endsWith("/") ? null : method === 8 ? inflateRawSync(body) : Buffer.from(body))
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return out
}

const zipOf = (fill: (z: ZipWriter) => void): Buffer => {
  const chunks: Buffer[] = []
  const z = new ZipWriter((c) => chunks.push(c))
  fill(z)
  z.end()
  return Buffer.concat(chunks)
}

test("zip（D-254）：中文文件名、空目录、压缩和原样存的都能读回来", () => {
  const big = "一行很长的日志\n".repeat(2000)
  const files = readZip(zipOf((z) => {
    z.file("包/甲.ts", big)
    z.file("包/小.txt", "x")
    z.dir("包/versions")
  }))
  assert.equal(files.get("包/甲.ts")!.toString("utf8"), big)
  assert.equal(files.get("包/小.txt")!.toString("utf8"), "x")
  assert.equal(files.get("包/versions/"), null)
})

test("联赛包（D-254）：汇总、回放、参赛 bot 代码和参赛报告都在；本机路径换成 bots/<名字>.ts 和平台目录下的参考 bot", () => {
  const dir = join(TMP, "lg")
  const botDir = join(TMP, "我的bot")
  mkdirSync(dir, { recursive: true })
  mkdirSync(botDir, { recursive: true })
  const mine = join(botDir, "甲.ts")
  writeFileSync(mine, "export function onTick() {}\n")
  writeFileSync(join(botDir, "甲.REPORT.md"), "# 甲的参赛报告\n")
  const ref = join(TMP, "某处", "rulesets", "koth", "bots", "baseline.ts")
  const series = {
    format: "rts-arena-series",
    kind: "league",
    replays: true,
    ruleset: { id: "koth", name: "夺点", dir: join(TMP, "某处", "rulesets", "koth") },
    participants: [{ name: "甲", file: mine }, { name: "baseline", file: ref }],
    results: [{ index: 1, replay: "x-g1.json" }],
    summary: { standings: [] },
  }
  writeFileSync(join(dir, "x.series.json"), JSON.stringify(series))
  writeFileSync(join(dir, "x-g1.json"), JSON.stringify({ players: [{ name: "甲", bot: mine, team: 0 }, { name: "baseline", bot: ref, team: 1 }], bots: [{ bot: mine }, { bot: ref }] }))
  let folder = ""
  const files = readZip(zipOf((z) => (folder = packLeague(join(dir, "x.series.json"), TMP, z))))
  assert.equal(folder, "x")
  assert.deepEqual([...files.keys()].sort(), ["x/bots/甲.REPORT.md", "x/bots/甲.ts", "x/x-g1.json", "x/x.series.json"])
  assert.match(files.get("x/bots/甲.REPORT.md")!.toString("utf8"), /甲的参赛报告/)
  const s = JSON.parse(files.get("x/x.series.json")!.toString("utf8"))
  assert.deepEqual(s.participants, [{ name: "甲", file: "bots/甲.ts" }, { name: "baseline", file: "rulesets/koth/bots/baseline.ts" }])
  assert.equal(s.ruleset.dir, undefined)
  const r = JSON.parse(files.get("x/x-g1.json")!.toString("utf8"))
  assert.deepEqual(r.players.map((p: { bot: string }) => p.bot), ["bots/甲.ts", "rulesets/koth/bots/baseline.ts"])
  assert.deepEqual(r.bots.map((b: { bot: string }) => b.bot), ["bots/甲.ts", "rulesets/koth/bots/baseline.ts"])
  // 哪一项里都没有本机路径
  for (const [name, data] of files) assert.ok(!data || !data.toString("utf8").includes(TMP.split("\\").join("\\\\")) && !data.toString("utf8").includes(TMP), name)
  // 不能导出的：不是联赛、没存回放、没打完
  assert.match(leaguePackageProblem({ ...series, kind: undefined }) ?? "", /只有联赛/)
  assert.match(leaguePackageProblem({ ...series, replays: false }) ?? "", /没存回放/)
  assert.match(leaguePackageProblem({ ...series, summary: null }) ?? "", /还没打完/)
})

test("对战接口（D-254）：生成 bot 模板是 rts-arena init 同款的 bot 目录；联赛包找不到记录时说清楚", async () => {
  const api = createArenaApi({ replaysDir: join(TMP, "replays"), cliPath: join(ROOT, "src", "cli", "arena.ts"), cwd: ROOT })
  const server = createServer(async (req, res) => {
    if (!(await api(req, res))) {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const res = await fetch(`${base}/api/arena/template?ruleset=koth`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get("content-disposition") ?? "", /filename\*=UTF-8''%E5%A4%BA%E7%82%B9-bot/)
    const files = readZip(Buffer.from(await res.arrayBuffer()))
    assert.deepEqual([...files.keys()].sort(), ["koth-bot/.gitignore", "koth-bot/PROMPT.md", "koth-bot/arena.d.ts", "koth-bot/arena.json", "koth-bot/bot.ts", "koth-bot/tsconfig.json", "koth-bot/versions/"])
    assert.deepEqual(JSON.parse(files.get("koth-bot/arena.json")!.toString("utf8")), { ruleset: "koth", bot: "bot.ts" })
    assert.match(files.get("koth-bot/bot.ts")!.toString("utf8"), /export function onTick/)
    assert.equal((await fetch(`${base}/api/arena/template?ruleset=nope`)).status, 404)
    const miss = await fetch(`${base}/api/arena/package?series=nope.series.json`)
    assert.equal(miss.status, 404)
    assert.match(((await miss.json()) as { error: string }).error, /没有这场比赛/)
  } finally {
    server.close()
  }
})
