// 看兵出兵（侦察兵盯着对方，出克它的兵）：侦察兵在对方家门口外盯着，记下看到的敌兵，对方骑兵多就多出枪兵、弓兵多就多出骑兵、枪兵多就多出弓兵、有炮就多出骑兵去切；看到对方的塔和墙就出 2 门炮；兵够 16 个、不比对方少就推，打残了退回。工人见到敌兵就跑回主基地的炮下，家门口的矿快采完时建分矿和 3 块农田。
// 3～4 人局：打离自己主基地最近的对手（不是 enemyBases[0]）；分队时队友不算敌人（不攻击、不当威胁），两人共用的金子按队里活着的人平分，各花各的一份。两人局的打法不变。
/** 这个 bot 的打法参数（几个参考 bot 共用下面的写法，只有这里不一样，D-219） */
const CFG = {
  workers: 12,
  workersLate: 16,
  barracksAt: 6,
  barracks: 2,
  secondBarracksAt: 10,
  towers: 1,
  walls: 0,
  depotTick: 2500,
  depotHomeGold: 900,
  farms: 3,
  farmHomeGold: 800,
  farmTick: 99999,
  mix: [1, 1, 1],
  counter: true,
  cannons: 2,
  siegeAlways: false,
  pushAt: 16,
  raidSquad: 0,
  raidMin: 4,
  lateAttack: 1500,
  midTick: 99999,
  midMix: [2, 2, 1],
  midRaid: 0,
  midPushAt: 14,
  militia: true,
  engineers: 0,
  rushTowers: 0,
}

// ======================= 下面是几个参考 bot 共用的写法（各 bot 只有上面的 CFG 不一样） =======================

const isArmy = (e: Entity) => e.type === "spearman" || e.type === "archer" || e.type === "cavalry" || e.type === "cannon"
const isBuilding = (e: Entity) => game.types[e.type].kind === "building"
/** 看到过的敌方兵：id → [类型, 最后看到的 tick, x, y]（600 tick 没再看到就忘掉） */
const seen = new Map<number, { type: TypeName; tick: number; x: number; y: number; owner: number }>()
const SEEN_FOR = 600
/** 看到过对方的箭塔、城墙（要出炮） */
let siegeNeeded = false
let mode: "defend" | "push" = "defend"
let pushSize = 0
/** 骚扰队：骑兵 id；回家集合中 */
const raiders = new Set<number>()
let raidHome = true
let raidTarget = 0
/** 冲进对方主基地射程的那一刻（-1 是没冲进去）；退出骚扰队的骑兵（血太少，留在家里守） */
let diveStart = -1
const retired = new Set<number>()
/** 农田 id → 派去耕它的工人 id */
const farmerOf = new Map<number, number>()
/** 看到过的敌方建筑（不会动）：看不见了也记着，它死了、或者自己人走到旁边没看到它才忘掉（只认眼前看得见的，工人一躲开就忘了箭塔，又走回去挨打） */
const foeMemory = new Map<number, Entity>()
/** 记着的箭塔地基最后一次看到的 tick（看不见以后过一会儿就当它建好了） */
const siteSeen = new Map<number, number>()
/** 塔爆（CFG.engineers > 0）：去对手家门口建塔的工人 id；建好过塔没有（塔全被拆了就收手） */
let engineers: number[] = []
let hadTower = false

/**
 * 打谁（D-244）：离自己主基地直线距离最近的、还在场的敌方主基地（两人局就是对手那个）；一样近的（四人各自为战时左右两家）
 * 取顺时针那家，四家各打下一家，不会都去打编号小的那家
 */
function targetBase<T extends Pos>(bases: T[], home: Pos): T | undefined {
  const far = (r: Pos) => Math.hypot(r.x - home.x, r.y - home.y)
  const side = (r: Pos) => (game.width / 2 - home.x) * (r.y - home.y) - (game.height / 2 - home.y) * (r.x - home.x)
  let best: T | undefined
  for (const r of bases) if (!best || far(r) < far(best) - 0.5 || (Math.abs(far(r) - far(best)) <= 0.5 && side(r) < side(best))) best = r
  return best
}

function nearest<T extends Pos>(from: Pos, list: T[]): T | undefined {
  let best: T | undefined
  let bestD = Infinity
  for (const e of list) {
    const d = dist(from, e)
    if (d < bestD) {
      best = e
      bestD = d
    }
  }
  return best
}

function centerOf(e: { x: number; y: number; w: number; h: number }): Pos {
  return { x: e.x + Math.floor(e.w / 2), y: e.y + Math.floor(e.h / 2) }
}

function clampPos(p: Pos): Pos {
  return { x: Math.max(0, Math.min(game.width - 1, Math.round(p.x))), y: Math.max(0, Math.min(game.height - 1, Math.round(p.y))) }
}

/** 从 p 往 toward 走 steps 格，找最近的能走的格子 */
function toward(p: Pos, to: Pos, steps: number): Pos {
  const dx = to.x - p.x
  const dy = to.y - p.y
  const len = Math.abs(dx) + Math.abs(dy) || 1
  const c = clampPos({ x: p.x + (dx / len) * steps, y: p.y + (dy / len) * steps })
  for (let r = 0; r < 6; r++)
    for (let ox = -r; ox <= r; ox++)
      for (const oy of [r - Math.abs(ox), -(r - Math.abs(ox))]) {
        const x = c.x + ox
        const y = c.y + oy
        if (x >= 0 && y >= 0 && x < game.width && y < game.height && game.walkable[game.terrain[y][x]]) return { x, y }
      }
  return c
}

