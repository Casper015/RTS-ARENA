// 写 zip 文件（D-254：网页对战页导出 bot 模板、联赛包）：一项一项压（deflate）、边压边交给 out，最后写目录区。
// 文件名按 UTF-8 记（中文名的 bot 解压出来不乱码）；不支持超过 4G 的文件（zip64）
import { crc32, deflateRawSync } from "node:zlib"

interface Entry {
  name: Buffer
  crc: number
  csize: number
  size: number
  offset: number
  method: number
  dir: boolean
}

/** 名字按 UTF-8 编码（通用标志位第 11 位） */
const UTF8 = 0x0800

export class ZipWriter {
  private readonly entries: Entry[] = []
  private offset = 0
  private readonly time: number
  private readonly date: number
  private readonly out: (chunk: Buffer) => void

  constructor(out: (chunk: Buffer) => void) {
    this.out = out
    const d = new Date()
    this.time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
    this.date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }

  /** 加一个文件；name 用正斜杠分目录 */
  file(name: string, data: Buffer | string): void {
    const raw = typeof data === "string" ? Buffer.from(data, "utf8") : data
    const packed = deflateRawSync(raw)
    // 压不小的（很短的文件）原样存
    const store = packed.length >= raw.length
    this.add(name, raw, store ? raw : packed, store ? 0 : 8, false)
  }

  /** 加一个空目录（名字后面自动加 /） */
  dir(name: string): void {
    this.add(name.endsWith("/") ? name : `${name}/`, Buffer.alloc(0), Buffer.alloc(0), 0, true)
  }

  private add(name: string, raw: Buffer, body: Buffer, method: number, dir: boolean): void {
    const nameBuf = Buffer.from(name, "utf8")
    const crc = dir ? 0 : crc32(raw)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt16LE(20, 4)
    h.writeUInt16LE(UTF8, 6)
    h.writeUInt16LE(method, 8)
    h.writeUInt16LE(this.time, 10)
    h.writeUInt16LE(this.date, 12)
    h.writeUInt32LE(crc, 14)
    h.writeUInt32LE(body.length, 18)
    h.writeUInt32LE(raw.length, 22)
    h.writeUInt16LE(nameBuf.length, 26)
    h.writeUInt16LE(0, 28)
    this.entries.push({ name: nameBuf, crc, csize: body.length, size: raw.length, offset: this.offset, method, dir })
    this.out(h)
    this.out(nameBuf)
    if (body.length) this.out(body)
    this.offset += h.length + nameBuf.length + body.length
  }

  /** 写目录区和结尾，之后不能再加 */
  end(): void {
    const start = this.offset
    let size = 0
    for (const e of this.entries) {
      const c = Buffer.alloc(46)
      c.writeUInt32LE(0x02014b50, 0)
      c.writeUInt16LE(20, 4)
      c.writeUInt16LE(20, 6)
      c.writeUInt16LE(UTF8, 8)
      c.writeUInt16LE(e.method, 10)
      c.writeUInt16LE(this.time, 12)
      c.writeUInt16LE(this.date, 14)
      c.writeUInt32LE(e.crc, 16)
      c.writeUInt32LE(e.csize, 20)
      c.writeUInt32LE(e.size, 24)
      c.writeUInt16LE(e.name.length, 28)
      // 30～37：附加字段长度、注释长度、磁盘号、内部属性都是 0
      c.writeUInt32LE(e.dir ? 0x10 : 0, 38)
      c.writeUInt32LE(e.offset, 42)
      this.out(c)
      this.out(e.name)
      size += c.length + e.name.length
    }
    const z = Buffer.alloc(22)
    z.writeUInt32LE(0x06054b50, 0)
    z.writeUInt16LE(this.entries.length, 8)
    z.writeUInt16LE(this.entries.length, 10)
    z.writeUInt32LE(size, 12)
    z.writeUInt32LE(start, 16)
    this.out(z)
  }
}
