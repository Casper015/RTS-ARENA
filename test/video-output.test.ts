import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { Muxer, StreamTarget } from "mp4-muxer"
import { VideoOutput, serveVideoFile } from "../src/video/output.ts"

const TMP = mkdtempSync(join(tmpdir(), "rts-arena-output-"))
after(() => rmSync(TMP, { recursive: true, force: true }))

test("流式输出按偏移回填文件头；成功才替换旧成品，失败清理临时文件", () => {
  const file = join(TMP, "video.mp4")
  writeFileSync(file, "old video")
  const output = new VideoOutput(file)
  try {
    output.write(128, Buffer.from("tail"))
    output.write(0, Buffer.from("head"))
    assert.equal(output.finish(), 132)
    assert.equal(readFileSync(file, "utf8"), "old video")
    output.commit()
  } finally { output.close() }
  const bytes = readFileSync(file)
  assert.equal(bytes.subarray(0, 4).toString(), "head")
  assert.equal(bytes.subarray(128).toString(), "tail")
  const failed = new VideoOutput(file)
  failed.write(0, Buffer.from("bad output"))
  failed.close()
  assert.deepEqual(readFileSync(file), bytes)
  assert.deepEqual(readdirSync(TMP), ["video.mp4"])
})

test("成品检查 HTTP 支持定段、开尾、后缀、HEAD 与越界 Range", async () => {
  const file = join(TMP, "range.mp4")
  writeFileSync(file, "0123456789abcdef")
  const server = createServer((req, res) => serveVideoFile(req, res, file))
  await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  try {
    for (const [range, want] of [["bytes=3-8", "345678"], ["bytes=12-", "cdef"], ["bytes=-4", "cdef"]]) {
      const res = await fetch(url, { headers: { Range: range } })
      assert.equal(res.status, 206)
      assert.equal(await res.text(), want)
    }
    const head = await fetch(url, { method: "HEAD" })
    assert.equal(head.headers.get("content-length"), "16")
    for (const range of ["bytes=16-", "bytes=8-3", "bytes=-0", "bytes=0-1,3-4", "invalid"]) {
      const res = await fetch(url, { headers: { Range: range } })
      assert.equal(res.status, 416)
      assert.equal(res.headers.get("content-range"), "bytes */16")
      await res.body?.cancel()
    }
  } finally { await new Promise<void>((ok, bad) => server.close(e => e ? bad(e) : ok())) }
})

test("磁盘输出与 HTTP Range 保留超过 4 GiB 的完整偏移", async (t) => {
  const output = new VideoOutput(join(TMP, "large.mp4"))
  try {
    // Windows 先显式标记稀疏文件，避免测试占用数 GB 磁盘；其他平台默认支持文件空洞。
    if (process.platform === "win32" && spawnSync("fsutil", ["sparse", "setflag", output.path], { windowsHide: true }).status !== 0) {
      t.skip("本机不允许创建稀疏文件")
      return
    }
    const position = 5_700_000_000
    output.write(position, Buffer.from("tail"))
    assert.equal(output.finish(), position + 4)
    const server = createServer((req, res) => serveVideoFile(req, res, output.path))
    await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok))
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
      const res = await fetch(url, { headers: { Range: `bytes=${position}-` } })
      assert.equal(res.status, 206)
      assert.equal(res.headers.get("content-range"), `bytes ${position}-${position + 3}/${position + 4}`)
      assert.equal(await res.text(), "tail")
    } finally { await new Promise<void>((ok, bad) => server.close(e => e ? bad(e) : ok())) }
  } finally { output.close() }
})

test("实际流式封装 6 GiB 媒体数据：块保持有界，mdat 与采样偏移使用 64 位", () => {
  // 重用小块测试真实 muxer 的 4 GiB 边界；接收端仅保存文件头，不占用 6 GiB RAM 或磁盘。
  const head = Buffer.alloc(64 * 1024)
  let bytes = 0, largest = 0
  const frames = 768, data = new Uint8Array(8 * 1024 * 1024)
  const muxer = new Muxer({
    target: new StreamTarget({ chunked: true, chunkSize: 3_000_000, onData: (part, position) => {
      bytes = Math.max(bytes, position + part.length)
      largest = Math.max(largest, part.length)
      if (position < head.length) head.set(part.subarray(0, head.length - position), position)
    } }),
    video: { codec: "avc", width: 3840, height: 2160, frameRate: 60 },
    fastStart: { expectedVideoChunks: frames },
  })
  for (let i = 0; i < frames; i++) muxer.addVideoChunkRaw(data, "key", i * 1_000_000, 1_000_000, i ? undefined : {
    decoderConfig: { codec: "avc1.640034", codedWidth: 3840, codedHeight: 2160, description: new Uint8Array([1, 100, 0, 52]) },
  })
  muxer.finalize()
  assert.ok(bytes > 6 * 1024 ** 3)
  assert.ok(largest <= 3_000_000)
  const co64 = head.indexOf("co64")
  assert.ok(co64 > 0)
  const count = head.readUInt32BE(co64 + 8)
  assert.ok(head.readBigUInt64BE(co64 + 12 + (count - 1) * 8) > 2n ** 32n)
  const mdat = head.indexOf("mdat")
  assert.ok(mdat > 0)
  assert.equal(head.readUInt32BE(mdat - 4), 1)
  assert.equal(head.readBigUInt64BE(mdat + 4), BigInt(data.length * frames + 16))
})
