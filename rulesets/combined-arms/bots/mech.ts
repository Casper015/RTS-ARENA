// 架炮推进：第 400 tick 就建战车工厂，坦克为主（步枪兵、坦克、重型机甲 2:3:1），门口一座地堡，第 1500 tick 起门前埋 4 颗地雷；坦克射程里有敌人就架炮，没有敌人才收炮往前挪，兵力够 18 个步枪兵才推。
// 正面很硬，推得慢；怕空中战舰（坦克打不到空中）和绕过来砍工人的。
/** 这个 bot 的打法参数（几个参考 bot 共用下面的写法，只有这里不一样）。mix 是步枪兵、坦克、重型机甲、空中战舰的配比；pushAt 是推进时兵力按造价折成几个步枪兵 */
const CFG = {
  workers: 16,
  barracks: 1,
  bunkers: 1,
  factories: 1,
  airports: 0,
  turrets: 1,
  factoryTick: 400,
  airportTick: 99999,
  turretTick: 1500,
  depotTick: 2500,
  mineTick: 1500,
  mines: 4,
  guards: 2,
  mix: { rifleman: 2, tank: 3, mech: 1, warship: 0 },
  pushAt: 18,
  pushTick: 2200,
  siege: true,
}

// ======================= 下面是几个参考 bot 共用的写法（各 bot 只有上面的 CFG 不一样） =======================

const ARMY: TypeName[] = ["rifleman", "tank", "mine", "mech", "warship"]
/** 兵种配比的键（地雷单独算，按 CFG.mines 补） */
type MixKey = "rifleman" | "tank" | "mech" | "warship"

let mode: "defend" | "push" = "defend"
/** 地雷 id → 要埋的格子（下标） */
const mineSpot = new Map<number, number>()
let spots: Pos[] | null = null

const cost = (t: TypeName) => game.types[t].cost.gold ?? 0
const walkAt = (x: number, y: number) => x >= 0 && y >= 0 && x < game.width && y < game.height && !!game.walkable[game.terrain[y][x]]
const center = (e: { x: number; y: number; w: number; h: number }): Pos => ({ x: e.x + Math.floor(e.w / 2), y: e.y + Math.floor(e.h / 2) })

/** 从 a 往 b 走 n 格（落到最近能走的格子） */
function toward(a: Pos, b: Pos, n: number): Pos {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.abs(dx) + Math.abs(dy) || 1
  return nearWalk(Math.round(a.x + (dx * n) / len), Math.round(a.y + (dy * n) / len))
}

function nearWalk(x: number, y: number): Pos {
  for (let r = 0; r <= 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (walkAt(x + dx, y + dy)) return { x: x + dx, y: y + dy }
      }
  return { x, y }
}

function nearest<T extends { x: number; y: number; w: number; h: number }>(from: Pos, list: T[]): T | undefined {
  let best: T | undefined
  let bd = Infinity
  for (const e of list) {
    const d = dist({ x: from.x, y: from.y, w: 1, h: 1 }, e)
    if (d < bd) {
      bd = d
      best = e
    }
  }
  return best
}

