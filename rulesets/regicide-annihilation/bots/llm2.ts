// 大模型试写（Sonnet 测试员第十、十一轮各 60 分钟写的 v13，困难陪练）：一整团兵带着领主站在军队中央吃满光环，轮流清野、守家，派一个兵骚扰对方兵营，钱花不完时工人去拆对方兵营；击杀价值领先 700 且兵够 14 个、或者快到时间上限还落后才推家。
// 外部大模型试写的 bot（2026-10-10，D-212 收录，换掉第八、九轮的 v8）：子代理只读了 PROMPT.md、看不到平台源码和参考 bot 的源码，
// 当时（D-210 的规则）对 baseline、assassin、escort、llm、turtle、旧 llm2 全胜，对 farmer 三批合计 23-27。原样收录，只改了开头的说明。
//
// 要点（每条都是对战里试出来的）：
//  1. 经济：9 个工人先采家门口的矿，家门口采完再去中间矿（营地离矿一般 10 格，野怪追不到矿边的工人，只躲开营地 3 格内的矿）；
//     兵营一直排满，战士:弓手 = 2:1。
//  2. 领主站在军队中央，打仗时离领主 9 格以上的兵先走回领主身边，保证光环覆盖。
//  3. 军队的 attackMove 默认带 { neutral: true }：野怪咬过来大家一起还手（领主站在发怒的营地边会被野怪磨死）。
//  4. 清野：兵 >= 6 个就去，先在离营地 6 步的集结点聚齐 70%，再整团冲；选营地看路程、刷新时间、谁离得更近。
//  5. 守家：敌兵进家 14 格内或工人挨打，全军迎击；看得见的敌兵战力明显强于我军就退回家。
//  6. 骚扰兵（v9）：第 700 tick 起派一个战士去对手兵营旁边（对手看得见、离它主基地 9～12 格挨不到炮）晃，
//     对手的兵一靠近就撤，过 40 tick 再回来——很多 bot 只要"家里有敌兵"就整团回防，会被一个兵牵着走。
//  7. 工人转职（v11/v13）：手里钱花不完（>= 800 且过了 1800 tick），或兵 >= 42 且钱 >= 300，就不再要工人，
//     9 个工人去拆对手兵营（单位上限 60 含工人；兵营在主基地射程外；很多 bot 只把"兵"当威胁）；兵营拆掉后送去野怪营地腾位置。
//  8. 推家：只在 击杀价值领先 700 且兵 >= 14，或第 4800 tick 后击杀价值落后且兵 >= 16 时推。
//  9. 看得见对方领主且射程内：弓手（4 格内）、战士（2 格内）集火领主；击退：领主 6 格内有 >= 3 个敌人就放。
//
// 座位镜像：所有"一样近 / 一样好取谁"的地方都用 canonLess()——右下座位把坐标中心翻转后再比。

let W = 0
let H = 0
let inited = false
let seat0 = true
let pdHome: number[] = []
let pdEnemy: number[] = []
let pdCamp: number[][] = []
let campMargin: number[] = [] // 对手到营地的步数 − 我到营地的步数（正：我更近）
let stageCell: ({ x: number; y: number } | null)[] = []
let rally: { x: number; y: number } = { x: 0, y: 0 }
let phase: "gather" | "farm" | "push" = "gather"
let curCamp = -1
let stageReady = false
let enemyBarDead = false
let raidStage: { x: number; y: number } | null = null // 工人偷袭对手兵营的集结点：贴着兵营、离对手主基地 8 格以上（挨不到炮）
let disposeWorkers = false // 兵营满编后把工人送去送死，腾出单位上限给兵
let enemyBarPos: { x: number; y: number; w: number; h: number } | null = null // 对手兵营：我兵营的中心对称位置
let decoyId = -1 // 骚扰兵：一个兵在对手家附近晃，把对手整团兵引回家
let decoyPost: { x: number; y: number } | null = null
let decoyFlee: { x: number; y: number } | null = null
let decoyNextSpawn = 0
let decoyHold = 0
let lastLordPos: { x: number; y: number } | null = null

