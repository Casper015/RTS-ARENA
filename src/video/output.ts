// MP4 按 muxer 给出的字节偏移写入临时文件；验证成功后才替换成品。
import { randomUUID } from "node:crypto"
import { closeSync, createReadStream, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname, join, resolve } from "node:path"

export class VideoOutput {
  readonly path: string
  private readonly destination: string
  private fd: number | null
  private committed = false

  constructor(destination: string) {
    this.destination = resolve(destination)
    mkdirSync(dirname(this.destination), { recursive: true })
    this.path = join(dirname(this.destination), `.${basename(destination)}.${randomUUID()}.tmp`)
    this.fd = openSync(this.path, "wx")
  }

  write(position: number, data: Uint8Array): void {
    if (this.fd === null) throw new Error("视频输出文件已经关闭")
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + data.length)) throw new Error("视频输出字节偏移无效")
    for (let offset = 0; offset < data.length;) {
      const n = writeSync(this.fd, data, offset, data.length - offset, position + offset)
      if (!n) throw new Error("视频写入失败：磁盘没有接受数据")
      offset += n
    }
  }

  finish(): number {
    if (this.fd !== null) {
      closeSync(this.fd)
      this.fd = null
    }
    return statSync(this.path).size
  }

  commit(): void {
    this.finish()
    renameSync(this.path, this.destination)
    this.committed = true
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd)
      this.fd = null
    }
    if (!this.committed) {
      try { unlinkSync(this.path) } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e }
    }
  }
}

/** 浏览器按 Range 读取成品，不把整部 MP4 读进 Node 或浏览器的内存。 */
export function serveVideoFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const size = statSync(file).size
  res.setHeader("Content-Type", "video/mp4")
  res.setHeader("Accept-Ranges", "bytes")
  res.setHeader("Cache-Control", "no-store")
  let start = 0, end = size - 1
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]))
      else {
        start = Number(match[1])
        if (match[2]) end = Math.min(end, Number(match[2]))
      }
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end()
      return
    }
    res.statusCode = 206
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`)
  }
  res.setHeader("Content-Length", Math.max(0, end - start + 1))
  if (req.method === "HEAD" || !size) { res.end(); return }
  const stream = createReadStream(file, { start, end })
  stream.on("error", () => res.destroy())
  res.on("close", () => stream.destroy())
  stream.pipe(res)
}