export function onTick(view: View, cmd: Commands): void {
  const me = view.me
  const mine = view.entities.filter((e) => e.owner === me)
  const foes = view.entities.filter((e) => e.owner >= 0 && e.owner !== me)
  const base = mine.find((e) => e.type === "base")
  if (!base) return
  const eb = view.objectives.enemyBases[0]
  const home = center(base)
  const enemyHome = { x: eb.x + 1, y: eb.y + 1 }
  const all = (t: TypeName) => mine.filter((e) => e.type === t)
  const done = (t: TypeName) => all(t).filter((e) => !e.construction)
  let gold = view.resources.gold
  let reserve = 0
  const workers = all("worker")
  const busy = new Set<number>()
  // 只采离自己比离对手近的矿（中间的矿在对手的兵眼皮底下）
  const goldmines = view.entities.filter((e) => e.type === "goldmine" && (e.amount ?? 0) > 0 && dist(e, base) <= dist(e, { x: eb.x, y: eb.y, w: 3, h: 3 }))

  // ---------- 建造 ----------
  const freeWorker = (near: Pos) => nearest(near, workers.filter((w) => !busy.has(w.id) && w.order?.kind !== "build"))
  /** 放一座建筑；钱不够时 hold 为 true 就把钱留着等它（出兵先停），false 就先不放 */
  const place = (type: TypeName, near: Pos, hold: boolean, range = 8): boolean => {
    if (gold - reserve < cost(type)) {
      if (hold) reserve += cost(type)
      return false
    }
    const spot = findBuildSpot(view, type, near, range, 1)
    const w = spot ? freeWorker(spot) : undefined
    if (!spot || !w) return false
    cmd.build(w, type, spot.x, spot.y)
    busy.add(w.id)
    gold -= cost(type)
    return true
  }
  // 没建好的地基：没人在建就派一个
  for (const site of mine.filter((e) => e.construction)) {
    if (workers.some((w) => w.order?.kind === "build" && w.order.target === site.id)) continue
    const w = freeWorker(site)
    if (w) {
      cmd.build(w, site.type, site.x, site.y)
      busy.add(w.id)
    }
  }
  const front = toward(home, enemyHome, 6)
  const homeMines = goldmines.filter((m) => dist(m, base) <= 10)
  const natural = goldmines.filter((m) => dist(m, base) > 12 && dist(m, base) < dist(m, { x: eb.x, y: eb.y, w: 3, h: 3 }))
  const wantDepot = all("depot").length === 0 && natural.length > 0 && (view.tick >= CFG.depotTick || homeMines.reduce((a, m) => a + (m.amount ?? 0), 0) < 700)
  // 建筑：类型、要几座、放在哪附近、现在该不该建、钱不够时要不要留着钱等它（只有兵营、战车工厂、机场、仓库留钱，地堡、防空塔钱够才建）
  const order: [TypeName, number, Pos, boolean, boolean][] = [
    ["barracks", 1, front, workers.length >= 6, true],
    ["bunker", CFG.bunkers, toward(home, enemyHome, 9), done("barracks").length > 0, false],
    ["factory", CFG.factories, toward(home, enemyHome, 4), done("barracks").length > 0 && view.tick >= CFG.factoryTick, true],
    ["airport", CFG.airports, toward(home, { x: home.x, y: enemyHome.y }, 5), done("barracks").length > 0 && view.tick >= CFG.airportTick, true],
    ["depot", 1, natural.length ? toward(center(natural[0]), home, 3) : home, wantDepot, true],
    ["turret", CFG.turrets, toward(home, enemyHome, 7), view.tick >= CFG.turretTick, false],
    ["barracks", CFG.barracks, front, view.tick >= 1500, false],
  ]
  for (const [type, want, near, ready, hold] of order) {
    if (!ready || all(type).length >= want) continue
    if (mine.some((e) => e.type === type && e.construction)) continue
    if (place(type, near, hold) || hold) break
  }

  // ---------- 采矿 ----------
  const drops = mine.filter((e) => game.types[e.type].dropOff && !e.construction)
  const load = new Map<number, number>()
  for (const w of workers) if (w.order?.kind === "gather") load.set(w.order.target, (load.get(w.order.target) ?? 0) + 1)
  const threatNear = (m: Entity) => foes.some((f) => game.types[f.type].kind === "unit" && f.type !== "worker" && dist(f, m) <= 6)
  for (const w of workers) {
    if (busy.has(w.id) || (w.order && w.order.kind !== "idle")) continue
    let best: Entity | undefined
    let bs = Infinity
    for (const m of goldmines) {
      if (threatNear(m)) continue
      const d = (nearest(center(m), drops) ? dist(m, nearest(center(m), drops)!) : 50) + dist(w, m) * 0.3 + (load.get(m.id) ?? 0) * 6
      if (d < bs) {
        bs = d
        best = m
      }
    }
    if (best) {
      cmd.gather(w, best)
      load.set(best.id, (load.get(best.id) ?? 0) + 1)
    }
  }

  // ---------- 生产 ----------
  const queued = (t: TypeName) => mine.reduce((a, e) => a + (e.queue ?? []).filter((q) => q.type === t).length, 0)
  const units = mine.filter((e) => game.types[e.type].kind === "unit").length + mine.reduce((a, e) => a + (e.queue ?? []).length, 0)
  let room = game.unitCap - units
  if (workers.length + queued("worker") < CFG.workers && (base.queue?.length ?? 0) < 2 && room > 0 && gold - reserve >= cost("worker")) {
    cmd.produce(base, "worker")
    gold -= cost("worker")
    room--
  }
  const have = (t: TypeName) => all(t).length + queued(t)
  const mix = CFG.mix as Record<MixKey, number>
  const total = Object.values(mix).reduce((a, x) => a + x, 0) || 1
  const armyN = (Object.keys(mix) as MixKey[]).reduce((a, t) => a + have(t), 0) + 1
  // 空着的生产建筑里，挑全场离配比差得最多的那种兵；钱不够就攒着等它（不然步枪兵便宜，兵营总是先把钱花掉，坦克、战舰永远造不出来）
  const free = [...done("barracks"), ...done("factory"), ...done("airport")].filter((b) => (b.queue?.length ?? 0) < 2)
  const added = new Map<TypeName, number>()
  const gap = (t: MixKey) => (have(t) + (added.get(t) ?? 0)) / armyN - mix[t] / total
  while (free.length && room > 0) {
    let pick: { b: Entity; type: TypeName; need: number } | null = null
    for (const b of free) {
      const can = game.types[b.type].produces
      // 地雷按 CFG.mines 补（战车工厂造），排在兵前面
      if (can.includes("mine") && have("mine") + (added.get("mine") ?? 0) < CFG.mines && view.tick >= CFG.mineTick) {
        pick = { b, type: "mine", need: -10 }
        break
      }
      for (const t of Object.keys(mix) as MixKey[]) if (mix[t] > 0 && can.includes(t) && (!pick || gap(t) < pick.need)) pick = { b, type: t, need: gap(t) }
    }
    if (!pick || gold - reserve < cost(pick.type)) break
    cmd.produce(pick.b, pick.type)
    gold -= cost(pick.type)
    room--
    added.set(pick.type, (added.get(pick.type) ?? 0) + 1)
    free.splice(free.indexOf(pick.b), 1)
  }

  // ---------- 兵 ----------
  const army = mine.filter((e) => ARMY.includes(e.type) && e.type !== "mine")
  const fighting = army.filter((e) => !e.inside)
  const rally = toward(home, enemyHome, 9)
  const threat = foes.filter((f) => game.types[f.type].kind === "unit" && mine.some((m) => game.types[m.type].kind === "building" && dist(f, m) <= 10))
  const power = fighting.reduce((a, e) => a + cost(e.type), 0)
  if (mode === "defend" && power >= CFG.pushAt * 60 && view.tick >= CFG.pushTick) mode = "push"
  if (mode === "push" && power < CFG.pushAt * 20) mode = "defend"
  const goal: Pos = threat.length ? center(nearest(home, threat)!) : mode === "push" ? enemyHome : rally
  // 地堡：留 CFG.guards 个步枪兵在里面
  const bunkers = done("bunker")
  let guards = mine.filter((e) => e.type === "rifleman" && (e.inside || e.order?.kind === "enter")).length
  for (const r of all("rifleman")) {
    if (guards >= CFG.guards || r.inside || r.order?.kind === "enter") continue
    const b = bunkers.find((x) => (x.garrison?.length ?? 0) < (game.types.bunker.garrison?.capacity ?? 0))
    if (!b) break
    cmd.enter(r, b)
    guards++
  }
  for (const u of fighting) {
    if (u.order?.kind === "enter") continue
    // 坦克：射程 9 里有敌人就架炮；没敌人、要走了就收炮
    if (u.type === "tank") {
      const near = foes.some((f) => dist(u, f) <= 9 && (game.types[f.type].kind === "building" || (f.layer ?? "ground") !== "air"))
      if (u.switching) continue
      if (u.mode === "move" && near && CFG.siege) {
        cmd.mode(u, "siege")
        continue
      }
      if (u.mode === "siege") {
        if (!foes.some((f) => dist(u, f) <= 11) && dist(u, goal) > 4) cmd.mode(u, "move")
        continue
      }
    }
    const o = u.order
    const there = o?.kind === "attackMove" && o.x === goal.x && o.y === goal.y
    if (!there && (o?.kind === "idle" || o?.kind === "attackMove" || o === undefined)) cmd.attackMove(u, goal.x, goal.y)
  }
  // 地雷：开到要埋的格子就埋下
  if (!spots) {
    spots = []
    for (const d of [11, 14, 17, 20])
      for (const side of [-3, 0, 3]) {
        const p = toward(home, enemyHome, d)
        const dx = enemyHome.x - home.x
        const dy = enemyHome.y - home.y
        const q = nearWalk(p.x + Math.round((side * -dy) / (Math.abs(dx) + Math.abs(dy) || 1) * 2), p.y + Math.round((side * dx) / (Math.abs(dx) + Math.abs(dy) || 1) * 2))
        if (!spots.some((s) => s.x === q.x && s.y === q.y)) spots.push(q)
      }
  }
  const used = new Set(mineSpot.values())
  for (const m of all("mine")) {
    if (m.mode !== "roll" || m.switching) continue
    let i = mineSpot.get(m.id)
    if (i === undefined) {
      i = spots.findIndex((_, k) => !used.has(k))
      if (i < 0) i = spots.length - 1
      mineSpot.set(m.id, i)
      used.add(i)
    }
    const s = spots[i]
    if (m.x === s.x && m.y === s.y) cmd.mode(m, "buried")
    else if (m.order?.kind !== "move" || m.order.x !== s.x || m.order.y !== s.y) cmd.move(m, s.x, s.y)
    else if (m.order?.kind === "move" && dist(m, { x: s.x, y: s.y, w: 1, h: 1 }) <= 1 && view.tick % 50 === 0) cmd.mode(m, "buried")
  }
}