/** u 打 e 一下的伤害（算克制倍数） */
function hitOn(u: Entity, e: Entity): number {
  const atk = game.types[u.type].attack
  if (!atk) return 0
  return Math.max(1, Math.round((u.stats?.attack?.damage ?? atk.damage) * (atk.vs?.[e.type] ?? 1)))
}

/** 挑目标：射程内几下能打死的（打得疼的、兵优先），射程外挑打得疼又近的 */
function pickTarget(u: Entity, list: Entity[]): Entity | undefined {
  const range = game.types[u.type].attack?.range ?? 1
  let best: Entity | undefined
  let bestScore = Infinity
  for (const e of list) {
    const d = dist(u, e)
    const hits = Math.ceil(e.hp / hitOn(u, e))
    const score = (d <= range ? hits : 1000 + d * 20 + hits) - (isArmy(e) ? 50 : 0) - (e.type === "cannon" && u.type === "cavalry" ? 80 : 0)
    if (score < bestScore) {
      best = e
      bestScore = score
    }
  }
  return best
}

function order(cmd: Commands, u: Entity, kind: "move" | "attackMove", p: Pos): void {
  if (u.order?.kind === kind && u.order.x === p.x && u.order.y === p.y) return
  if (kind === "move") cmd.move(u, p.x, p.y)
  else cmd.attackMove(u, p.x, p.y)
}

function attack(cmd: Commands, u: Entity, t: Entity): void {
  if (u.order?.kind !== "attack" || u.order.target !== t.id) cmd.attack(u, t)
}

/** 农田旁边（贴着它）能站的空格里离 from 最近的 */
/** 塔爆的塔位：离对手主基地 8 格以上（主基地射程 6，围着地基建的工人也不挨打）、离它家门口某个金矿 3 格以内（箭塔射程 4，矿边的工人在射程里）；挑盖住金矿最多的，一样多挑离它主基地远些（10 格封顶）、离 from 近的格子 */
function towerSpot(view: View, from: Pos, eb: { x: number; y: number; w: number; h: number }): Pos | null {
  const mines = view.entities.filter((e) => e.type === "goldmine" && (e.amount ?? 0) > 0 && dist(e, eb) <= 9)
  let best: Pos | null = null
  let bestScore = -Infinity
  const done = new Set<number>()
  for (const m of mines)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = m.x + dx
        const y = m.y + dy
        if (done.has(y * game.width + x)) continue
        done.add(y * game.width + x)
        const c = { x, y, w: 1, h: 1 }
        if (dist(c, eb) < 8 || !canBuild(view, "tower", x, y)) continue
        // 别贴着建筑、金矿（留出采矿的路）
        if (view.entities.some((e) => game.types[e.type].kind !== "unit" && dist(e, c) <= 1)) continue
        const score = mines.filter((k) => dist(k, c) <= 3).length * 100 + Math.min(dist(c, eb), 10) * 15 - dist(c, from)
        if (score > bestScore) {
          bestScore = score
          best = { x, y }
        }
      }
  return best
}

function farmCell(view: View, f: { x: number; y: number }, from: Entity): Pos | null {
  let best: Pos | null = null
  let bestD = Infinity
  for (let y = f.y - 1; y <= f.y + 2; y++)
    for (let x = f.x - 1; x <= f.x + 2; x++) {
      if (x >= f.x && x <= f.x + 1 && y >= f.y && y <= f.y + 1) continue
      if (x < 0 || y < 0 || x >= game.width || y >= game.height || !game.walkable[game.terrain[y][x]]) continue
      if (view.entities.some((e) => e.id !== from.id && x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h)) continue
      const d = Math.abs(x - from.x) + Math.abs(y - from.y)
      if (d < bestD) {
        best = { x, y }
        bestD = d
      }
    }
  return best
}

