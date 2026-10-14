// 大模型试写（Haiku 40 分钟写的 v5）：分矿建仓库并留 3 个兵守着，家门口的矿采完就种农田，三座兵营按对方兵种的克制出枪兵、弓兵、骑兵，攒够 22 个兵整队去拆对方主基地，敌人骚扰工人就派兵去打。
// 外部大模型试写的 bot（2026-10-13，D-258）：子代理（Haiku）只读了 PROMPT.md、看不到平台源码和参考 bot 的源码，从空模板写到第 5 版，
// 当时对 7 个参考 bot 每个 4 局共 19 胜 9 负。代码里写了火药工坊出线列步兵、掺炮，可出兵时兵营排在前面先把钱花掉，火药工坊建好了也不出兵（参考 bot 联赛里一个线列步兵都没造），
// 原样收录，只改了开头的说明、补了多人局只认别队为敌人。

const BARRACKS_ARMY: TypeName[] = ["spearman", "archer", "cavalry"]
const ARMY: TypeName[] = ["spearman", "archer", "cavalry", "musketeer", "cannon"]
const ATTACK_SIZE = 22
const WORKER_GOAL = 16

let mode: "eco" | "attack" = "eco"
let depotCands: Pos[] | null = null
let depotIdx = 0
let depotBuilder = -1
const farmMap = new Map<number, number>()

function adjCell(f: Pos): Pos {
  const c: Pos[] = [
    { x: f.x - 1, y: f.y },
    { x: f.x - 1, y: f.y + 1 },
    { x: f.x + 2, y: f.y },
    { x: f.x + 2, y: f.y + 1 },
    { x: f.x, y: f.y - 1 },
    { x: f.x + 1, y: f.y - 1 },
    { x: f.x, y: f.y + 2 },
    { x: f.x + 1, y: f.y + 2 },
  ]
  for (const p of c) if (walk(p.x, p.y)) return p
  return { x: f.x, y: f.y }
}

function walk(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= game.width || y >= game.height) return false
  return game.walkable[game.terrain[y][x]] === true
}

function nearWalk(x: number, y: number): Pos {
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        if (walk(x + dx, y + dy)) return { x: x + dx, y: y + dy }
      }
    }
  }
  return { x, y }
}

function nearestTo(list: Entity[], p: Pos | Entity): Entity {
  let best = list[0]
  for (const e of list) if (dist(e, p) < dist(best, p)) best = e
  return best
}

function pickBuilder(workers: Entity[], busy: Set<number>, p: Pos): Entity | null {
  let best: Entity | null = null
  for (const w of workers) {
    if (busy.has(w.id) || (w.order !== undefined && w.order.kind === "build")) continue
    if (best === null || dist(w, p) < dist(best, p)) best = w
  }
  return best
}

function footprintOk(x: number, y: number, w: number, h: number, mines: Entity[]): boolean {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (!walk(xx, yy)) return false
      for (const m of mines) if (m.x === xx && m.y === yy) return false
    }
  }
  return true
}

function gapTo(x: number, y: number, w: number, h: number, mines: Entity[]): number {
  let best = 999
  for (const m of mines) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) best = Math.min(best, Math.abs(m.x - xx) + Math.abs(m.y - yy))
    }
  }
  return best
}

// 家远处最近的那一组 600 金矿旁边，找离矿隔一格的 2×2 位置，按离家近排序
function computeDepotCands(base: Entity, mines: Entity[]): Pos[] {
  const far = mines.filter((m) => dist(m, base) >= 15)
  if (far.length === 0) return []
  const f = nearestTo(far, base)
  const cl = far.filter((m) => dist(m, f) <= 4)
  const cx = Math.floor(cl.reduce((s, m) => s + m.x, 0) / cl.length)
  const cy = Math.floor(cl.reduce((s, m) => s + m.y, 0) / cl.length)
  const out: Pos[] = []
  for (let y = cy - 6; y <= cy + 6; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (!footprintOk(x, y, 2, 2, mines)) continue
      if (gapTo(x, y, 2, 2, cl) !== 2) continue
      out.push({ x, y })
    }
  }
  out.sort((a, b) => dist(a, base) - dist(b, base))
  return out
}

