// 视频页面里跑的代码：画每一帧、用 WebCodecs 编成 H.264、交给 mp4-muxer 封装成 MP4。
// installVideoPage 会被 toString() 后原样注入无头浏览器，所以必须自包含：不能引用这个文件外面的任何东西。
// Node 那边每帧算好要画的东西（场景的固定内容用 __scene 送一次，回放的局面每帧用 __frames 送）

/** 一个场景的固定内容；first：视频的第一段，第一帧就是完整画面、不从黑屏淡入（D-221 起是规则介绍） */
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
    }
  | {
      kind: "rules"
      frames: number
      /** 页内动画快几倍（时长已经按它缩短） */
      speed?: number
      ruleset: string
      /** 脚本写的规则介绍（不写就是规则包的一句话简介） */
      lines: string[]
      /** 地图下面的小字："第 N 局的开局地图" */
      mapNote: string
      width: number
      height: number
      terrain: string[]
      colors: Record<string, string>
      /** [x, y, w, h, 座位(-1 中立), 类型下标] 一组 6 个 */
      ents: number[]
      markers: ({ kind: "zone"; x: number; y: number; w: number; h: number; owner: number | null; label?: string; color?: string } | { kind: "label"; x: number; y: number; text: string; owner?: number | null })[]
      types: { shape: string; label: string; color: string | null; kind: string }[]
      seatColors: string[]
      legend: { shape: string; label: string; color: string | null; kind: string; name: string; detail: string }[]
      /** 左下角的小字：1 秒 = 多少 tick */
      tickNote: string
    }
  /**
   * 排名页（D-221）：所有 bot 的名次、胜-平-负、得分率、等级分，和每局平均的对局数据（columns 是表头，cells 和它一一对应）；
   * ref 是平台自带的参考 bot（陪练），画得灰一些、名字后面标「陪练」
   */
  | {
      kind: "standings"
      frames: number
      speed?: number
      title: string
      sub: string
      columns: string[]
      rows: { name: string; color: string; rank: number; record: string; rate: number; elo: number; ref: boolean; cells: string[] }[]
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
      types: { name: string; kind: string; shape: string; label: string; color: string | null; worker: boolean; base: boolean }[]
      /** 每个座位的名字和颜色；avatar 是形象图的名字（没有就 null） */
      seats: { name: string; color: string; avatar?: string | null }[]
      result: string
      /** 实时胜率：curve 是每 step tick 一个点的、sides[0] 那方赢的概率；不是两方对打或没有模型时 null（D-177） */
      win: { step: number; ticks: number; curve: number[]; sides: { name: string; color: string }[] } | null
    }
  /**
   * 对战胜负页（D-223）：行、列都按名次排，cells[行][列] 是行对列的胜负（text 是「胜-负」或「胜-平-负」，rate 是胜率，对角线是 null）；
   * note 是下面一句克制关系
   */
  | {
      kind: "matrix"
      frames: number
      speed?: number
      title: string
      sub: string
      players: { name: string; color: string; rank: number; ref: boolean }[]
      cells: ({ text: string; rate: number } | null)[][]
      note: string
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
  /** 刚死的：[x, y, 第几帧前死的] 一组 3 个 */
  deaths: number[]
  /** 每个座位：兵、工人、建筑、分数（歼灭是击杀价值、夺点是控制分……看规则包） */
  counts: { army: number; workers: number; buildings: number; score: number; alive: boolean }[]
  events: string[]
  progress: number
  /** 最后定格时显示结果 */
  final: boolean
  /** 这段怎么放：battle 大战 2 倍速、skirmish 小冲突 4 倍速、quiet 没动静快进 */
  pace: "battle" | "skirmish" | "quiet"
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
  /** 技能冷却环：[x, y, w, h, 冷却好了的比例（1 是能放了）] 一组 5 个 */
  cds?: number[]
  /** 正在回血的：[x, y, w, h] 一组 4 个 */
  healing?: number[]
}

