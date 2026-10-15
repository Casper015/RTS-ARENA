// 视频页面里跑的代码：画每一帧、用 WebCodecs 编成 H.264、交给 mp4-muxer 封装成 MP4。
// installVideoPage 会被 toString() 后注入无头浏览器；画面工厂作为参数传入，不引用模块闭包。
// Node 那边每帧算好要画的东西（场景的固定内容用 __scene 送一次，回放的局面每帧用 __frames 送）
import type { BattleAttack, BattlePose, BattleType, createBattleArt } from "./battle-art.ts"
import type { BattleCamera } from "./battle-camera.ts"

/** 一个场景的固定内容；first：视频的第一段，第一帧就是完整画面、不从黑屏淡入。 */
export type SceneData = (
  | {
      kind: "player"
      frames: number
      /** 页内动画快几倍（时长已经按它缩短） */
      speed?: number
      color: string
      displayName: string
      name: string
      byline: string | null
      tagline: string
      intro: string[]
      codeHeader: string[]
      facts: string[]
      /** 战绩，一两行 */
      record: string[]
      rank: number
      total: number
      /** 形象图的名字（__image 送进来的），背后放半透明的半身像；没有就 null（D-177） */
      portrait: string | null
      /** 能力雷达图（analysis.ts 算的），没有就画代码开头 */
      radar: { label: string; text: string; score: number }[] | null
      /** 规则包看点（D-249，brief.ts spotlightFor）：一张小卡片列出几项数字和排名；规则包没写就是 null */
      spotlight?: { label: string; value: string; rank: number; of: number; note: string | null }[] | null
      /** 称号（D-249，脚本里写的），挂在名次旁边 */
      award?: string | null
    }
  | {
      kind: "rules"
      frames: number
      /** 页内动画快几倍（时长已经按它缩短） */
      speed?: number
      ruleset: string
      /** 脚本写的规则介绍（不写就是规则包的一句话简介） */
      lines: string[]
      /** 规则包自带的陪练（D-252，参考 bot）：名字、一句话介绍 */
      sparring: { name: string; text: string }[]
      seatColors: string[]
      legend: { shape: string; label: string; color: string | null; kind: string; name: string; detail: string; art?: BattleType }[]
      /** 左下角的小字：1 秒 = 多少 tick */
      tickNote: string
    }
  | {
      kind: "replay"
      frames: number
      no: number
      /** 标题上面那行小字，不写就是「精彩对局 <no>」；竖屏写成「<选手>的高光对局」（D-183） */
      kicker?: string
      title: string
      commentary: string | null
      width: number
      height: number
      terrain: string[]
      colors: Record<string, string>
      /** base：主基地（选手有形象图时画成头像） */
      types: (BattleType & { name: string; kind: string; shape: string; label: string; color: string | null; worker: boolean; base: boolean })[]
      /** 每个座位的名字和颜色；avatar 是形象图的名字（没有就 null） */
      /** team：队伍编号（D-248，分队时阵营卡片按队分组）；不分队时每人一队 */
      seats: { name: string; color: string; avatar?: string | null; team?: number }[]
      result: string
      /** 结束原因（D-256）：规则包给的原因，座位换成名字、比分标上是谁的；结尾写在获胜方下面 */
      reason?: string
      /** 实时胜率：curve 是每 step tick 一个点的、sides[0] 那方赢的概率；不是两方对打或没有模型时 null（D-177） */
      win: { step: number; ticks: number; curve: number[]; sides: { name: string; color: string }[] } | null
    }
  /** 开场阵容（D-179，D-221 删掉、D-230 加回来）：全体参赛选手的立绘和一句大字，第一帧就是完整画面（也当封面） */
  | { kind: "lineup"; frames: number; title: string; sub: string; players: { name: string; color: string; portrait: string | null }[] }
  /** 联赛排名（D-237）：联赛命令行那样的排行榜，每行后面接这个 bot 对每个对手的胜负（行、列都按名次排） */
  | {
      kind: "standings"
      frames: number
      speed?: number
      title: string
      sub: string
      /** ref：平台自带的参考 bot（陪练），画灰一点 */
      rows: { name: string; color: string; rank: number; record: string; rate: number; ref: boolean }[]
      /** 行对列：text 是「胜-负」（有平局时「胜-平-负」），rate 是分出胜负的局里赢的比例；自己对自己、没打过是 null */
      cells: ({ text: string; rate: number } | null)[][]
    }
  | { kind: "brandClose"; frames: number; speed?: number; outro: string | null; credits: string[] }
) & { first?: boolean }

/** 回放场景每帧变化的部分 */
export interface ReplayFrame {
  t: number
  /** [x, y, w, h, 座位(-1 中立), 类型下标, 生命百分比, 建造进度(100 是建好)] 一组 8 个 */
  ents: number[]
  /** [x1, y1, x2, y2, 座位] 一组 5 个 */
  shots: number[]
  /** Typed attacks retain their source, target, flight and impact across output frames. */
  combat?: BattleAttack[]
  /** Aligned with ents: [heading radians, walking stride, attack phase (-1 idle), hit flash]. */
  poses?: number[]
  workers?: { index: number; pose: BattlePose }[]
  production?: { x:number; y:number; w:number; h:number; count:number; active:{progress:number;blocked:boolean}[] }[]
  camera?: BattleCamera
  fallen?: { x: number; y: number; w: number; h: number; owner: number; age: number; duration: number; building: boolean }[]
  /** 刚死的：[x, y, 第几帧前死的] 一组 3 个 */
  deaths: number[]
  /** 每个座位：兵、工人、建筑、分数（歼灭是击杀价值、夺点是控制分……看规则包） */
  counts: { army: number; workers: number; buildings: number; score: number; alive: boolean }[]
  events: string[]
  progress: number
  /** 最后定格时显示结果 */
  final: boolean
  /** 这段怎么放：fight 交战 4 倍速（D-226 不再分大战、小冲突）、quiet 没动静快进 */
  pace: "fight" | "quiet"
  /** 这段按几倍速放（取整；进度条旁写「交战 4x」「快进 16x」，D-226） */
  speed: number
  /** 规则包画在地图上的标记（控制点、台址……），和回放页面一样 */
  markers: ({ kind: "zone"; x: number; y: number; w: number; h: number; owner: number | null; label?: string; color?: string } | { kind: "label"; x: number; y: number; text: string; owner?: number | null })[]
  /** 规则包的状态栏文字（比分、目标……） */
  status: string
  /** 光环（D-186）：[x, y, w, h, 半径, 座位] 一组 6 个，地图上画一圈淡淡的菱形 */
  auras?: number[]
  /** 身上有增益的单位：[x, y] 一组 2 个，外面描一圈金色 */
  buffed?: number[]
  /** 放技能（D-190）：[释放者 x, y, 目标 x, y（没有是 -1）, 放了几帧] 一组 5 个 */
  castFx?: number[]
  /** 回血：[x, y, 回了多少, 几帧前] 一组 4 个 */
  healFx?: number[]
  /** 规则包放的画面特效（D-205）：区域、几帧前、飘的字、颜色 */
  ruleFx?: { x: number; y: number; w: number; h: number; age: number; text?: string; color?: string; radius?: number }[]
  /** 一下挪了好几格的单位（击退这类，D-226）：[原来的 x, y, 现在画在的 x, y, 滑了多少（0～1）] 一组 5 个，画一道渐隐的轨迹 */
  knockFx?: number[]
  /** 技能冷却环：[x, y, w, h, 冷却好了的比例（1 是能放了）] 一组 5 个 */
  cds?: number[]
  /** 正在回血的：[x, y, w, h] 一组 4 个 */
  healing?: number[]
}