function decide(view: View, cmd: Commands): void {
  const me = view.me
  const mine = view.entities.filter((e) => e.owner === me)
  const base = mine.find((e) => e.type === "base")
  if (!base) return
  // 敌人 = 不同队的（分队时队友既不是敌人，也不能攻击、不算威胁）
  const myTeam = view.players.find((p) => p.id === me)?.team
  const isFoe = (e: Entity) => e.owner >= 0 && view.players.find((p) => p.id === e.owner)?.team !== myTeam
  const foes = view.entities.filter(isFoe)
  // 自己和队友的实体（队友的视野我们也看得见）
  const teamEnts = view.entities.filter((e) => e.owner >= 0 && !isFoe(e))
  // 已经出局的玩家：他们留下的记忆（建筑、兵）要清掉
  const out = new Set(view.objectives.eliminated)
  const foeArmy = foes.filter(isArmy)
  const visible = new Set(foes.map((e) => e.id))
  for (const b of foes.filter(isBuilding)) {
    foeMemory.set(b.id, b)
    if (b.construction) siteSeen.set(b.id, view.tick)
  }
  for (const ev of view.events) if (ev.kind === "died") foeMemory.delete(ev.id)
  for (const [id, b] of foeMemory) if (out.has(b.owner)) foeMemory.delete(id)
  for (const [id, b] of foeMemory) if (!visible.has(id) && teamEnts.some((e) => dist(e, b) < (game.types[e.type].sight ?? 0) - 1)) foeMemory.delete(id)
  const foeBuildings = [...foeMemory.values()]
  /** 建好的箭塔（看不见的地基过了 60 tick 就当它建好了） */
  const towerUp = (b: Entity) => b.type === "tower" && (!b.construction || (!visible.has(b.id) && view.tick - (siteSeen.get(b.id) ?? 0) > 60))
  const foeTowers = foeBuildings.filter(towerUp)
  /** 去打 t：看得见就 attack，看不见（记着的建筑）就先走过去 */
  const hit = (u: Entity, t: Entity) => {
    if (visible.has(t.id)) attack(cmd, u, t)
    else order(cmd, u, "move", toward(centerOf(t), u, Math.min(game.types[u.type].attack?.range ?? 1, (game.types[u.type].sight ?? 2) - 1)))
  }
  const goldmines = view.entities.filter((e) => e.type === "goldmine" && (e.amount ?? 0) > 0)
  if (view.tick === 0 && CFG.engineers > 0) {
    // 塔爆：开局留离金矿最近的 1 个工人采矿，其余的去对手家门口建塔
    const ws = mine.filter((e) => e.type === "worker")
    const miner = ws.slice().sort((a, b) => dist(a, nearest(a, goldmines) ?? a) - dist(b, nearest(b, goldmines) ?? b))[0]
    engineers = ws.filter((w) => w.id !== miner?.id).slice(0, CFG.engineers).map((w) => w.id)
  }
  engineers = engineers.filter((id) => mine.some((e) => e.id === id))
  const crew = mine.filter((e) => engineers.includes(e.id))
  /** 家里的工人（建塔的不算） */
  const workers = mine.filter((e) => e.type === "worker" && !engineers.includes(e.id))
  const army = mine.filter(isArmy)
  const buildings = mine.filter(isBuilding)
  const done = (t: TypeName) => buildings.filter((b) => b.type === t && !b.construction)
  const all = (t: TypeName) => buildings.filter((b) => b.type === t)
  // 要打的对手：离自己主基地最近的一个（两人局就是唯一的对手；3～4 人局列的是还没出局的）
  const eb = targetBase(view.objectives.enemyBases, base)
  if (!eb) return
  const enemyRect = { x: eb.x, y: eb.y, w: 3, h: 3 }
  const enemyCenter = { x: eb.x + 1, y: eb.y + 1 }
  /** 离某点最近的对手主基地的距离（没有对手是无穷大） */
  const enemyRects = view.objectives.enemyBases.map((b) => ({ x: b.x, y: b.y, w: 3, h: 3 }))
  const nearestEnemyD = (p: Pos | { x: number; y: number; w: number; h: number }) => Math.min(Infinity, ...enemyRects.map((r) => dist(p, r)))
  const home = centerOf(base)
  const drops = buildings.filter((b) => game.types[b.type].dropOff && !b.construction)
  // 家门口还能采的金子：被对方箭塔盯着（5 格内）的矿不算（被塔爆时马上去开分矿、种田）
  const homeGold = goldmines.filter((m) => dist(m, base) <= 10 && !foeBuildings.some((e) => e.type === "tower" && dist(e, m) <= 5)).reduce((a, m) => a + (m.amount ?? 0), 0)
  /** 去不得的矿：在对手那一侧、旁边有敌兵、在箭塔射程边上，或者从交货点走过去要经过箭塔射程（沿直线每格查一下） */
  const unsafe = (m: Entity) => {
    if (dist(m, base) > nearestEnemyD(m) || foes.some((e) => isArmy(e) && dist(e, m) <= 6) || foeTowers.some((t) => dist(t, m) <= 5)) return true
    if (foeTowers.length === 0) return false
    const d = nearest(m, drops)
    if (!d) return false
    const a = centerOf(d)
    const n = Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y))
    for (let i = 1; i < n; i++) {
      const p = { x: Math.round(a.x + ((m.x - a.x) * i) / n), y: Math.round(a.y + ((m.y - a.y) * i) / n) }
      if (foeTowers.some((t) => dist(t, p) <= 5)) return true
    }
    return false
  }
  // 塔爆：建在对手那一侧的塔；塔全被拆了、或者塔够数了就收手，建塔的工人回家
  const rushTowers = buildings.filter((b) => b.type === "tower" && dist(b, enemyRect) < dist(b, base))
  if (rushTowers.some((t) => !t.construction)) hadTower = true
  if (engineers.length && ((hadTower && rushTowers.length === 0) || rushTowers.filter((t) => !t.construction).length >= CFG.rushTowers)) {
    console.log(`第 ${view.tick} tick 塔爆收手（对方那边的塔 ${rushTowers.length} 座），${engineers.length} 个建塔的工人回家`)
    engineers = []
  }
  // 给下一座塔留 100 金：第一座马上建；之后要等兵营建好、出了骑兵（先护住第一座再加塔）
  const nextTower = engineers.length > 0 && !rushTowers.some((t) => t.construction) && (rushTowers.length === 0 || (done("barracks").length > 0 && army.some((u) => u.type === "cavalry")))
  // 同队共用一份金子：队友和我花的是同一份，按队里还活着的人平分，各花各的一份（不超花）
  const teamAlive = Math.max(1, view.players.filter((p) => p.team === myTeam && p.alive).length)
  let gold = Math.floor(view.resources.gold / teamAlive) - (nextTower ? 100 : 0)
  let reserve = 0

  // ---------- 记账：看到的敌兵、塔和墙 ----------
  for (const e of foeArmy) seen.set(e.id, { type: e.type, tick: view.tick, x: e.x, y: e.y, owner: e.owner })
  for (const ev of view.events) if (ev.kind === "died") seen.delete(ev.id)
  for (const [id, s] of seen) if (view.tick - s.tick > SEEN_FOR || out.has(s.owner)) seen.delete(id)
  if (foeBuildings.some((b) => b.type === "tower" || b.type === "wall")) siegeNeeded = true
  const seenCount = (t: TypeName) => [...seen.values()].filter((s) => s.type === t).length
  const enemyStrength = seen.size

  // 威胁：家附近、建筑旁、工人旁的敌方兵；对方在我家附近放的箭塔地基、箭塔（塔爆）
  const threats = foes.filter(
    (e) =>
      game.types[e.type].kind === "unit" &&
      e.type !== "scout" &&
      (dist(e, base) <= 12 || buildings.some((b) => dist(e, b) <= 7) || workers.some((w) => dist(e, w) <= 4)),
  )
  const intruders = foeBuildings.filter((b) => (b.type === "tower" || b.type === "wall") && (dist(b, base) <= 16 || goldmines.some((m) => dist(m, base) <= 12 && dist(b, m) <= 6)))
  if (intruders.length) siegeNeeded = true

  // ---------- 塔爆的工人：一起建塔，躲兵，砍没人护着的炮，塔挨炮时离开塔边 ----------
  if (crew.length > 0) {
    const site = rushTowers.find((t) => t.construction)
    const lead = crew[0]
    // 只躲兵，不躲工人：对方派工人来打地基时接着建
    const threat = foes.filter((e) => isArmy(e) && e.type !== "cannon")
    const siege = foes.filter((e) => e.type === "cannon" && (rushTowers.some((t) => dist(t, e) <= 6) || crew.some((w) => dist(w, e) <= 6)))
    const loneSiege = siege.filter((c) => !threat.some((e) => dist(e, c) <= 3))
    for (const w of crew) {
      const danger = threat.some((e) => dist(e, w) <= 3)
      if (loneSiege.length && !danger) {
        // 炮打的是塔，砍它的人不挨溅射
        attack(cmd, w, nearest(w, loneSiege)!)
        continue
      }
      if (danger) {
        const safe = nearest(w, rushTowers.filter((t) => !t.construction)) ?? home
        order(cmd, w, "move", { x: safe.x, y: safe.y })
        continue
      }
      if (siege.length && rushTowers.some((t) => dist(t, w) <= 1)) {
        // 塔在挨炮：背着炮离开塔边 3 格，别挨溅射
        const c = nearest(w, siege)!
        order(cmd, w, "move", clampPos({ x: w.x + Math.sign(w.x - c.x || 1) * 3, y: w.y + Math.sign(w.y - c.y || 1) * 3 }))
        continue
      }
      if (site) {
        if (w.order?.kind !== "build" || w.order.target !== site.id) cmd.build(w, "tower", site.x, site.y)
        continue
      }
      if (dist(w, enemyRect) > 12) {
        // 先走到对手主基地射程外 11 格，再找塔位（别从它主基地旁边绕过去）
        order(cmd, w, "move", toward(enemyCenter, home, 11))
        continue
      }
      if (w.id !== lead.id) {
        if (dist(w, lead) > 2) order(cmd, w, "move", { x: lead.x, y: lead.y })
        continue
      }
      if (!nextTower || view.resources.gold < 100) continue
      const spot = towerSpot(view, w, enemyRect)
      if (spot) cmd.build(w, "tower", spot.x, spot.y)
      else order(cmd, w, "move", toward(enemyCenter, home, 8))
    }
  }

  // ---------- 建造 ----------
  const busy = new Set<number>()
  const freeWorker = (near: Pos) => nearest(near, workers.filter((w) => !busy.has(w.id) && w.order?.kind !== "build" && ![...farmerOf.values()].includes(w.id)))
  const place = (type: TypeName, near: Pos, range = 8, margin = 1): boolean => {
    const cost = game.types[type].cost.gold ?? 0
    if (gold < cost) {
      reserve = Math.max(reserve, cost)
      return false
    }
    const spot = findBuildSpot(view, type, near, range, margin)
    const w = spot && freeWorker(spot)
    if (!spot || !w) return false
    cmd.build(w, type, spot.x, spot.y)
    busy.add(w.id)
    gold -= cost
    return true
  }
  const sites = buildings.filter((b) => b.construction)
  // 每块地基补够人（兵营、仓库 2 个，别的 1 个）
  for (const s of sites) {
    const want = s.type === "barracks" || s.type === "depot" ? 2 : 1
    const crew = workers.filter((w) => w.order?.kind === "build" && w.order.target === s.id)
    for (const w of crew) busy.add(w.id)
    for (let i = crew.length; i < want; i++) {
      const w = freeWorker(s)
      if (!w) break
      cmd.build(w, s.type, s.x, s.y)
      busy.add(w.id)
    }
  }
  if (sites.length === 0) {
    const front = toward(home, enemyCenter, 5)
    const homeMines = goldmines.filter((m) => dist(m, base) <= 10)
    const mineCenter = homeMines.length ? { x: Math.round(homeMines.reduce((a, m) => a + m.x, 0) / homeMines.length), y: Math.round(homeMines.reduce((a, m) => a + m.y, 0) / homeMines.length) } : front
    const natural = goldmines.filter((m) => dist(m, base) > 12 && dist(m, base) < nearestEnemyD(m)).sort((a, b) => dist(a, base) - dist(b, base))[0]
    const wantDepot = natural && all("depot").length === 0 && (view.tick >= CFG.depotTick || homeGold < CFG.depotHomeGold) && workers.length >= 8
    if (all("barracks").length === 0 && workers.length >= CFG.barracksAt) place("barracks", front, 8)
    else if (intruders.length === 0 && all("barracks").length < CFG.barracks && done("barracks").length > 0 && workers.length >= CFG.secondBarracksAt && gold >= 150) place("barracks", toward(home, enemyCenter, 7), 8)
    else if (wantDepot) place("depot", toward(centerOf(natural), home, 3), 6)
    else if (done("barracks").length > 0 && all("tower").length < CFG.towers && army.length >= 2) {
      // 箭塔放在矿边上朝对手的一侧（防骚扰）；有仓库的话轮流放在分矿
      const depot = done("depot")[0]
      const spot = depot && all("tower").length % 2 === 1 ? toward(centerOf(depot), enemyCenter, 2) : toward(mineCenter, enemyCenter, 2)
      place("tower", spot, 6)
    } else if (CFG.walls > 0 && all("wall").length < CFG.walls && done("tower").length > 0) {
      // 城墙：在箭塔朝对手那一侧砌一小段，挡住冲过来拆塔的近战兵
      const t = done("tower")[all("wall").length % done("tower").length]
      place("wall", toward(t, enemyCenter, 2), 3, 0)
    } else if (all("farm").length < CFG.farms && (homeGold < CFG.farmHomeGold || view.tick >= CFG.farmTick) && done("barracks").length > 0) {
      place("farm", toward(home, enemyCenter, -5), 9)
    }
  }

  // ---------- 生产 ----------
  const queued = (t: TypeName) => mine.reduce((n, e) => n + (e.queue ?? []).filter((q) => q.type === t).length, 0)
  let room = game.unitCap - mine.filter((e) => game.types[e.type].kind === "unit").length - mine.reduce((n, e) => n + (e.queue?.length ?? 0), 0)
  // 工人上限：有仓库或家门口快采完时多补；没有安全的矿可采（被塔爆盯住）时不补，补了也是送死
  const jobs = goldmines.filter((m) => !unsafe(m)).length * 3 + view.objectives.farms.length + 2
  const workerCap = Math.min(jobs, done("depot").length > 0 || homeGold < 600 ? CFG.workersLate : CFG.workers)
  // 家门口有对方建好的箭塔：先攒钱出 1 门炮（炮射程 5，塔打不到它），工人、别的兵都往后排
  const urgentCannon = intruders.some(towerUp) && done("barracks").length > 0 && mine.filter((e) => e.type === "cannon").length + queued("cannon") === 0
  if (urgentCannon) reserve = Math.max(reserve, 180)
  if ((base.queue?.length ?? 0) === 0 && workers.length + queued("worker") < workerCap && gold - reserve >= 50 && room > 0) {
    cmd.produce(base, "worker")
    gold -= 50
    room--
  }
  // 出兵配比：按 CFG.mix；看兵出兵的 bot 再往克对方的方向偏（枪兵克骑兵、骑兵克弓兵、弓兵克枪兵）
  // 前期、中期（rush：前期骑兵杀工人，第 midTick tick 起转成骑兵加弓兵）
  const mid = view.tick >= CFG.midTick
  const mix = mid ? CFG.midMix : CFG.mix
  const weight: Record<string, number> = { spearman: mix[0], archer: mix[1], cavalry: mix[2] }
  if (CFG.counter && enemyStrength >= 3) {
    weight.spearman += seenCount("cavalry") * 2
    weight.cavalry += seenCount("archer") * 2 + seenCount("cannon") * 2
    weight.archer += seenCount("spearman") * 2
  }
  const wantCannons = Math.max(intruders.length ? 1 : 0, siegeNeeded || (CFG.siegeAlways && army.length >= (mid ? CFG.midPushAt : CFG.pushAt) / 2) ? CFG.cannons : 0)
  for (const b of done("barracks")) {
    if ((b.queue?.length ?? 0) > 0 || room <= 0) continue
    let type: TypeName
    const fighting = army.filter((e) => e.type !== "cannon").length
    if (urgentCannon) type = "cannon"
    else if (mine.filter((e) => e.type === "cannon").length + queued("cannon") < wantCannons && (fighting >= 4 || gold - reserve >= 180)) type = "cannon"
    else if (intruders.length && fighting < 4) type = "spearman"
    else {
      const have = (t: string) => army.filter((e) => e.type === t).length + queued(t as TypeName)
      const total = Object.values(weight).reduce((a, x) => a + x, 0) || 1
      const n = army.length + 1
      type = (Object.keys(weight) as TypeName[]).sort((a, c) => have(a) / n - weight[a] / total - (have(c) / n - weight[c] / total))[0]
    }
    const cost = game.types[type].cost.gold ?? 0
    if (gold - (urgentCannon ? 0 : reserve) < cost) break
    cmd.produce(b, type)
    gold -= cost
    room--
  }

  // ---------- 侦察兵：在对手家门口外 10 格盯着，有敌兵靠近就往回跑 ----------
  const scout = mine.find((e) => e.type === "scout")
  if (scout) {
    const danger = foes.some((e) => isArmy(e) && dist(e, scout) <= 7)
    const spot = danger ? toward(enemyCenter, home, 20) : toward(enemyCenter, home, 11)
    if (dist(scout, spot) > 1) order(cmd, scout, "move", spot)
  }

  // ---------- 工人：敌兵靠近就跑回主基地的炮下；塔爆就派人去打地基；农田；采矿 ----------
  const farms = view.objectives.farms
  for (const [fid, wid] of farmerOf) if (!farms.some((f) => f.id === fid) || !workers.some((w) => w.id === wid)) farmerOf.delete(fid)
  const scared = (w: Entity) => foes.some((e) => isArmy(e) && e.type !== "cannon" && dist(e, w) <= 4) || foeTowers.some((t) => dist(t, w) <= 5)
  for (const f of farms) {
    let w = workers.find((u) => u.id === farmerOf.get(f.id))
    if (!w) {
      const taken = new Set(farmerOf.values())
      w = workers.filter((u) => !busy.has(u.id) && u.order?.kind !== "build" && !taken.has(u.id)).sort((a, b) => dist(a, f) - dist(b, f))[0]
      if (!w) continue
      farmerOf.set(f.id, w.id)
    }
    busy.add(w.id)
    const farm = view.entities.find((e) => e.id === f.id)
    if (!farm) continue
    if (dist(w, farm) <= 1) {
      if (w.order?.kind !== "idle") cmd.stop(w)
      continue
    }
    const cell = farmCell(view, f, w)
    if (cell) order(cmd, w, "move", cell)
  }
  // 塔爆：对方工人跑到我家门口建箭塔（旁边还没有建好的塔）时，拉工人去打建塔的工人（地基长血比打得快，打人不打地基）
  const towerBuilders = foes.filter((e) => e.type === "worker" && (dist(e, base) <= 14 || goldmines.some((m) => dist(m, base) <= 10 && dist(e, m) <= 6)) && !foeTowers.some((t) => dist(t, e) <= 5))
  if (CFG.militia && towerBuilders.length) {
    const pool = workers.filter((w) => !busy.has(w.id) && w.order?.kind !== "build" && !scared(w)).sort((a, b) => dist(a, towerBuilders[0]) - dist(b, towerBuilders[0]))
    for (const w of pool.slice(0, Math.min(6, towerBuilders.length * 2))) {
      busy.add(w.id)
      attack(cmd, w, nearest(w, towerBuilders)!)
    }
  }
  const load = new Map<number, number>()
  for (const w of workers) if (w.order?.kind === "gather") load.set(w.order.target, (load.get(w.order.target) ?? 0) + 1)
  for (const w of workers) {
    if (busy.has(w.id) || w.order?.kind === "build") continue
    if (scared(w)) {
      // 跑回主基地旁边（主基地射程 6，会帮忙打）
      if (dist(w, base) > 1) order(cmd, w, "move", toward(home, w, 2))
      continue
    }
    const o = w.order
    if (o?.kind === "gather") {
      const m = goldmines.find((g) => g.id === o.target)
      if (m && !unsafe(m)) continue
    }
    let best: Entity | undefined
    let bestScore = Infinity
    for (const m of goldmines) {
      if (unsafe(m)) continue
      const n = load.get(m.id) ?? 0
      if (n >= 3) continue
      const drop = nearest(m, drops)
      const score = (drop ? dist(drop, m) : 99) + n * 4 + dist(w, m) * 0.2
      if (score < bestScore) {
        best = m
        bestScore = score
      }
    }
    if (best) {
      cmd.gather(w, best)
      load.set(best.id, (load.get(best.id) ?? 0) + 1)
    } else if (dist(w, base) > 2) order(cmd, w, "move", toward(home, w, 2))
  }

  // ---------- 骚扰队：骑兵专杀采矿的工人，不进主基地射程、不靠近箭塔，见到枪兵就跑 ----------
  for (const id of [...raiders]) if (!army.some((u) => u.id === id)) raiders.delete(id)
  // 血掉到三成五以下的退出骚扰队（不会回血，留在家里守），别拖住整队
  for (const u of army) if (raiders.has(u.id) && u.hp < u.maxHp * 0.35) {
    raiders.delete(u.id)
    retired.add(u.id)
  }
  const raidCap = mid ? CFG.midRaid : CFG.raidSquad
  // 中期骚扰队缩小：多出来的骑兵回到主力（和弓兵一起打）
  for (const id of [...raiders]) if (raiders.size > raidCap) raiders.delete(id)
  if (raidCap > 0) for (const u of army) if (u.type === "cavalry" && raiders.size < raidCap && !raiders.has(u.id) && !retired.has(u.id)) raiders.add(u.id)
  const squad = army.filter((u) => raiders.has(u.id))
  if (squad.length > 0) {
    const c = { x: Math.round(squad.reduce((a, u) => a + u.x, 0) / squad.length), y: Math.round(squad.reduce((a, u) => a + u.y, 0) / squad.length) }
    // 只躲箭塔；主基地射程里可以冲进去砍几下，最多待 80 tick
    const forbidden = (p: Entity | Pos) => foeTowers.some((b) => dist(b, p) <= 5)
    const diving = squad.some((u) => dist(u, enemyRect) <= 6)
    if (!diving) diveStart = -1
    else if (diveStart < 0) diveStart = view.tick
    const spears = foes.filter((e) => (e.type === "spearman" || e.type === "archer") && dist(e, c) <= 6).length
    const tooLong = diveStart >= 0 && view.tick - diveStart > 80
    if (!raidHome && (spears * 2 >= squad.length + 1 || tooLong || squad.length < 2)) raidHome = true
    const myTowers = done("tower")
    const loneCannons = foes.filter((e) => e.type === "cannon" && myTowers.some((t) => dist(t, e) <= 7) && !foes.some((x) => (x.type === "spearman" || x.type === "archer") && dist(x, e) <= 3))
    // 塔爆的骚扰队在离对手最近的自家塔旁集合（塔封主矿，骑兵从这里出去砍副矿）
    const post = rushTowers.filter((t) => !t.construction).sort((a, b) => dist(a, enemyRect) - dist(b, enemyRect))[0]
    if (loneCannons.length) {
      // 有没人护着的炮在拆自家的塔：先去砍炮（骑兵打炮 ×3）
      for (const u of squad) attack(cmd, u, nearest(u, loneCannons)!)
    } else if (raidHome) {
      // 回家集合，凑齐了再出去
      const gather = post ? toward(centerOf(post), home, 2) : toward(home, enemyCenter, 4)
      for (const u of squad) order(cmd, u, "move", gather)
      if (squad.length >= Math.min(raidCap, CFG.raidMin) && squad.every((u) => dist(u, gather) <= 4)) raidHome = false
    } else {
      const prey = foes.filter((e) => e.type === "worker" && !forbidden(e))
      if (prey.length) {
        // 离对方主基地远的工人优先（少挨主基地的打），一样远挑近的
        for (const u of squad) {
          const t = prey.slice().sort((a, b) => dist(a, u) - Math.min(dist(a, enemyRect), 7) * 2 - (dist(b, u) - Math.min(dist(b, enemyRect), 7) * 2))[0]
          if (t) attack(cmd, u, t)
        }
      } else {
        // 看不到工人：轮流去对手那一侧的矿（离它主基地远、旁边没有箭塔的）
        const spots = goldmines.filter((m) => dist(m, enemyRect) < dist(m, base) && !forbidden(m)).sort((a, b) => dist(a, enemyRect) - dist(b, enemyRect))
        if (spots.length) {
          const m = spots[raidTarget % spots.length]
          if (squad.every((u) => dist(u, m) <= 4)) raidTarget++
          const p = toward(centerOf(m), home, 2)
          for (const u of squad) order(cmd, u, "move", p)
        }
      }
    }
  }
  const main = army.filter((u) => !raiders.has(u.id))

  // ---------- 主力：守家、推进 ----------
  const rally = toward(home, enemyCenter, 6)
  if (intruders.length > 0 && threats.every((e) => e.type === "worker" || intruders.some((b) => dist(b, e) <= 8))) {
    // 塔爆：先杀建塔的工人，再拆没建好的地基；建好的塔兵够 6 个一起集火，不够就在射程外等炮（炮射程 5，塔打不到）
    const builders = foes.filter((e) => e.type === "worker" && intruders.some((b) => dist(b, e) <= 3))
    const sitesUp = intruders.filter((b) => b.construction && !towerUp(b))
    const towersUp = intruders.filter((b) => !b.construction || towerUp(b))
    // 拆塔只算扛得住箭的：枪兵、骑兵（弓兵 60 血，挨三下就死）
    const fighters = main.filter((u) => u.type === "spearman" || u.type === "cavalry")
    for (const u of main) {
      if (u.type === "cannon") {
        const t = nearest(u, intruders)
        if (t) hit(u, t)
        continue
      }
      const guard = foes.filter((e) => isArmy(e) && dist(e, u) <= 6)
      if (guard.length) {
        const t = pickTarget(u, guard)
        if (t) attack(cmd, u, t)
      } else if (builders.length) attack(cmd, u, nearest(u, builders)!)
      else if (sitesUp.length) hit(u, nearest(u, sitesUp)!)
      else if (towersUp.length && fighters.length >= 6 && u.type !== "archer") hit(u, nearest(u, towersUp)!)
      else if (towersUp.length) {
        // 兵不够：在箭塔射程外守着（有炮就护着炮），等炮来拆
        const t = nearest(u, towersUp)!
        const p = toward(centerOf(t), home, 7)
        if (dist(u, p) > 2) order(cmd, u, "move", p)
      }
    }
    return
  }
  if (threats.length > 0) {
    for (const u of main) {
      const t = pickTarget(u, threats)
      if (t) attack(cmd, u, t)
    }
    return
  }
  const lateGame = view.tick > game.maxTicks - CFG.lateAttack
  const pushAt = mid ? CFG.midPushAt : CFG.pushAt
  if (mode === "defend" && (main.length >= pushAt || (lateGame && main.length >= 8)) && main.length >= enemyStrength * 0.9 && (!siegeNeeded || main.some((u) => u.type === "cannon") || CFG.cannons === 0)) {
    mode = "push"
    pushSize = main.length
    console.log(`第 ${view.tick} tick 出击，兵 ${main.length}，记得对方 ${enemyStrength}`)
  }
  if (mode === "push" && (main.length < pushSize * 0.4 || main.length < 4)) {
    mode = "defend"
    console.log(`第 ${view.tick} tick 撤回，剩 ${main.length}`)
  }
  if (mode === "defend") {
    for (const u of main) if (dist(u, rally) > 3) order(cmd, u, "attackMove", rally)
    return
  }
  // 推进：先打看得见的敌兵；炮打 12 格内的建筑（塔、墙优先）；没敌兵时整队往对方主基地走，先拆兵营、塔，再拆主基地
  const front = main.filter((u) => u.type !== "cannon")
  const fc = front.length ? { x: Math.round(front.reduce((a, u) => a + u.x, 0) / front.length), y: Math.round(front.reduce((a, u) => a + u.y, 0) / front.length) } : home
  const goal = nearest(fc, foeBuildings.filter((b) => b.type === "tower")) ?? nearest(fc, foeBuildings.filter((b) => b.type === "barracks")) ?? nearest(fc, foeBuildings.filter((b) => b.type === "base"))
  for (const u of main) {
    if (u.type === "cannon") {
      const b = foeBuildings.filter((e) => dist(e, u) <= 12).sort((x, y) => (x.type === "tower" || x.type === "wall" ? -100 : 0) + dist(x, u) - ((y.type === "tower" || y.type === "wall" ? -100 : 0) + dist(y, u)))[0]
      if (b && foeArmy.every((e) => dist(e, u) > 3)) hit(u, b)
      else order(cmd, u, "move", toward(fc, home, 2))
      continue
    }
    const near = foes.filter((e) => game.types[e.type].kind === "unit" && e.type !== "scout" && dist(e, u) <= 8)
    if (near.length) {
      const t = pickTarget(u, near)
      if (t) attack(cmd, u, t)
    } else if (goal && dist(u, goal) <= 10) hit(u, goal)
    else if (dist(u, fc) > 6) order(cmd, u, "move", fc)
    else order(cmd, u, "attackMove", toward(fc, enemyCenter, 5))
  }
}