export function onTick(view: View, cmd: Commands): void {
  const me = view.me
  const mine = view.entities.filter((e) => e.owner === me)
  const base = mine.find((e) => e.type === "base")
  if (!base) return
  // 多人局：只把别的队当敌人，打离自己最近的敌方主基地（收进规则包时补的，两人局不变）
  const foe = (e: Entity): boolean => e.owner >= 0 && e.owner !== me && game.teams[e.owner] !== game.teams[me]
  const eb = view.objectives.enemyBases.slice().sort((a, b) => dist(a, base) - dist(b, base))[0]
  if (!eb) return

  const bc = { x: base.x + 1, y: base.y + 1 }
  const ec = { x: eb.x + 1, y: eb.y + 1 }
  const sx = Math.sign(ec.x - bc.x) || 1
  const sy = Math.sign(ec.y - bc.y) || 1
  const mirror = bc.x > ec.x
  const rally = nearWalk(bc.x + sx * 7, bc.y + sy * 7)
  const cost = (t: TypeName): number => game.types[t].cost.gold ?? 0

  let gold = view.resources.gold
  let reserve = 0
  const busy = new Set<number>()
  const workers = mine.filter((e) => e.type === "worker")
  const army = mine.filter((e) => ARMY.includes(e.type))
  const allMines = view.entities.filter((e) => game.types[e.type].kind === "resource")
  if (depotCands === null) depotCands = computeDepotCands(base, allMines)

  // 1. 没建好的地基：没人在建就派一个工人去接着建
  const fdns = mine.filter((e) => e.construction !== undefined)
  for (const f of fdns) {
    const hasBuilder = workers.some((w) => w.order !== undefined && w.order.kind === "build" && w.order.target === f.id)
    if (hasBuilder) continue
    const b = pickBuilder(workers, busy, f)
    if (b) {
      cmd.build(b, f.type, f.x, f.y)
      busy.add(b.id)
    }
  }

  // 2. 远矿的仓库：派一个工人走过去，到了就放地基
  const depots = mine.filter((e) => e.type === "depot")
  const cands = depotCands ?? []
  if (depots.length === 0 && view.tick >= 300 && workers.length >= 9 && depotIdx < cands.length) {
    const spot = cands[depotIdx]
    let b = workers.find((w) => w.id === depotBuilder)
    if (b === undefined) {
      const c = pickBuilder(workers, busy, spot)
      if (c !== null) {
        b = c
        depotBuilder = c.id
      }
    }
    if (b !== undefined) {
      busy.add(b.id)
      const near = dist(b, { x: spot.x, y: spot.y, w: 2, h: 2 }) <= 2
      if (near) {
        const bp = buildProblem(view, "depot", spot.x, spot.y)
        if (bp !== null) {
          depotIdx++
          depotBuilder = -1
        } else if (gold - reserve >= cost("depot")) {
          cmd.build(b, "depot", spot.x, spot.y)
          gold -= cost("depot")
        } else {
          reserve += cost("depot")
        }
      } else {
        if (b.order === undefined || b.order.kind !== "move") cmd.move(b, spot.x - 1, spot.y)
        reserve += cost("depot")
      }
    }
  }

  // 3. 其他建筑：一次放一座，钱不够就先留着
  const barracksTotal = mine.filter((e) => e.type === "barracks").length
  const gunTotal = mine.filter((e) => e.type === "gunworks").length
  const mines = allMines.filter((e) => (e.amount ?? 0) > 0)
  const near0 = mines.filter((m) => dist(m, base) <= 12)
  const farmTotal = mine.filter((e) => e.type === "farm").length
  const farmWant = (near0.length === 0 ? 3 : 0) + (view.tick >= 2000 ? 2 : 0)
  const wants: { type: "barracks" | "gunworks" | "farm"; need: boolean }[] = [
    { type: "barracks", need: barracksTotal < 1 && workers.length >= 7 },
    { type: "gunworks", need: gunTotal < 1 && barracksTotal >= 1 && view.tick >= 700 },
    { type: "barracks", need: barracksTotal < 2 && view.tick >= 900 && workers.length >= 10 },
    { type: "barracks", need: barracksTotal < 3 && view.tick >= 1800 },
    { type: "farm", need: farmTotal < farmWant && view.tick >= 800 },
  ]
  for (const w of wants) {
    if (!w.need) continue
    const c = cost(w.type)
    if (gold - reserve < c) {
      reserve += c
      break
    }
    const near =
      w.type === "barracks"
        ? { x: bc.x + sx * 4, y: bc.y + sy * 4 }
        : w.type === "gunworks"
          ? { x: bc.x + sx * 4, y: bc.y - sy * 4 }
          : { x: bc.x - sx * 3, y: bc.y + sy * 3 }
    const spot = findBuildSpot(view, w.type, near, 8, 1, mirror)
    const b = spot ? pickBuilder(workers, busy, spot) : null
    if (spot && b) {
      cmd.build(b, w.type, spot.x, spot.y)
      busy.add(b.id)
      gold -= c
      break
    }
  }

  // 3b. 农田：每块田派一个工人站在旁边耕作（命令 idle，不用搬运）
  for (const f of view.objectives.farms) {
    let w: Entity | undefined = workers.find((x) => x.id === farmMap.get(f.id))
    if (w === undefined) {
      const c = pickBuilder(workers, busy, f)
      if (c === null) continue
      w = c
      farmMap.set(f.id, c.id)
    }
    busy.add(w.id)
    if (dist(w, { x: f.x, y: f.y, w: 2, h: 2 }) <= 1) {
      if (w.order !== undefined && w.order.kind !== "idle") cmd.stop(w)
    } else if (w.order === undefined || w.order.kind !== "move") {
      const adj = adjCell(f)
      cmd.move(w, adj.x, adj.y)
    }
  }

  // 4. 采矿：没在干别的、闲着的工人去采家附近最近的矿（同一个矿人多会加罚分）
  const load = new Map<number, number>()
  for (const w of workers) {
    const o = w.order
    if (o !== undefined && o.kind === "gather") load.set(o.target, (load.get(o.target) ?? 0) + 1)
  }
  const pool = near0.length > 0 ? near0 : mines
  for (const w of workers) {
    if (busy.has(w.id)) continue
    const o = w.order
    if (o !== undefined && o.kind !== "idle") continue
    if (pool.length === 0) break
    let best = pool[0]
    let bs = Infinity
    for (const m of pool) {
      const s = dist(w, m) + 6 * (load.get(m.id) ?? 0)
      if (s < bs) {
        bs = s
        best = m
      }
    }
    cmd.gather(w, best)
    load.set(best.id, (load.get(best.id) ?? 0) + 1)
  }

  // 5. 生产：先补工人，再按对方兵种选兵；火药工坊只出线列步兵
  const have: Partial<Record<TypeName, number>> = {}
  const addHave = (t: TypeName): void => {
    have[t] = (have[t] ?? 0) + 1
  }
  for (const e of mine) {
    if (ARMY.includes(e.type) || e.type === "worker") addHave(e.type)
    for (const q of e.queue ?? []) addHave(q.type)
  }
  const seen: Partial<Record<TypeName, number>> = {}
  for (const e of view.entities) {
    if (foe(e) && game.types[e.type].kind === "unit") seen[e.type] = (seen[e.type] ?? 0) + 1
  }
  const sc = (t: TypeName): number => {
    const s = seen.spearman ?? 0
    const a = seen.archer ?? 0
    const c = seen.cavalry ?? 0
    const m = seen.musketeer ?? 0
    const k = seen.cannon ?? 0
    if (t === "spearman") return 2 + 3 * c - 0.5 * m
    if (t === "archer") return 1 + 2 * s + m - 1.5 * c
    if (t === "musketeer") return 2 + 1.5 * s - c - 0.5 * a
    return 1 + 2.5 * a + 1.5 * m + 3 * k - 2 * s
  }
  const pick = (types: TypeName[]): TypeName => {
    let best: TypeName = types[0]
    let bv = -1
    for (const t of types) {
      const v = Math.max(0.2, sc(t)) / ((have[t] ?? 0) + 1)
      if (v > bv) {
        bv = v
        best = t
      }
    }
    return best
  }

  if ((have.worker ?? 0) < WORKER_GOAL && (base.queue ?? []).length < 2 && gold - reserve >= cost("worker")) {
    cmd.produce(base, "worker")
    gold -= cost("worker")
    addHave("worker")
  }
  const barracks = mine.filter((e) => e.type === "barracks" && e.construction === undefined)
  const gunworks = mine.filter((e) => e.type === "gunworks" && e.construction === undefined)
  if ((have.worker ?? 0) >= 8) {
    for (const b of [...barracks, ...gunworks]) {
      if ((b.queue ?? []).length >= 2) continue
      let t: TypeName = pick(BARRACKS_ARMY)
      if (b.type === "gunworks") {
        // 火药工坊：兵够了再掺炮（3 线列步兵配 1 门炮），炮专拆塔和建筑
        t = view.tick >= 2500 && (have.cannon ?? 0) * 3 < (have.musketeer ?? 0) ? "cannon" : "musketeer"
      }
      if (gold - reserve < cost(t) || army.length >= 55) break
      cmd.produce(b, t)
      gold -= cost(t)
      addHave(t)
    }
  }

  // 6. 军队：平时在家门口集结，兵够了整队去打对方主基地；家里有敌人就去解围
  // 家里有敌人，或者敌人贴近了采矿的工人（骚扰、速攻），都派兵去解围
  const threat = view.entities.filter(
    (e) =>
      foe(e) &&
      game.types[e.type].kind === "unit" &&
      (dist(e, base) <= 12 || workers.some((w) => dist(w, e) <= 6)),
  )
  if (mode === "eco" && view.tick >= 1500 && army.length >= ATTACK_SIZE) mode = "attack"
  if (mode === "attack" && army.length <= 4) mode = "eco"
  // 仓库旁边留 3 个兵守着分矿工人，防骑兵速攻
  const depotsDone = mine.filter((e) => e.type === "depot" && e.construction === undefined)
  const guard: Pos | null = depotsDone.length > 0 ? nearWalk(depotsDone[0].x, depotsDone[0].y) : null
  let gi = 0
  for (const u of army) {
    const o = u.order
    if (mode === "eco" && threat.length > 0) {
      const t = nearestTo(threat, base)
      if (o === undefined || o.kind !== "attackMove") cmd.attackMove(u, t.x, t.y)
    } else if (mode === "attack") {
      if (o === undefined || o.kind !== "attackMove") cmd.attackMove(u, ec.x, ec.y)
    } else if (guard !== null && gi < 3) {
      gi++
      if ((o === undefined || o.kind === "idle") && dist(u, guard) > 2) cmd.attackMove(u, guard.x, guard.y)
    } else if ((o === undefined || o.kind === "idle") && dist(u, rally) > 3) {
      cmd.attackMove(u, rally.x, rally.y)
    }
  }
}