export function installVideoPage(artFactory: typeof createBattleArt): void {
  const art = artFactory()
  let brandImage: HTMLImageElement | null = null
  // 画面按 1280×720 排版，输出时整体放大（1920×1080 是 1.5 倍）；文字和图形都是矢量画的，放大不糊
  const W = 1280
  const H = 720
  let SCALE = 1.5
  const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif'
  const MONO = 'Consolas, "Cascadia Mono", "Microsoft YaHei", monospace'
  /** 平台的远程仓库：gitee 和 GitHub（片头下方、片尾署名里） */
  const REPO = "gitee.com/mingomin/rts-arena  ·  github.com/Clark760/RTS-ARENA"
  /** 称号的金色（D-249） */
  const GOLD = "#ffc94a"
  const C = { bg1: "#080f20", bg2: "#111f37", text: "#edf5ff", muted: "#8ba5c6", accent: "#53e3ff", line: "#294667", panel: "rgba(13,25,46,0.95)" }
  let canvas = new OffscreenCanvas(W * SCALE, H * SCALE)
  let g = canvas.getContext("2d")!
  /** 输出画布的画笔（横屏时就是 g） */
  let outG = g
  /** 竖屏（D-179）：逻辑尺寸 720×1280，每种场景都按竖屏单独排版（片尾 D-239 起也是） */
  const VW = 720
  const VH = 1280
  let VERT = false
  let VS = 1.5
  /**
   * 竖屏左右的安全边距（D-220）：抖音在长屏手机上把 9:16 的视频放大铺满，左右各裁掉一些，所以竖屏的字、头像和地图都放在中间 SW 宽里。
   * D-222 从每边 108 像素（20:9 手机铺满整个屏幕高度时的最坏情况，每边 10%）改成 54 像素（用户截图实测每边裁约 5%，用户选的）
   */
  const SX = 36
  const SW = VW - 2 * SX
  /** 地图上的字（规则包标记、特效飘字）：竖屏的格子小，字放大一些 */
  const fxPx = (px: number) => (VERT ? Math.round(px * 1.4) : px)
  type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = globalThis as unknown as Any
  let scene: Any | null = null
  let terrainLayer: OffscreenCanvas | null = null
  let encoder: VideoEncoder | null = null
  let muxer: Any | null = null
  let frameNo = 0
  let fps = 30
  let output: Uint8Array | null = null
  const images = new Map<string, { img: ImageBitmap; avatar: OffscreenCanvas; bust: { c: OffscreenCanvas; w: number; h: number } | null }>()

  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3))
  const font = (px: number, bold = false, mono = false) => `${bold ? "bold " : ""}${px}px ${mono ? MONO : FONT}`

  function background(): void {
    consoleBackdrop(W,H)
  }

  function consoleBackdrop(width:number,height:number):void {
    g.save()
    const grad = g.createLinearGradient(0, 0, width, height)
    grad.addColorStop(0, C.bg1)
    grad.addColorStop(1, C.bg2)
    g.fillStyle = grad
    g.fillRect(0, 0, width, height)
    const glow=g.createRadialGradient(width*.2,0,0,width*.2,0,width*.72)
    glow.addColorStop(0,"#205f9145");glow.addColorStop(1,"#10254e00")
    g.fillStyle=glow;g.fillRect(0,0,width,height)
    g.strokeStyle = "rgba(66,125,189,0.075)"
    g.lineWidth = 1
    for (let x = 0; x <= width; x += 48) {
      g.beginPath()
      g.moveTo(x + 0.5, 0)
      g.lineTo(x + 0.5, height)
      g.stroke()
    }
    for (let y = 0; y <= height; y += 48) {
      g.beginPath()
      g.moveTo(0, y + 0.5)
      g.lineTo(width, y + 0.5)
      g.stroke()
    }
    // Edge rails and cut corners stay outside the content; no decorative telemetry.
    g.strokeStyle="#2c527a";g.lineWidth=1
    g.beginPath();g.moveTo(18,75);g.lineTo(18,25);g.lineTo(34,9);g.lineTo(width*.34,9);g.stroke()
    g.beginPath();g.moveTo(width-18,height-75);g.lineTo(width-18,height-25);g.lineTo(width-34,height-9);g.lineTo(width*.67,height-9);g.stroke()
    g.strokeStyle=C.accent;g.globalAlpha=.55
    g.beginPath();g.moveTo(34,9);g.lineTo(100,9);g.moveTo(width-100,height-9);g.lineTo(width-34,height-9);g.stroke()
    g.restore()
  }

  /** 不能放在行首的标点：宁可让这一行稍微超出一点 */
  const NO_START = "，。、；：？！”’）》」』】…,.;:?!)"
  /** 按字折行（中文没有空格），返回每行；英文单词尽量不拆开 */
  function wrap(text: string, maxWidth: number): string[] {
    const out: string[] = []
    let line = ""
    for (const ch of text) {
      if (ch === "\n") {
        out.push(line)
        line = ""
        continue
      }
      if (g.measureText(line + ch).width > maxWidth && line && !NO_START.includes(ch)) {
        // 正在写一个英文单词：把它整个挪到下一行
        const m = /[A-Za-z0-9.]+$/.exec(line)
        if (m && /[A-Za-z0-9]/.test(ch) && m[0].length < line.length) {
          out.push(line.slice(0, -m[0].length))
          line = m[0] + ch
          continue
        }
        out.push(line)
        line = ch
      } else line += ch
    }
    if (line) out.push(line)
    return out
  }

  /**
   * 好看的折行：行数和 wrap 一样少，在这个前提下各行尽量一样长，并且尽量在标点后面断行（不把"谷歌之罪"拆到两行）；
   * 英文单词和数字不拆开。按当前字体量，结果缓存起来（每帧都会画）
   */
  const niceCache = new Map<string, string[]>()
  /** 句读：在它后面断行最自然 */
  const PUNCT = "，。、；：？！”’）》」』】…,.;:?!)"
  /** 除了最后一行，每行都停在标点上 */
  const endsAtPunct = (lines: string[]) => lines.slice(0, -1).every((l) => PUNCT.includes(l.at(-1) ?? ""))
  function wrapBalanced(text: string, maxWidth: number): string[] {
    const key = `${g.font}|${maxWidth}|${text}`
    const hit = niceCache.get(key)
    if (hit) return hit
    const ch = [...text]
    const N = ch.length
    const alnum = (c: string | undefined) => !!c && /[A-Za-z0-9.]/.test(c)
    // 第 i 个字前面能不能断
    const canBreak = (i: number) => i === N || (!NO_START.includes(ch[i]) && !(alnum(ch[i - 1]) && alnum(ch[i])))
    const width = (i: number, j: number) => g.measureText(ch.slice(i, j).join("").trim()).width
    const P = (0.35 * maxWidth) ** 2
    // best[j]：前 j 个字排好的最小代价（先比行数，再比各行剩下的空白平方和 + 不在标点后断行的罚分）
    const best: { lines: number; cost: number; from: number }[] = [{ lines: 0, cost: 0, from: -1 }]
    for (let j = 1; j <= N; j++) {
      best[j] = { lines: Infinity, cost: Infinity, from: -1 }
      if (!canBreak(j)) continue
      for (let i = j - 1; i >= 0; i--) {
        if (best[i].lines === Infinity || (i > 0 && !canBreak(i))) continue
        const w = width(i, j)
        if (w > maxWidth && j - i > 1) break
        const cost = best[i].cost + (maxWidth - w) ** 2 + (j < N && !PUNCT.includes(ch[j - 1]) ? P : 0)
        const lines = best[i].lines + 1
        if (lines < best[j].lines || (lines === best[j].lines && cost < best[j].cost)) best[j] = { lines, cost, from: i }
      }
    }
    let out: string[]
    if (best[N].lines === Infinity) out = wrap(text, maxWidth)
    else {
      out = []
      for (let j = N; j > 0; j = best[j].from) out.unshift(ch.slice(best[j].from, j).join("").trim())
    }
    niceCache.set(key, out)
    return out
  }

  function text(s: string, x: number, y: number, px: number, color: string, opts: { bold?: boolean; align?: CanvasTextAlign; mono?: boolean; alpha?: number } = {}): void {
    g.globalAlpha = opts.alpha ?? 1
    g.font = font(px, opts.bold, opts.mono)
    g.fillStyle = color
    g.textAlign = opts.align ?? "left"
    g.textBaseline = "alphabetic"
    g.fillText(s, x, y)
    g.globalAlpha = 1
  }

  function roundRect(x: number, y: number, ww: number, hh: number, r: number, fill: string, stroke?: string): void {
    g.beginPath()
    g.roundRect(x, y, ww, hh, r)
    g.fillStyle = fill
    g.fill()
    if (stroke) {
      g.strokeStyle = stroke
      g.lineWidth = 1.5
      g.stroke()
    }
  }

  /** 角落里的小署名（除片头片尾外每个画面都有） */
  function watermark(): void {
    g.save();g.globalAlpha=.5;drawBrand(W-126,H-34,102);g.restore()
  }

  /** 场景开头结尾的黑场过渡：12 帧，短场景按长度缩短（D-221 选手页只有 1 秒多）；视频第一段不淡入（第一帧就是完整画面，也当封面） */
  function fade(i: number, n: number): void {
    const k = Math.max(3, Math.min(12, Math.round(n / 8)))
    const noIn = scene?.first === true
    const a = i < k && !noIn ? 1 - i / k : i > n - k ? (i - (n - k)) / k : 0
    if (a > 0) {
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalAlpha = Math.min(1, a)
      g.fillStyle = "#000"
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.restore()
    }
  }

  // ---------- 各个场景 ----------
  /** 选手页背后的半身像：形象图上面 56%、去掉两边，四周淡出；按输出像素画一次缓存起来 */
  function bustOf(key: string): { c: OffscreenCanvas; w: number; h: number } | null {
    const im = images.get(key)
    if (!im) return null
    if (im.bust) return im.bust
    const sx = im.img.width * 0.12
    const sw = im.img.width * 0.76
    const sh = im.img.height * 0.56
    const bh = H
    const bw = (bh * sw) / sh
    const c = new OffscreenCanvas(Math.ceil(bw * SCALE), Math.ceil(bh * SCALE))
    const b = c.getContext("2d")!
    b.drawImage(im.img, sx, 0, sw, sh, 0, 0, c.width, c.height)
    // 两边、下面淡出（destination-in：只留下和渐变重叠的部分）
    b.globalCompositeOperation = "destination-in"
    const gx = b.createLinearGradient(0, 0, c.width, 0)
    gx.addColorStop(0, "rgba(0,0,0,0)")
    gx.addColorStop(0.28, "rgba(0,0,0,1)")
    gx.addColorStop(0.82, "rgba(0,0,0,1)")
    gx.addColorStop(1, "rgba(0,0,0,0)")
    b.fillStyle = gx
    b.fillRect(0, 0, c.width, c.height)
    const gy = b.createLinearGradient(0, 0, 0, c.height)
    gy.addColorStop(0, "rgba(0,0,0,1)")
    gy.addColorStop(0.72, "rgba(0,0,0,1)")
    gy.addColorStop(1, "rgba(0,0,0,0)")
    b.fillStyle = gy
    b.fillRect(0, 0, c.width, c.height)
    im.bust = { c, w: bw, h: bh }
    return im.bust
  }

  /** 能力雷达图：6 项各一条轴，和全联赛最好的比（1 就是最好），轴旁标名字和数据 */
  function radar(axes: { label: string; text: string; score: number }[], cx: number, cy: number, R: number, color: string, a: number): void {
    const n = axes.length
    const ang = (k: number) => -Math.PI / 2 + (2 * Math.PI * k) / n
    const pt = (k: number, r: number) => [cx + r * Math.cos(ang(k)), cy + r * Math.sin(ang(k))]
    g.globalAlpha = a
    g.strokeStyle = "rgba(255,255,255,0.13)"
    g.lineWidth = 1
    for (const f of [0.25, 0.5, 0.75, 1]) {
      g.beginPath()
      for (let k = 0; k < n; k++) {
        const [x, y] = pt(k, R * f)
        if (k === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.closePath()
      g.stroke()
    }
    for (let k = 0; k < n; k++) {
      const [x, y] = pt(k, R)
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(x, y)
      g.stroke()
    }
    // 数据：从中心长出来
    const grow = ease(a)
    g.beginPath()
    axes.forEach((ax, k) => {
      const [x, y] = pt(k, R * (0.08 + 0.92 * ax.score) * grow)
      if (k === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    })
    g.closePath()
    g.fillStyle = color
    g.globalAlpha = 0.32 * a
    g.fill()
    g.globalAlpha = a
    g.strokeStyle = color
    g.lineWidth = 2.2
    g.stroke()
    axes.forEach((ax, k) => {
      const [x, y] = pt(k, R * (0.08 + 0.92 * ax.score) * grow)
      g.fillStyle = color
      g.beginPath()
      g.arc(x, y, 3.2, 0, Math.PI * 2)
      g.fill()
    })
    g.globalAlpha = 1
    axes.forEach((ax, k) => {
      const [x, y] = pt(k, R + 18)
      const c = Math.cos(ang(k))
      const align: CanvasTextAlign = c > 0.3 ? "left" : c < -0.3 ? "right" : "center"
      const up = Math.sin(ang(k)) < -0.5
      const ly = up ? y - 16 : Math.sin(ang(k)) > 0.5 ? y + 6 : y - 4
      text(ax.label, x, ly, 16, C.text, { bold: true, align, alpha: a })
      // 说明可以有两行（用换行分开），放在轴名下面
      ax.text.split("\n").forEach((l: string, j: number) => text(l, x, ly + 18 + j * 15, 13, C.muted, { align, alpha: a }))
    })
  }

  function player(s: Any, i: number): void {
    background()
    const p = ease(i / 18)
    // 背后半透明的半身像（D-177）
    const bust = s.portrait ? bustOf(s.portrait) : null
    if (bust) {
      g.globalAlpha = 0.34 * p
      g.drawImage(bust.c, 905 - bust.w / 2, 0, bust.w, bust.h)
      g.globalAlpha = 1
    }
    // 左边一条选手颜色
    g.fillStyle = s.color
    g.fillRect(0, 0, 14 * p, H)
    const head = `选手 ${s.rank <= s.total ? `· 联赛第 ${s.rank} 名` : ""}`
    text(head, 70, 92, 24, s.color, { bold: true, alpha: p })
    // 称号（D-249，脚本里写的）挂在名次旁边
    if (s.award) {
      g.font = font(24, true)
      awardPill(s.award, 70 + g.measureText(head).width + 18, 92, 20, ease((i - 8) / 14))
    }
    const sp = s.spotlight
    text(s.displayName, 70, 164, 58, C.text, { bold: true, alpha: p })
    let y = 206
    if (s.byline) {
      text(s.byline, 72, y, 24, C.muted, { alpha: p })
      y += 8
    }
    text(s.tagline, 72, y + 44, 30, C.accent, { bold: true, alpha: ease((i - 10) / 18) })
    y += 96
    // 介绍：22 号字、4～5 句（D-178，用户：字可以多一点、字号小一点）
    g.font = font(22)
    s.intro.forEach((line: string, k: number) => {
      const a = ease((i - 20 - k * 9) / 12)
      const ls = wrapBalanced(line, 680)
      g.fillStyle = s.color
      g.globalAlpha = a
      g.beginPath()
      g.arc(80, y - 7, 4, 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 1
      ls.forEach((l, j) => text(l, 98, y + j * 31, 22, C.text, { alpha: a }))
      y += ls.length * 31 + 11
    })
    // 右边：能力雷达图（没有就是代码开头）和战绩；有半身像时卡片半透明，透出后面的人
    // 有规则包看点时（D-249）雷达卡片缩小、代码与战绩压成三行，中间放看点卡片
    const x0 = 820
    const a2 = ease((i - 14) / 20)
    const radarH = sp ? 330 : 380
    g.globalAlpha = a2
    broadcastCard(x0,70,400,radarH)
    g.globalAlpha = 1
    if (s.radar) {
      text("能力雷达（这场联赛的对局数据）", x0 + 18, 98, 15, C.muted, { bold: true, alpha: a2 })
      if (sp) radar(s.radar, x0 + 200, 248, 94, s.color, ease((i - 16) / 24))
      else radar(s.radar, x0 + 200, 272, 108, s.color, ease((i - 16) / 24))
    } else {
      text(s.name + ".ts", x0 + 18, 100, 16, C.muted, { mono: true, alpha: a2 })
      // 文件开头的 12 行：注释绿色、代码灰色
      s.codeHeader.slice(0, sp ? 10 : 12).forEach((l: string, k: number) => {
        g.font = font(15, false, true)
        let shown = l
        while (shown && g.measureText(shown).width > 364) shown = shown.slice(0, -1)
        const isComment = /^\s*(\/\/|\/\*|\*)/.test(l)
        text(shown + (shown.length < l.length ? "…" : ""), x0 + 18, 132 + k * 24, 15, isComment ? "#7fb37a" : "#c9d3e6", { mono: true, alpha: a2 })
      })
    }
    let cy = 70 + radarH + 12
    if (sp) {
      spotlightCard(sp, x0, cy, 400, s.color, a2, 1)
      cy += spotlightHeight(sp, 1) + 12
    }
    g.globalAlpha = a2
    broadcastCard(x0,cy,400,670-cy)
    g.globalAlpha = 1
    g.save();g.globalAlpha=a2;dataHeading("代码与战绩",x0+20,cy+34,360);g.restore()
    if (sp) {
      text(s.facts[0] ?? "", x0 + 20, cy + 58, 17, C.text, { alpha: a2 })
      s.record.forEach((r: string, k: number) => text(r, x0 + 20, cy + 84 + k * 24, 18, s.color, { bold: true, alpha: a2 }))
    } else {
      s.facts.forEach((f: string, k: number) => text(f, x0 + 20, cy + 62 + k * 26, 18, C.text, { alpha: a2 }))
      s.record.forEach((r: string, k: number) => text(r, x0 + 20, cy + 152 + k * 26, 19, s.color, { bold: true, alpha: a2 }))
    }
    watermark()
  }

  /** 画一个单位、建筑或资源点的形状（和回放一样的几种） */
  function rules(s: Any, i: number): void {
    background()
    const p = ease(i / 15)
    text("规则", 80, 110, 26, C.accent, { bold: true, alpha: p })
    text(`${s.ruleset}怎么玩`, 80, 180, 52, C.text, { bold: true, alpha: p })
    // 左边：规则介绍，逐句出现
    let y = 262
    g.font = font(26)
    s.lines.forEach((line: string, k: number) => {
      const a = ease((i - 12 - k * 9) / 12)
      const ls = wrapBalanced(line, 570)
      g.fillStyle = C.accent
      g.globalAlpha = a
      g.beginPath()
      g.arc(90, y - 9, 5, 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 1
      ls.forEach((l, j) => text(l, 110, y + j * 37, 26, C.text, { alpha: a }))
      y += ls.length * 37 + 18
    })
    if (s.tickNote) text(s.tickNote, 80, H - 56, 17, C.muted, { alpha: ease((i - 20) / 15) })
    // 平台署名（D-221：开场阵容删掉了，署名和仓库地址放在第一页规则介绍的底部）
    fitLines(`RTS Arena · 大模型写 bot 的即时战略竞技平台 · ${REPO}`, 80, H - 22, 15, 10, 600, 1, C.muted)
    // 右边：陪练和单位图例（D-252）
    rulesSide(s, i, 700, 92, 540, 686)
    watermark()
  }

  /**
   * 规则页右边（D-252 去掉开局地图，用户：换成陪练的简短介绍；横竖屏共用）：上面是陪练（平台自带的参考 bot）每个一行——颜色点、名字、
   * 一句话介绍，下面是单位图例（兵种造型、名字、造价和数值），都排在 (x0, y0) 起 width 宽、不超过 bottom 的地方
   */
  function rulesSide(s: Any, i: number, x0: number, y0: number, width: number, bottom: number): void {
    const spar = (s.sparring ?? []) as { name: string; text: string }[]
    const n = s.legend.length
    // 陪练多时（攻城拓荒 7 个）行高、字号、图标一起缩，最多缩到 78%，图例尽量还是一栏（两栏时说明要截断）
    const need = (spar.length ? 46 + spar.length * 34 + 12 : 0) + 24 + (n - 1) * 34 + 12
    const k = Math.max(0.78, Math.min(1, (bottom - y0) / need))
    const px = (v: number) => Math.round(v * k)
    let y = y0
    if (spar.length) {
      // 标题不写「也在联赛里」（用户：陪练不一定会进联赛）；名字统一一种颜色（用户：这里只是介绍规则包，不管它们参赛时什么颜色）
      g.save();g.globalAlpha=ease((i - 8) / 18);dataHeading("陪练：规则包自带的参考 bot",x0,y+14,width);g.restore()
      y += px(46)
      g.font = font(px(18), true)
      const nameW = Math.min(width * 0.35, Math.max(...spar.map((b) => g.measureText(b.name).width)))
      spar.forEach((b, j) => {
        const a = ease((i - 12 - j * 3) / 12)
        g.globalAlpha = a
        g.fillStyle = C.accent
        g.beginPath()
        g.arc(x0 + 6, y - px(6), px(5), 0, Math.PI * 2)
        g.fill()
        g.globalAlpha = 1
        fitLines(b.name, x0 + 20, y, px(18), 12, nameW, 1, C.accent, { bold: true, alpha: a })
        fitLines(b.text, x0 + 34 + nameW, y, px(17), 12, width - 34 - nameW, 1, C.text, { alpha: a })
        y += 34 * k
      })
      y += 12 * k
    }
    // 单位图例：排一栏放得下（不超过 bottom）就排一栏，否则排两栏；说明超出栏宽就截断
    const row = 34 * k
    const ly = y + 24 * k
    const cols = ly + (n - 1) * row <= bottom ? 1 : 2
    const colW = width / cols
    const icon = px(22)
    s.legend.forEach((it: Any, j: number) => {
      const col = j % cols
      const lx = x0 + col * colW
      const yy = ly + Math.floor(j / cols) * row
      const a = ease((i - 20 - j * 3) / 12)
      g.globalAlpha = a
      g.save(); g.translate(lx, yy - icon * 0.82); g.scale(icon, icon)
      art.entity(g, it.art ?? it, 0, 0, 1, 1, it.color ?? (it.kind === "resource" ? "#e0b53a" : s.seatColors[0] ?? "#4ea1ff"))
      g.restore()
      g.globalAlpha = 1
      text(it.name, lx + icon + 10, yy - 1, px(18), C.text, { bold: true, alpha: a })
      g.font = font(px(18), true)
      const nw = g.measureText(it.name).width
      g.font = font(px(14))
      let detail = it.detail as string
      while (detail && icon + 18 + nw + g.measureText(detail).width > colW - 12) detail = detail.slice(0, -1)
      text(detail + (detail.length < it.detail.length ? "…" : ""), lx + icon + 18 + nw, yy - 1, px(14), C.muted, { alpha: a })
    })
  }

  /**
   * 竖屏的几句要点（规则、选手介绍）：逐句出现，每句前一个圆点。字号从 px0 往下试，直到放得进 room 高（最小 minPx）；
   * 返回最后一句下面的 y
   */
  function vBullets(lines: string[], x: number, y: number, maxW: number, room: number, px0: number, minPx: number, dot: string, i: number): number {
    let px = px0
    const fit = (size: number) => {
      g.font = font(size)
      const rows = lines.map((l) => wrapBalanced(l, maxW))
      return { rows, h: rows.reduce((t, ls) => t + ls.length * Math.round(size * 1.4) + Math.round(size * 0.5), 0) }
    }
    let r = fit(px)
    while (r.h > room && px > minPx) r = fit(--px)
    const lh = Math.round(px * 1.4)
    r.rows.forEach((ls, k) => {
      const a = ease((i - 12 - k * 9) / 12)
      const base = y + px
      g.fillStyle = dot
      g.globalAlpha = a
      g.beginPath()
      g.arc(x - 16, base - px * 0.36, Math.max(4, px * 0.18), 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 1
      ls.forEach((l, j) => text(l, x, base + j * lh, px, C.text, { alpha: a }))
      y += ls.length * lh + Math.round(px * 0.5)
    })
    return y
  }

  /** 竖屏的规则页（D-183）：上面是标题和规则几句，下面是陪练和单位图例（D-252 去掉开局地图） */
  function vRules(s: Any, i: number): void {
    const p = ease(i / 15)
    text("规则", SX, 90, 26, C.accent, { bold: true, alpha: p })
    fitLines(`${s.ruleset}怎么玩`, SX, 156, 48, 28, SW, 1, C.text, { bold: true })
    // 规则最多占到 560 高，字多就缩字号
    const y = vBullets(s.lines, SX + 22, 196, SW - 22, 360, 28, 20, C.accent, i)
    rulesSide(s, i, SX, Math.max(y + 24, 400), SW, VH - 140)
    if (s.tickNote) fitLines(s.tickNote, SX, VH - 104, 18, 12, SW, 1, C.muted, { alpha: ease((i - 20) / 15) })
    // 平台署名（D-221：开场阵容删掉了，挪到规则页最下面）
    fitLines("RTS Arena · 大模型写 bot 的即时战略竞技平台", VW / 2, VH - 64, 20, 12, SW, 1, C.muted, { align: "center" })
    fitLines(REPO, VW / 2, VH - 34, 18, 10, SW, 2, C.accent, { align: "center" })
  }

  /**
   * 竖屏的选手页（D-183）：整张立绘当半透明背景；上面是名次、名字、小字和一句话定位，中间是能力雷达图，
   * 下面是介绍（逐句出现，字多就缩字号）和联赛战绩
   */
  function vPlayer(s: Any, i: number): void {
    const p = ease(i / 18)
    const im = s.portrait ? images.get(s.portrait) : undefined
    if (im) {
      // 按高铺满、左右居中，裁掉两边
      const h = VH
      const w = (im.img.width * h) / im.img.height
      g.globalAlpha = 0.22 * p
      g.drawImage(im.img, (VW - w) / 2, 0, w, h)
      g.globalAlpha = 1
    }
    g.fillStyle = s.color
    g.fillRect(0, 0, VW, 10 * p)
    const head = `选手 · 联赛第 ${s.rank} 名`
    text(head, SX, 80, 24, s.color, { bold: true, alpha: p })
    // 称号（D-249，脚本里写的）挂在名次旁边；规则包看点卡片放在雷达图下面
    if (s.award) {
      g.font = font(24, true)
      awardPill(s.award, SX + g.measureText(head).width + 16, 80, 20, ease((i - 8) / 14))
    }
    const sp = s.spotlight
    fitLines(s.displayName, SX, 148, 60, 30, SW, 1, C.text, { bold: true })
    let y = 190
    if (s.byline) {
      fitLines(s.byline, SX + 2, y, 22, 14, SW, 1, C.muted)
      y += 10
    }
    y = fitLines(s.tagline, SX, y + 42, 32, 22, SW, 2, C.accent, { bold: true }) - 10
    if (s.radar) {
      const a2 = ease((i - 14) / 20)
      g.globalAlpha = a2
      broadcastCard(SX,y,SW,sp ? 340 : 400)
      g.globalAlpha = 1
      g.save()
      g.translate(VW / 2, y + (sp ? 168 : 200))
      if (!sp) g.scale(1.2, 1.2)
      radar(s.radar, 0, 0, 110, s.color, ease((i - 16) / 24))
      g.restore()
      y += sp ? 354 : 414
    }
    if (sp) {
      spotlightCard(sp, SX, y, SW, s.color, ease((i - 14) / 20), 1.25)
      y += spotlightHeight(sp, 1.25) + 14
    }
    vBullets(s.intro, SX + 22, y, SW - 22, VH - 96 - y, 26, 18, s.color, i - 8)
    if (s.record?.length) fitLines(s.record.join(" · "), VW / 2, VH - 40, 24, 14, SW, 1, s.color, { bold: true, align: "center" })
  }

  /** 单位图形的半径是几格（D-220：直径 1.4 格，比一格大，挨着的单位边缘叠在一起）；工人还是原来的大小（不到一格，D-221 用户） */
  const UNIT_R = 0.7
  /** 一格多大：按地图大小算，尽量铺满左边（输出时是整数像素，地形不会有缝） */
  let TILE = 18
  const MX = 24
  const MY = 92
  function fitTile(s: Any): void {
    // 竖屏：地图拉满安全宽度（D-181；D-220 两边留出抖音会裁掉的边）
    if (VERT) {
      TILE = Math.floor((SW / s.width) * VS) / VS
      return
    }
    const t = Math.min(26, (H - MY - 44) / s.height, (W - MX - 20 - 330 - 20) / s.width)
    TILE = Math.floor(t * SCALE) / SCALE
  }
  /**
   * 实时胜率折线图（D-177；折线图 D-178）：标题旁写两边的百分比；横轴是这局的时间、纵轴 0～100%，中间虚线是 50%，
   * 曲线在虚线上方涂 sides[0] 的颜色、下方涂 sides[1] 的颜色，当前点按领先一方上色。px 是标题字号（侧栏 15，竖屏 30）
   */
  function drawWin(wv: Any, t: number, bx: number, y: number, bw: number, ch: number, px: number): void {
    const at = Math.max(0, Math.min(wv.curve.length - 1, t / wv.step))
    const k = Math.floor(at)
    const pr = wv.curve[k] + ((wv.curve[Math.min(k + 1, wv.curve.length - 1)] ?? wv.curve[k]) - wv.curve[k]) * (at - k)
    const pa = Math.round(pr * 100)
    text("胜率预测", bx, y - 2, px, C.muted, { bold: true })
    const vp = Math.round(px * 1.07)
    text(`${100 - pa}%`, bx + bw, y - 2, vp, wv.sides[1].color, { bold: true, align: "right" })
    g.font = font(vp, true)
    const wb = g.measureText(`${100 - pa}%`).width
    text(":", bx + bw - wb - px * 0.4, y - 2, vp, C.muted, { align: "right" })
    text(`${pa}%`, bx + bw - wb - px * 1.05, y - 2, vp, wv.sides[0].color, { bold: true, align: "right" })
    const top = y + Math.round(px * 0.55)
    const mid = top + ch / 2
    roundRect(bx, top, bw, ch, 6, "rgba(255,255,255,0.04)")
    const xOf = (tick: number) => bx + bw * Math.min(1, tick / Math.max(1, wv.ticks))
    const yOf = (v: number) => top + ch * (1 - v)
    const pts: [number, number][] = []
    for (let j = 0; j <= k; j++) pts.push([xOf(j * wv.step), yOf(wv.curve[j])])
    pts.push([xOf(t), yOf(pr)])
    for (const [clipTop, col] of [
      [top, wv.sides[0].color],
      [mid, wv.sides[1].color],
    ] as [number, string][]) {
      g.save()
      g.beginPath()
      g.rect(bx, clipTop, bw, ch / 2)
      g.clip()
      g.beginPath()
      g.moveTo(pts[0][0], mid)
      for (const [qx, qy] of pts) g.lineTo(qx, qy)
      g.lineTo(pts[pts.length - 1][0], mid)
      g.closePath()
      g.globalAlpha = 0.4
      g.fillStyle = col
      g.fill()
      g.restore()
    }
    g.globalAlpha = 1
    g.strokeStyle = "rgba(255,255,255,0.25)"
    g.lineWidth = 1
    g.setLineDash([3, 3])
    g.beginPath()
    g.moveTo(bx, mid)
    g.lineTo(bx + bw, mid)
    g.stroke()
    g.setLineDash([])
    text("50%", bx + 3, mid - 3, Math.max(10, px * 0.67), C.muted)
    g.strokeStyle = "#e8edf7"
    g.lineWidth = px > 20 ? 3 : 1.8
    g.beginPath()
    pts.forEach(([qx, qy], j) => (j === 0 ? g.moveTo(qx, qy) : g.lineTo(qx, qy)))
    g.stroke()
    const [lx, ly] = pts[pts.length - 1]
    g.fillStyle = pr >= 0.5 ? wv.sides[0].color : wv.sides[1].color
    g.beginPath()
    g.arc(lx, ly, px > 20 ? 7 : 4, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = "#0b1220"
    g.lineWidth = 1.5
    g.stroke()
  }

  /** 头像（圆形，描一圈颜色）；没有形象图时画颜色圆加名字的头一个字 */
  function avatarCircle(key: string | null | undefined, name: string, color: string, cx: number, cy: number, r: number): void {
    const im = key ? images.get(key) : undefined
    g.save()
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.clip()
    if (im) g.drawImage(im.avatar, cx - r, cy - r, r * 2, r * 2)
    else {
      g.fillStyle = color
      g.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
    g.restore()
    if (!im) text([...name][0] ?? "?", cx, cy + r * 0.35, r, "#ffffff", { bold: true, align: "center" })
    g.strokeStyle = color
    g.lineWidth = Math.max(3, r * 0.08)
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.stroke()
  }

  /** 排一段文字（不画）：先折行，折到 maxLines 行还放不下才缩字号，最小 minPx；返回字号和每行 */
  function layoutLines(s: string, px: number, minPx: number, maxW: number, maxLines: number, bold: boolean): { size: number; lines: string[] } {
    let size = px
    g.font = font(size, bold)
    while (size > minPx && wrapBalanced(s, maxW).length > maxLines) g.font = font(--size, bold)
    return { size, lines: wrapBalanced(s, maxW).slice(0, maxLines) }
  }

  /**
   * 一段文字：放不下就缩字号（最小 minPx），还放不下就折行（最多 maxLines 行）；返回最后一行下面的 y。
   * wrapFirst：先折行、折到 maxLines 行还放不下才缩字号（竖屏开场的大字，D-183：长标题缩成一行小字看不清）
   */
  function fitLines(s: string, x: number, y: number, px: number, minPx: number, maxW: number, maxLines: number, color: string, opts: { bold?: boolean; align?: CanvasTextAlign; wrapFirst?: boolean; alpha?: number } = {}): number {
    let size = px
    g.font = font(size, opts.bold)
    const fits = () => (opts.wrapFirst ? wrapBalanced(s, maxW).length <= maxLines : g.measureText(s).width <= maxW)
    while (size > minPx && !fits()) g.font = font(--size, opts.bold)
    const ls = g.measureText(s).width > maxW ? wrapBalanced(s, maxW).slice(0, maxLines) : [s]
    ls.forEach((l, k) => text(l, x, y + k * size * 1.3, size, color, opts))
    return y + ls.length * size * 1.3
  }

  /**
   * 开场阵容（D-179，用户：三秒跳出率高；D-221 删掉、D-230 用户要求加回来）：第一帧就是全体选手的立绘和一句大字，不从黑屏淡入（也适合当封面）。
   * 横屏排成一排；竖屏每行最多 4 个
   */
  function lineup(s: Any, a: number, vert: boolean): void {
    const VWW = vert ? VW : W
    if (!vert) background()
    const n = s.players.length
    const cols = vert ? Math.min(4, n) : n
    const rows = Math.ceil(n / cols)
    const top = vert ? 330 : 150
    const ch = vert ? Math.min(400, (VH - top - 190) / rows - 50) : H - top - 92
    const cw = (VWW - (vert ? 2 * SX : 40)) / cols
    // 立绘慢慢推近一点（Ken Burns），第一帧已经是完整画面
    const z = 1 + 0.04 * Math.min(1, a / Math.max(1, s.frames))
    s.players.forEach((pl: Any, k: number) => {
      const row = Math.floor(k / cols)
      const inRow = Math.min(cols, n - row * cols)
      const x = (VWW - inRow * cw) / 2 + (k - row * cols) * cw
      const y = top + row * (ch + 50)
      const bust = pl.portrait ? bustOf(pl.portrait) : null
      g.save()
      g.beginPath()
      g.rect(x + 2, y, cw - 4, ch)
      g.clip()
      if (bust) {
        const sh = bust.c.height * 0.9
        const sw = Math.min(bust.c.width, (sh * (cw - 4)) / ch)
        const zx = (sw * (z - 1)) / 2
        const zy = (sh * (z - 1)) / 2
        g.drawImage(bust.c, (bust.c.width - sw) / 2 + zx, zy, sw - 2 * zx, sh - 2 * zy, x + 2, y, cw - 4, ch)
      } else {
        g.globalAlpha = 0.5
        g.fillStyle = pl.color
        g.fillRect(x + 2, y, cw - 4, ch)
        g.globalAlpha = 1
        text([...pl.name][0] ?? "?", x + cw / 2, y + ch * 0.55, Math.min(cw, ch) * 0.5, "#ffffff", { bold: true, align: "center" })
      }
      g.restore()
      // 下面一条选手颜色和名字
      g.fillStyle = pl.color
      g.fillRect(x + 2, y + ch, cw - 4, 5)
      fitLines(pl.name, x + cw / 2, y + ch + 34, vert ? 26 : 22, 12, cw - 8, 1, pl.color, { bold: true, align: "center" })
    })
    // 大字压在立绘上面
    const ty = vert ? 150 : 84
    fitLines(s.title, VWW / 2, ty, vert ? 50 : 46, 24, vert ? SW : VWW - 80, 2, C.text, { bold: true, align: "center", wrapFirst: vert })
    text(s.sub, VWW / 2, vert ? 270 : 128, vert ? 24 : 20, C.accent, { bold: true, align: "center" })
    // 平台署名（D-181：不单独放片头页，用小字放在开场阵容最下面）
    if (vert) {
      fitLines("RTS Arena · 大模型写 bot 的即时战略竞技平台", VWW / 2, VH - 70, 20, 12, SW, 1, C.muted, { align: "center" })
      fitLines(REPO, VWW / 2, VH - 38, 18, 10, SW, 2, C.accent, { align: "center" })
    } else fitLines(`RTS Arena · 大模型写 bot 的即时战略竞技平台 · ${REPO}`, VWW / 2, H - 16, 15, 11, VWW - 40, 1, C.muted, { align: "center" })
  }

  /** 竖屏：渐变背景 */
  function vBackground(): void {
    consoleBackdrop(VW,VH)
  }

  /** 地图（D-181 抽出来，横屏回放和竖屏回放共用）：地形（按输出像素画一次缓存）、规则包标记、单位和建筑（主基地画成头像）、攻击线、刚死的红圈；(ox, oy) 是左上角 */
  function drawField(s: Any, f: Any, ox: number, oy: number, i = 0): void {
    // 光环菱形、特效画在地图范围里，不压到旁边的面板上（D-190）
    g.save()
    g.beginPath()
    g.rect(ox, oy, s.width * TILE, s.height * TILE)
    g.clip()
    drawFieldInner(s, f, ox, oy, i)
    g.restore()
  }
  function drawFieldInner(s: Any, f: Any, ox: number, oy: number, i: number): void {
    const rs = VERT ? VS : SCALE
    if (!terrainLayer) {
      // A fixed, sufficiently detailed terrain cache survives smooth camera zoom without reallocating.
      // 横屏、竖屏交战时都会放大（D-236），按两倍格子大小（至少 32）存一份
      const rasterTile = Math.min(Math.max(32, TILE * 2), 4096 / (Math.max(s.width, s.height) * rs))
      terrainLayer = new OffscreenCanvas(Math.ceil(s.width * rasterTile * rs), Math.ceil(s.height * rasterTile * rs))
      const t = terrainLayer.getContext("2d")!
      t.scale(rs, rs)
      art.terrain(t, s.terrain, s.colors, rasterTile)
    }
    g.drawImage(terrainLayer, ox, oy, s.width * TILE, s.height * TILE)
    const colorOf = (seat: number) => (seat >= 0 ? (s.seats[seat]?.color ?? "#ccc") : "#9aa0a6")
    // 规则包的标记：区域按归属上色（没人的灰色），文字标在格子上
    for (const m of (f.markers ?? []) as Any[]) {
      const col = m.color ?? (m.owner === null || m.owner === undefined || m.owner < 0 ? "#c8ccd4" : colorOf(m.owner))
      if (m.kind === "zone") {
        g.globalAlpha = 0.22
        g.fillStyle = col
        g.fillRect(ox + m.x * TILE, oy + m.y * TILE, m.w * TILE, m.h * TILE)
        g.globalAlpha = 0.9
        g.strokeStyle = col
        g.lineWidth = 2
        g.setLineDash([6, 4])
        g.strokeRect(ox + m.x * TILE + 1, oy + m.y * TILE + 1, m.w * TILE - 2, m.h * TILE - 2)
        g.setLineDash([])
        g.globalAlpha = 1
        if (m.label) text(m.label, ox + m.x * TILE + 3, oy + m.y * TILE - 4, fxPx(13), col, { bold: true })
      } else text(m.text, ox + (m.x + 0.5) * TILE, oy + (m.y + 0.5) * TILE, fxPx(13), col, { bold: true, align: "center" })
    }
    // 光环范围：曼哈顿距离的菱形（D-186）
    const au = (f.auras ?? []) as number[]
    for (let k = 0; k < au.length; k += 6) {
      const [x, y, ew, eh, r, seat] = au.slice(k, k + 6)
      const cx = ox + (x + ew / 2) * TILE
      const cy = oy + (y + eh / 2) * TILE
      const R = (r + 0.5) * TILE
      g.beginPath()
      g.moveTo(cx, cy - R)
      g.lineTo(cx + R, cy)
      g.lineTo(cx, cy + R)
      g.lineTo(cx - R, cy)
      g.closePath()
      g.globalAlpha = 0.07
      g.fillStyle = colorOf(seat)
      g.fill()
      g.globalAlpha = 0.45
      g.strokeStyle = colorOf(seat)
      g.lineWidth = 1.2
      g.stroke()
      // 从光环的主人往外扩散到边缘的金色波纹，两道错开半拍（D-190）
      for (const k of [0, 0.5]) {
        const ph = (i / 45 + k) % 1
        const rr = Math.max(2, R * ph)
        g.beginPath()
        g.moveTo(cx, cy - rr)
        g.lineTo(cx + rr, cy)
        g.lineTo(cx, cy + rr)
        g.lineTo(cx - rr, cy)
        g.closePath()
        g.globalAlpha = 0.08 * (1 - ph)
        g.fillStyle = "#f2c14e"
        g.fill()
        g.globalAlpha = 0.65 * (1 - ph)
        g.strokeStyle = "#f2c14e"
        g.lineWidth = 2
        g.stroke()
      }
      g.globalAlpha = 0.2
      g.fillStyle = "#f2c14e"
      g.beginPath()
      g.arc(cx, cy, TILE * (0.9 + 0.12 * Math.sin(i / 5)), 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 1
    }
    // 被击退的（D-226）：从原来的位置拖一道浅色轨迹到现在画的位置，越往原处越淡、滑得越久越淡；单位本身画在插值的位置上
    const kf = (f.knockFx ?? []) as number[]
    g.save()
    g.lineCap = "round"
    g.lineWidth = TILE * UNIT_R * 1.5
    for (let k = 0; k < kf.length; k += 5) {
      const [x0, y0, x1, y1, p] = kf.slice(k, k + 5)
      const ax = ox + (x0 + 0.5) * TILE
      const ay = oy + (y0 + 0.5) * TILE
      const bx = ox + (x1 + 0.5) * TILE
      const by = oy + (y1 + 0.5) * TILE
      const grad = g.createLinearGradient(ax, ay, bx, by)
      // 滑的大部分时间都看得清，快滑完才淡掉
      const a = 0.95 * (1 - p * p)
      grad.addColorStop(0, "rgba(235,248,255,0)")
      grad.addColorStop(0.5, `rgba(235,248,255,${0.45 * a})`)
      grad.addColorStop(1, `rgba(235,248,255,${a})`)
      g.strokeStyle = grad
      g.beginPath()
      g.moveTo(ax, ay)
      g.lineTo(bx, by)
      g.stroke()
    }
    g.restore()
    g.save()
    g.translate(ox, oy)
    g.scale(TILE, TILE)
    for (const d of f.fallen ?? []) art.fallen(g, d.x, d.y, d.w, d.h, colorOf(d.owner), d.age, d.duration, d.building)
    g.restore()
    const e = f.ents as number[]
    const poses = (f.poses ?? []) as number[]
    const workers = new Map<number, BattlePose>((f.workers ?? []).map((w: { index: number; pose: BattlePose }) => [w.index, w.pose]))
    // Paint from back to front; neighboring soldiers overlap naturally, with buildings behind units.
    const order = Array.from({ length: e.length / 8 }, (_, k) => k * 8).sort((a, b) => {
      // 建筑最先、地面单位其次、空中单位（D-266）最后画
      const ak = s.types[e[a + 5]].kind === "unit" ? (s.types[e[a + 5]].layer === "air" ? 2 : 1) : 0
      const bk = s.types[e[b + 5]].kind === "unit" ? (s.types[e[b + 5]].layer === "air" ? 2 : 1) : 0
      return ak - bk || e[a + 1] + e[a + 3] - e[b + 1] - e[b + 3] || e[a] - e[b]
    })
    for (const k of order) {
      const [x, y, ew, eh, seat, ti, hp, bp] = e.slice(k, k + 8)
      const ty = s.types[ti]
      const col = ty.color ?? colorOf(seat)
      const pi = k / 2
      g.save()
      g.translate(ox, oy)
      g.scale(TILE, TILE)
      art.entity(g, ty, x, y, ew, eh, col, { angle: poses[pi], walk: poses[pi + 1], attack: poses[pi + 2], hit: poses[pi + 3], ...workers.get(k / 8) }, bp)
      g.restore()
      const px = ox + x * TILE, py = oy + y * TILE, pw = ew * TILE, ph = eh * TILE
      // Portraits are a heraldic inset on the keep, so the base still reads as a building.
      const av = ty.base && seat >= 0 ? images.get(s.seats[seat]?.avatar ?? "") : undefined
      if (av) {
        const side = Math.min(pw, ph) * .40, ax = px + (pw - side) / 2, ay = py + ph * .25
        g.save(); g.beginPath(); g.roundRect(ax, ay, side, side, 2); g.clip()
        g.drawImage(av.avatar, ax, ay, side, side); g.restore()
        g.strokeStyle = "#e3cf9d"; g.lineWidth = 1.3; g.strokeRect(ax, ay, side, side)
      }
      if (ty.kind !== "resource" && hp < 100) {
        const bw = ty.kind === "unit" ? TILE * .85 : pw - 3
        const clearance = art.headroom(ty)
        const bx = px + (pw - bw) / 2, by = py - 3 - clearance * TILE
        g.fillStyle = "rgba(9,18,18,.85)"; g.fillRect(bx - 1, by - 1, bw + 2, 4)
        g.fillStyle = hp > 50 ? "#a8ce91" : hp > 25 ? "#efc673" : "#ee8270"
        g.fillRect(bx, by, bw * hp / 100, 2)
      }
    }
    // Production bars and one pip per queued unit; no inferred queue in old replays.
    for(const q of (f.production??[]) as NonNullable<ReplayFrame["production"]>) {
      const x=ox+q.x*TILE,y=oy+(q.y+q.h)*TILE+2, width=q.w*TILE-2
      q.active.forEach((slot,j)=>{
        g.fillStyle="#122026";g.fillRect(x,y+j*4,width+2,3)
        g.fillStyle=slot.blocked?"#de806b":"#dfb76d";g.fillRect(x+1,y+j*4+1,width*slot.progress,1.5)
      })
      for(let j=0;j<q.count;j++){g.fillStyle=j<q.active.length?"#dfb76d":"#617780";g.fillRect(x+1+j*4,y+2+q.active.length*4,2.5,2.5)}
    }
    // 身上有增益的单位：外面一圈金色，一呼一吸（D-186、D-190）
    const bf = (f.buffed ?? []) as number[]
    g.strokeStyle = "#f2c14e"
    g.lineWidth = 1.5
    g.globalAlpha = 0.55 + 0.45 * Math.sin(i / 4)
    for (let k = 0; k < bf.length; k += 2) {
      g.beginPath()
      g.arc(ox + (bf[k] + 0.5) * TILE, oy + (bf[k + 1] + 0.5) * TILE, TILE * UNIT_R + 1.5, 0, Math.PI * 2)
      g.stroke()
    }
    g.globalAlpha = 1
    // Weapon-specific motion and impacts, with a lifetime independent of skipped simulation ticks.
    g.save()
    g.translate(ox, oy)
    g.scale(TILE, TILE)
    for (const a of f.combat ?? []) art.attack(g, a, colorOf(a.owner))
    g.restore()
    // 技能冷却环（D-190）：金色是冷却好了的部分，好了整圈发光；正在回血的外面再一圈绿色
    const cd = (f.cds ?? []) as number[]
    for (let k = 0; k < cd.length; k += 5) {
      const [x, y, ew, eh, frac] = cd.slice(k, k + 5)
      const cx = ox + (x + ew / 2) * TILE
      const cy = oy + (y + eh / 2) * TILE
      const rr = (ew === 1 && eh === 1 ? TILE * UNIT_R : (Math.max(ew, eh) * TILE) / 2) + 3.5
      g.lineWidth = 1.6
      g.strokeStyle = "rgba(0,0,0,0.45)"
      g.beginPath()
      g.arc(cx, cy, rr, 0, Math.PI * 2)
      g.stroke()
      g.lineWidth = 2
      g.strokeStyle = "#f2c14e"
      g.globalAlpha = frac >= 1 ? 0.6 + 0.4 * Math.sin(i / 3) : 0.9
      g.beginPath()
      g.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
      g.stroke()
      g.globalAlpha = 1
    }
    const hg = (f.healing ?? []) as number[]
    for (let k = 0; k < hg.length; k += 4) {
      const [x, y, ew, eh] = hg.slice(k, k + 4)
      g.strokeStyle = "#6ee36e"
      g.lineWidth = 1.5
      g.globalAlpha = 0.55 + 0.3 * Math.sin(i / 2)
      g.beginPath()
      g.arc(ox + (x + ew / 2) * TILE, oy + (y + eh / 2) * TILE, (ew === 1 && eh === 1 ? TILE * UNIT_R : (Math.max(ew, eh) * TILE) / 2) + 6.5, 0, Math.PI * 2)
      g.stroke()
      g.globalAlpha = 1
    }
    // 放技能（D-190）：释放者身上金色冲击波和放射光线，一道金光射向目标（点金的新金矿），目标处闪一颗星
    const cf = (f.castFx ?? []) as number[]
    for (let k = 0; k < cf.length; k += 5) {
      const [x, y, tx, ty, age] = cf.slice(k, k + 5)
      const fr = age / 18
      const a = 1 - fr
      const px = ox + (x + 0.5) * TILE
      const py = oy + (y + 0.5) * TILE
      g.globalAlpha = a
      g.strokeStyle = "#f2c14e"
      g.lineWidth = 3 * a + 0.5
      g.beginPath()
      g.arc(px, py, TILE * (0.6 + fr * 3.2), 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = "rgba(255,241,184,0.35)"
      g.beginPath()
      g.arc(px, py, TILE * (0.3 + fr * 1.2), 0, Math.PI * 2)
      g.fill()
      g.lineWidth = 1.5
      for (let r = 0; r < 8; r++) {
        const ang = (Math.PI / 4) * r + age * 0.15
        const r0 = TILE * (0.6 + fr * 1.5)
        g.beginPath()
        g.moveTo(px + Math.cos(ang) * r0, py + Math.sin(ang) * r0)
        g.lineTo(px + Math.cos(ang) * (r0 + TILE * 0.7), py + Math.sin(ang) * (r0 + TILE * 0.7))
        g.stroke()
      }
      if (tx >= 0) {
        const qx = ox + (tx + 0.5) * TILE
        const qy = oy + (ty + 0.5) * TILE
        const reach = Math.min(1, age / 6)
        g.lineWidth = 3 * a + 0.5
        g.beginPath()
        g.moveTo(px, py)
        g.lineTo(px + (qx - px) * reach, py + (qy - py) * reach)
        g.stroke()
        if (age >= 4) {
          const gr = Math.min(1, (age - 4) / 6)
          const sr = TILE * (0.5 + gr * 1.2)
          g.fillStyle = "rgba(255,241,184,0.95)"
          g.beginPath()
          for (let r = 0; r < 8; r++) {
            const ang = (Math.PI / 4) * r - Math.PI / 2
            const rad = r % 2 === 0 ? sr : sr * 0.3
            if (r === 0) g.moveTo(qx + Math.cos(ang) * rad, qy + Math.sin(ang) * rad)
            else g.lineTo(qx + Math.cos(ang) * rad, qy + Math.sin(ang) * rad)
          }
          g.closePath()
          g.fill()
          g.beginPath()
          g.arc(qx, qy, TILE * (0.5 + gr), 0, Math.PI * 2)
          g.stroke()
        }
      }
      g.globalAlpha = 1
    }
    // 回血（D-190）：绿色光圈往外扩、几颗绿色十字往上飘、头顶飘 +N
    const hf = (f.healFx ?? []) as number[]
    for (let k = 0; k < hf.length; k += 4) {
      const [x, y, amount, age] = hf.slice(k, k + 4)
      const fr = age / 14
      const a = 1 - fr
      const px = ox + (x + 0.5) * TILE
      const py = oy + (y + 0.5) * TILE
      g.globalAlpha = a
      g.strokeStyle = "#6ee36e"
      g.lineWidth = 2
      g.beginPath()
      g.lineWidth = 2.5
      g.arc(px, py, TILE * (0.6 + fr * 1.4), 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = "rgba(110,227,110,0.18)"
      g.beginPath()
      g.arc(px, py, TILE * (0.6 + fr * 1.4), 0, Math.PI * 2)
      g.fill()
      g.fillStyle = "#6ee36e"
      for (const [dx, dy] of [[-8, 3], [8, -2], [0, 8], [-3, -7]]) {
        const cx = px + dx
        const cy = py + dy - fr * TILE * 1.6
        g.fillRect(cx - 3, cy - 1, 6, 2)
        g.fillRect(cx - 1, cy - 3, 2, 6)
      }
      g.globalAlpha = 1
      text(`+${amount}`, px + TILE * 0.9, py - TILE * (0.8 + fr * 1.4), fxPx(15), `rgba(110,227,110,${a})`, { bold: true, align: "left" })
    }
    // 规则包的画面特效（D-205，比如击退的冲击波）：两圈光往外扩、中间一团亮光、八道放射线，字往上飘
    for (const r of (f.ruleFx ?? []) as NonNullable<ReplayFrame["ruleFx"]>) {
      const fr = r.age / 24
      const a = 1 - fr
      const hex = r.color && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : "#f2c14e"
      const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)).join(",")
      const cx = ox + (r.x + r.w / 2) * TILE
      const cy = oy + (r.y + r.h / 2) * TILE
      const base = (Math.max(r.w, r.h) * TILE) / 2
      g.globalAlpha = a
      g.fillStyle = "rgba(255,241,184,0.45)"
      g.beginPath()
      g.arc(cx, cy, base * (1 - fr * 0.5), 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = `rgb(${rgb})`
      g.lineWidth = 3.5
      g.beginPath()
      g.arc(cx, cy, base + TILE * fr * (r.radius ?? 2.6), 0, Math.PI * 2)
      g.stroke()
      g.strokeStyle = "#fff1b8"
      g.lineWidth = 2
      g.beginPath()
      g.arc(cx, cy, base + TILE * fr * (r.radius ?? 2.6) * 0.55, 0, Math.PI * 2)
      g.stroke()
      g.strokeStyle = `rgb(${rgb})`
      g.lineWidth = 2.5
      for (let k = 0; k < 8; k++) {
        const ang = (Math.PI / 4) * k + fr * 0.8
        const r0 = base + TILE * (0.3 + fr * (r.radius ?? 2.6) * 0.6)
        g.beginPath()
        g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0)
        g.lineTo(cx + Math.cos(ang) * (r0 + TILE * 0.8), cy + Math.sin(ang) * (r0 + TILE * 0.8))
        g.stroke()
      }
      g.globalAlpha = 1
      if (r.text) text(r.text, cx, cy - base - TILE * (0.6 + fr * 1.6), fxPx(20), `rgba(${rgb},${a})`, { bold: true })
    }
  }

  function broadcastCard(x:number,y:number,width:number,height:number,accent=C.line):void {
    g.save()
    const fill=g.createLinearGradient(x,y,x+width,y+height)
    fill.addColorStop(0,"#172a45");fill.addColorStop(.5,"#0e1b32");fill.addColorStop(1,"#0a1427")
    const cut=Math.min(10,height*.18)
    g.beginPath();g.moveTo(x,y);g.lineTo(x+width-cut,y);g.lineTo(x+width,y+cut);g.lineTo(x+width,y+height);g.lineTo(x+cut,y+height);g.lineTo(x,y+height-cut);g.closePath()
    g.fillStyle=fill;g.shadowColor="#01050b66";g.shadowBlur=12;g.shadowOffsetY=4;g.fill();g.shadowBlur=0;g.shadowOffsetY=0
    g.strokeStyle=accent;g.lineWidth=1;g.stroke()
    g.strokeStyle="#4c91bb";g.globalAlpha=.7
    g.beginPath();g.moveTo(x+12,y+.8);g.lineTo(x+Math.min(width-20,57),y+.8);g.stroke()
    g.globalAlpha=.4
    for(let k=0;k<3;k++){g.beginPath();g.moveTo(x+width-15-k*5,y+height-4);g.lineTo(x+width-13-k*5,y+height-8);g.stroke()}
    g.restore()
  }
  /** 称号（D-249）：金色小牌子，左边从 x 开始；y 是旁边那行字的基线 */
  function awardPill(award:string,x:number,y:number,px:number,a:number):void {
    const h=px+14,top=y-px*0.85-7,label="★ "+award
    g.font=font(px,true)
    const tw=g.measureText(label).width
    g.globalAlpha=a
    roundRect(x,top,tw+px*1.4,h,h/2,GOLD)
    text(label,x+px*0.7,top+h/2+px*0.36,px,"#2a1d00",{bold:true,alpha:a})
    g.globalAlpha=1
  }
  /** 看点卡片多高（k 是缩放：横屏 1、竖屏 1.25） */
  function spotlightHeight(rows:Any[],k:number):number {
    return Math.round((20+rows.length*28+rows.filter((r:Any)=>r.note).length*16)*k)
  }
  /** 规则包看点卡片（D-249）：每项一行——名字、每局平均、在参赛选手里排第几；有说明的在下面一行小字写怎么算的（不要标题，用户：省地方） */
  function spotlightCard(rows:Any[],x:number,y:number,w:number,color:string,a:number,k:number):void {
    g.globalAlpha=a
    broadcastCard(x,y,w,spotlightHeight(rows,k))
    g.globalAlpha=1
    let ry=y+32*k
    for(const r of rows) {
      text(r.label,x+20*k,ry,Math.round(17*k),C.text,{alpha:a})
      text(r.value,x+w-96*k,ry,Math.round(19*k),color,{bold:true,align:"right",alpha:a})
      text(`第 ${r.rank} / ${r.of}`,x+w-20*k,ry,Math.round(14*k),r.rank===1?C.text:C.muted,{align:"right",alpha:a})
      if(r.note){ry+=16*k;fitLines(r.note,x+20*k,ry,Math.round(12*k),9,w-40*k,1,C.muted,{alpha:a})}
      ry+=28*k
    }
  }
  /** 座位按队伍分组（D-248）：同队的挨着、队按第一个座位的先后；不分队时每人一组 */
  function teamGroups(seats:Any[]):number[][] {
    const out:number[][]=[]
    seats.forEach((st,k)=>{const t=st.team??k;const gr=out.find((x)=>(seats[x[0]].team??x[0])===t);if(gr)gr.push(k);else out.push([k])})
    return out
  }
  /**
   * 各家兵力对比（D-248）：三方以上各自为战没有胜率折线（模型只支持两方），竖屏底部改画每家作战部队的横条，
   * 条长按场上最多的那家算，出局的灰掉
   */
  function drawForces(s:Any,f:Any,bx:number,y:number,bw:number,px:number):void {
    text("各家兵力",bx,y-2,px,C.muted,{bold:true})
    const counts=(s.seats as Any[]).map((_,k)=>f.counts?.[k]??{army:0,alive:true})
    const most=Math.max(1,...counts.map((c:Any)=>c.army))
    const rowH=Math.min(18,56/Math.max(1,counts.length)+4),top=y+Math.round(px*0.55)
    counts.forEach((c:Any,k:number)=>{
      const ry=top+k*rowH,col=c.alive?s.seats[k].color:"#5d6b70"
      g.fillStyle=col;g.beginPath();g.arc(bx+5,ry+rowH/2,4,0,Math.PI*2);g.fill()
      roundRect(bx+16,ry+rowH/2-4,bw-70,8,4,"rgba(255,255,255,0.06)")
      if(c.army>0)roundRect(bx+16,ry+rowH/2-4,Math.max(8,(bw-70)*c.army/most),8,4,col)
      text(c.alive?String(c.army):"出局",bx+bw,ry+rowH/2+5,13,c.alive?C.text:C.muted,{bold:true,align:"right"})
    })
  }
  function dataHeading(label:string,x:number,y:number,width:number):void {
    g.save();g.fillStyle=C.accent
    g.fillRect(x,y-9,3,9);g.fillRect(x+5,y-12,3,12)
    text(label,x+17,y,13,C.text,{bold:true})
    g.font=font(13,true);const end=x+24+g.measureText(label).width
    if(end<x+width){g.strokeStyle=C.line;g.beginPath();g.moveTo(end,y-5);g.lineTo(x+width,y-5);g.stroke()}
    g.restore()
  }
  function progressRail(x:number,y:number,width:number,progress:number):void {
    g.save();g.fillStyle="#213c5e";g.fillRect(x,y,width,4)
    const length=width*Math.max(0,Math.min(1,progress||0)),fill=g.createLinearGradient(x,y,x+width,y)
    fill.addColorStop(0,"#3875f5");fill.addColorStop(1,C.accent)
    g.fillStyle=fill;g.fillRect(x,y,length,4)
    g.fillStyle=C.accent;g.fillRect(x+length-1,y-2,2,8)
    g.strokeStyle="#395d81";g.lineWidth=1
    for(let k=0;k<=10;k++){g.beginPath();g.moveTo(x+k*width/10,y+8);g.lineTo(x+k*width/10,y+11);g.stroke()}
    g.restore()
  }
  function metricIcon(kind:string,x:number,y:number,color:string):void {
    g.save();g.translate(x,y);g.strokeStyle=color;g.lineWidth=1.2;g.lineJoin="round"
    g.beginPath()
    if(kind==="army") {g.moveTo(0,-7);g.lineTo(5,-5);g.lineTo(5,0);g.quadraticCurveTo(4,4,0,7);g.quadraticCurveTo(-4,4,-5,0);g.lineTo(-5,-5);g.closePath();g.moveTo(0,-3);g.lineTo(0,3)}
    else if(kind==="workers"){g.arc(0,-4,3,0,Math.PI*2);g.moveTo(-5,7);g.lineTo(-5,4);g.quadraticCurveTo(0,-2,5,4);g.lineTo(5,7)}
    else{g.moveTo(-5,7);g.lineTo(-5,-2);g.lineTo(0,-6);g.lineTo(5,-2);g.lineTo(5,7);g.closePath();g.moveTo(-2,7);g.lineTo(-2,2);g.lineTo(2,2);g.lineTo(2,7)}
    g.stroke();g.restore()
  }
  function drawBrand(x:number,y:number,width:number):void {
    if(!brandImage)throw new Error("Logo must be loaded with __brand before rendering")
    g.drawImage(brandImage,x,y,width,width*brandImage.naturalHeight/brandImage.naturalWidth)
  }
  function broadcastBrand(x:number,y:number):void {
    drawBrand(x,y-20,160)
  }
  function teamCard(st:Any,c:Any,x:number,y:number,width:number,height:number,seat:number):void {
    broadcastCard(x,y,width,height,st.color+"70")
    g.save();const tint=g.createLinearGradient(x,y,x+width,y+height)
    tint.addColorStop(0,st.color+"22");tint.addColorStop(1,st.color+"00");g.fillStyle=tint;g.fillRect(x+2,y+2,width-14,height-4)
    g.fillStyle=st.color;g.fillRect(x+1,y+13,3,height-26);g.fillRect(x+width-66,y,48,3);g.restore()
    if(height<60) {
      fitLines(st.name,x+16,y+height/2+5,15,11,width-112,1,st.color,{bold:true})
      text(String(c.score),x+width-16,y+height/2+7,22,C.text,{bold:true,align:"right",mono:true})
      return
    }
    const short=height<86, avatar=short?15:21
    avatarCircle(st.avatar,st.name,st.color,x+18+avatar,y+18+avatar,avatar)
    fitLines(st.name,x+28+avatar*2,y+27,short?15:19,12,width-avatar*2-104,1,st.color,{bold:true})
    // 矮卡片（不到 76 高，D-248：横屏 2v2 带胜率折线时）把座位和部队、农民、建筑并成一行，不然两行叠在一起
    const seatText=c.alive?`P${seat} · 场上`:`P${seat} · 已出局`
    if(short&&height<76) fitLines(`${seatText}　部队 ${c.army} / 农民 ${c.workers} / 建筑 ${c.buildings}`,x+28+avatar*2,y+45,11,9,width-avatar*2-44,1,C.muted)
    else text(seatText,x+28+avatar*2,y+45,10,C.muted)
    text(String(c.score),x+width-16,y+(short?28:32),short?23:30,C.text,{bold:true,align:"right",mono:true})
    text("得分",x+width-16,y+(short?44:49),10,C.muted,{align:"right"})
    if(short) {
      if(height>=76)text(`部队 ${c.army}  /  农民 ${c.workers}  /  建筑 ${c.buildings}`,x+16,y+height-12,12,C.muted)
    } else {
      const cw=(width-32)/3
      for(const [j,key,label] of [[0,"army","作战部队"],[1,"workers","农民"],[2,"buildings","建筑"]] as const) {
        const dx=x+16+cw*j
        roundRect(dx-2,y+height-48,cw-6,40,3,"#16284499","#29456566")
        fitLines(String(c[key]),dx+6,y+height-28,21,12,cw-29,1,C.text,{bold:true})
        text(label,dx+6,y+height-14,9,C.muted)
        metricIcon(key,dx+cw-20,y+height-34,st.color)
      }
    }
  }
  /** 小地图：地形、每个单位和建筑一个色块，金框是放大的画面拍到的范围 [左, 上, 右, 下]（格） */
  function miniMap(s:Any,f:Any,x0:number,y0:number,mt:number,view:number[]):void {
    if(terrainLayer)g.drawImage(terrainLayer,x0,y0,s.width*mt,s.height*mt)
    const entities=f.ents??[]
    for(let k=0;k<entities.length;k+=8) {
      const [x,y,w,h,owner,ti]=entities.slice(k,k+6),type=s.types[ti]
      if(type.kind==="resource")continue
      g.fillStyle=owner>=0?(s.seats[owner]?.color??"#ccc"):"#ada48a"
      g.fillRect(x0+x*mt,y0+y*mt,Math.max(2,w*mt),Math.max(2,h*mt))
    }
    const left=Math.max(0,view[0]),right=Math.min(s.width,view[2]),upper=Math.max(0,view[1]),lower=Math.min(s.height,view[3])
    g.strokeStyle=C.accent;g.lineWidth=1.5;g.strokeRect(x0+left*mt,y0+upper*mt,(right-left)*mt,(lower-upper)*mt)
  }
  function fieldFrame(x:number,y:number,width:number,height:number):void {
    g.save();g.strokeStyle="#365b7e";g.lineWidth=1;g.strokeRect(x-.5,y-.5,width+1,height+1)
    g.strokeStyle=C.accent;g.lineWidth=2;g.globalAlpha=.85
    for(const dx of [0,width])for(const dy of [0,height]){const sx=dx? -1:1,sy=dy? -1:1;g.beginPath();g.moveTo(x+dx,y+dy+sy*21);g.lineTo(x+dx,y+dy);g.lineTo(x+dx+sx*21,y+dy);g.stroke()}
    g.globalAlpha=.4;g.lineWidth=1
    for(let k=-2;k<=2;k++){const xx=x+width/2+k*7;g.beginPath();g.moveTo(xx,y-3);g.lineTo(xx+2,y-6);g.stroke()}
    g.restore()
  }

  function replay(s: Any, f: Any, i: number): void {
    background()
    broadcastBrand(24,33)
    fitLines(s.kicker??"精彩对局 "+s.no,190,24,12,10,W-220,1,C.accent,{bold:true})
    fitLines(s.title,190,49,23,16,W-220,1,C.text,{bold:true})
    if(s.commentary)fitLines(s.commentary,190,71,14,11,W-220,1,C.muted)
    const baseTile=TILE,mapW=s.width*TILE,mapH=s.height*TILE
    broadcastCard(MX-7,MY-7,mapW+14,mapH+14)
    // 交战时放大主要战团（D-236，和竖屏同一条镜头轨迹）：右上角小地图标出拍到的范围
    const camera=(!f.final&&f.camera)||{x:s.width/2,y:s.height/2,zoom:1}
    TILE=baseTile*camera.zoom
    const viewW=mapW/TILE,viewH=mapH/TILE
    const cx=viewW>=s.width?s.width/2:Math.max(viewW/2,Math.min(s.width-viewW/2,camera.x))
    const cy=viewH>=s.height?s.height/2:Math.max(viewH/2,Math.min(s.height-viewH/2,camera.y))
    g.save();g.beginPath();g.rect(MX,MY,mapW,mapH);g.clip()
    drawField(s,f,MX+mapW/2-cx*TILE,MY+mapH/2-cy*TILE,i)
    g.restore()
    TILE=baseTile
    // 多处同时开打（D-242）：右上角的小地图换成另一处战场的小窗，小地图淡出
    const pip=!f.final?camera.pip:null,pa=pip?.alpha??0
    if(camera.zoom>1.02&&pa<1) {
      const iw=Math.min(190,mapW*.24),mt=iw/s.width,ih=s.height*mt,ix=camera.left?MX+10:MX+mapW-iw-10,iy=camera.bottom?MY+mapH-ih-10:MY+10
      g.save();g.globalAlpha=Math.min(1,(camera.zoom-1)/.4)*(1-pa)
      roundRect(ix-5,iy-5,iw+10,ih+10,6,"rgba(11,18,25,.86)",C.line)
      miniMap(s,f,ix,iy,mt,[cx-viewW/2,cy-viewH/2,cx+viewW/2,cy+viewH/2])
      g.restore()
    }
    if(pip) {
      const pw=Math.min(mapW*.34,mapH*.42*s.width/s.height),ph=pw*s.height/s.width,px=camera.left?MX+10:MX+mapW-pw-10,py=camera.bottom?MY+mapH-ph-10:MY+10
      pipView(s,f,i,pip,px,py,pw,ph,pa)
      g.save();g.globalAlpha=pa;roundRect(px+6,py+6,74,20,10,"rgba(11,18,25,.82)");g.restore()
      text("另一处交战",px+43,py+20,11,C.accent,{bold:true,align:"center",alpha:pa})
    }
    fieldFrame(MX,MY,mapW,mapH)
    const x0=MX+mapW+24,pw=W-x0-24,bottom=Math.max(MY+mapH,H-68)
    // 分队时（D-248）：同队的挨着放，每队上面一行小字「队1」；有胜率折线时卡片先让出它的位置（2v2 四张卡片也放得下）
    const groups=teamGroups(s.seats)
    const grouped=groups.some((gr)=>gr.length>1)
    const rest=116+(s.win?116:0)+(grouped?groups.length*16:0)
    const ch=Math.max(40,Math.min(112,(bottom-MY-rest)/Math.max(1,s.seats.length)-10))
    let y=MY
    for(const gr of groups) {
      if(grouped){text(`队${(s.seats[gr[0]].team??gr[0])+1}`,x0+2,y+11,11,C.muted,{bold:true});y+=16}
      for(const k of gr){teamCard(s.seats[k],f.counts[k],x0,y,pw,ch,k);y+=ch+10}
    }
    if(s.win&&bottom-y>=174){broadcastCard(x0,y,pw,104);drawWin(s.win,f.t,x0+14,y+25,pw-28,52,13);y+=116}
    if(f.status&&bottom-y>90) {
      broadcastCard(x0,y,pw,56)
      fitLines(f.status,x0+14,y+24,14,11,pw-28,2,C.accent,{bold:true});y+=68
    }
    if(bottom-y>45) {
      broadcastCard(x0,y,pw,bottom-y)
      dataHeading("战况速递",x0+16,y+25,pw-32);y+=52
      const room=Math.max(1,Math.floor((bottom-y)/49))
      for(const ev of (f.events??[]).slice(-room)) {
        g.fillStyle=C.accent;g.beginPath();g.arc(x0+17,y-4,2.4,0,Math.PI*2);g.fill()
        y=fitLines(ev,x0+28,y,14,11,pw-44,2,C.text)+12
      }
      if(!(f.events??[]).length)fitLines("部队正在部署，等待交锋",x0+16,y,14,11,pw-32,2,C.muted)
    }
    const by=MY+mapH+23
    progressRail(MX,by,mapW,f.progress)
    const mode=f.final?"对局结束":f.pace==="quiet"?"全图 · 快进 "+f.speed+"x":"交战 · "+f.speed+"x"+(camera.zoom>1.15?" · 主战场 "+camera.zoom.toFixed(1)+"×":"")
    text(mode,MX,by-8,12,C.accent,{bold:true})
    text("第 "+f.t+" tick",MX+mapW,by-8,12,C.muted,{align:"right",mono:true})
    if(f.final) {
      // 获胜方下面写结束原因（D-256，用户：时间到按分数赢的看着莫名其妙）
      const rh=s.reason?160:114,rw=Math.min(mapW-32,s.reason?600:480),rx=MX+(mapW-rw)/2,ry=MY+mapH/2-rh/2
      broadcastCard(rx,ry,rw,rh,C.accent)
      text("对局结束",rx+rw/2,ry+30,13,C.muted,{align:"center"})
      fitLines(s.result,rx+rw/2,ry+76,30,18,rw-38,1,C.accent,{bold:true,align:"center"})
      if(s.reason)fitLines(s.reason,rx+rw/2,ry+114,17,12,rw-38,2,C.text,{align:"center",wrapFirst:true})
    }
    watermark()
  }

  /**
   * 竖屏的回放（D-181、D-182，用户：地图拉到 100% 宽度、放在画面正中）：上面是标题、解说、双方头像和兵力（左右两栏），
   * 中间放大主要交战区域；下方小地图保留全局位置，镜头轨迹按回放预先计算，预览和跳转结果一致
   */
  function vReplay(s: Any, f: Any, i: number): void {
    vBackground()
    broadcastBrand(SX,32)
    fitLines(s.kicker??"精彩对局 "+s.no,SX+SW,32,16,12,SW-210,1,C.accent,{bold:true,align:"right"})
    // 阵营卡片两家一行；三四家排两行、卡片变矮，标题和解说跟着缩小（D-243，用户：竖屏顶部也显示全部阵营卡片）
    // 分队时（D-248）每队从新的一行开始，每行左边一个窄标签「队 1」
    const seats=s.seats as Any[],groups=teamGroups(seats),grouped=groups.some((gr)=>gr.length>1),gap=12
    const lines=grouped?groups.flatMap((gr)=>Array.from({length:Math.ceil(gr.length/2)},(_,r)=>({team:seats[gr[0]].team??gr[0],ks:gr.slice(r*2,r*2+2),first:r===0}))):Array.from({length:Math.ceil(seats.length/2)},(_,r)=>({team:-1,ks:[r*2,r*2+1].filter((k)=>k<seats.length),first:false}))
    const rows=lines.length,labelW=grouped?26:0,colW=(SW-labelW-(grouped?6:0)-gap)/2,cx0=SX+labelW+(grouped?6:0)
    const teamH=rows<=1?116:rows===2?80:Math.max(44,(170-(rows-1)*8)/rows)
    lines.forEach((ln,r)=>{
      const ry=72+r*(teamH+8)
      if(grouped){roundRect(SX,ry,labelW,teamH,6,"rgba(255,255,255,0.05)",C.line);if(ln.first){text("队",SX+labelW/2,ry+teamH/2-3,13,C.muted,{bold:true,align:"center"});text(String(ln.team+1),SX+labelW/2,ry+teamH/2+14,15,C.text,{bold:true,align:"center"})}}
      ln.ks.forEach((k,j)=>teamCard(seats[k],f.counts?.[k]??{army:0,workers:0,buildings:0,score:0,alive:true},cx0+j*(colW+gap),ry,colW,teamH,k))
    })
    const top = 72 + rows*teamH + (rows-1)*8 + 15, many = rows > 1
    const title = layoutLines(s.title, many ? 26 : 34, many ? 19 : 25, SW, 2, true)
    const note = s.commentary ? layoutLines(s.commentary, many ? 17 : 22, many ? 13 : 17, SW, 2, false) : null
    let y = top
    for(const l of title.lines) { y += title.size * 1.23; text(l,VW/2,y,title.size,C.text,{bold:true,align:"center"}) }
    if(note) { y += 8; for(const l of note.lines) { y += note.size * 1.3; text(l,VW/2,y,note.size,C.muted,{align:"center"}) } }
    const oy = y + 42, viewH = Math.max(360, Math.min(550, 880 - oy))
    const camera = (!f.final && f.camera) || { x:s.width/2, y:s.height/2, zoom:1 }
    const baseTile = Math.min(SW / s.width, viewH / s.height)
    TILE = baseTile * camera.zoom
    const viewW = SW / TILE, viewTilesH = viewH / TILE
    const cx = viewW >= s.width ? s.width/2 : Math.max(viewW/2,Math.min(s.width-viewW/2,camera.x))
    const cy = viewTilesH >= s.height ? s.height/2 : Math.max(viewTilesH/2,Math.min(s.height-viewTilesH/2,camera.y))
    const ox = SX + SW/2 - cx*TILE, fieldY = oy + viewH/2 - cy*TILE
    text(camera.zoom>1.15?"主战场":"全局概览",SX,oy-12,17,C.accent,{bold:true})
    if(camera.zoom>1.15)text(camera.zoom.toFixed(1)+"×",SX+SW,oy-12,16,C.muted,{align:"right"})
    broadcastCard(SX-5,oy-5,SW+10,viewH+10)
    g.save();g.beginPath();g.rect(SX,oy,SW,viewH);g.clip()
    drawField(s,f,ox,fieldY,i)
    g.restore()
    fieldFrame(SX,oy,SW,viewH)
    if(f.final) {
      const rh=s.reason?150:96
      roundRect(SX+16,oy+viewH/2-rh/2,SW-32,rh,12,"rgba(11,18,25,.92)",C.accent)
      fitLines(s.result,VW/2,oy+viewH/2+(s.reason?-14:12),34,20,SW-60,1,C.accent,{bold:true,align:"center"})
      if(s.reason)fitLines(s.reason,VW/2,oy+viewH/2+26,20,13,SW-60,2,C.text,{align:"center",wrapFirst:true})
    }
    const by = oy + viewH + 34
    progressRail(SX,by,SW,f.progress??0)
    text("第 "+(f.t??0)+" tick",SX+SW,by-10,17,C.muted,{align:"right"})
    if(!f.final)text(f.pace==="quiet"?"▸▸ 快进 "+f.speed+"x":"▶ 交战 "+f.speed+"x",SX,by-10,17,f.pace==="quiet"?C.accent:C.text,{bold:true})

    // The overview stays visible while the large window follows a battle; the gold rectangle locates it.
    const my=by+30, miniW=210, miniH=Math.min(150,miniW*s.height/s.width), panelW=238
    const mt=Math.min(miniW/s.width,miniH/s.height),mw=s.width*mt,mh=s.height*mt, mapX=SX+14,mapY=my+43
    const cardH=Math.max(190,mh+57)
    broadcastCard(SX,my,panelW,cardH)
    // 多处同时开打（D-242）：卡片里的小地图换成另一处战场的小窗
    const pip=!f.final?camera.pip:null,pa=pip?.alpha??0
    dataHeading(pa>.5?"另一处交战":"全局位置",SX+14,my+25,panelW-28)
    if(pa<1){g.save();g.globalAlpha=1-pa;miniMap(s,f,mapX,mapY,mt,[cx-viewW/2,cy-viewTilesH/2,cx+viewW/2,cy+viewTilesH/2]);g.restore()}
    if(pip)pipView(s,f,i,pip,mapX,mapY,panelW-28,cardH-57,pa)
    const tx=SX+panelW+14,tw=SW-panelW-14
    broadcastCard(tx,my,tw,cardH)
    dataHeading("战况速递",tx+16,my+25,tw-32)
    let ey=my+54
    for(const event of (f.events??[]).slice(-2)) {
      g.fillStyle=C.accent;g.beginPath();g.arc(tx+17,ey-5,2.5,0,Math.PI*2);g.fill()
      ey=fitLines(event,tx+29,ey,17,14,tw-45,2,C.text)+14
    }
    if(!(f.events??[]).length)fitLines(f.status||"部队正在部署，等待交锋",tx+16,ey,18,14,tw-32,3,C.muted)
    if(s.win)drawWin(s.win,f.t??0,SX,my+cardH+30,SW,50,16)
    else if(s.seats.length>2)drawForces(s,f,SX,my+cardH+30,SW,16)

  }

  /**
   * 画中画（D-242）：另一处战场按 pip 镜头画进 (x, y, w, h)。先画到离屏画布上再整体淡入淡出（地图里的特效会自己改透明度）；
   * 小窗里横着看到 地图宽 / pip.zoom 格
   */
  let pipCanvas: OffscreenCanvas | null = null
  function pipView(s: Any, f: Any, i: number, pip: Any, x: number, y: number, w: number, h: number, alpha: number): void {
    const rs = VERT ? VS : SCALE
    const pw = Math.ceil(w * rs), ph = Math.ceil(h * rs)
    if (!pipCanvas || pipCanvas.width !== pw || pipCanvas.height !== ph) pipCanvas = new OffscreenCanvas(pw, ph)
    const pg = pipCanvas.getContext("2d")!
    pg.setTransform(1, 0, 0, 1, 0, 0)
    pg.clearRect(0, 0, pw, ph)
    pg.setTransform(rs, 0, 0, rs, 0, 0)
    const outer = g, base = TILE
    g = pg
    TILE = w / (s.width / pip.zoom)
    const vw = w / TILE, vh = h / TILE
    const cx = vw >= s.width ? s.width / 2 : Math.max(vw / 2, Math.min(s.width - vw / 2, pip.x))
    const cy = vh >= s.height ? s.height / 2 : Math.max(vh / 2, Math.min(s.height - vh / 2, pip.y))
    drawField(s, f, w / 2 - cx * TILE, h / 2 - cy * TILE, i)
    g = outer
    TILE = base
    g.save()
    g.globalAlpha = alpha
    roundRect(x - 4, y - 4, w + 8, h + 8, 6, "rgba(11,18,25,.92)", C.accent)
    g.drawImage(pipCanvas, x, y, w, h)
    g.restore()
  }

  /** 对阵格子的底色：赢多输少偏绿、输多赢少偏红，越悬殊越深（D-223） */
  const cellColor = (rate: number) => {
    const t = rate - 0.5
    return t >= 0 ? `rgba(94,224,138,${(0.1 + t * 1.1).toFixed(3)})` : `rgba(255,93,93,${(0.1 - t * 1.1).toFixed(3)})`
  }
  /** 一个对阵格子：底色 + 居中的胜负 */
  function cell(c: Any, x: number, y: number, cw: number, ch: number, by: number, fs: number, a: number): void {
    g.globalAlpha = a
    roundRect(x + 2, y + 2, cw - 4, ch - 4, 6, c ? cellColor(c.rate) : "rgba(255,255,255,0.03)")
    g.globalAlpha = 1
    if (c) fitLines(c.text, x + cw / 2, by, fs, 8, cw - 6, 1, C.text, { bold: true, align: "center", alpha: a })
    else text("—", x + cw / 2, by, fs, C.muted, { align: "center", alpha: a })
  }

  /**
   * 联赛排名（D-237，片尾之前）：一行一个 bot（按名次），左边名次、名字、胜-平-负、得分率，右边是它对每个对手的胜负
   * （列也按名次，列头是名字），和联赛命令行的排行榜、对阵表一样
   */
  function standings(s: Any, i: number): void {
    background()
    const p = ease(i / 10)
    text(s.title, 60, 64, 34, C.text, { bold: true, alpha: p })
    fitLines(s.sub, 60, 98, 16, 11, W - 120, 1, C.muted, { alpha: p })
    const n = s.rows.length, left = 60, right = W - 60, top = 118
    const ch = Math.min(56, (H - top - 36) / Math.max(1, n + 1))
    const fs = Math.max(10, Math.min(20, Math.round(ch * 0.42)))
    const xName = left + fs * 2.4, xRec = xName + 170, xRate = xRec + fs * 4.6, x0 = xRate + 124
    const cw = (right - x0) / Math.max(1, n)
    const cfs = Math.max(9, Math.min(fs, Math.round(cw * 0.24)))
    const hy = top + ch * 0.62, hp = Math.max(10, fs - 3)
    for (const [label, x] of [["名次", left], ["选手", xName], ["胜-平-负", xRec], ["得分率", xRate]] as [string, number][]) text(label, x, hy, hp, C.muted, { bold: true, alpha: p })
    // 列头的名字统一一个字号：最长的名字放得下为止
    let np = hp
    while (np > 8 && s.rows.some((r: Any) => ((g.font = font(np, true)), g.measureText(r.name).width > cw - 6))) np--
    s.rows.forEach((r: Any, j: number) => fitLines(r.name, x0 + (j + 0.5) * cw, hy, np, 8, cw - 6, 1, r.ref ? C.muted : r.color, { bold: true, align: "center", alpha: p }))
    s.rows.forEach((r: Any, k: number) => {
      const y = top + (k + 1) * ch
      const a = ease((i - 4 - k * 1.2) / 8)
      const ra = a * (r.ref ? 0.62 : 1)
      g.globalAlpha = ra
      roundRect(left - 12, y + 2, x0 - left + 8, ch - 4, 6, k % 2 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.055)")
      g.fillStyle = r.color
      g.fillRect(left - 12, y + 2, 4, ch - 4)
      g.globalAlpha = 1
      const by = y + ch / 2 + fs * 0.36
      text(`#${r.rank}`, left, by, fs, r.ref ? C.muted : r.color, { bold: true, alpha: ra })
      g.font = font(Math.max(9, fs - 6))
      const tagW = r.ref ? g.measureText("陪练").width + 8 : 0
      fitLines(r.name, xName, by, fs, 9, xRec - xName - 12 - tagW, 1, r.ref ? C.text : r.color, { bold: true, alpha: ra })
      if (r.ref) {
        g.font = font(fs, true)
        const nw = Math.min(g.measureText(r.name).width, xRec - xName - 12 - tagW)
        text("陪练", xName + nw + 6, by - 1, Math.max(9, fs - 6), C.muted, { alpha: ra })
      }
      text(r.record, xRec, by, fs, C.text, { alpha: ra })
      g.globalAlpha = ra
      roundRect(xRate, y + ch / 2 - 5, 60, 10, 5, "rgba(255,255,255,0.08)")
      if (r.rate > 0) roundRect(xRate, y + ch / 2 - 5, Math.max(10, 60 * r.rate), 10, 5, r.ref ? "#8fa0bf" : r.color)
      g.globalAlpha = 1
      text(`${Math.round(r.rate * 100)}%`, xRate + 68, by, fs, C.text, { bold: true, alpha: ra })
      s.cells[k].forEach((c: Any, j: number) => cell(c, x0 + j * cw, y, cw, ch, y + ch / 2 + cfs * 0.36, cfs, a))
    })
    watermark()
  }

  /** 竖屏的联赛排名（D-237）：每行左边名次和名字、下面一行小字胜-平-负和得分率，右边对每个对手的胜负，列头是名次 */
  function vStandings(s: Any, i: number): void {
    const p = ease(i / 10)
    text(s.title, VW / 2, 110, 48, C.text, { bold: true, align: "center", alpha: p })
    const top = fitLines(s.sub, VW / 2, 158, 18, 12, SW, 3, C.muted, { align: "center", alpha: p, wrapFirst: true }) + 10
    const n = s.rows.length
    const nameW = Math.round(SW * 0.36)
    const cw = (SW - nameW) / Math.max(1, n)
    const ch = Math.min(96, (VH - top - 80) / Math.max(1, n + 1))
    const fs = Math.max(12, Math.min(26, Math.round(ch * 0.3)))
    const cfs = Math.max(10, Math.min(22, Math.round(Math.min(cw * 0.38, ch * 0.3))))
    s.rows.forEach((r: Any, j: number) => text(`#${r.rank}`, SX + nameW + (j + 0.5) * cw, top + ch * 0.62, cfs + 2, r.ref ? C.muted : r.color, { bold: true, align: "center", alpha: p }))
    s.rows.forEach((r: Any, k: number) => {
      const y = top + (k + 1) * ch
      const a = ease((i - 4 - k * 1.2) / 8)
      const ra = a * (r.ref ? 0.62 : 1)
      g.globalAlpha = ra
      roundRect(SX, y + 2, nameW - 4, ch - 4, 8, k % 2 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)")
      g.fillStyle = r.color
      g.fillRect(SX, y + 2, 5, ch - 4)
      g.globalAlpha = 1
      const x = SX + 14
      text(`#${r.rank}`, x, y + ch * 0.44, fs, r.ref ? C.muted : r.color, { bold: true, alpha: ra })
      g.font = font(fs, true)
      const xn = x + g.measureText(`#${r.rank}`).width + 8
      fitLines(r.name, xn, y + ch * 0.44, fs, 10, nameW - (xn - SX) - 10, 1, r.ref ? C.text : r.color, { bold: true, alpha: ra })
      fitLines(`${r.record} · ${Math.round(r.rate * 100)}%${r.ref ? " · 陪练" : ""}`, x, y + ch * 0.44 + fs * 1.1, Math.round(fs * 0.72), 10, nameW - 28, 1, C.muted, { alpha: ra })
      s.cells[k].forEach((c: Any, j: number) => cell(c, SX + nameW + j * cw, y, cw, ch, y + ch / 2 + cfs * 0.36, cfs, a))
    })
  }

  function brandClose(s: Any, i: number): void {
    background()
    const p = ease(i / 20)
    let y = 120
    if (s.outro) {
      g.font = font(30, true)
      for (const l of wrapBalanced(s.outro, W - 240)) {
        text(l, W / 2, y, 30, C.accent, { bold: true, align: "center", alpha: p })
        y += 44
      }
      y += 30
    }
    g.save();g.globalAlpha=p;drawBrand(W/2-220,y-8,440);g.restore()
    text("本视频由 RTS Arena 联赛视频接口自动生成", W / 2, y + 130, 28, C.text, { align: "center", alpha: ease((i - 10) / 20) })
    text(REPO, W / 2, y + 172, 24, C.accent, { align: "center", alpha: ease((i - 15) / 20) })
    text("选手", W / 2, y + 226, 18, C.muted, { bold: true, align: "center", alpha: ease((i - 20) / 20) })
    s.credits.forEach((c: string, k: number) => text(c, W / 2, y + 258 + k * 30, 20, k === s.credits.length - 1 ? C.muted : C.text, { align: "center", alpha: ease((i - 25 - k * 5) / 20) }))
  }

  /**
   * 按标点（，；。！？、：）断行：整句一句一句往行里装，字号从 px 往下试到 minPx，行数尽量少（字号不小于 px 的 85% 时选行少的）；
   * 断不开（一句就超宽）再按字折行（竖屏片尾的总结，D-239：按字折行会把「战局」拆到两行）
   */
  function clauseLines(s: string, px: number, minPx: number, maxW: number, maxLines: number, bold: boolean): { size: number; lines: string[] } {
    const segs = s.split(/(?<=[，；。！？、：,;!?])/)
    let best: { size: number; lines: string[] } | null = null
    for (let size = px; size >= minPx; size--) {
      g.font = font(size, bold)
      const lines: string[] = []
      for (const seg of segs) {
        const last = lines.length ? lines[lines.length - 1] : null
        if (last !== null && g.measureText(last + seg).width <= maxW) lines[lines.length - 1] = last + seg
        else lines.push(seg)
      }
      if (lines.length > maxLines || lines.some((l) => g.measureText(l).width > maxW)) continue
      if (!best || (lines.length < best.lines.length && size >= px * 0.85)) best = { size, lines }
    }
    return best ?? layoutLines(s, px, minPx, maxW, maxLines, bold)
  }

  /**
   * 竖屏的片尾（D-239）：原来是把横屏片尾缩小贴进来、上面再写一遍总结、下面写「完整版看横屏长视频」，现在按竖屏重新排：
   * 总结大字、平台标志、署名、两个仓库地址各一行、选手名单，整块竖直居中
   */
  function vBrandClose(s: Any, i: number): void {
    const p = ease(i / 20)
    const outro = s.outro ? clauseLines(s.outro, 40, 26, SW - 20, 3, true) : null
    const logoW = 400, logoH = brandImage ? (logoW * brandImage.naturalHeight) / brandImage.naturalWidth : 100
    const credits = s.credits as string[]
    const repos = REPO.split(/\s+·\s+/)
    const lh = Math.min(44, (VH - 520 - (outro ? outro.lines.length * outro.size * 1.4 + 60 : 0) - logoH) / Math.max(1, credits.length))
    const total = (outro ? outro.lines.length * outro.size * 1.4 + 60 : 0) + logoH + 56 + 46 + repos.length * 38 + 50 + credits.length * lh
    let y = Math.max(90, (VH - total) / 2)
    if (outro) {
      for (const l of outro.lines) {
        y += outro.size * 1.4
        text(l, VW / 2, y - outro.size * 0.3, outro.size, C.accent, { bold: true, align: "center", alpha: p })
      }
      y += 60
    }
    g.save(); g.globalAlpha = p; drawBrand(VW / 2 - logoW / 2, y, logoW); g.restore()
    y += logoH + 56
    text("本视频由 RTS Arena 联赛视频接口自动生成", VW / 2, y, 26, C.text, { align: "center", alpha: ease((i - 10) / 20) })
    y += 46
    repos.forEach((r, k) => text(r, VW / 2, y + k * 38, 24, C.accent, { align: "center", alpha: ease((i - 15) / 20) }))
    y += repos.length * 38 + 22
    text("选手", VW / 2, y, 20, C.muted, { bold: true, align: "center", alpha: ease((i - 20) / 20) })
    credits.forEach((c, k) => {
      const last = k === credits.length - 1
      fitLines(c, VW / 2, y + (k + 1) * lh, last ? 20 : 26, 14, SW, 1, last ? C.muted : C.text, { align: "center", alpha: ease((i - 25 - k * 5) / 20) })
    })
  }

  /** 一个场景的画面（横屏） */
  function drawScene(s: Any, f: Any | null, i: number, a: number): void {
    if (s.kind === "lineup") lineup(s, a, false)
    else if (s.kind === "rules") rules(s, a)
    else if (s.kind === "player") player(s, a)
    else if (s.kind === "replay") replay(s, f ?? {}, i)
    else if (s.kind === "standings") standings(s, a)
    else if (s.kind === "brandClose") brandClose(s, a)
  }
  function draw(f: Any | null, i: number): void {
    const s = scene!
    // 页内动画按 speed 加快（淡入淡出还是按实际帧数）；视频第一段从第一帧起就是完整画面（也当封面，D-221），页内动画直接跳到放完；
    // 开场阵容本来第一帧就是完整的，只有立绘慢慢推近，不用跳
    const a = i * (s.speed ?? 1) + (s.first && s.kind !== "lineup" ? 120 : 0)
    if (!VERT) {
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0)
      g.save()
      drawScene(s, f, i, a)
      g.restore()
      fade(i, s.frames)
      g.setTransform(1, 0, 0, 1, 0, 0)
      return
    }
    // 竖屏：每种场景都直接按竖屏画（D-183、D-221、D-230、D-237；片尾 D-239）
    g.setTransform(VS, 0, 0, VS, 0, 0)
    g.save()
    vBackground()
    if (s.kind === "lineup") lineup(s, a, true)
    else if (s.kind === "replay") vReplay(s, f ?? {}, i)
    else if (s.kind === "rules") vRules(s, a)
    else if (s.kind === "player") vPlayer(s, a)
    else if (s.kind === "standings") vStandings(s, a)
    else if (s.kind === "brandClose") vBrandClose(s, a)
    g.restore()
    fade(i, s.frames)
    g.setTransform(1, 0, 0, 1, 0, 0)
  }

  // ---------- 和 Node 那边的接口 ----------
  /** 输出尺寸（16:9，宽度 / 1280 就是放大倍数） */
  w.__size = (width: number, height: number) => {
    canvas = new OffscreenCanvas(width, height)
    outG = canvas.getContext("2d")!
    terrainLayer = null
    images.forEach((im) => (im.bust = null))
    // 竖屏：高比宽大（D-179）
    VERT = height > width
    VS = width / VW
    SCALE = width / W
    g = outG
    return true
  }
  w.__init = (opts: { fps: number; bitrate: number }) => {
    fps = opts.fps
    const Muxer = w.Mp4Muxer
    muxer = new Muxer.Muxer({ target: new Muxer.ArrayBufferTarget(), video: { codec: "avc", width: canvas.width, height: canvas.height, frameRate: fps }, fastStart: "in-memory" })
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta),
      error: (e) => {
        w.__encodeError = String(e)
      },
    })
    // High 4.2：1080p 到 60 帧都够
    encoder.configure({ codec: "avc1.64002a", width: canvas.width, height: canvas.height, bitrate: opts.bitrate, framerate: fps })
    frameNo = 0
    return true
  }
  /** Load the exact SVG used by the web header before exporting any frames. */
  w.__brand = async (svg: string) => {
    const image = new Image()
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
    await image.decode()
    brandImage = image
    return true
  }
  /** 选手形象图：原图、裁好的头像（正方形）、选手页的半身像（第一次用时做） */
  w.__image = async (key: string, b64: string, crop: number[]) => {
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k)
    const img = await createImageBitmap(new Blob([buf]))
    const side = crop[2] * img.width
    const avatar = new OffscreenCanvas(256, 256)
    avatar.getContext("2d")!.drawImage(img, crop[0] * img.width - side / 2, crop[1] * img.height - side / 2, side, side, 0, 0, 256, 256)
    images.set(key, { img, avatar, bust: null })
    return true
  }
  w.__scene = async (s: Any) => {
    scene = s
    terrainLayer = null
    if (s.kind === "replay") fitTile(s)
    // 规则包自带的素材（D-233）：这一场用到的 SVG 按各家颜色先解码好，第一帧就画得出来
    const types = [...(s.types ?? []), ...(s.legend ?? []).map((it: Any) => it.art).filter(Boolean)]
    if (types.some((t: Any) => t.art)) {
      const colors = [...(s.seats ?? []).map((x: Any) => x.color), ...(s.seatColors ?? []), ...types.map((t: Any) => t.color).filter(Boolean), "#9aa0a6", "#4ea1ff"]
      await art.prepare(types, colors)
    }
    return true
  }
  /** 画并编码一批帧：items[k] 是 [场景里第几帧, 回放的局面或 null] */
  w.__frames = async (items: [number, Any | null][]) => {
    for (const [i, f] of items) {
      draw(f, i)
      let vf: VideoFrame
      try {
        vf = new VideoFrame(canvas, { timestamp: Math.round((frameNo * 1e6) / fps), duration: Math.round(1e6 / fps) })
      } catch (e) {
        // 显卡进程崩了画布就失效（Invalid source state）：多半是同时开着两个渲染抢显卡
        throw new Error(`第 ${frameNo} 帧取不到画面（${e}）：多半是显卡进程崩了，或者同时开着两个渲染抢显卡；关掉别的渲染再重跑一次`)
      }
      encoder!.encode(vf, { keyFrame: frameNo % (fps * 2) === 0 })
      vf.close()
      frameNo++
      // 编码器跟不上就等它消化（D-173：原来只让出一次，帧全堆在显卡进程里，提交内存涨到 50 GB 把系统挤崩）
      while (encoder!.encodeQueueSize > 8) {
        await new Promise((r) => {
          encoder!.addEventListener("dequeue", r, { once: true })
          setTimeout(r, 50)
        })
        if (w.__encodeError) throw new Error(w.__encodeError)
      }
    }
    if (w.__encodeError) throw new Error(w.__encodeError)
    return frameNo
  }
  /** 画一帧，返回 PNG 的 data URL（预览用，不编码） */
  const pngBase64 = async (c: OffscreenCanvas) => {
    const blob = await c.convertToBlob({ type: "image/png" })
    const buf = new Uint8Array(await blob.arrayBuffer())
    let s = ""
    for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000))
    return btoa(s)
  }
  w.__png = async (i: number, f: Any | null) => {
    draw(f, i)
    return pngBase64(canvas)
  }
  // 预览总览：每张预览缩小拼在一张图上，上面标秒数和是哪一段（大模型先看这一张，有问题再打开单张）
  const TW = 480
  const TH = 270
  const LH = 30
  let sheet: OffscreenCanvas | null = null
  let sheetCols = 4
  w.__sheetBegin = (n: number, cols: number) => {
    sheetCols = cols
    sheet = new OffscreenCanvas(cols * TW, Math.ceil(n / cols) * (TH + LH))
    const sg = sheet.getContext("2d")!
    sg.fillStyle = "#05080f"
    sg.fillRect(0, 0, sheet.width, sheet.height)
    return true
  }
  w.__sheetAdd = (k: number, label: string) => {
    const sg = sheet!.getContext("2d")!
    const x = (k % sheetCols) * TW
    const y = Math.floor(k / sheetCols) * (TH + LH)
    // 竖屏的按比例缩、居中
    const k2 = Math.min(TW / canvas.width, TH / canvas.height)
    sg.drawImage(canvas, x + (TW - canvas.width * k2) / 2, y + LH + (TH - canvas.height * k2) / 2, canvas.width * k2, canvas.height * k2)
    sg.fillStyle = "#e8edf7"
    sg.font = `bold 18px ${FONT}`
    sg.textBaseline = "middle"
    sg.fillText(label, x + 8, y + LH / 2, TW - 16)
    return true
  }
  w.__sheetPng = async () => pngBase64(sheet!)
  w.__finish = async () => {
    await encoder!.flush()
    muxer!.finalize()
    output = new Uint8Array(muxer!.target.buffer)
    return output.length
  }
  /** 取第 k 段（每段 3 MB）的 base64 */
  w.__chunk = (k: number) => {
    const part = output!.subarray(k * 3_000_000, (k + 1) * 3_000_000)
    let s = ""
    for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode(...part.subarray(j, j + 0x8000))
    return btoa(s)
  }
  /** 把编好的 MP4 用 <video> 解码，取第 sec 秒的画面（检查成品用） */
  w.__probe = async (secs: number[]) => {
    const url = URL.createObjectURL(new Blob([output! as BlobPart], { type: "video/mp4" }))
    const v = document.createElement("video")
    v.muted = true
    v.src = url
    document.body.appendChild(v)
    await new Promise<void>((ok, bad) => {
      v.onloadeddata = () => ok()
      v.onerror = () => bad(new Error("浏览器解不开生成的 MP4"))
    })
    const shots: string[] = []
    const c2 = document.createElement("canvas")
    c2.width = canvas.width
    c2.height = canvas.height
    const g2 = c2.getContext("2d")!
    for (const sec of secs) {
      // 光等 seeked 不够：解码器可能还没把这一帧交出来，截到的是上一张（D-173：第一张全白、第二张是片头）。
      // 两个都等到再截；requestVideoFrameCallback 万一不来，1 秒后也截
      await new Promise<void>((ok) => {
        let n = 0
        const done = () => {
          if (++n === 2) ok()
        }
        let framed = false
        const frame = () => {
          if (framed) return
          framed = true
          done()
        }
        v.requestVideoFrameCallback(frame)
        setTimeout(frame, 1000)
        v.onseeked = () => done()
        v.currentTime = Math.min(sec, Math.max(0, v.duration - 0.05))
      })
      g2.drawImage(v, 0, 0)
      shots.push(c2.toDataURL("image/png").split(",")[1])
    }
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, shots }
  }
}
