// 塔爆（箭塔快攻）：开局留 1 个工人采矿，另外 4 个工人直接走到对手家门口，在它主基地射程外、又够得着它家门口金矿的地方合力建箭塔，专打它采矿的工人；塔被拆了就补，钱够就再加（最多 4 座）。家里补工人、建兵营，凑够 3 门炮和 6 个枪兵就去拆它的主基地。
// 仿照克制拓荒里一个大模型写的「四个工人去对方家门口合建箭塔」的打法（D-217，用户：参考 bot 里要有这种打法，让写 bot 的大模型有防备）。
// - 塔位：离对手主基地 7 格以上（主基地射程 6），离它家门口某个金矿 3 格以内（箭塔射程 4，矿边的工人在射程里），挑能盖住最多金矿、离工人最近的格子。
// - 工人：4 个建塔的工人一起建一座（50 tick 就好）；看到敌兵 3 格内就退到最近的自家箭塔旁边。
// - 家里：主基地补工人到 6 个（工人越多采得越快，但塔要先建）；钱够 150 再建兵营，兵营出炮和枪兵。

const ENGINEERS = 4
const MAX_TOWERS = 4
const HOME_WORKERS = 6
const SIEGE_CANNONS = 3
const SIEGE_SPEARS = 6

let engineers: number[] = []
let pushing = false

function center(e: { x: number; y: number; w: number; h: number }): Pos {
  return { x: e.x + Math.floor(e.w / 2), y: e.y + Math.floor(e.h / 2) }
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

/** 对手主基地占的矩形（开局位置，主基地 3×3） */
function enemyBaseRect(view: View): { x: number; y: number; w: number; h: number } {
  const eb = view.objectives.enemyBases[0]
  return { x: eb.x, y: eb.y, w: 3, h: 3 }
}

/** 塔位：离对手主基地 7 格以上、离它家门口某个金矿 3 格以内；挑盖住金矿最多、离 from 最近的格子 */
function towerSpot(view: View, from: Pos): Pos | null {
  const eb = enemyBaseRect(view)
  const mines = view.entities.filter((e) => e.type === "goldmine" && (e.amount ?? 0) > 0 && dist(e, eb) <= 9)
  if (mines.length === 0) return null
  let best: Pos | null = null
  let bestScore = -Infinity
  const seen = new Set<number>()
  for (const m of mines)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = m.x + dx
        const y = m.y + dy
        const key = y * game.width + x
        if (seen.has(key)) continue
        seen.add(key)
        const c = { x, y, w: 1, h: 1 }
        if (dist(c, eb) < 7) continue
        if (!canBuild(view, "tower", x, y)) continue
        // 别贴着金矿（留出采矿的路）
        if (view.entities.some((e) => game.types[e.type].kind !== "unit" && dist(e, c) <= 0)) continue
        const covered = mines.filter((k) => dist(k, c) <= 3).length
        const score = covered * 100 - dist(c, from)
        if (score > bestScore) {
          bestScore = score
          best = { x, y }
        }
      }
  return best
}