export function installVideoPage(): void {
  // 画面按 1280×720 排版，输出时整体放大（1920×1080 是 1.5 倍）；文字和图形都是矢量画的，放大不糊
  const W = 1280
  const H = 720
  let SCALE = 1.5
  const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif'
  const MONO = 'Consolas, "Cascadia Mono", "Microsoft YaHei", monospace'
  /** 平台的远程仓库：gitee 和 GitHub（片头下方、片尾署名里） */
  const REPO = "gitee.com/mingomin/rts-arena  ·  github.com/Clark760/RTS-ARENA"
  const C = { bg1: "#0b1220", bg2: "#14203a", text: "#e8edf7", muted: "#8fa0bf", accent: "#f5b942", line: "#26344f", panel: "rgba(16,26,46,0.92)" }
  let canvas = new OffscreenCanvas(W * SCALE, H * SCALE)
  let g = canvas.getContext("2d")!
  /** 输出画布的画笔（横屏时就是 g） */
  let outG = g
  /** 竖屏（D-179）：逻辑尺寸 720×1280，场景先按横屏画到 landCanvas 再拼进来 */
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
  let landCanvas: OffscreenCanvas | null = null
  let landG: OffscreenCanvasRenderingContext2D | null = null
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
    const grad = g.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, C.bg1)
    grad.addColorStop(1, C.bg2)
    g.fillStyle = grad
    g.fillRect(0, 0, W, H)
    // 淡淡的格子，像地图
    g.strokeStyle = "rgba(255,255,255,0.035)"
    g.lineWidth = 1
    for (let x = 0; x <= W; x += 32) {
      g.beginPath()
      g.moveTo(x + 0.5, 0)
      g.lineTo(x + 0.5, H)
      g.stroke()
    }
    for (let y = 0; y <= H; y += 32) {
      g.beginPath()
      g.moveTo(0, y + 0.5)
      g.lineTo(W, y + 0.5)
      g.stroke()
    }
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
    text("RTS Arena", W - 24, H - 18, 16, "rgba(232,237,247,0.45)", { bold: true, align: "right" })
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
    text(`选手 ${s.rank <= s.total ? `· 联赛第 ${s.rank} 名` : ""}`, 70, 92, 24, s.color, { bold: true, alpha: p })
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
    const x0 = 820
    const a2 = ease((i - 14) / 20)
    g.globalAlpha = a2
    roundRect(x0, 70, 400, 380, 12, bust ? "rgba(10,15,26,0.62)" : "#0a0f1a", C.line)
    g.globalAlpha = 1
    if (s.radar) {
      text("能力雷达（这场联赛的对局数据）", x0 + 18, 98, 15, C.muted, { bold: true, alpha: a2 })
      radar(s.radar, x0 + 200, 272, 108, s.color, ease((i - 16) / 24))
    } else {
      text(s.name + ".ts", x0 + 18, 100, 16, C.muted, { mono: true, alpha: a2 })
      // 文件开头的 12 行：注释绿色、代码灰色
      s.codeHeader.slice(0, 12).forEach((l: string, k: number) => {
        g.font = font(15, false, true)
        let shown = l
        while (shown && g.measureText(shown).width > 364) shown = shown.slice(0, -1)
        const isComment = /^\s*(\/\/|\/\*|\*)/.test(l)
        text(shown + (shown.length < l.length ? "…" : ""), x0 + 18, 132 + k * 24, 15, isComment ? "#7fb37a" : "#c9d3e6", { mono: true, alpha: a2 })
      })
    }
    g.globalAlpha = a2
    roundRect(x0, 470, 400, 200, 12, bust ? "rgba(16,26,46,0.78)" : C.panel, C.line)
    g.globalAlpha = 1
    text("代码", x0 + 20, 504, 18, C.muted, { bold: true, alpha: a2 })
    s.facts.forEach((f: string, k: number) => text(f, x0 + 20, 532 + k * 26, 18, C.text, { alpha: a2 }))
    s.record.forEach((r: string, k: number) => text(r, x0 + 20, 622 + k * 26, 19, s.color, { bold: true, alpha: a2 }))
    watermark()
  }

  /** 画一个单位、建筑或资源点的形状（和回放一样的几种） */
  function shapeAt(shape: string, x: number, y: number, w: number, h: number, color: string): void {
    const cx = x + w / 2
    const cy = y + h / 2
    const r = Math.min(w, h) / 2
    g.fillStyle = color
    g.strokeStyle = "rgba(0,0,0,0.6)"
    g.lineWidth = 1
    g.beginPath()
    if (shape === "square") g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 2)
    else if (shape === "triangle") {
      g.moveTo(cx, y)
      g.lineTo(x + w, y + h)
      g.lineTo(x, y + h)
      g.closePath()
    } else if (shape === "diamond") {
      g.moveTo(cx, y)
      g.lineTo(x + w, cy)
      g.lineTo(cx, y + h)
      g.lineTo(x, cy)
      g.closePath()
    } else if (shape === "hex")
      for (let a = 0; a < 6; a++) {
        const ang = (Math.PI / 3) * a + Math.PI / 6
        if (a === 0) g.moveTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang))
        else g.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang))
      }
    else g.arc(cx, cy, r, 0, Math.PI * 2)
    g.closePath()
    g.fill()
    g.stroke()
  }

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
    // 右边：开局地图和单位图例
    rulesMap(s, i, 700, 92, 540, 330, 686)
    watermark()
  }

  /** 规则页的开局地图、说明小字和单位图例（D-183 抽出来，横竖屏共用）：地图放进 (x0, y0) 起 boxW×boxH 的框，图例排在地图下面、不超过 bottom */
  function rulesMap(s: Any, i: number, x0: number, y0: number, boxW: number, boxH: number, bottom: number): void {
    const a2 = ease((i - 8) / 18)
    const tile = Math.min(boxW / s.width, boxH / s.height)
    const mx = x0 + (boxW - s.width * tile) / 2
    const my = y0
    g.globalAlpha = a2
    for (let yy = 0; yy < s.height; yy++)
      for (let xx = 0; xx < s.width; xx++) {
        g.fillStyle = s.colors[s.terrain[yy][xx]] ?? "#333"
        g.fillRect(mx + xx * tile, my + yy * tile, tile + 0.3, tile + 0.3)
      }
    const seatColor = (o: number) => (o >= 0 ? (s.seatColors[o] ?? "#ccc") : "#9aa0a6")
    for (const m of s.markers as Any[]) {
      if (m.kind !== "zone") continue
      const col = m.color ?? (m.owner === null || m.owner === undefined || m.owner < 0 ? "#c8ccd4" : seatColor(m.owner))
      g.fillStyle = col
      g.globalAlpha = a2 * 0.3
      g.fillRect(mx + m.x * tile, my + m.y * tile, m.w * tile, m.h * tile)
      g.globalAlpha = a2
      g.strokeStyle = col
      g.lineWidth = 1.5
      g.setLineDash([4, 3])
      g.strokeRect(mx + m.x * tile, my + m.y * tile, m.w * tile, m.h * tile)
      g.setLineDash([])
      if (m.label) text(m.label, mx + m.x * tile, my + m.y * tile - 4, 12, col, { bold: true, alpha: a2 })
    }
    const e = s.ents as number[]
    for (let k = 0; k < e.length; k += 6) {
      const [x, yy, w, h, o, ti] = e.slice(k, k + 6)
      const ty = s.types[ti]
      g.globalAlpha = a2
      shapeAt(ty.shape, mx + x * tile, my + yy * tile, w * tile, h * tile, ty.color ?? seatColor(o))
    }
    g.globalAlpha = 1
    text(s.mapNote, mx, my + s.height * tile + 24, 15, C.muted, { alpha: a2 })
    // 地图下面：单位图例（形状、字、名字、造价和数值）
    // 排一栏放得下（不超过 bottom）就排一栏，否则排两栏；说明超出栏宽就截断
    const ly = my + s.height * tile + 58
    const cols = ly + (s.legend.length - 1) * 34 <= bottom ? 1 : 2
    const colW = (s.width * tile) / cols
    s.legend.forEach((it: Any, k: number) => {
      const col = k % cols
      const lx = mx + col * colW
      const yy = ly + Math.floor(k / cols) * 34
      const a = ease((i - 20 - k * 3) / 12)
      g.globalAlpha = a
      shapeAt(it.shape, lx, yy - 18, 22, 22, it.color ?? (it.kind === "resource" ? "#e0b53a" : s.seatColors[0] ?? "#4ea1ff"))
      g.globalAlpha = 1
      if (it.label) {
        g.font = font(12, true)
        g.textAlign = "center"
        g.fillStyle = "#fff"
        g.globalAlpha = a
        g.fillText(it.label, lx + 11, yy - 3)
        g.globalAlpha = 1
        g.textAlign = "left"
      }
      text(it.name, lx + 32, yy - 1, 18, C.text, { bold: true, alpha: a })
      g.font = font(18, true)
      const nw = g.measureText(it.name).width
      g.font = font(14)
      let detail = it.detail as string
      while (detail && 40 + nw + g.measureText(detail).width > colW - 12) detail = detail.slice(0, -1)
      text(detail + (detail.length < it.detail.length ? "…" : ""), lx + 40 + nw, yy - 1, 14, C.muted, { alpha: a })
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

  /** 竖屏的规则页（D-183）：上面是标题和规则几句，下面是拉满宽度的开局地图和单位图例 */
  function vRules(s: Any, i: number): void {
    const p = ease(i / 15)
    text("规则", SX, 90, 26, C.accent, { bold: true, alpha: p })
    fitLines(`${s.ruleset}怎么玩`, SX, 156, 48, 28, SW, 1, C.text, { bold: true })
    // 规则最多占到 560 高，字多就缩字号
    const y = vBullets(s.lines, SX + 22, 196, SW - 22, 360, 28, 20, C.accent, i)
    // 地图在下面拉满宽度；高度给图例（按两栏算）和最下面的 tick 说明留出地方
    const y0 = Math.max(y + 16, 400)
    const legendH = 58 + Math.ceil(s.legend.length / 2) * 34
    rulesMap(s, i, SX, y0, SW, Math.min(520, VH - 150 - y0 - legendH), VH - 140)
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
    text(`选手 · 联赛第 ${s.rank} 名`, SX, 80, 24, s.color, { bold: true, alpha: p })
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
      roundRect(SX, y, SW, 400, 14, "rgba(10,15,26,0.6)", C.line)
      g.globalAlpha = 1
      g.save()
      g.translate(VW / 2, y + 200)
      g.scale(1.2, 1.2)
      radar(s.radar, 0, 0, 110, s.color, ease((i - 16) / 24))
      g.restore()
      y += 414
    }
    vBullets(s.intro, SX + 22, y, SW - 22, VH - 96 - y, 26, 18, s.color, i - 8)
    if (s.record?.length) fitLines(s.record.join(" · "), VW / 2, VH - 40, 24, 14, SW, 1, s.color, { bold: true, align: "center" })
  }

  /** 排名页（D-221，用户：规则之后加排名页，列出所有选手的排名和各种对局数据）：一行一个 bot，陪练灰一些 */
  function standings(s: Any, i: number): void {
    background()
    const p = ease(i / 10)
    text(s.title, 60, 64, 34, C.text, { bold: true, alpha: p })
    fitLines(s.sub, 60, 98, 16, 11, W - 120, 1, C.muted, { alpha: p })
    const n = s.rows.length
    const top = 128
    const rh = Math.min(52, (H - top - 30) / Math.max(1, n + 1))
    const fs = Math.max(11, Math.min(20, Math.round(rh * 0.46)))
    const left = 60
    const right = W - 60
    // 列：名次、名字、胜-平-负、得分率（条 + 百分比）、等级分，后面是数据列（右对齐，平分剩下的宽度）
    const xName = left + fs * 2.4
    const xRec = xName + 190
    const xRate = xRec + fs * 5.8
    const xElo = xRate + 124
    const x0 = xElo + fs * 3.4
    const cw = (right - x0) / Math.max(1, s.columns.length)
    const hy = top + rh * 0.62
    const hp = Math.max(10, fs - 3)
    for (const [label, x, align] of [["名次", left, "left"], ["选手", xName, "left"], ["胜-平-负", xRec, "left"], ["得分率", xRate, "left"], ["等级分", xElo + fs * 2.6, "right"]] as [string, number, CanvasTextAlign][])
      text(label, x, hy, hp, C.muted, { bold: true, align, alpha: p })
    s.columns.forEach((c: string, k: number) => fitLines(c, x0 + (k + 1) * cw - 4, hy, hp, 9, cw - 6, 1, C.muted, { bold: true, align: "right", alpha: p }))
    s.rows.forEach((r: Any, k: number) => {
      const y = top + (k + 1) * rh
      const a = ease((i - 4 - k * 1.2) / 8) * (r.ref ? 0.62 : 1)
      g.globalAlpha = a
      roundRect(left - 12, y + 2, right - left + 24, rh - 4, 6, k % 2 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.055)")
      g.fillStyle = r.color
      g.fillRect(left - 12, y + 2, 4, rh - 4)
      g.globalAlpha = 1
      const by = y + rh / 2 + fs * 0.36
      text(`#${r.rank}`, left, by, fs, r.ref ? C.muted : r.color, { bold: true, alpha: a })
      g.font = font(Math.max(9, fs - 6))
      const tagW = r.ref ? g.measureText("陪练").width + 8 : 0
      fitLines(r.name, xName, by, fs, 9, xRec - xName - 12 - tagW, 1, r.ref ? C.text : r.color, { bold: true, alpha: a })
      if (r.ref) {
        g.font = font(fs, true)
        const nw = Math.min(g.measureText(r.name).width, xRec - xName - 12 - tagW)
        text("陪练", xName + nw + 6, by - 1, Math.max(9, fs - 6), C.muted, { alpha: a })
      }
      text(r.record, xRec, by, fs, C.text, { alpha: a })
      g.globalAlpha = a
      roundRect(xRate, y + rh / 2 - 5, 70, 10, 5, "rgba(255,255,255,0.08)")
      if (r.rate > 0) roundRect(xRate, y + rh / 2 - 5, Math.max(10, 70 * r.rate), 10, 5, r.ref ? "#8fa0bf" : r.color)
      g.globalAlpha = 1
      text(`${Math.round(r.rate * 100)}%`, xRate + 78, by, fs, C.text, { bold: true, alpha: a })
      text(String(r.elo), xElo + fs * 2.6, by, fs, C.text, { align: "right", alpha: a })
      r.cells.forEach((c: string, j: number) => text(c, x0 + (j + 1) * cw - 4, by, fs, C.text, { align: "right", alpha: a }))
    })
    watermark()
  }

  /** 竖屏的排名页（D-221）：一行一个 bot，只有名次、名字、胜-平-负和得分率（D-223 试过人少时加详细数据，超出框，D-224 去掉，数据只在横屏版里） */
  function vStandings(s: Any, i: number): void {
    const p = ease(i / 10)
    text("RTS Arena", VW / 2, 56, 22, C.accent, { bold: true, align: "center", alpha: p })
    text(s.title, VW / 2, 122, 48, C.text, { bold: true, align: "center", alpha: p })
    const top = 150 + (s.rows.some((r: Any) => r.ref) ? fitLines("灰色的是平台自带的陪练", VW / 2, 182, 18, 12, SW, 1, C.muted, { align: "center", alpha: p }) - 150 : 20)
    const n = s.rows.length
    const rh = Math.min(96, (VH - 60 - top) / Math.max(1, n))
    const f1 = Math.max(13, Math.min(30, Math.round(rh * 0.44)))
    s.rows.forEach((r: Any, k: number) => {
      const y = top + k * rh
      const a = ease((i - 4 - k * 1.2) / 8) * (r.ref ? 0.62 : 1)
      g.globalAlpha = a
      roundRect(SX, y + 3, SW, rh - 6, 8, k % 2 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)")
      g.fillStyle = r.color
      g.fillRect(SX, y + 3, 5, rh - 6)
      g.globalAlpha = 1
      const by = y + rh / 2 + f1 * 0.36
      const xName = SX + 16 + f1 * 2.5
      text(`#${r.rank}`, SX + 16, by, f1, r.ref ? C.muted : r.color, { bold: true, alpha: a })
      // 右边：得分率（条 + 百分比），左边是胜-平-负
      const xPct = SX + SW - 12
      text(`${Math.round(r.rate * 100)}%`, xPct, by, f1, C.text, { bold: true, align: "right", alpha: a })
      g.font = font(f1, true)
      const barR = xPct - g.measureText("100%").width - 10
      g.globalAlpha = a
      roundRect(barR - 70, y + rh / 2 - 5, 70, 10, 5, "rgba(255,255,255,0.08)")
      if (r.rate > 0) roundRect(barR - 70, y + rh / 2 - 5, Math.max(10, 70 * r.rate), 10, 5, r.ref ? "#8fa0bf" : r.color)
      g.globalAlpha = 1
      g.font = font(f1 - 4)
      const recW = g.measureText(r.record).width
      text(r.record, barR - 82, by, f1 - 4, C.text, { align: "right", alpha: a })
      const nameW = barR - 82 - recW - 12 - xName
      const tagPx = Math.max(10, Math.round(f1 * 0.6))
      g.font = font(tagPx)
      const tagW = r.ref ? g.measureText("陪练").width + 8 : 0
      fitLines(r.name, xName, by, f1, 10, nameW - tagW, 1, r.ref ? C.text : r.color, { bold: true, alpha: a })
      if (r.ref) {
        g.font = font(f1, true)
        const nw = Math.min(g.measureText(r.name).width, nameW - tagW)
        text("陪练", xName + nw + 6, by - 1, tagPx, C.muted, { alpha: a })
      }
    })
  }

  /**
   * 一段话按标点（：、，；）断行、居中写，字号从 px 往下试到 minPx，放进 maxLines 行；返回最后一行下面的 y。
   * 克制关系那句里有「（25:15）」这样的比分，按字折行会把括号拆到两行（D-223）
   */
  function noteLines(s: string, x: number, y: number, px: number, minPx: number, maxW: number, maxLines: number, color: string, alpha: number): number {
    const segs = s.split(/(?<=[：、，；])/)
    for (let size = px; size >= minPx; size--) {
      g.font = font(size, true)
      const lines: string[] = []
      for (const seg of segs) {
        const last = lines.length ? lines[lines.length - 1] : null
        if (last !== null && g.measureText(last + seg).width <= maxW) lines[lines.length - 1] = last + seg
        else lines.push(seg)
      }
      if (lines.length <= maxLines && lines.every((l) => g.measureText(l).width <= maxW)) {
        lines.forEach((l, k) => text(l, x, y + k * size * 1.35, size, color, { bold: true, align: "center", alpha }))
        return y + lines.length * size * 1.35
      }
    }
    return fitLines(s, x, y, minPx, minPx, maxW, maxLines, color, { bold: true, align: "center", alpha, wrapFirst: true })
  }

  /** 对战胜负页的格子底色：赢多输少偏绿、输多赢少偏红，越悬殊越深 */
  const cellColor = (rate: number) => {
    const t = rate - 0.5
    return t >= 0 ? `rgba(94,224,138,${(0.1 + t * 1.1).toFixed(3)})` : `rgba(255,93,93,${(0.1 - t * 1.1).toFixed(3)})`
  }

  /** 对战胜负页（D-223）：两两对阵的胜负表，下面一句克制关系 */
  function matrix(s: Any, i: number): void {
    background()
    const p = ease(i / 10)
    text(s.title, 60, 64, 34, C.text, { bold: true, alpha: p })
    fitLines(s.sub, 60, 98, 16, 11, W - 120, 1, C.muted, { alpha: p })
    const n = s.players.length
    const left = 60
    const nameW = 210
    const top = 118
    const cw = (W - 60 - left - nameW) / Math.max(1, n)
    const ch = Math.min(60, (H - top - 110) / Math.max(1, n + 1))
    const fs = Math.max(10, Math.min(22, Math.round(Math.min(cw * 0.24, ch * 0.42))))
    s.players.forEach((pl: Any, j: number) =>
      fitLines(pl.name, left + nameW + (j + 0.5) * cw, top + ch * 0.62, fs, 9, cw - 8, 1, pl.ref ? C.muted : pl.color, { bold: true, align: "center", alpha: p }),
    )
    s.players.forEach((pl: Any, r: number) => {
      const y = top + (r + 1) * ch
      const a = ease((i - 4 - r * 1.2) / 8)
      const by = y + ch * 0.5 + fs * 0.36
      text(`#${pl.rank}`, left, by, fs, pl.ref ? C.muted : pl.color, { bold: true, alpha: a })
      fitLines(pl.name, left + fs * 2.6, by, fs, 9, nameW - fs * 2.6 - 10, 1, pl.ref ? C.muted : pl.color, { bold: true, alpha: a })
      s.cells[r].forEach((c: Any, j: number) => {
        const x = left + nameW + j * cw
        g.globalAlpha = a
        roundRect(x + 2, y + 2, cw - 4, ch - 4, 6, c ? cellColor(c.rate) : "rgba(255,255,255,0.03)")
        g.globalAlpha = 1
        if (c) fitLines(c.text, x + cw / 2, by, fs, 9, cw - 8, 1, C.text, { bold: true, align: "center", alpha: a })
        else text("—", x + cw / 2, by, fs, C.muted, { align: "center", alpha: a })
      })
    })
    if (s.note) noteLines(s.note, W / 2, top + (n + 1) * ch + 52, 26, 14, W - 160, 2, C.accent, ease((i - 6) / 10))
    watermark()
  }

  /** 竖屏的对战胜负页（D-223）：列头是名次（颜色和行头的名字一样），下面一句克制关系 */
  function vMatrix(s: Any, i: number): void {
    const p = ease(i / 10)
    text("RTS Arena", VW / 2, 56, 22, C.accent, { bold: true, align: "center", alpha: p })
    text(s.title, VW / 2, 122, 48, C.text, { bold: true, align: "center", alpha: p })
    const top = fitLines(s.sub, VW / 2, 176, 18, 12, SW, 2, C.muted, { align: "center", alpha: p, wrapFirst: true }) + 6
    const n = s.players.length
    const nameW = Math.round(SW * 0.27)
    const cw = (SW - nameW) / Math.max(1, n)
    const ch = Math.min(96, (VH - top - 230) / Math.max(1, n + 1))
    const fs = Math.max(11, Math.min(24, Math.round(Math.min(cw * 0.3, ch * 0.34))))
    s.players.forEach((pl: Any, j: number) => text(`#${pl.rank}`, SX + nameW + (j + 0.5) * cw, top + ch * 0.6, fs + 2, pl.ref ? C.muted : pl.color, { bold: true, align: "center", alpha: p }))
    s.players.forEach((pl: Any, r: number) => {
      const y = top + (r + 1) * ch
      const a = ease((i - 4 - r * 1.2) / 8)
      const by = y + ch * 0.5 + fs * 0.36
      text(`#${pl.rank}`, SX + 4, by, fs, pl.ref ? C.muted : pl.color, { bold: true, alpha: a })
      fitLines(pl.name, SX + 4 + fs * 2.3, by, fs, 10, nameW - fs * 2.3 - 10, 1, pl.ref ? C.muted : pl.color, { bold: true, alpha: a })
      s.cells[r].forEach((c: Any, j: number) => {
        const x = SX + nameW + j * cw
        g.globalAlpha = a
        roundRect(x + 2, y + 2, cw - 4, ch - 4, 6, c ? cellColor(c.rate) : "rgba(255,255,255,0.03)")
        g.globalAlpha = 1
        if (c) fitLines(c.text, x + cw / 2, by, fs, 9, cw - 6, 1, C.text, { bold: true, align: "center", alpha: a })
        else text("—", x + cw / 2, by, fs, C.muted, { align: "center", alpha: a })
      })
    })
    if (s.note) noteLines(s.note, VW / 2, top + (n + 1) * ch + 64, 28, 16, SW, 4, C.accent, ease((i - 6) / 10))
  }

  /** 单位图形的半径是几格（D-220：直径 1.4 格，比一格大，挨着的单位边缘叠在一起）；工人还是原来的大小（不到一格，D-221 用户） */
  const UNIT_R = 0.7
  const unitR = (ty: Any) => (ty.worker ? TILE / 2 - 1.8 : TILE * UNIT_R)
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

  /** 竖屏最下面正中的小署名（D-224，横屏在右下角；规则页最下面已经有署名和仓库地址、片尾也有，这两页不加） */
  function vWatermark(): void {
    text("RTS Arena", VW / 2, VH - 14, 18, "rgba(232,237,247,0.45)", { bold: true, align: "center" })
  }

  /** 竖屏：渐变背景 */
  function vBackground(): void {
    const gr = g.createLinearGradient(0, 0, 0, VH)
    gr.addColorStop(0, C.bg1)
    gr.addColorStop(1, C.bg2)
    g.fillStyle = gr
    g.fillRect(0, 0, VW, VH)
  }

  /**
   * 竖屏版里排名和片尾的一帧（D-179）：横屏的画面缩到中间，上面是大标题，下面放冠军头像或总结（回放另有 vReplay）。
   * 最上面一直留着平台署名
   */
  function vFrame(s: Any, f: Any, i: number): void {
    const LY = 330
    const LH = (SW * H) / W
    text("RTS Arena", VW / 2, 64, 26, C.accent, { bold: true, align: "center" })
    if (s.kind === "brandClose") fitLines(s.outro ?? "比赛和视频都由平台自动生成", VW / 2, 200, 40, 24, SW, 2, C.text, { bold: true, align: "center" })
    g.drawImage(landCanvas!, SX, LY, SW, LH)
    const y = LY + LH + 70
    if (s.kind === "brandClose") text("完整版看横屏长视频", VW / 2, y + 60, 30, C.muted, { align: "center" })
    void i
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
    // 地形按现在画布的实际放大倍数画（竖屏回放直接画在竖屏画布上）
    const rs = VERT ? VS : SCALE
    // 地图
    if (!terrainLayer) {
      // 按输出的实际像素画一次地形，之后每帧贴上去
      terrainLayer = new OffscreenCanvas(Math.ceil(s.width * TILE * rs), Math.ceil(s.height * TILE * rs))
      const t = terrainLayer.getContext("2d")!
      t.scale(rs, rs)
      for (let y = 0; y < s.height; y++)
        for (let x = 0; x < s.width; x++) {
          t.fillStyle = s.colors[s.terrain[y][x]] ?? "#333"
          t.fillRect(x * TILE, y * TILE, TILE, TILE)
        }
      t.strokeStyle = "rgba(0,0,0,0.12)"
      for (let x = 0; x <= s.width; x++) {
        t.beginPath()
        t.moveTo(x * TILE + 0.5, 0)
        t.lineTo(x * TILE + 0.5, s.height * TILE)
        t.stroke()
      }
      for (let y = 0; y <= s.height; y++) {
        t.beginPath()
        t.moveTo(0, y * TILE + 0.5)
        t.lineTo(s.width * TILE, y * TILE + 0.5)
        t.stroke()
      }
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
    const e = f.ents as number[]
    for (let k = 0; k < e.length; k += 8) {
      const [x, y, ew, eh, seat, ti, hp, bp] = e.slice(k, k + 8)
      const ty = s.types[ti]
      const px = ox + x * TILE
      const py = oy + y * TILE
      const pw = ew * TILE
      const ph = eh * TILE
      const col = ty.color ?? colorOf(seat)
      // 主基地换成选手头像（D-177），描一圈座位颜色
      const av = ty.base && seat >= 0 ? images.get(s.seats[seat]?.avatar ?? "") : undefined
      if (av) {
        g.save()
        g.beginPath()
        g.roundRect(px + 1.5, py + 1.5, pw - 3, ph - 3, 4)
        g.clip()
        g.drawImage(av.avatar, px + 1.5, py + 1.5, pw - 3, ph - 3)
        g.restore()
        g.strokeStyle = col
        g.lineWidth = 2.5
        g.beginPath()
        g.roundRect(px + 1.5, py + 1.5, pw - 3, ph - 3, 4)
        g.stroke()
        if (hp < 100) {
          g.fillStyle = "rgba(0,0,0,0.6)"
          g.fillRect(px + 1, py - 4, pw - 2, 3)
          g.fillStyle = hp > 50 ? "#5ee08a" : hp > 25 ? "#f5c542" : "#ff5d5d"
          g.fillRect(px + 1, py - 4, ((pw - 2) * hp) / 100, 3)
        }
        continue
      }
      g.globalAlpha = ty.kind === "building" ? (bp < 100 ? 0.45 : 0.85) : 1
      g.fillStyle = col
      g.strokeStyle = "rgba(0,0,0,0.6)"
      g.lineWidth = 1.2
      const cx = px + pw / 2
      const cy = py + ph / 2
      // 单位比一格大（D-220，用户：手机上看不清兵种；挨着的单位边缘叠在一起没关系），工人小一点；建筑占满自己的格子
      const r = ty.kind === "unit" ? unitR(ty) : Math.min(pw, ph) / 2 - 1.5
      const bx = ty.kind === "unit" ? cx - r : px + 1.5
      const by = ty.kind === "unit" ? cy - r : py + 1.5
      const bw = ty.kind === "unit" ? 2 * r : pw - 3
      const bh = ty.kind === "unit" ? 2 * r : ph - 3
      g.beginPath()
      if (ty.shape === "square") g.roundRect(bx, by, bw, bh, 3)
      else if (ty.shape === "triangle") {
        g.moveTo(cx, by)
        g.lineTo(bx + bw, by + bh)
        g.lineTo(bx, by + bh)
        g.closePath()
      } else if (ty.shape === "diamond") {
        g.moveTo(cx, by)
        g.lineTo(bx + bw, cy)
        g.lineTo(cx, by + bh)
        g.lineTo(bx, cy)
        g.closePath()
      } else if (ty.shape === "hex") {
        for (let a = 0; a < 6; a++) {
          const ang = (Math.PI / 3) * a + Math.PI / 6
          const hx = cx + r * Math.cos(ang)
          const hy = cy + r * Math.sin(ang)
          if (a === 0) g.moveTo(hx, hy)
          else g.lineTo(hx, hy)
        }
        g.closePath()
      } else g.arc(cx, cy, r, 0, Math.PI * 2)
      g.fill()
      g.stroke()
      g.globalAlpha = 1
      // 和回放页面一样标上汉字：建筑大字，单位小字
      if (ty.kind === "building" && ty.label) text(ty.label, cx, cy + TILE / 2, (TILE * 4) / 3, "rgba(255,255,255,0.9)", { bold: true, align: "center" })
      else if (ty.kind === "unit" && ty.label) {
        // 白字加深色描边：在哪种颜色上都看得清；字和一格一样大（D-220），工人的字还是原来的大小
        g.font = font(TILE * (ty.worker ? 0.56 : 1), true)
        g.textAlign = "center"
        g.textBaseline = "middle"
        const ly = cy + (ty.shape === "triangle" ? r * 0.22 : ty.worker ? 0.5 : TILE * 0.04)
        g.lineWidth = ty.worker ? 1.8 : Math.max(2, TILE * 0.16)
        g.strokeStyle = "rgba(0,0,0,0.6)"
        g.lineJoin = "round"
        g.strokeText(ty.label, cx, ly)
        g.fillStyle = "#ffffff"
        g.fillText(ty.label, cx, ly)
        g.textBaseline = "alphabetic"
      }
      // 血条：没满血的单位和建筑（单位的画在放大后的图形上面）
      if (ty.kind !== "resource" && hp < 100) {
        const hx = ty.kind === "unit" ? bx : px + 1
        const hy = ty.kind === "unit" ? by - 4 : py - 4
        const hw = ty.kind === "unit" ? bw : pw - 2
        g.fillStyle = "rgba(0,0,0,0.6)"
        g.fillRect(hx, hy, hw, 3)
        g.fillStyle = hp > 50 ? "#5ee08a" : hp > 25 ? "#f5c542" : "#ff5d5d"
        g.fillRect(hx, hy, (hw * hp) / 100, 3)
      }
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
    // 攻击线
    const sh = f.shots as number[]
    g.lineWidth = 1.6
    for (let k = 0; k < sh.length; k += 5) {
      g.strokeStyle = colorOf(sh[k + 4])
      g.globalAlpha = 0.8
      g.beginPath()
      g.moveTo(ox + (sh[k] + 0.5) * TILE, oy + (sh[k + 1] + 0.5) * TILE)
      g.lineTo(ox + (sh[k + 2] + 0.5) * TILE, oy + (sh[k + 3] + 0.5) * TILE)
      g.stroke()
      g.globalAlpha = 1
    }
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
    // 刚死的：一圈扩散的红圈
    const d = f.deaths as number[]
    for (let k = 0; k < d.length; k += 3) {
      const age = d[k + 2]
      g.strokeStyle = `rgba(255,120,90,${Math.max(0, 0.9 - age * 0.12)})`
      g.lineWidth = 2
      g.beginPath()
      g.arc(ox + (d[k] + 0.5) * TILE, oy + (d[k + 1] + 0.5) * TILE, ((6 + age * 2.5) * TILE) / 18, 0, Math.PI * 2)
      g.stroke()
    }
  }

  function replay(s: Any, f: Any, i: number): void {
    g.fillStyle = C.bg1
    g.fillRect(0, 0, W, H)
    // 顶部：精彩对局的标题和解说
    const kicker = s.kicker ?? `精彩对局 ${s.no}`
    text(kicker, 24, 38, 20, C.accent, { bold: true })
    g.font = font(20, true)
    const kx = 24 + g.measureText(kicker).width + 18
    fitLines(s.title, kx, 38, 22, 14, W - 24 - kx, 1, C.text, { bold: true })
    if (s.commentary) {
      // 解说放一行：放不下就缩小字号，最小 14 号还放不下就折成两行
      let px = 18
      g.font = font(px)
      while (px > 14 && g.measureText(s.commentary).width > W - 60) g.font = font(--px)
      const ls = wrap(s.commentary, W - 60)
      if (ls.length === 1) text(ls[0], 24, 70, px, C.muted)
      else ls.slice(0, 2).forEach((l, k) => text(l, 24, 62 + k * 18, px, C.muted))
    }
    drawField(s, f, MX, MY, i)
    // 右边面板
    const x0 = MX + s.width * TILE + 20
    const pw = W - x0 - 20
    roundRect(x0, MY, pw, s.height * TILE, 12, C.panel, C.line)
    let y = MY + 34
    s.seats.forEach((st: Any, k: number) => {
      const c = f.counts[k]
      g.fillStyle = st.color
      g.fillRect(x0 + 16, y - 18, 6, 64)
      g.font = font(20, true)
      let nm = st.name
      while (g.measureText(nm).width > pw - 50) nm = nm.slice(0, -1)
      text(nm + (nm.length < st.name.length ? "…" : ""), x0 + 32, y, 20, st.color, { bold: true })
      text(c.alive ? `兵 ${c.army}  工人 ${c.workers}  建筑 ${c.buildings}` : "已出局", x0 + 32, y + 26, 17, C.text)
      text(`分数 ${c.score}`, x0 + 32, y + 48, 17, C.muted)
      y += 88
    })
    // 实时胜率预测（D-177；折线图 D-178）
    if (s.win) {
      drawWin(s.win, f.t, x0 + 16, y, pw - 32, 66, 15)
      y += 66 + 34
    }
    g.strokeStyle = C.line
    g.beginPath()
    g.moveTo(x0 + 14, y - 14)
    g.lineTo(x0 + pw - 14, y - 14)
    g.stroke()
    // 规则包的状态栏（比分、目标……）
    if (f.status) {
      g.font = font(16)
      for (const l of wrapBalanced(f.status, pw - 32).slice(0, 2)) {
        text(l, x0 + 16, y + 10, 16, C.accent)
        y += 23
      }
      y += 12
    }
    text("战况", x0 + 16, y + 12, 17, C.muted, { bold: true })
    y += 40
    g.font = font(16)
    // 面板里放得下几条放几条，留最新的（每条最多两行）
    const bottom = MY + s.height * TILE - 14
    const blocks = (f.events as string[]).map((ev) => wrapBalanced(ev, pw - 32).slice(0, 2))
    let first = blocks.length
    let used = 0
    while (first > 0 && y + used + (blocks[first - 1].length - 1) * 23 <= bottom) used += blocks[--first].length * 23 + 4
    for (const ls of blocks.slice(first)) {
      for (const l of ls) {
        text(l, x0 + 16, y, 16, C.text)
        y += 23
      }
      y += 4
    }
    // 进度条
    const by = MY + s.height * TILE + 22
    roundRect(MX, by, s.width * TILE, 8, 4, "rgba(255,255,255,0.1)")
    roundRect(MX, by, Math.max(8, s.width * TILE * f.progress), 8, 4, C.accent)
    text(`第 ${f.t} tick`, MX + s.width * TILE, by - 6, 15, C.muted, { align: "right" })
    // 大战 2 倍速、小冲突 4 倍速、没动静快进（D-172、D-174）
    if (!f.final) {
      if (f.pace === "quiet") text("▸▸ 快进", MX, by - 6, 15, C.accent, { bold: true })
      else text(f.pace === "battle" ? "▶ 大战 2 倍速" : "▶ 交火 4 倍速", MX, by - 6, 15, C.text, { bold: true })
    }
    if (f.final) {
      g.globalAlpha = 0.85
      roundRect(MX + 120, MY + (s.height * TILE) / 2 - 60, s.width * TILE - 240, 120, 16, "#0b1220", C.accent)
      g.globalAlpha = 1
      text(s.result, MX + (s.width * TILE) / 2, MY + (s.height * TILE) / 2 + 15, 36, C.accent, { bold: true, align: "center" })
    }
    watermark()
    void i
  }

  /**
   * 竖屏的回放（D-181、D-182，用户：地图拉到 100% 宽度、放在画面正中）：上面是标题、解说、双方头像和兵力（左右两栏），
   * 中间是拉满宽度的地图，下面是进度条、胜率折线和最新的战况
   */
  function vReplay(s: Any, f: Any, i: number): void {
    vBackground()
    const mapW = s.width * TILE
    const mapH = s.height * TILE
    const ox = (VW - mapW) / 2
    // 地图上方：标题、解说、双方（左右两栏）
    text("RTS Arena", VW / 2, 40, 20, C.accent, { bold: true, align: "center" })
    text(s.kicker ?? `精彩对局 ${s.no}`, VW / 2, 80, 22, C.accent, { bold: true, align: "center" })
    let y = fitLines(s.title, VW / 2, 124, 36, 22, SW, 2, C.text, { bold: true, align: "center" })
    if (s.commentary) y = fitLines(s.commentary, VW / 2, y, 19, 14, SW, 2, C.muted, { align: "center" })
    const seats = (s.seats as Any[]).slice(0, 2)
    const colW = SW / Math.max(1, seats.length)
    const sy = y + 6
    seats.forEach((st, k) => {
      const c = f.counts?.[k] ?? { army: 0, workers: 0, buildings: 0, score: 0, alive: true }
      const cx = SX + k * colW
      avatarCircle(st.avatar, st.name, st.color, cx + 32, sy + 36, 28)
      fitLines(st.name, cx + 70, sy + 22, 24, 14, colW - 76, 1, st.color, { bold: true })
      fitLines(c.alive ? `兵 ${c.army}  工人 ${c.workers}` : "已出局", cx + 70, sy + 50, 18, 12, colW - 76, 1, C.text)
      if (c.alive) fitLines(`建筑 ${c.buildings}  分数 ${c.score}`, cx + 70, sy + 74, 18, 12, colW - 76, 1, C.muted)
    })
    const top = sy + 92
    // 地图放在画面正中（D-182，用户要求）；上面的字太多放不下时才往下挪
    const oy = Math.max((VH - mapH) / 2, top)
    drawField(s, f, ox, oy, i)
    if (f.final) {
      g.globalAlpha = 0.85
      roundRect(SX, oy + mapH / 2 - 60, SW, 120, 16, "#0b1220", C.accent)
      g.globalAlpha = 1
      fitLines(s.result, VW / 2, oy + mapH / 2 + 14, 36, 20, SW - 40, 1, C.accent, { bold: true, align: "center" })
    }
    // 地图下方：进度条和变速、胜率折线、最新的战况
    const by = oy + mapH + 30
    roundRect(SX, by, SW, 8, 4, "rgba(255,255,255,0.1)")
    roundRect(SX, by, Math.max(8, SW * (f.progress ?? 0)), 8, 4, C.accent)
    text(`第 ${f.t ?? 0} tick`, SX + SW, by - 8, 18, C.muted, { align: "right" })
    if (!f.final) text(f.pace === "quiet" ? "▸▸ 快进" : f.pace === "battle" ? "▶ 大战 2 倍速" : "▶ 交火 4 倍速", SX, by - 8, 18, f.pace === "quiet" ? C.accent : C.text, { bold: true })
    let y2 = by + 46
    if (s.win) {
      drawWin(s.win, f.t ?? 0, SX, y2, SW, 100, 22)
      y2 += 12 + 100 + 34
    }
    const room = Math.max(0, Math.floor((VH - 46 - y2) / 28) + 1)
    for (const ev of (f.events as string[]).slice(-room)) {
      fitLines(ev, SX, y2, 19, 14, SW, 1, C.muted)
      y2 += 28
    }
    void i
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
    text("RTS Arena", W / 2, y + 70, 80, C.text, { bold: true, align: "center", alpha: p })
    text("本视频由 RTS Arena 联赛视频接口自动生成", W / 2, y + 130, 28, C.text, { align: "center", alpha: ease((i - 10) / 20) })
    text(REPO, W / 2, y + 172, 24, C.accent, { align: "center", alpha: ease((i - 15) / 20) })
    text("选手", W / 2, y + 226, 18, C.muted, { bold: true, align: "center", alpha: ease((i - 20) / 20) })
    s.credits.forEach((c: string, k: number) => text(c, W / 2, y + 258 + k * 30, 20, k === s.credits.length - 1 ? C.muted : C.text, { align: "center", alpha: ease((i - 25 - k * 5) / 20) }))
  }

  /** 一个场景的画面（横屏的画法；竖屏时先画到 landCanvas 上再拼） */
  function drawScene(s: Any, f: Any | null, i: number, a: number): void {
    if (s.kind === "rules") rules(s, a)
    else if (s.kind === "player") player(s, a)
    else if (s.kind === "standings") standings(s, a)
    else if (s.kind === "matrix") matrix(s, a)
    else if (s.kind === "replay") replay(s, f ?? {}, i)
    else if (s.kind === "brandClose") brandClose(s, a)
  }
  function draw(f: Any | null, i: number): void {
    const s = scene!
    // 页内动画按 speed 加快（淡入淡出还是按实际帧数）；视频第一段从第一帧起就是完整画面（也当封面，D-221），页内动画直接跳到放完
    const a = i * (s.speed ?? 1) + (s.first ? 120 : 0)
    if (!VERT) {
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0)
      g.save()
      drawScene(s, f, i, a)
      g.restore()
      fade(i, s.frames)
      g.setTransform(1, 0, 0, 1, 0, 0)
      return
    }
    // 竖屏：规则、排名、选手和回放直接按竖屏画（D-183、D-221）；片尾先按横屏画到 landCanvas，再拼到竖屏画布上
    const direct = s.kind === "replay" || s.kind === "rules" || s.kind === "player" || s.kind === "standings" || s.kind === "matrix"
    if (!direct) {
      g = landG!
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0)
      g.save()
      drawScene(s, f, i, a)
      g.restore()
      g.setTransform(1, 0, 0, 1, 0, 0)
    }
    g = outG
    g.setTransform(VS, 0, 0, VS, 0, 0)
    g.save()
    vBackground()
    if (s.kind === "replay") vReplay(s, f ?? {}, i)
    else if (s.kind === "standings") vStandings(s, a)
    else if (s.kind === "matrix") vMatrix(s, a)
    else if (s.kind === "rules") vRules(s, a)
    else if (s.kind === "player") vPlayer(s, a)
    else vFrame(s, f ?? {}, i)
    if (s.kind !== "brandClose" && s.kind !== "rules") vWatermark()
    g.restore()
    fade(i, s.frames)
    g.setTransform(1, 0, 0, 1, 0, 0)
    g = landG!
  }

  // ---------- 和 Node 那边的接口 ----------
  /** 输出尺寸（16:9，宽度 / 1280 就是放大倍数） */
  w.__size = (width: number, height: number) => {
    canvas = new OffscreenCanvas(width, height)
    outG = canvas.getContext("2d")!
    terrainLayer = null
    images.forEach((im) => (im.bust = null))
    // 竖屏（高比宽大，D-179）：场景按横屏画在 landCanvas 上，再拼进竖屏画布
    VERT = height > width
    if (VERT) {
      VS = width / VW
      SCALE = width / W
      landCanvas = new OffscreenCanvas(width, Math.round((width * H) / W))
      landG = landCanvas.getContext("2d")!
      g = landG
    } else {
      SCALE = width / W
      landCanvas = null
      landG = null
      g = outG
    }
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
  w.__scene = (s: Any) => {
    scene = s
    terrainLayer = null
    if (s.kind === "replay") fitTile(s)
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