// ---- 可调参数 ----
const WORKERS = 9
const SOLDIER_PER_ARCHER = 2
const FARM_MIN = 6
const DECOY_FROM = 700 // 从这个 tick 起派一个骚扰兵
const RAID_GOLD = 800 // 手里钱花不完（>= 这么多）且过了 1800 tick，工人去偷对手兵营
const DISPOSE_ARMY = 42 // 兵（不含工人、领主）够这么多且手里有钱，就不再要工人
const PUSH_MIN = 999 // 不再无条件推家：同等水平下进攻方吃亏，只在领先或快超时落后时推
const PUSH_LEAD_MIN = 14 // 击杀价值领先 PUSH_LEAD 且兵够这么多就推家
const PUSH_LEAD = 700

function canonXY(x: number, y: number): [number, number] {
  return seat0 ? [x, y] : [W - 1 - x, H - 1 - y]
}
function cidx(x: number, y: number): number {
  return y * W + x
}
// 比较两个点的"镜像顺序"
function canonLess(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const [ax, ay] = canonXY(a.x, a.y)
  const [bx, by] = canonXY(b.x, b.y)
  return ax < bx || (ax === bx && ay < by)
}
// 资源点自己的格子走不到（-1），取四邻最小 +1
function pdNear(pd: number[], p: { x: number; y: number }): number {
  const v = pd[cidx(p.x, p.y)]
  if (v >= 0) return v
  let best = -1
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = p.x + dx
    const y = p.y + dy
    if (x < 0 || y < 0 || x >= W || y >= H) continue
    const w = pd[cidx(x, y)]
    if (w >= 0 && (best < 0 || w + 1 < best)) best = w + 1
  }
  return best
}
function isWalk(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= W || y >= H) return false
  return !!game.walkable[game.terrain[y][x]]
}

function init(view: View) {
  W = game.width
  H = game.height
  const base = view.entities.find((e) => e.owner === view.me && e.type === "base")!
  seat0 = base.x < W / 2
  pdHome = pathDistances(view, base)
  const eb = view.objectives.enemyBases[0]
  pdEnemy = pathDistances(null, { x: eb.x + 1, y: eb.y + 1 })
  pdCamp = []
  stageCell = []
  campMargin = []
  for (const c of view.objectives.creepCamps) {
    const pd = pathDistances(null, c.cells.length ? c.cells : { x: c.x, y: c.y })
    pdCamp.push(pd)
    const dMe = pd[cidx(base.x + 1, base.y + 1)]
    const dEn = pd[cidx(eb.x + 1, eb.y + 1)]
    campMargin.push(dMe >= 0 && dEn >= 0 ? dEn - dMe : 0)
    // 集结点：离营地 6 步、离我家最近（同样近的按镜像顺序取）
    let best: { x: number; y: number } | null = null
    let bv = 1e9
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = pd[cidx(x, y)]
        if (d !== 6) continue
        const h = pdHome[cidx(x, y)]
        if (h < 0) continue
        if (h < bv || (h === bv && best && canonLess({ x, y }, best))) {
          bv = h
          best = { x, y }
        }
      }
    stageCell.push(best)
  }
  // 家门口集结点：往最近的营地走 9 步的位置
  let bc = 0
  let bd = 1e9
  view.objectives.creepCamps.forEach((c, i) => {
    const d = pdHome[cidx(c.x, c.y)]
    if (d >= 0 && (d < bd || (d === bd && canonLess(c, view.objectives.creepCamps[bc])))) {
      bd = d
      bc = i
    }
  })
  let rb: { x: number; y: number } | null = null
  let rv = 1e9
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (pdHome[cidx(x, y)] !== 9) continue
      const d = pdCamp[bc][cidx(x, y)]
      if (d < 0) continue
      if (d < rv || (d === rv && rb && canonLess({ x, y }, rb))) {
        rv = d
        rb = { x, y }
      }
    }
  rally = rb ?? { x: base.x + 5, y: base.y + 5 }
  const myBar = view.entities.find((e) => e.owner === view.me && e.type === "barracks")
  if (myBar) {
    enemyBarPos = { x: W - myBar.x - myBar.w, y: H - myBar.y - myBar.h, w: myBar.w, h: myBar.h }
    const pdBar = pathDistances(null, { x: enemyBarPos.x, y: enemyBarPos.y })
    const ebRect = { x: eb.x, y: eb.y, w: 3, h: 3 }
    // 骚扰点：离对手兵营 4～5 格（兵营视野 5，对手看得见）、离对手主基地 9～12 格（挨不到炮、又在对手"家里有敌兵"的 14 格内）
    let bp: { x: number; y: number } | null = null
    let bv = 1e9
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!isWalk(x, y) || pdHome[cidx(x, y)] < 0 || pdBar[cidx(x, y)] < 0) continue
        const db = dist({ x, y }, enemyBarPos)
        const dh = dist({ x, y }, ebRect)
        if (db < 4 || db > 5 || dh < 9 || dh > 12) continue
        // 偏好离我家近（先到）的一侧
        const v = pdHome[cidx(x, y)]
        if (v < bv || (v === bv && bp && canonLess({ x, y }, bp))) {
          bv = v
          bp = { x, y }
        }
      }
    decoyPost = bp
    // 撤退点：从骚扰点往我家方向 12 步左右（对手看不见的地方）
    let fp: { x: number; y: number } | null = null
    let fv = 1e9
    if (bp) {
      const pdPost = pathDistances(null, bp)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!isWalk(x, y) || pdPost[cidx(x, y)] !== 12 || pdHome[cidx(x, y)] < 0) continue
          const v = pdHome[cidx(x, y)]
          if (v < fv || (v === fv && fp && canonLess({ x, y }, fp))) {
            fv = v
            fp = { x, y }
          }
        }
    }
    decoyFlee = fp
    let rp: { x: number; y: number } | null = null
    let rv = 1e9
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!isWalk(x, y) || pdHome[cidx(x, y)] < 0) continue
        if (dist({ x, y }, enemyBarPos) > 3 || dist({ x, y }, enemyBarPos) < 1) continue
        if (dist({ x, y }, ebRect) < 8) continue
        const v = pdHome[cidx(x, y)]
        if (v < rv || (v === rv && rp && canonLess({ x, y }, rp))) {
          rv = v
          rp = { x, y }
        }
      }
    raidStage = rp
  }
  inited = true
}