export function onTick(view: View, cmd: Commands): void {
  const mine = view.entities.filter((e) => e.owner === view.me)
  const foes = view.entities.filter((e) => e.owner >= 0 && e.owner !== view.me)
  const base = mine.find((e) => e.type === "base")
  if (!base) return
  const workers = mine.filter((e) => e.type === "worker")
  const towers = mine.filter((e) => e.type === "tower")
  const barracks = mine.find((e) => e.type === "barracks")
  const goldmines = view.entities.filter((e) => e.type === "goldmine" && (e.amount ?? 0) > 0)
  const eb = enemyBaseRect(view)
  let gold = view.resources.gold

  // 开局挑 4 个工人去建塔（留离金矿最近的那个采矿）；死了的划掉
  if (view.tick === 0 || engineers.length === 0) {
    const miner = workers.slice().sort((a, b) => dist(a, nearest(a, goldmines) ?? a) - dist(b, nearest(b, goldmines) ?? b))[0]
    if (view.tick === 0) engineers = workers.filter((w) => w.id !== miner?.id).slice(0, ENGINEERS).map((w) => w.id)
  }
  engineers = engineers.filter((id) => workers.some((w) => w.id === id))
  const crew = workers.filter((w) => engineers.includes(w.id))
  const homeWorkers = workers.filter((w) => !engineers.includes(w.id))

  // ---------- 建塔的工人 ----------
  const site = towers.find((t) => t.construction)
  if (crew.length > 0) {
    const lead = crew[0]
    const threat = foes.filter((e) => game.types[e.type].kind === "unit" && e.type !== "scout" && game.types[e.type].attack)
    for (const w of crew) {
      // 敌兵贴近就退到最近的自家箭塔旁边（没有塔就回家）
      if (threat.some((e) => dist(e, w) <= 3)) {
        const safe = nearest(w, towers.filter((t) => !t.construction)) ?? center(base)
        if (w.order?.kind !== "move" || w.order.x !== safe.x || w.order.y !== safe.y) cmd.move(w, safe.x, safe.y)
        continue
      }
      if (site) {
        // 一起建正在建的那座
        if (w.order?.kind !== "build" || w.order.target !== site.id) cmd.build(w, "tower", site.x, site.y)
        continue
      }
      if (towers.length >= MAX_TOWERS) {
        // 塔够了：去采对手那边离得近的矿（没有就回家采）
        const m = nearest(w, goldmines)
        if (m && w.order?.kind !== "gather") cmd.gather(w, m)
        continue
      }
      if (dist(w, eb) > 14) {
        // 还在路上：走到对手家门口
        const goal = { x: eb.x + 1, y: eb.y + 1 }
        if (w.order?.kind !== "move" || dist({ x: w.order.x, y: w.order.y }, goal) > 2) cmd.move(w, goal.x, goal.y)
        continue
      }
      if (w.id !== lead.id) {
        // 跟着领头的工人，等它放地基
        if (dist(w, lead) > 2 && (w.order?.kind !== "move" || w.order.x !== lead.x || w.order.y !== lead.y)) cmd.move(w, lead.x, lead.y)
        continue
      }
      if (gold < 100) continue
      const spot = towerSpot(view, w)
      if (spot) {
        cmd.build(w, "tower", spot.x, spot.y)
        gold -= 100
      } else {
        // 看不见合适的格子：往对手主基地再靠近一点（不进它的射程）
        const goal = { x: eb.x + 1 + (eb.x > base.x ? -8 : 8), y: eb.y + 1 + (eb.y > base.y ? -8 : 8) }
        if (w.order?.kind !== "move" || w.order.x !== goal.x || w.order.y !== goal.y) cmd.move(w, goal.x, goal.y)
      }
    }
  }

  // ---------- 家里 ----------
  if ((base.queue?.length ?? 0) === 0 && homeWorkers.length < HOME_WORKERS && gold >= 50 + (towers.length < 1 ? 100 : 0)) {
    cmd.produce(base, "worker")
    gold -= 50
  }
  // 第一座塔建好以后建兵营
  if (!barracks && towers.some((t) => !t.construction) && gold >= 150) {
    const builder = homeWorkers[0]
    if (builder) {
      for (let r = 4; r <= 9; r++) {
        const x = base.x + (eb.x > base.x ? r : -r)
        const y = base.y + 1
        if (canBuild(view, "barracks", x, y)) {
          cmd.build(builder, "barracks", x, y)
          gold -= 150
          break
        }
      }
    }
  }
  const barracksSite = barracks?.construction ? barracks : undefined
  for (const w of homeWorkers) {
    if (barracksSite && w.order?.kind !== "build" && homeWorkers.indexOf(w) < 2) {
      cmd.build(w, "barracks", barracksSite.x, barracksSite.y)
      continue
    }
    if (w.order?.kind === "build" || w.order?.kind === "gather") continue
    const m = nearest(base, goldmines.filter((g) => dist(g, base) < dist(g, eb)))
    if (m) cmd.gather(w, m)
  }

  // ---------- 兵营：炮和枪兵 ----------
  const army = mine.filter((e) => e.type === "cannon" || e.type === "spearman")
  const cannons = army.filter((e) => e.type === "cannon")
  const spears = army.filter((e) => e.type === "spearman")
  if (barracks && !barracks.construction && (barracks.queue?.length ?? 0) === 0) {
    const want: TypeName = cannons.length < SIEGE_CANNONS && cannons.length * 2 <= spears.length ? "cannon" : "spearman"
    const cost = game.types[want].cost.gold ?? 0
    if (gold >= cost + (towers.length < MAX_TOWERS ? 100 : 0)) cmd.produce(barracks, want)
  }
  if (cannons.length >= SIEGE_CANNONS && spears.length >= SIEGE_SPEARS) pushing = true
  if (pushing && army.length < 3) pushing = false
  const goal = { x: eb.x + 1, y: eb.y + 1 }
  for (const u of army) {
    const near = foes.filter((e) => dist(e, u) <= 6 && game.types[e.type].kind === "unit")
    if (u.type === "cannon") {
      // 炮打 7 格内最近的建筑，没有就跟着走
      const b = foes.filter((e) => game.types[e.type].kind === "building" && dist(e, u) <= 7).sort((x, y) => dist(x, u) - dist(y, u))[0]
      if (b) {
        if (u.order?.kind !== "attack" || u.order.target !== b.id) cmd.attack(u, b)
        continue
      }
    } else if (near.length > 0) {
      const t = nearest(u, near)!
      if (u.order?.kind !== "attack" || u.order.target !== t.id) cmd.attack(u, t)
      continue
    }
    const to = pushing ? goal : { x: base.x + (eb.x > base.x ? 5 : -3), y: base.y + 1 }
    if (u.order?.kind !== "attackMove" || u.order.x !== to.x || u.order.y !== to.y) cmd.attackMove(u, to.x, to.y)
  }
}
