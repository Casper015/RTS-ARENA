// 空中舰队：步枪兵和空中战舰 3:2，机场挂科技挂件，聚变核心研究主炮充能，战舰能量够 150 就用主炮点射程里最值钱的，攒到兵力够 24 个步枪兵一起推过去拆家。
// 门口两座地堡共进 4 个步枪兵守家，战车工厂只当前置，不建研究所和防空塔。战舰飞过一切、坦克和地雷打不到它；怕成群的步枪兵、重型机甲（打战舰 ×2）和防空塔。
/** 这个 bot 的打法参数（几个参考 bot 共用下面的写法，只有这里不一样）。mix 是步枪兵、医疗兵、坦克、重型机甲、空中战舰的配比；pushAt 是推进时兵力按造价折成几个步枪兵；research 是按顺序要研究的 */
const CFG = {
  workers: 16,
  barracks: 1,
  barracksTick: 1500,
  bunkers: 2,
  factories: 1,
  airports: 1,
  turrets: 0,
  academy: false,
  armory: false,
  fusion: true,
  factoryTick: 450,
  academyTick: 1200,
  armoryTick: 1800,
  airportTick: 700,
  fusionTick: 2000,
  turretTick: 1500,
  depotTick: 2500,
  mineTick: 1500,
  mines: 0,
  guards: 4,
  patrols: 1,
  hold: true,
  repair: true,
  barracksLab: false,
  reactor: false,
  research: ["main_cannon"],
  mix: { rifleman: 3, medic: 0, tank: 0, mech: 0, warship: 2 },
  pushAt: 24,
  pushTick: 2200,
  siege: false,
}

// ======================= 下面是几个参考 bot 共用的写法（各 bot 只有上面的 CFG 不一样） =======================

const ARMY: TypeName[] = ["rifleman", "medic", "tank", "mine", "mech", "warship"]
/** 兵种配比的键（地雷单独算，按 CFG.mines 补） */
type MixKey = "rifleman" | "medic" | "tank" | "mech" | "warship"
const FACTORIES: TypeName[] = ["barracks", "factory", "airport"]

let mode: "defend" | "push" = "defend"
/** 地雷 id → 要埋的格子（下标） */
const mineSpot = new Map<number, number>()
let spots: Pos[] | null = null
/** 挂件的位置被挡住、飞起来挪地方的建筑 id → 要落的左上角 */
const moving = new Map<number, Pos | null>()