// ======================= 换到「自己在左上角」的视角里决策（D-246，几个参考 bot 共用） =======================
// 同一份写法坐在不同的角，找建筑位置（findBuildSpot 一样近时先试左边、下边）、toward 的取整和找空格的顺序都偏向某个方向，
// 对称的座位会摆出不对称的布局（差一两格），4 人 2v2 里右边那队赢 88%。这里把局面翻成「自己的主基地在左上角」再交给上面的
// decide，它下的命令再翻回去：坐在右半边的左右翻，坐在下半边的上下翻。两人局（中心对称）你在左上或右下，右下就是左右、上下都翻；
// 3～4 人局的长方形四角地图左右、上下都对称（D-261），四个角都翻得到左上角。
// decide 运行时 game 换成翻好的那份（地形跟着翻），findBuildSpot、canBuild、pathDistances 也按它算。

/** 要不要左右翻、上下翻（null 是还没定，第一次 onTick 看自己的主基地在哪半边） */
let flipX: boolean | null = null
let flipY = false
let realGame: Game
let turnedGame: Game

/** 格子 (x, y) 翻过去；翻两次回到原处，所以真实坐标和「左上角」视角的坐标互相换都用它 */
function turnCell(x: number, y: number): [number, number] {
  return [flipX ? realGame.width - 1 - x : x, flipY ? realGame.height - 1 - y : y]
}

