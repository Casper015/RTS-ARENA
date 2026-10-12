/** Shared, deterministic Canvas artwork. The factory is also serialized into the video browser. */
export interface BattleType {
  name?: string
  kind: string
  shape?: string
  label?: string
  worker?: boolean
  range?: number
  splash?: number
}

export type AttackStyle = "slash" | "thrust" | "arrow" | "shell"
export interface BattlePose {
  angle?: number
  walk?: number
  attack?: number
  hit?: number
  /** Work cycle, -1 when travelling or idle. */
  work?: number
  job?: "mine" | "chop" | "harvest" | "build" | "farm"
  carrying?: boolean
}

export interface BattleAttack {
  source: number
  target: number
  x1: number
  y1: number
  x2: number
  y2: number
  owner: number
  style: AttackStyle
  age: number
  duration: number
}

/** No runtime imports or browser globals here: keep this factory safe to call via toString(). */
export function createBattleArt() {
  type Ink = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const TAU = Math.PI * 2
  const ink = "#182123"
  const steel = "#c9d9da"
  const gold = "#e3b969"
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const noise = (x: number, y: number, n = 0) => {
    let h = Math.imul(x + 113, 374761393) ^ Math.imul(y + 71, 668265263) ^ Math.imul(n + 7, 1274126177)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  function role(t: BattleType): string {
    const n = (t.name ?? "").toLowerCase()
    if (t.kind !== "unit") return n
    if (/cannon|catapult|mortar/.test(n)) return "cannon"
    if (/scout/.test(n)) return "scout"
    if (/cavalry|knight|horse/.test(n)) return "cavalry"
    if (/spearman|pike|lancer/.test(n)) return "spearman"
    if (/archer|ranger|bow/.test(n)) return "archer"
    if (/king|lord|hero/.test(n)) return "lord"
    if (/cow|cattle|sheep|herd/.test(n)) return "animal"
    if (/caravan|wagon/.test(n)) return "wagon"
    if (t.worker || /worker|peasant/.test(n)) return "worker"
    if ((t.splash ?? 0) > 0) return "cannon"
    if ((t.range ?? 0) > 1) return "archer"
    return "soldier"
  }
  function attackStyle(t: BattleType): AttackStyle {
    const r = role(t)
    if (r === "cannon") return "shell"
    if ((t.range ?? 0) > 1 || r === "archer" || r === "tower" || r === "base") return "arrow"
    return r === "spearman" || r === "cavalry" ? "thrust" : "slash"
  }
  function polygon(g: Ink, pts: number[], fill: string, outline = ink, width = 0.035): void {
    g.beginPath()
    for (let i = 0; i < pts.length; i += 2) i ? g.lineTo(pts[i], pts[i + 1]) : g.moveTo(pts[i], pts[i + 1])
    g.closePath()
    g.fillStyle = fill
    g.fill()
    if (outline) { g.strokeStyle = outline; g.lineWidth = width; g.stroke() }
  }
  function ellipse(g: Ink, x: number, y: number, rx: number, ry: number, fill: string, outline = ""): void {
    g.beginPath()
    g.ellipse(x, y, rx, ry, 0, 0, TAU)
    g.fillStyle = fill
    g.fill()
    if (outline) { g.strokeStyle = outline; g.lineWidth = 0.035; g.stroke() }
  }
  function line(g: Ink, x: number, y: number, x2: number, y2: number, color: string, width: number): void {
    g.strokeStyle = color
    g.lineWidth = width
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke()
  }
  function box(g: Ink, x: number, y: number, w: number, h: number, fill: string, outline = ink): void {
    g.fillStyle = fill; g.fillRect(x, y, w, h)
    if (outline) { g.strokeStyle = outline; g.lineWidth = 0.035; g.strokeRect(x, y, w, h) }
  }
  function flag(g: Ink, x: number, y: number, color: string): void {
    line(g, x, y, x, y - 0.53, "#e2ce9e", 0.035)
    polygon(g, [x, y - 0.53, x + 0.32, y - 0.49, x + 0.24, y - 0.32, x, y - 0.35], color)
  }

  // Three-quarter silhouettes keep the face, clothing, tools and horse readable at game scale.
  // They turn left/right instead of rotating an upright person flat across the ground.
  function villager(g: Ink, color: string, p: BattlePose): void {
    const walk = p.walk ?? 0, phase = (p.work ?? -1) >= 0 ? p.work! : p.attack ?? -1
    const active = phase >= 0, job = p.job ?? "mine"
    const swing = active ? phase < .38 ? phase / .38 : phase < .58 ? 1 - (phase - .38) / .2 : 0 : 0
    const bend = active ? (1 - swing) * (job==="farm"?.17:.08) : 0
    g.scale(Math.cos(p.angle ?? 0) < 0 ? -1 : 1, 1)
    // Boots, trousers, rolled sleeves and an apron distinguish a civilian from armoured infantry.
    for (const side of [-1, 1]) {
      const foot = side * .12 + walk * side * .10
      line(g, side * .09, .10, foot, .37, "#6c583e", .11)
      line(g, foot - .035, .39, foot + .075, .39, "#322e26", .075)
    }
    g.save(); g.translate(bend, Math.abs(walk) * .02 + bend * .35)
    polygon(g, [-.14,-.28,.10,-.28,.18,.08,.09,.18,-.18,.12], "#d3c2a0")
    polygon(g, [-.075,-.21,.105,-.18,.13,.15,-.11,.14], color)
    line(g, -.15, .035, .14, .035, "#665039", .055)
    polygon(g, [-.09,.07,.1,.07,.12,.24,-.12,.21], "#b9a785")
    line(g, -.13,-.19,-.22,-.035,"#e2c69e",.105)
    ellipse(g, .025, -.405, .12, .145, (p.hit ?? 0) > .5 ? "#fff4d0" : "#deb58a", ink)
    polygon(g, [-.09,-.43,-.09,-.54,.03,-.57,.12,-.49,.11,-.435,.015,-.47], "#624536")
    line(g,.075,-.37,.14,-.385,"#deb58a",.05)
    if (p.carrying) {
      ellipse(g,.20,-.04,.17,.22,"#b49961",ink)
      line(g,.10,-.04,.29,.07,"#e2c69e",.075)
      line(g,.16,-.24,.25,-.24,"#57422e",.035)
      line(g,.17,-.21,.19,.12,"#8d754c",.023)
    } else {
      // The hands follow the tool: lift, strike, then recover. Work is supplied by replay orders.
      const theta = active ? job==="farm" ? .55-swing*1.6 : -.14 - swing * 2.0 : -.65 + walk * .10
      const hx=.09, hy=-.18
      const gripX=hx+Math.cos(theta)*.24, gripY=hy+Math.sin(theta)*.24
      line(g,.09,-.20,gripX,gripY,"#dec09a",.09)
      line(g,-.20,-.035,gripX-.06,gripY+.045,"#dec09a",.075)
      g.save();g.translate(hx,hy);g.rotate(theta)
      line(g,.10,0,.55,0,"#8e6940",.045)
      line(g,.15,-.012,.52,-.012,"#d7b77d",.017)
      if(job==="chop") polygon(g,[.47,-.13,.61,-.22,.66,.10,.49,.065],steel)
      else if(job==="build") box(g,.47,-.11,.14,.22,steel)
      else if(job==="farm") polygon(g,[.50,-.015,.64,-.015,.64,.15,.59,.19,.50,.10],steel)
      else if(job==="harvest") {
        g.beginPath();g.arc(.51,-.07,.15,-Math.PI*.7,Math.PI*.55);g.strokeStyle=steel;g.lineWidth=.045;g.stroke()
      } else {
        g.beginPath();g.moveTo(.47,-.22);g.quadraticCurveTo(.66,-.04,.52,.23);g.strokeStyle=steel;g.lineWidth=.052;g.stroke()
      }
      g.restore()
      if(active && phase>.57 && phase<.85) {
        const q=(phase-.57)/.28
        g.globalAlpha=1-q
        for(let j=0;j<3;j++) ellipse(g,.58+(j-1)*q*.19,.01-q*.18+j*.055,.022,.026,job==="mine"?"#dec278":"#baa675")
      }
    }
    g.restore()
  }

  function scout(g: Ink, color: string, p: BattlePose, heavy = false): void {
    const walk=p.walk ?? 0, strike=p.attack === undefined || p.attack<0 ? 0 : Math.sin(p.attack*Math.PI)
    g.scale(Math.cos(p.angle ?? 0)<0?-1:1,1)
    // Four separated legs, a raised neck, ears, reins and saddle make the horse unmistakable.
    for(const back of [true,false]) for(const end of [-1,1]) {
      const x=end*.30, step=walk*(back?-1:1)*end*.13, y=back?.05:.10
      line(g,x,y,x+step*.4,.28,back?"#614638":"#a2744d",.072)
      line(g,x+step*.4,.28,x+step,.43,back?"#614638":"#b38b61",.063)
      line(g,x+step-.035,.44,x+step+.035,.44,"#302c27",.058)
    }
    line(g,-.45,-.02,-.64,.13+walk*.04,"#463329",.10)
    ellipse(g,-.06,.005,.43,.205,"#ac8155",ink)
    ellipse(g,-.22,-.07,.19,.12,"#bc956b")
    polygon(g,[.19,-.09,.31,-.44,.43,-.43,.50,-.15,.38,.16,.18,.14],"#bd9568")
    polygon(g,[.30,-.43,.30,-.53,.365,-.47,.41,-.55,.45,-.43,.59,-.32,.57,-.20,.43,-.23],"#c5a078")
    line(g,.29,-.42,.24,-.20,"#4b382b",.065)
    ellipse(g,.45,-.37,.015,.018,"#252b29")
    line(g,.52,-.29,.57,-.27,"#574734",.025)
    polygon(g,[-.31,-.15,.10,-.16,.17,.12,-.24,.19],color)
    line(g,-.31,.09,.10,.07,"#dfc690",.028)
    if(heavy) {
      polygon(g,[.22,-.13,.32,-.43,.40,-.46,.47,-.27,.37,.13],"#9aaeb0")
      line(g,.29,-.10,.40,-.29,"#e0e6d5",.035)
      polygon(g,[-.39,-.08,-.29,-.19,-.14,-.17,-.17,.20,-.39,.13],"#829798")
      for(const x of [-.31,-.24])line(g,x,-.10,x,.12,"#c0cebf",.028)
    }
    box(g,-.17,-.17,.22,.065,"#694b32")
    const bob=Math.abs(walk)*.035
    g.save();g.translate(0,-bob)
    polygon(g,[-.12,-.52,.06,-.51,.13,-.22,-.19,-.18,-.25,-.28],heavy?steel:"#b5a782")
    polygon(g,[-.15,-.48,-.30,-.14,-.10,-.20,.025,-.48],color)
    line(g,-.07,-.18,.08,-.06,"#b6a37c",.10)
    line(g,.08,-.06,.04,.17,"#393d32",.075)
    line(g,-.14,-.21,.08,-.21,"#765939",.04)
    ellipse(g,-.035,-.63,.105,.13,"#dbb88c",ink)
    polygon(g,[-.14,-.64,-.11,-.76,.015,-.76,.075,-.65,-.015,-.68,-.11,-.58],heavy?steel:color)
    if(heavy) {
      polygon(g,[-.13,-.75,-.07,-.90,.035,-.87,.07,-.78,-.045,-.79],color)
      line(g,.035,-.65,.035,-.57,"#344349",.034)
      polygon(g,[-.21,-.47,-.04,-.47,.035,-.32,-.10,-.16,-.25,-.30],color)
      line(g,-.135,-.41,-.11,-.23,gold,.035)
    }
    line(g,.065,-.44,.23,-.29,"#cfb18b",.075)
    line(g,.23,-.29,.48,-.29,"#665039",.024)
    g.save();g.translate(-.09,-.39)
    if(heavy) {
      const reach=strike*.25
      line(g,-.25+reach,0,.86+reach,-.08,"#b49563",.045)
      polygon(g,[.82+reach,-.135,1.08+reach,-.10,.83+reach,-.035],steel)
      polygon(g,[.69+reach,-.07,.72+reach,.08,.58+reach,.025],color)
    } else {
      // The light scout has a short blade; the armoured rider carries a pennant lance.
      g.rotate(-.7+strike*1.9)
      line(g,0,0,.22,0,"#cdb08a",.07)
      line(g,.20,-.065,.20,.065,gold,.035)
      polygon(g,[.24,-.025,.47,-.025,.54,0,.24,.035],steel)
    }
    g.restore();g.restore()
  }

  function infantry(g: Ink, r: string, color: string, p: BattlePose): void {
    const walk=p.walk??0, a=p.attack??-1
    const strike=a<0?0:Math.sin(Math.PI*clamp(a/.7))
    const skin=(p.hit??0)>.5?"#fff4d0":"#d8b58c"
    g.scale(Math.cos(p.angle??0)<0?-1:1,1)
    for(const side of [-1,1]) {
      const foot=side*.12+walk*side*.12
      line(g,side*.08,.04,foot,.34,r==="archer"?"#78674d":"#879c9e",.10)
      line(g,foot-.035,.39,foot+.09,.39,"#30352e",.078)
    }
    g.save();g.translate(strike*.055,Math.abs(walk)*.025)
    if(r==="lord")polygon(g,[-.17,-.36,-.33,-.27,-.38,.28,-.19,.21,.01,-.13],color)
    if(r==="archer") {
      // Quiver and the tall bent bow are visible even when the archer is not firing.
      line(g,-.21,-.12,-.28,-.46,"#715239",.105)
      for(const x of [-.31,-.25]) {
        line(g,x,-.52,x+.08,-.20,"#d7c193",.022)
        line(g,x,-.53,x-.045,-.48,steel,.035)
      }
      polygon(g,[-.16,-.29,.09,-.30,.18,.12,-.18,.15],"#927c55")
      polygon(g,[-.16,-.29,-.05,-.32,.11,.03,.08,.17,-.17,.14],color)
    } else {
      polygon(g,[-.16,-.31,.105,-.31,.18,.09,.06,.16,-.17,.12],steel)
      polygon(g,[-.085,-.28,.05,-.28,.11,.22,-.14,.21],color)
      line(g,-.13,-.25,-.14,-.07,"#eff2df",.034)
      ellipse(g,-.15,-.26,.115,.075,"#8da3a7",ink)
    }
    line(g,-.16,.06,.15,.06,"#63543e",.047)
    if(r==="lord")box(g,-.03,.035,.065,.045,gold,"")
    ellipse(g,.02,-.445,.115,.137,skin,ink)
    if(r==="archer")polygon(g,[-.10,-.43,-.12,-.56,-.02,-.64,.10,-.53,.105,-.44,.01,-.51],color)
    else {
      polygon(g,[-.11,-.43,-.11,-.56,-.04,-.61,.065,-.59,.135,-.49,.12,-.445,.015,-.48],steel)
      line(g,.09,-.45,.09,-.35,"#4b5755",.037)
      if(r==="lord") {
        polygon(g,[-.115,-.54,-.13,-.70,-.055,-.62,.015,-.74,.07,-.62,.12,-.68,.11,-.53],gold)
        line(g,.035,-.61,.035,-.56,"#fff0bc",.025)
      } else if(r==="soldier") {
        polygon(g,[-.075,-.60,-.02,-.73,.08,-.70,.12,-.61,.025,-.62],color)
      }
    }
    if(r==="archer") {
      const pull=a<0?.03:a<.28?.04+a/.28*.19:a<.55?.23*(1-(a-.28)/.27):.025
      line(g,.10,-.23,.40,-.22,skin,.075)
      line(g,-.11,-.20,.36-pull,-.21,skin,.068)
      g.save();g.translate(.43,-.22)
      g.beginPath();g.moveTo(0,-.34);g.quadraticCurveTo(.31,0,0,.34);g.strokeStyle="#d7b680";g.lineWidth=.048;g.stroke()
      line(g,0,-.34,-pull,0,"#e7e3c8",.019);line(g,-pull,0,0,.34,"#e7e3c8",.019)
      if(a<.45){line(g,-pull-.04,0,.32,0,"#e6d1a1",.027);polygon(g,[.29,-.035,.42,0,.29,.035],steel,"",0)}
      g.restore()
    } else if(r==="spearman") {
      const reach=strike*.28, lift=a<0?-.36:-.16
      line(g,.09,-.25,.32+reach,-.20,skin,.074)
      g.save();g.translate(.06+reach,-.22);g.rotate(lift)
      line(g,-.42,0,.89,0,"#ad8b57",.052)
      line(g,-.38,-.016,.87,-.016,"#e2c790",.015)
      polygon(g,[.86,-.065,1.09,0,.86,.065,.92,0],steel)
      g.restore()
    } else {
      const angle=a<0?-.94:a<.22?-.94-a/.22*1.2:a<.60?-2.14+(a-.22)/.38*2.55:.41-(a-.60)/.40*1.35
      g.save();g.translate(.11,-.23);g.rotate(angle)
      line(g,0,0,.22,0,skin,.082)
      line(g,.19,-.075,.19,.075,gold,.037)
      polygon(g,[.24,-.038,.63,-.03,.74,0,.63,.037,.24,.038],steel)
      line(g,.28,-.013,.62,-.013,"#f5f3dd",.018)
      g.restore()
    }
    if(r!=="archer") {
      const sx=r==="spearman"?-.12:-.18
      polygon(g,[sx-.13,-.27,sx+.14,-.28,sx+.15,-.03,sx+.01,.16,sx-.14,-.02],r==="lord"?"#b8a467":color)
      line(g,sx,-.22,sx,.065,r==="lord"?"#fff0be":"#e0dac1",.038)
      line(g,sx-.09,-.115,sx+.09,-.115,"#e0dac1",.029)
    }
    g.restore()
  }

  function vehicle(g: Ink, r: string, color: string, p: BattlePose): void {
    const a=p.attack??-1, recoil=a<0?0:Math.sin(Math.PI*clamp(a/.6))*.14, walk=p.walk??0
    g.scale(Math.cos(p.angle??0)<0?-1:1,1)
    polygon(g,[-.48,.20,.31,.20,.48,.05,-.34,.02],"#8e714a")
    if(r==="wagon") {
      box(g,-.38,-.31,.67,.43,"#bca173")
      for(const y of [-.22,-.08,.065])line(g,-.35,y,.26,y,"#796341",.03)
      polygon(g,[-.43,-.31,-.33,-.53,.21,-.53,.34,-.30],"#dbc9a1")
      for(const x of [-.26,.14])line(g,x,-.49,x,-.30,color,.08)
      line(g,.30,.13,.68,.25,"#9c7e50",.055)
    } else {
      polygon(g,[-.21,-.19,.07,-.19,.20,.14,-.32,.14],"#746547")
      line(g,-.17,-.12,-.25,.09,"#b99a66",.04)
      g.save();g.translate(-recoil,-.14)
      polygon(g,[-.35,-.16,.53,-.21,.65,-.14,.65,.025,-.34,.03],"#697b79")
      line(g,-.26,-.115,.55,-.155,"#c4d2c3",.035)
      polygon(g,[.46,-.215,.62,-.23,.69,-.16,.69,.04,.48,.06],"#b19b6b")
      ellipse(g,.655,-.08,.042,.096,"#263330",ink)
      ellipse(g,-.31,-.065,.09,.135,"#465856",ink)
      g.restore()
      box(g,-.37,.02,.21,.15,color)
      line(g,-.37,.10,-.61,.30,"#a98853",.09)
    }
    for(const x of [-.26,.29]) {
      ellipse(g,x,.24,.175,.175,"#4c4838",ink)
      ellipse(g,x,.24,.127,.127,"#b39664")
      for(let n=0;n<3;n++) {
        const angle=n*Math.PI/3+walk*.5
        line(g,x+Math.cos(angle)*.12,.24+Math.sin(angle)*.12,x-Math.cos(angle)*.12,.24-Math.sin(angle)*.12,"#67523a",.028)
      }
      ellipse(g,x,.24,.039,.039,"#d3bc8b",ink)
    }
  }

  function animal(g: Ink, p: BattlePose): void {
    const walk=p.walk??0
    g.scale(Math.cos(p.angle??0)<0?-1:1,1)
    for(const side of [-1,1])for(const x of [-.25,.23]) {
      const foot=x+walk*side*.08
      line(g,x,.09,foot,.36,side<0?"#8e7e65":"#c0ad8a",.074)
      line(g,foot-.025,.38,foot+.04,.38,"#473f31",.049)
    }
    line(g,-.4,-.11,-.48,.15,"#968568",.04)
    ellipse(g,-.045,-.02,.4,.25,"#d1c1a2",ink)
    ellipse(g,-.14,-.07,.12,.13,"#716a55")
    polygon(g,[.20,-.19,.31,-.33,.44,-.28,.51,-.02,.40,.11,.29,.045],"#b6a589")
    line(g,.32,-.30,.30,-.42,"#e9dfbb",.037)
    line(g,.40,-.29,.45,-.40,"#e9dfbb",.037)
    ellipse(g,.44,-.12,.015,.021,"#343831")
  }

  function headroom(t: BattleType): number {
    const r=role(t)
    return t.kind!=="unit"?0:r==="cavalry"?.50:r==="scout"?.36:r==="lord"?.40:r==="soldier"?.35:r==="worker"?.25:r==="spearman"||r==="archer"?.30:.10
  }

  /** Coordinates and line widths use map tiles, so the same art works at any output resolution. */
  function entity(g: Ink, t: BattleType, x: number, y: number, w: number, h: number, color: string, pose: BattlePose = {}, progress = 100): void {
    const r = role(t)
    g.save()
    g.translate(x + w / 2, y + h / 2)
    g.lineCap = "round"
    g.lineJoin = "round"
    if (t.kind === "unit") {
      // All mobile units share an upright side view, fixed ground plane and left/right facing.
      ellipse(g, .035, .38, ["cavalry","scout","wagon","cannon","animal"].includes(r) ? .56 : .33, .14, "rgba(5,12,12,.35)")
      if (r === "worker") villager(g,color,pose)
      else if (r === "scout" || r === "cavalry") scout(g,color,pose,r === "cavalry")
      else if (r === "cannon" || r === "wagon") vehicle(g,r,color,pose)
      else if (r === "animal") animal(g,pose)
      else infantry(g,r,color,pose)
    } else if (t.kind === "resource") {
      ellipse(g, 0, .17, w * .47, h * .34, "rgba(4,12,12,.30)")
      g.scale(w, h)
      if (!/gold|mine|ore/.test(r)) {
        polygon(g, [-.4,.04,-.16,-.35,.22,-.28,.42,.12,.02,.35], color)
        polygon(g, [-.16,-.35,.22,-.28,.07,.02,-.4,.04], "rgba(255,255,255,.28)", "")
        if (t.label) { g.font = "bold .3px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff3cd"; g.fillText(t.label, 0, .08) }
      } else for (const [dx,dy,rr] of [[-.22,.08,.25],[.12,.09,.28],[-.03,-.13,.26]]) {
        polygon(g, [dx-rr,dy+.14,dx-rr*.65,dy-.13,dx+.02,dy-rr,dx+rr,dy-.06,dx+rr*.8,dy+.18], "#947744")
        polygon(g, [dx-rr*.65,dy-.13,dx+.02,dy-rr,dx+rr*.4,dy-.07,dx-.04,dy+.04], "#f1cd70", "")
        polygon(g, [dx+.02,dy-rr,dx+rr,dy-.06,dx+rr*.8,dy+.18,dx+rr*.4,dy-.07], "#c59b4b", "")
      }
    } else {
      g.scale(w, h)
      ellipse(g, .035, .13, .49, .42, "rgba(5,12,12,.32)")
      if (progress < 100) g.globalAlpha *= .48 + progress * .003
      const masonry = (x0: number, y0: number, ww: number, hh: number) => {
        box(g, x0, y0, ww, hh, "#9c9a80")
        for (let y = y0+.12; y < y0+hh; y+=.13) line(g, x0, y, x0+ww, y, "#6a7164", .015)
        line(g, x0+.025, y0+.025, x0+ww-.025, y0+.025, "#d5ceb0", .025)
      }
      if (r === "farm") {
        box(g, -.47, -.41, .94, .82, "#694e30")
        for (let row = 0; row < 5; row++) {
          const y = -.3 + row * .14
          line(g, -.38, y+.055, .38, y+.055, "#433824", .04)
          for (let j = 0; j < 5; j++) { const x = -.32+j*.16; line(g,x,y+.04,x+.025,y-.06,"#c8bc6d",.025); line(g,x,y,x-.045,y-.04,"#929649",.028) }
        }
        for (const side of [-1,1]) for (const end of [-1,1]) box(g,side*.42-.025,end*.35-.025,.05,.12,"#bea075")
      } else if (r === "wall") {
        masonry(-.44,-.28,.88,.67)
        box(g,-.44,-.35,.88,.19,"#d2c5a3")
        for (const x of [-.36,-.04,.28]) box(g,x,-.44,.15,.23,"#b6ae90")
      } else if (r === "tower" || r === "base") {
        if (r === "base") {
          masonry(-.4,-.24,.8,.62)
          polygon(g,[-.43,-.2,0,-.46,.43,-.2,.31,.01,-.31,.01],color)
          box(g,-.10,.12,.2,.27,"#303c36")
          for (const x of [-.38,.22]) { masonry(x,-.29,.16,.61); box(g,x-.02,-.34,.2,.11,"#c6bea1"); for(const dx of [0,.13])box(g,x-.02+dx,-.4,.075,.12,"#b7b195") }
          flag(g,.13,-.36,color)
        } else {
          masonry(-.28,-.3,.56,.68)
          box(g,-.13,-.04,.26,.11,"#303b38")
          box(g,-.38,-.35,.76,.2,"#c6bea1")
          for(const x of [-.38,-.05,.28])box(g,x,-.48,.13,.2,"#a8a58d")
          box(g,-.24,.05,.12,.26,color,"")
          flag(g,.25,-.41,color)
        }
      } else if (r === "barracks" || r === "depot" || r === "stable") {
        masonry(-.4,-.08,.8,.43)
        polygon(g,[-.47,-.09,0,-.43,.47,-.09,.32,.04,-.32,.04],color)
        line(g,0,-.4,.4,-.095,"rgba(255,255,255,.34)",.025)
        box(g,-.11,.1,.22,.25,"#354037")
        if(r==="depot") {box(g,.22,.18,.22,.21,"#bd9960");line(g,.23,.19,.42,.38,"#796240",.025)}
        else { line(g,-.27,.12,-.27,.31,steel,.05);line(g,-.33,.16,-.21,.16,gold,.035); flag(g,.34,-.14,color) }
      } else {
        // Custom structures keep their identifying label rather than pretending to be a known type.
        masonry(-.4,-.3,.8,.65)
        polygon(g,[-.45,-.28,0,-.46,.45,-.28,.32,-.04,-.32,-.04],color)
        if(t.label) {g.font="bold .32px sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillStyle="#f0e8d0";g.fillText(t.label,0,.17)}
      }
      if(progress<100) {
        for(const x of [-.42,.42])line(g,x,-.45,x,.44,"#d0aa74",.04)
        for(const y of [-.28,.13])line(g,-.45,y,.45,y,"#d0aa74",.035)
        line(g,-.42,.39,.42,-.38,"#93754b",.032)
      }
    }
    g.restore()
  }

  function terrain(g: Ink, rows: string[], colors: Record<string, string>, tile: number): void {
    const h = rows.length, w = rows[0]?.length ?? 0
    g.save(); g.scale(tile, tile)
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const key=rows[y][x], base=colors[key] ?? "#354436"
      g.fillStyle=base;g.fillRect(x,y,1.015,1.015)
      const n=noise(x,y)
      g.fillStyle=`rgba(232,220,154,${.018+n*.043})`;g.fillRect(x,y,1,1)
      if(key==="#") {
        g.save();g.translate(x+.5,y+.5)
        ellipse(g,.08,.14,.46,.32,"rgba(4,12,12,.24)")
        const rr=.30+n*.15
        polygon(g,[-rr,.3,-.44,-.08,-.15,-rr,.27,-.35,.44,.06,.27,.32],"#797b66","#444d40",.025)
        polygon(g,[-.44,-.08,-.15,-rr,.27,-.35,.08,.02,-.19,.10],"#a0a086","",0)
        line(g,.08,.02,.27,.32,"#606957",.025)
        g.restore()
      } else if(key==="~") {
        line(g,x+.12,y+.24+n*.3,x+.52+n*.2,y+.24+n*.3,"rgba(151,193,191,.18)",.022)
        if(rows[y-1]?.[x]!=="~")line(g,x,y+.04,x+1,y+.04,"rgba(197,200,159,.32)",.06)
        if(rows[y]?.[x-1]!=="~")line(g,x+.04,y,x+.04,y+1,"rgba(197,200,159,.25)",.055)
      } else {
        for(let j=0;j<3;j++) {
          const xx=x+.12+noise(x,y,j+1)*.73, yy=y+.16+noise(x,y,j+7)*.69
          line(g,xx,yy,xx-.055,yy-.10,"rgba(163,174,114,.16)",.022)
          line(g,xx,yy,xx+.035,yy-.12,"rgba(163,174,114,.16)",.022)
        }
        if(n>.87)ellipse(g,x+.2,y+.65,.038,.022,"rgba(213,209,159,.3)")
      }
    }
    // Soft lighting unifies adjacent tiles without a checkerboard or a noisy per-frame texture.
    const light=g.createLinearGradient(0,0,w,h)
    light.addColorStop(0,"rgba(214,222,165,.065)");light.addColorStop(1,"rgba(3,18,22,.18)")
    g.fillStyle=light;g.fillRect(0,0,w,h)
    g.restore()
  }

  function attack(g: Ink, a: BattleAttack, color: string): void {
    const p=clamp(a.age/a.duration)
    if(p>=1||a.age<0)return
    const dx=a.x2-a.x1,dy=a.y2-a.y1,angle=Math.atan2(dy,dx)
    const ranged=a.style==="arrow"||a.style==="shell"
    const impact=ranged?.6:.32
    g.save();g.lineCap="round";g.lineJoin="round"
    if(!ranged) {
      g.translate(a.x1,a.y1);g.rotate(angle)
      const reach=Math.min(1.3,Math.hypot(dx,dy))
      if(a.style==="slash") {
        const sweep=-1.0+Math.min(1,p/.6)*2.0
        g.globalAlpha=Math.sin(Math.PI*clamp(p/.85))*.8
        g.beginPath();g.arc(0,0,Math.max(.55,reach*.75),sweep-.9,sweep)
        g.strokeStyle="#fff2ca";g.lineWidth=.10*(1-p)+.018;g.stroke()
        g.beginPath();g.arc(0,0,Math.max(.47,reach*.61),sweep-.75,sweep)
        g.strokeStyle=color;g.lineWidth=.035;g.stroke()
      } else {
        g.globalAlpha=Math.sin(Math.PI*clamp(p/.7))*.75
        line(g,.35,0,reach+.11,0,"#fff0c5",.065*(1-p)+.015)
        line(g,.35,-.08,reach-.10,-.04,color,.025)
      }
    } else {
      const travel=clamp(p/impact)
      const arc=a.style==="shell"?.65:.26
      // A side-view gun fires from its visible barrel, then the shot travels toward the map target.
      const side=Math.cos(angle)<0?-1:1
      const launchX=a.x1+(a.style==="shell"?side*.65:0), launchY=a.y1-(a.style==="shell"?.22:0)
      const fx=a.x2-launchX, fy=a.y2-launchY
      const px=launchX+fx*travel,py=launchY+fy*travel-Math.sin(travel*Math.PI)*arc
      if(p<impact) {
        if(a.style==="shell") {
          for(let j=4;j>=1;j--){const q=Math.max(0,travel-j*.035);ellipse(g,launchX+fx*q,launchY+fy*q-Math.sin(q*Math.PI)*arc,.07+j*.018,.06+j*.015,`rgba(204,187,150,${.17-j*.025})`)}
          ellipse(g,px,py,.09,.09,"#282d29","#d8b472")
        } else {
          const theta=Math.atan2(dy-Math.cos(travel*Math.PI)*Math.PI*arc,dx)
          g.save();g.translate(px,py);g.rotate(theta)
          line(g,-.26,0,.12,0,"#efdfb2",.037)
          polygon(g,[.1,-.045,.23,0,.1,.045],"#eff5df","",0)
          line(g,-.21,0,-.3,-.055,color,.045);line(g,-.21,0,-.3,.055,color,.045)
          g.restore()
        }
      }
      if(a.style==="shell"&&p<.22) {
        g.save();g.translate(launchX,launchY);g.scale(side,1)
        const q=1-p/.22
        polygon(g,[-.08,-.09,.14,-.065,.31,-.16,.55,0,.30,.15,.15,.07,-.08,.09],`rgba(255,191,82,${q*.9})`,"",0)
        ellipse(g,.14,0,.2*q,.10*q,"#fff2ca")
        g.restore()
      }
    }
    g.restore()
    if(p>=impact) {
      const q=(p-impact)/(1-impact), alpha=1-q
      g.save();g.translate(a.x2,a.y2)
      if(a.style==="shell") {
        for(let j=0;j<7;j++) {
          const ang=j*TAU/7+a.source*.7,rr=.12+q*.72
          ellipse(g,Math.cos(ang)*rr,Math.sin(ang)*rr-q*.2,.15+q*.2,.12+q*.2,`rgba(101,103,89,${alpha*.26})`)
        }
        ellipse(g,0,0,.26*(1-q),.22*(1-q),`rgba(255,224,150,${alpha})`)
      }
      g.globalAlpha=alpha
      for(let j=0;j<(a.style==="shell"?7:3);j++) {
        const ang=angle+Math.PI+(j-1)*.9+a.target*.37, rr=.05+q*(a.style==="shell"?.65:.27)
        line(g,Math.cos(ang)*rr,Math.sin(ang)*rr,Math.cos(ang)*(rr+.08*alpha),Math.sin(ang)*(rr+.08*alpha),j%2?color:"#fff1c1",.035*alpha+.01)
      }
      g.restore()
    }
  }

  function fallen(g: Ink,x:number,y:number,w:number,h:number,color:string,age:number,duration:number,building=false):void {
    const p=clamp(age/duration)
    if(p>=1)return
    g.save();g.translate(x+w/2,y+h/2);g.globalAlpha=(1-p)*.8
    ellipse(g,0,.1,w*.44,h*.25,"#29302a")
    for(let j=0;j<(building?8:4);j++) {
      const ang=j*2.4,rr=(.08+p*.35)*(building?Math.max(w,h):1)
      const xx=Math.cos(ang)*rr,yy=Math.sin(ang)*rr*.6
      polygon(g,[xx-.10,yy-.06,xx+.07,yy-.08,xx+.12,yy+.04,xx-.07,yy+.09],j%2?color:"#9b9d87","",0)
    }
    g.restore()
  }
  return { role, attackStyle, entity, terrain, attack, fallen, headroom }
}