const cost = (t: string) => game.types[t as TypeName]?.cost.gold ?? game.researches[t]?.cost.gold ?? 0
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
  const researched = new Set(view.researched)
  let gold = view.resources.gold
  let reserve = 0
  const workers = all("worker")
  const busy = new Set<number>()
  // 只采离自己比离对手近的矿（中间的矿在对手的兵眼皮底下）
  const goldmines = view.entities.filter((e) => e.type === "goldmine" && (e.amount ?? 0) > 0 && dist(e, base) <= dist(e, { x: eb.x, y: eb.y, w: 3, h: 3 }))
  /** 挂件：建筑 id → 挂着的或正在建的挂件 */
  const addonOf = new Map<number, Entity>()
  for (const e of mine) if (e.host) addonOf.set(e.host, e)
  const hasLab = (b: Entity) => {
    const a = addonOf.get(b.id)
    return !!a && a.type === "techlab" && !a.construction
  }

  // ---------- 建造 ----------
  const freeWorker = (near: Pos) => nearest(near, workers.filter((w) => !busy.has(w.id) && w.order?.kind !== "build" && w.order?.kind !== "repair"))
  // 兵营、战车工厂、机场右边留出挂件的地方（2×2，和建筑底边对齐）
  const reserved = mine.filter((e) => FACTORIES.includes(e.type) && !addonOf.has(e.id) && e.layer !== "air").map((b) => ({ x: b.x + b.w, y: b.y + b.h - 2, w: 2, h: 2 }))
  const statics = view.entities.filter((e) => game.types[e.type].kind !== "unit" && e.layer !== "air")
  /** 在 near 附近找能放 type 的左上角：四周空一格；兵营这类右边还要放得下挂件；不占别的建筑的挂件位置 */
  const spotFor = (type: TypeName, near: Pos, range = 8): Pos | null => {
    const d = game.types[type]
    const room = d.addons.length > 0
    for (let r = 0; r <= range; r++)
      for (let ox = -r; ox <= r; ox++)
        for (const oy of r === Math.abs(ox) ? [0] : [r - Math.abs(ox), Math.abs(ox) - r]) {
          const x = near.x - Math.floor(d.w / 2) + ox
          const y = near.y - Math.floor(d.h / 2) + oy
          const box = { x: x - 1, y: y - 1, w: d.w + 2 + (room ? 2 : 0), h: d.h + 2 }
          if (statics.some((s) => dist(s, box) === 0) || reserved.some((s) => dist(s, box) === 0)) continue
          if (buildProblem(view, type, x, y) !== null) continue
          if (room && buildProblem(view, "techlab", x + d.w, y + d.h - 2) !== null) continue
          return { x, y }
        }
    return null
  }
  /** 放一座建筑；钱不够时 hold 为 true 就把钱留着等它（出兵先停），false 就先不放 */
  const place = (type: TypeName, near: Pos, hold: boolean): boolean => {
    if (gold - reserve < cost(type)) {
      if (hold) reserve += cost(type)
      return false
    }
    const spot = spotFor(type, near)
    const w = spot ? freeWorker(spot) : undefined
    if (!spot || !w) return false
    cmd.build(w, type, spot.x, spot.y)
    busy.add(w.id)
    gold -= cost(type)
    return true
  }
  // 没建好的地基（挂件除外，挂件是建筑自己建）：没人在建就派一个
  for (const site of mine.filter((e) => e.construction && !e.host)) {
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
  /** 有没有建好的这种建筑（前置里写的） */
  const ready = (t: string) => done(t as TypeName).length > 0
  // 建筑：类型、要几座、放在哪附近、现在该不该建、钱不够时要不要留着钱等它（只有生产建筑、研究建筑、仓库留钱，地堡、防空塔钱够才建）
  const order: [TypeName, number, Pos, boolean, boolean][] = [
    ["barracks", 1, front, workers.length >= 6, true],
    ["bunker", CFG.bunkers, toward(home, enemyHome, 9), ready("barracks"), false],
    ["factory", CFG.factories, toward(home, enemyHome, 3), ready("barracks") && view.tick >= CFG.factoryTick, true],
    ["academy", CFG.academy ? 1 : 0, toward(home, { x: enemyHome.x, y: home.y }, 5), ready("barracks") && view.tick >= CFG.academyTick, true],
    ["armory", CFG.armory ? 1 : 0, toward(home, { x: home.x, y: enemyHome.y }, 7), ready("factory") && view.tick >= CFG.armoryTick, true],
    ["airport", CFG.airports, toward(home, { x: home.x, y: enemyHome.y }, 5), ready("factory") && view.tick >= CFG.airportTick, true],
    ["fusion", CFG.fusion ? 1 : 0, toward(home, { x: enemyHome.x, y: home.y }, 8), ready("airport") && view.tick >= CFG.fusionTick, true],
    ["depot", 1, natural.length ? toward(center(natural[0]), home, 3) : home, wantDepot, true],
    ["turret", CFG.turrets, toward(home, enemyHome, 7), ready("academy") && view.tick >= CFG.turretTick, false],
    ["barracks", CFG.barracks, front, view.tick >= CFG.barracksTick, false],
  ]
  for (const [type, want, near, ok, hold] of order) {
    if (!ok || all(type).length >= want) continue
    if (mine.some((e) => e.type === type && e.construction)) continue
    if (place(type, near, hold) || hold) break
  }

  // ---------- 挂件：兵营、战车工厂、机场空着就在右边建；位置被挡住就飞起来挪地方 ----------
  const factories = mine.filter((e) => FACTORIES.includes(e.type) && !e.construction)
  for (const b of factories) {
    const target = moving.get(b.id)
    if (b.switching) continue
    if (b.layer === "air") {
      // 飞着：找一块右边放得下挂件的空地，左上角到了就降落
      const spot = target ?? spotFor(b.type, center(b), 10)
      moving.set(b.id, spot)
      if (!spot) continue
      if (b.x === spot.x && b.y === spot.y) cmd.mode(b, "land")
      else if (b.order?.kind !== "move" || b.order.x !== spot.x || b.order.y !== spot.y) cmd.move(b, spot.x, spot.y)
      continue
    }
    moving.delete(b.id)
    if (addonOf.has(b.id) || (b.queue?.length ?? 0) > 0) continue
    const kind: TypeName = b.type === "barracks" && CFG.reactor && done("barracks").indexOf(b) >= 1 ? "reactor" : "techlab"
    if (b.type === "barracks" && kind === "techlab" && !CFG.barracksLab) continue
    if (gold - reserve < cost(kind)) continue
    const x = b.x + b.w
    const y = b.y + b.h - 2
    // 地形、建筑、资源点挡着（单位挡着平台会挪开）：飞起来挪地方
    let blocked = false
    for (let yy = y; yy < y + 2; yy++)
      for (let xx = x; xx < x + 2; xx++) if (!walkAt(xx, yy) || statics.some((s) => dist(s, { x: xx, y: yy, w: 1, h: 1 }) === 0)) blocked = true
    if (blocked) {
      cmd.mode(b, "fly")
      continue
    }
    cmd.addon(b, kind)
    gold -= cost(kind)
  }

  // ---------- 研究：按 CFG.research 的顺序，研究它的建筑空着、钱够就研究 ----------
  const labs = [...done("academy"), ...done("armory"), ...done("fusion"), ...mine.filter((e) => e.type === "techlab" && !e.construction)]
  const studying = new Set<string>(mine.flatMap((e) => (e.queue ?? []).filter((q) => q.research).map((q) => q.type)))
  for (const id of CFG.research) {
    if (researched.has(id) || studying.has(id)) continue
    const r = game.researches[id]
    if (r.requires.some((q) => (game.researches[q] ? !researched.has(q) : !ready(q)))) continue
    const lab = labs.find((b) => game.types[b.type].researches.includes(id) && (b.queue?.length ?? 0) === 0)
    if (!lab) continue
    if (gold - reserve < cost(id)) {
      reserve += cost(id)
      break
    }
    cmd.research(lab, id)
    gold -= cost(id)
    labs.splice(labs.indexOf(lab), 1)
  }

  // ---------- 采矿（工人和空投下来的采矿机） ----------
  const drops = mine.filter((e) => game.types[e.type].dropOff && !e.construction && e.layer !== "air")
  const load = new Map<number, number>()
  const miners = [...workers, ...all("harvester")]
  for (const w of miners) if (w.order?.kind === "gather") load.set(w.order.target, (load.get(w.order.target) ?? 0) + 1)
  const threatNear = (m: Entity) => foes.some((f) => game.types[f.type].kind === "unit" && f.type !== "worker" && dist(f, m) <= 6)
  for (const w of miners) {
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
  // 主基地能量够就空投一台采矿机：投在主基地往剩得最多的矿那边两格（一定看得见），它自己去采
  if ((base.energy ?? 0) >= 50 && (base.skillCooldowns?.calldown ?? 0) === 0) {
    const m = [...homeMines, ...natural].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0]
    if (m) {
      const p = toward(home, center(m), 3)
      cmd.cast(base, "calldown", p)
    }
  }

  // ---------- 修理：家附近受了伤的机械单位、建筑，派工人去修 ----------
  if (CFG.repair) {
    const fixing = workers.filter((w) => w.order?.kind === "repair")
    const hurt = mine.filter((e) => (game.types[e.type].kind === "building" ? !e.construction : game.types[e.type].tags.includes("mech") && e.type !== "harvester") && e.hp < e.maxHp * 0.7 && dist(e, base) <= 14)
    for (const t of hurt) {
      if (fixing.length >= 2 || gold - reserve < 40) break
      if (fixing.some((w) => w.order?.kind === "repair" && w.order.target === t.id)) continue
      if (foes.some((f) => game.types[f.type].attack && dist(f, t) <= 6)) continue
      const w = freeWorker(t)
      if (!w) break
      cmd.repair(w, t)
      busy.add(w.id)
      fixing.push(w)
    }
  }

  // ---------- 生产 ----------
  const queued = (t: TypeName) => mine.reduce((a, e) => a + (e.queue ?? []).filter((q) => !q.research && q.type === t).length, 0)
  const units = mine.filter((e) => game.types[e.type].kind === "unit" && e.lifeLeft === undefined).length + mine.reduce((a, e) => a + (e.queue ?? []).filter((q) => !q.research).length, 0)
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
  /** 这座建筑现在能造 t 吗：要的挂件挂好了、前置建好了 */
  const canMake = (b: Entity, t: TypeName) => {
    const d = game.types[t]
    return game.types[b.type].produces.includes(t) && (!d.needsAddon || hasLab(b)) && d.requires.every((q) => ready(q))
  }
  // 空着的生产建筑里，挑全场离配比差得最多的那种兵；钱不够就攒着等它（不然步枪兵便宜，兵营总是先把钱花掉，坦克、战舰永远造不出来）
  // 挂着反应挂件的同时造两个，队列留 3 个；正在建挂件、飞起来的不生产
  const free = factories.filter((b) => b.layer !== "air" && !(addonOf.get(b.id)?.construction) && (b.queue?.length ?? 0) < (addonOf.get(b.id)?.type === "reactor" ? 3 : 2))
  const added = new Map<TypeName, number>()
  const addedAt = new Map<number, number>()
  const gap = (t: MixKey) => (have(t) + (added.get(t) ?? 0)) / armyN - mix[t] / total
  while (free.length && room > 0) {
    let pick: { b: Entity; type: TypeName; need: number } | null = null
    for (const b of free) {
      // 地雷按 CFG.mines 补（战车工厂造），排在兵前面
      if (canMake(b, "mine") && have("mine") + (added.get("mine") ?? 0) < CFG.mines && view.tick >= CFG.mineTick) {
        pick = { b, type: "mine", need: -10 }
        break
      }
      for (const t of Object.keys(mix) as MixKey[]) if (mix[t] > 0 && canMake(b, t) && (!pick || gap(t) < pick.need)) pick = { b, type: t, need: gap(t) }
    }
    if (!pick || gold - reserve < cost(pick.type)) break
    cmd.produce(pick.b, pick.type)
    gold -= cost(pick.type)
    room--
    added.set(pick.type, (added.get(pick.type) ?? 0) + 1)
    addedAt.set(pick.b.id, (addedAt.get(pick.b.id) ?? 0) + 1)
    // 反应挂件的一次排两个，别的一次排一个
    if ((addedAt.get(pick.b.id) ?? 0) >= (addonOf.get(pick.b.id)?.type === "reactor" ? 2 : 1)) free.splice(free.indexOf(pick.b), 1)
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
  // 巡逻：没开打的时候留 CFG.patrols 个步枪兵在集结点和分矿之间来回走，看着有没有人来偷
  const patrolEnd = natural.length ? toward(center(natural[0]), home, 2) : home
  let patrols = fighting.filter((e) => e.order?.kind === "patrol").length
  /** 这一次已经点了主炮的目标（两艘战舰别打同一个快死的） */
  const shelled = new Map<number, number>()
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
    // 兴奋剂：研究好了、敌人到了跟前、血还多
    if (u.type === "rifleman" && researched.has("stim") && u.hp > 35 && !u.buffs?.some((b) => b.name === "兴奋剂") && (u.skillCooldowns?.stim ?? 0) === 0 && foes.some((f) => game.types[f.type].attack && dist(u, f) <= 6))
      cmd.cast(u, "stim")
    // 主炮：能量够就打射程里最值钱的
    if (u.type === "warship" && researched.has("main_cannon") && (u.energy ?? 0) >= 150 && (u.skillCooldowns?.main_cannon ?? 0) === 0) {
      const worth = (f: Entity) => cost(f.type) || game.types[f.type].maxHp / 4
      const t = foes.filter((f) => dist(u, f) <= 10 && game.types[f.type].kind !== "resource" && f.type !== "worker" && f.hp > (shelled.get(f.id) ?? 0)).sort((a, b) => worth(b) - worth(a) || a.hp - b.hp)[0]
      if (t && worth(t) >= 100) {
        cmd.cast(u, "main_cannon", t)
        shelled.set(t.id, (shelled.get(t.id) ?? 0) + 240)
      }
    }
    const o = u.order
    if (mode === "defend" && !threat.length && u.type === "rifleman" && (o?.kind === "patrol" || patrols < CFG.patrols)) {
      if (o?.kind !== "patrol") {
        cmd.patrol(u, patrolEnd.x, patrolEnd.y)
        patrols++
      }
      continue
    }
    // 守家的时候在集结点坚守（不被引出去追）；医疗兵跟着大部队走
    if (mode === "defend" && !threat.length && CFG.hold && u.type !== "medic" && dist(u, { ...rally, w: 1, h: 1 }) <= 2) {
      if (o?.kind !== "hold") cmd.hold(u)
      continue
    }
    const there = o?.kind === "attackMove" && o.x === goal.x && o.y === goal.y
    if (!there && (o?.kind === "idle" || o?.kind === "attackMove" || o?.kind === "hold" || o?.kind === "patrol" || o === undefined)) cmd.attackMove(u, goal.x, goal.y)
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