/** 占地矩形（左上角 x, y，宽 w、高 h）翻过去 */
function turnRect(x: number, y: number, w: number, h: number): [number, number, number, number] {
  return [flipX ? realGame.width - x - w : x, flipY ? realGame.height - y - h : y, w, h]
}

export function onTick(view: View, cmd: Commands): void {
  if (flipX === null) {
    const b = view.entities.find((e) => e.owner === view.me && e.type === "base")
    if (!b) return
    realGame = game
    flipX = b.x + b.w / 2 >= game.width / 2
    flipY = b.y + b.h / 2 >= game.height / 2
    const terrain: string[] = []
    for (let y = 0; y < game.height; y++) {
      let row = ""
      for (let x = 0; x < game.width; x++) {
        const [rx, ry] = turnCell(x, y)
        row += game.terrain[ry][rx]
      }
      terrain.push(row)
    }
    turnedGame = { ...game, terrain }
  }
  const cell = (x: number, y: number) => turnCell(x, y)
  const box = (x: number, y: number, w: number, h: number) => turnRect(x, y, w, h)
  const entities = view.entities.map((e) => {
    const [x, y] = box(e.x, e.y, e.w, e.h)
    const out: Entity = { ...e, x, y }
    if (e.order && (e.order.kind === "move" || e.order.kind === "attackMove")) {
      const [ox, oy] = cell(e.order.x, e.order.y)
      out.order = { ...e.order, x: ox, y: oy }
    }
    return out
  })
  const base3 = (b: { owner: number; x: number; y: number }) => {
    const [x, y] = box(b.x, b.y, 3, 3)
    return { ...b, x, y }
  }
  const ob = view.objectives
  const objectives = {
    ...ob,
    enemyBases: ob.enemyBases.map(base3),
    allyBases: ob.allyBases.map(base3),
    farms: ob.farms.map((f) => {
      const [x, y] = box(f.x, f.y, 2, 2)
      return { ...f, x, y }
    }),
  }
  const events = view.events.map((ev) => {
    if (ev.kind !== "died") return ev
    const [x, y] = cell(ev.x, ev.y)
    return { ...ev, x, y }
  })
  const to = (x: number, y: number) => turnCell(x, y)
  const turnedCmd: Commands = {
    move: (u, x, y) => cmd.move(u, ...to(x, y)),
    attack: (u, t) => cmd.attack(u, t),
    attackMove: (u, x, y, o) => cmd.attackMove(u, ...to(x, y), o),
    gather: (u, r) => cmd.gather(u, r),
    stop: (u) => cmd.stop(u),
    produce: (b, t) => cmd.produce(b, t),
    cancel: (b) => cmd.cancel(b),
    build: (u, type, x, y) => {
      const d = realGame.types[type]
      const [bx, by] = turnRect(x, y, d.w ?? 1, d.h ?? 1)
      cmd.build(u, type, bx, by)
    },
    cast: (u, skill, t) => {
      if (t && typeof t === "object" && !("id" in t)) {
        const [x, y] = to(t.x, t.y)
        cmd.cast(u, skill, { x, y })
      } else cmd.cast(u, skill, t)
    },
    mode: (u, m) => cmd.mode(u, m),
    enter: (u, b) => cmd.enter(u, b),
    unload: (b) => cmd.unload(b),
    research: (b, r) => cmd.research(b, r),
    addon: (b, t) => cmd.addon(b, t),
    repair: (u, t) => cmd.repair(u, t),
    hold: (u) => cmd.hold(u),
    patrol: (u, x, y) => cmd.patrol(u, ...to(x, y)),
  }
  ;(globalThis as unknown as { game: Game }).game = turnedGame
  try {
    decide({ ...view, entities, objectives, events }, turnedCmd)
  } finally {
    ;(globalThis as unknown as { game: Game }).game = realGame
  }
}