function nearestBy<T extends { x: number; y: number }>(list: T[], from: { x: number; y: number }): T | null {
  let best: T | null = null
  let bd = 1e9
  for (const e of list) {
    const d = dist(from, e)
    if (d < bd || (d === bd && best && canonLess(e, best))) {
      bd = d
      best = e
    }
  }
  return best
}

function isMil(e: Entity): boolean {
  return e.type === "soldier" || e.type === "archer"
}

// 一方的战力：总有效血量 × 总有效输出
function force(list: Entity[]): number {
  let hp = 0
  let dps = 0
  for (const e of list) {
    let dm = 0
    let df = 0
    for (const b of e.buffs ?? []) {
      dm += b.damagePct
      df += b.defensePct
    }
    const t = game.types[e.type]
    const a = e.stats?.attack ?? t.attack
    if (!a) continue
    hp += e.hp / Math.max(0.1, 1 - df / 100)
    dps += (a.damage * (1 + dm / 100)) / a.cooldown
  }
  return hp * dps
}

export function onTick(view: View, cmd: Commands): void {
  if (!inited) init(view)
  const me = view.me
  const tick = view.tick
  const mine = view.entities.filter((e) => e.owner === me)
  const base = mine.find((e) => e.type === "base")
  const barracks = mine.find((e) => e.type === "barracks")
  const lord = mine.find((e) => e.type === "lord")
  const workers = mine.filter((e) => e.type === "worker")
  const armyAll = mine.filter(isMil)
  // ---- 骚扰兵 ----
  let decoy = armyAll.find((e) => e.id === decoyId)
  if (!decoy && decoyId >= 0) {
    decoyId = -1
    decoyNextSpawn = tick + 250
  }
  if (!decoy && tick >= DECOY_FROM && tick >= decoyNextSpawn && armyAll.length >= 8 && decoyPost) {
    // 挑最靠近对手那边的一个战士
    const sol = armyAll.filter((e) => e.type === "soldier")
    let bd = 1e9
    for (const e of sol) {
      const d = pdEnemy[cidx(e.x, e.y)]
      if (d >= 0 && (d < bd || (d === bd && decoy && canonLess(e, decoy)))) {
        bd = d
        decoy = e
      }
    }
    if (decoy) decoyId = decoy.id
  }
  const army = armyAll.filter((e) => e.id !== decoyId)
  const enemies = view.entities.filter((e) => e.owner >= 0 && e.owner !== me)
  const enemyMil = enemies.filter(isMil)
  const mines = view.entities.filter((e) => e.type === "goldmine" && (e.amount ?? 0) > 0)
  const creeps = view.entities.filter((e) => e.owner === -1 && e.type === "creep")
  const camps = view.objectives.creepCamps
  if (!base) return

  // ---------------- 生产 ----------------
  let gold = view.resources.gold
  const baseQ = base.queue ?? []
  const barQ = barracks?.queue ?? []
  const nWorkersAll = workers.length + baseQ.length
  const unitCount = mine.filter((e) => game.types[e.type].kind === "unit").length + baseQ.length + barQ.length
  let cap = game.unitCap ? game.unitCap - unitCount : 99
  const milCount = army.length + barQ.length
  if (!disposeWorkers && ((milCount >= DISPOSE_ARMY && gold >= 300 && tick >= 1500) || (gold >= RAID_GOLD && tick >= 1800))) disposeWorkers = true
  if (!disposeWorkers && nWorkersAll < WORKERS && baseQ.length < 2 && gold >= 50 && cap > 0) {
    cmd.produce(base, "worker")
    gold -= 50
    cap--
  }
  if (barracks) {
    let q = barQ.length
    let nS = army.filter((e) => e.type === "soldier").length + barQ.filter((x) => x.type === "soldier").length
    let nA = army.filter((e) => e.type === "archer").length + barQ.filter((x) => x.type === "archer").length
    while (q < 5 && cap > 0) {
      const t: TypeName = nS <= nA * SOLDIER_PER_ARCHER ? "soldier" : "archer"
      const c = game.types[t].cost.gold ?? 0
      if (gold < c) break
      cmd.produce(barracks, t)
      gold -= c
      cap--
      q++
      if (t === "soldier") nS++
      else nA++
    }
  }

  // 对手兵营还在不在
  const enemyBar = view.entities.find((e) => e.owner >= 0 && e.owner !== me && e.type === "barracks")
  if (!enemyBarDead && view.events.some((ev) => ev.kind === "died" && ev.type === "barracks" && ev.owner >= 0 && ev.owner !== me)) enemyBarDead = true
  // ---------------- 工人 ----------------
  if (disposeWorkers && !enemyBarDead && enemyBarPos && raidStage) {
    // 单位上限 60 含工人，钱又花不完：9 个工人去拆对手兵营（800 血，3 点伤害 × 9 约 300 tick）。
    // 对手 bot 多半只把"兵"当威胁，不会因为几个工人回防；兵营挨不到主基地的炮。拆了它对手就不能补兵，击杀价值 +400。
    for (const w of workers) {
      if (enemyBar) cmd.attack(w, enemyBar)
      else cmd.move(w, raidStage.x, raidStage.y)
    }
  } else if (disposeWorkers) {
    // 单位上限 60 含工人：钱已经花不完，工人占的位置不如换成兵——送去野怪营地（不会有人得分）
    let tc = camps[0]
    let td = 1e9
    for (const c of camps) {
      const d = pdNear(pdHome, c)
      if (d >= 0 && (d < td || (d === td && canonLess(c, tc)))) {
        td = d
        tc = c
      }
    }
    for (const w of workers) cmd.attackMove(w, tc.x, tc.y, { neutral: true })
  } else {
    const assigned = new Map<number, number>()
    for (const w of workers) {
      if (w.order?.kind === "gather") assigned.set(w.order.target, (assigned.get(w.order.target) ?? 0) + 1)
    }
    const candMines = mines.filter((m) => {
      const d = pdNear(pdHome, m)
      if (d < 0 || d > 16) return false
      // 离有野怪的营地 9 格以内的矿不去
      for (const c of camps) {
        if (c.alive > 0 || c.angry) {
          for (const cell of c.cells) if (dist(cell, m) <= 8) return false
        }
      }
      return true
    })
    for (const w of workers) {
      const o = w.order
      if (o && o.kind === "gather") {
        const t = view.entities.find((e) => e.id === (o as any).target)
        if (t && (t.amount ?? 0) > 0) continue
      }
      if (candMines.length === 0) continue
      let best: Entity | null = null
      let bs = 1e9
      for (const m of candMines) {
        const n = assigned.get(m.id) ?? 0
        const s = n * 100 + dist(w, m)
        if (s < bs || (s === bs && best && canonLess(m, best))) {
          bs = s
          best = m
        }
      }
      if (best) {
        cmd.gather(w, best)
        assigned.set(best.id, (assigned.get(best.id) ?? 0) + 1)
      }
    }
  }

  // ---------------- 军队 ----------------
  if (!lord) return
  let cx = lord.x
  let cy = lord.y
  if (army.length) {
    cx = Math.round(army.reduce((s, e) => s + e.x, 0) / army.length)
    cy = Math.round(army.reduce((s, e) => s + e.y, 0) / army.length)
    // 质心可能落在墙里：取离质心最近的一个兵的位置
    const near = nearestBy(army, { x: cx, y: cy })
    if (near) {
      cx = near.x
      cy = near.y
    }
  }
  const armyC = { x: cx, y: cy }

  // 威胁：我家附近的敌兵、离我军 10 格内的敌兵
  const homeThreat = enemyMil.filter((e) => dist(e, base) <= 14)
  const nearEnemy = enemyMil.filter((e) => dist(e, armyC) <= 11 || dist(e, lord) <= 11)
  const workerAttacked = view.events.some(
    (ev) => ev.kind === "damaged" && ev.byOwner >= 0 && mine.some((m) => m.id === ev.id && m.type === "worker"),
  )

  // 领主光环下的我军战力 vs 看得见的敌兵战力
  const myF = force(army.filter((e) => dist(e, lord) <= 9))
  const enF = force(nearEnemy)

  let targetKind: "rally" | "enemy" | "camp" | "base" = "rally"
  let tx = rally.x
  let ty = rally.y
  let neutral = true // 野怪咬过来就还手；推家/撤退时才不打野怪
  let retreat = false

  if (homeThreat.length > 0 || workerAttacked) {
    // 守家：全军迎击
    const t = nearestBy(homeThreat.length ? homeThreat : enemyMil, base)
    if (t) {
      targetKind = "enemy"
      tx = t.x
      ty = t.y
    }
  } else if (nearEnemy.length >= 2 && enF > myF * 1.15) {
    // 打不过：撤回家
    retreat = true
    neutral = false
    targetKind = "rally"
    tx = base.x + 2
    ty = base.y + 2
  } else if (nearEnemy.length > 0) {
    const t = nearestBy(nearEnemy, armyC)!
    targetKind = "enemy"
    tx = t.x
    ty = t.y
  } else if (army.length >= PUSH_MIN || (army.length >= PUSH_LEAD_MIN && view.objectives.killValue[me] - view.objectives.killValue[1 - me] >= PUSH_LEAD) || (tick >= 4800 && army.length >= 16 && view.objectives.killValue[me] <= view.objectives.killValue[1 - me])) {
    phase = "push"
    neutral = false
    const eb = view.objectives.enemyBases[0]
    targetKind = "base"
    tx = eb.x + 1
    ty = eb.y + 1
  } else if (army.length >= FARM_MIN) {
    // 选一个营地
    let bi = -1
    let bs = 1e9
    camps.forEach((c, i) => {
      const pd = pdCamp[i][cidx(armyC.x, armyC.y)]
      const travel = (pd < 0 ? 99 : pd) * 3
      const ready = c.alive > 0 ? 0 : (c.respawnAt ?? tick + 900) - tick
      if (c.size - c.alive === 0 && c.alive === 0) return
      const s = Math.max(travel, ready) + travel * 0.3 + (c.alive > 0 ? 0 : 20) + Math.max(0, -campMargin[i]) * 2 // 对手更近的营地靠后
      if (s < bs || (s === bs && bi >= 0 && canonLess(c, camps[bi]))) {
        bs = s
        bi = i
      }
    })
    if (bi >= 0 && bs < 600) {
      const c = camps[bi]
      if (bi !== curCamp) {
        curCamp = bi
        stageReady = false
      }
      const st = stageCell[bi]
      const near = army.filter((e) => dist(e, st ?? c) <= 5).length
      if (!stageReady && st && near >= army.length * 0.7 && dist(lord, st) <= 7) stageReady = true
      if (stageReady && (c.alive > 0 || (c.respawnAt !== null && c.respawnAt - tick <= 15))) {
        targetKind = "camp"
        // 打活着的野怪：目标是看得见的最近的野怪
        const vis = creeps.filter((e) => c.cells.some((q) => dist(q, e) <= 3))
        const t = vis.length ? nearestBy(vis, armyC)! : { x: c.x, y: c.y }
        tx = t.x
        ty = t.y
        neutral = true
      } else {
        targetKind = "rally"
        tx = st ? st.x : rally.x
        ty = st ? st.y : rally.y
      }
    }
  }
  if (targetKind !== "camp" && targetKind !== "rally") stageReady = false
  if (targetKind === "rally" && !(curCamp >= 0 && army.length >= FARM_MIN)) stageReady = false

  // 推家/撤退途中，野怪贴到领主或兵旁边了也还手
  if (!neutral && creeps.some((c) => dist(c, lord) <= 4 || army.some((u) => dist(c, u) <= 1))) neutral = true
  // 下命令：军队。打仗时离领主太远的兵先回到领主身边（光环 8 格），别散着打
  const inCombat = nearEnemy.length > 0 && !retreat
  // 看得见对手的领主：射程里的兵集火它（杀了领主直接赢）；眩晕时不能跑，放宽范围
  const eLord = enemies.find((e) => e.type === 'lord')
  for (const u of army) {
    if (eLord) {
      const stun = (eLord.stunned ?? 0) > 0
      const rng = u.type === 'archer' ? (stun ? 6 : 4) : stun ? 4 : 2
      if (dist(u, eLord) <= rng) {
        cmd.attack(u, eLord)
        continue
      }
    }
    if (inCombat && dist(u, lord) > 9 && !enemyMil.some((e) => dist(e, u) <= 5)) {
      cmd.move(u, lord.x, lord.y)
    } else {
      cmd.attackMove(u, tx, ty, neutral ? { neutral: true } : undefined)
    }
  }

  // 领主：跟在军队后面
  let lx = lord.x
  let ly = lord.y
  if (retreat || (army.length === 0 && enemyMil.length > 0)) {
    lx = base.x + 1
    ly = base.y + 1
  } else if (army.length > 0) {
    // 领主站到军队中间（质心附近的那个兵旁边），所有兵都吃光环
    lx = armyC.x
    ly = armyC.y
  } else {
    lx = rally.x
    ly = rally.y
  }
  if (dist(lord, { x: lx, y: ly }) > 1) cmd.move(lord, lx, ly)

  // 骚扰兵：在对手兵营旁边晃（对手看得见、离主基地 9～12 格挨不到炮）；对手兵靠近就撤到看不见的地方，过一会儿再回来
  if (decoy && decoyPost) {
    const eNear = enemyMil.filter((e) => dist(e, decoy!) <= 8)
    if (eNear.length > 0) {
      decoyHold = tick + 40
      const f = decoyFlee ?? rally
      if (decoyFlee && dist(decoy, decoyFlee) <= 3) cmd.move(decoy, rally.x, rally.y)
      else cmd.move(decoy, f.x, f.y)
    } else if (tick >= decoyHold && dist(decoy, decoyPost) > 1) {
      cmd.move(decoy, decoyPost.x, decoyPost.y)
    }
  }

  // 击退：领主 6 格内有 3 个以上敌人
  const cd = lord.skillCooldowns?.repel ?? 0
  if (cd === 0) {
    const close = enemies.filter((e) => e.type !== "base" && e.type !== "barracks" && dist(e, lord) <= 6)
    const lordNear = eLord && dist(eLord, lord) <= 7 && enemyMil.some((e) => dist(e, lord) <= 8)
    if (close.length >= 3 || lordNear) cmd.cast(lord, "repel")
  }
}
