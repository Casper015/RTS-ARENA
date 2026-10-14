// 抢钱陪练：几乎不花燃料（同一 tick 它的命令先执行、先扣钱），开局放两座兵营和一座火药工坊，主基地一直造工人，兵营按枪兵、弓兵、骑兵，火药工坊按线列步兵、炮的顺序把队列排满，兵造出来就站在家门口，从不进攻；一直派一个工人从自家门前 10 格往对角那家砌一道城墙，砌到过了地图正中 10 格。
// 2v2 共用金子时当队友：钱一进队里就被它排进队列花掉，逼队友想办法（D-251 攻城拓荒的 hog 搬过来，D-262，用户：给 LLM 压力）。两人局里是只守不攻的对手。
// 城墙（D-262，用户：用来占据更多的资源）：从主基地朝地图正中那个角往前 10 格起，沿着对角线一格一格砌到正中再往前 10 格，把地图斜着隔开一道，
// 对手绕过来要多走路；被拆了就补。墙不贴着石头、水、金矿和建筑砌（两头留缝，不会把谁整个封死）。

/** 兵营、火药工坊各自按这个顺序轮流出兵（钱不够下一个就等，不跳过） */
const BARRACKS_ARMY: TypeName[] = ["spearman", "archer", "cavalry"]
const GUN_ARMY: TypeName[] = ["musketeer", "cannon"]
const BARRACKS = 2
const GUNWORKS = 1
/** 兵营、火药工坊队列排满（平台上限 5 个） */
const QUEUE = 5
/** 主基地队列里一直排着几个工人；工人不到这么多时先补工人再出兵 */
const BASE_QUEUE = 2
const MIN_WORKERS = 12
/** 第几 tick 起攒钱放火药工坊 */
const GUNWORKS_TICK = 600
/** 城墙从门前几格起、过了正中再砌几格 */
const WALL_FROM = 10
const WALL_PAST = 10

let nextBarracks = 0
let nextGun = 0
/** 下一样买工人还是兵；兵这次轮到火药工坊还是兵营 */
let buyWorker = false
let gunTurn = false
/** 兵站的地方：主基地往地图中间走几格（不堵兵营出兵和工人采矿），第一次调用时算好 */
let rally: Pos | null = null
/** 城墙要砌的格子（从门前往对角排好），第一次调用时算好；砌墙的工人 */
let wallLine: Pos[] | null = null
let mason = -1
/** 正在砌的那一格；站到旁边以后等了几次还放不下；这一轮跳过的格子（按格子编号记） */
let target: Pos | null = null
let waited = 0
const skipped = new Set<number>()

const cost = (t: TypeName) => game.types[t].cost.gold ?? 0
const walkAt = (x: number, y: number) => x >= 0 && y >= 0 && x < game.width && y < game.height && !!game.walkable[game.terrain[y][x]]

function nearest(from: Pos, list: Entity[]): Entity | undefined {
  let best: Entity | undefined
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

/** 从 p 往地图中间走 steps 格，落在能走的格子上 */
function towardCenter(p: Pos, steps: number): Pos {
  const dx = Math.sign(game.width / 2 - p.x)
  const dy = Math.sign(game.height / 2 - p.y)
  for (let s = steps; s > 0; s--) {
    const x = p.x + dx * s
    const y = p.y + dy * s
    if (walkAt(x, y)) return { x, y }
  }
  return p
}

/** 城墙的格子：主基地朝对角那个角的方向，从主基地前角往前 WALL_FROM 格，一直到地图正中再往前 WALL_PAST 格（八方向相连的一条线，四方向走不过去） */
function planWall(base: Entity): Pos[] {
  const cx = base.x + base.w / 2
  const cy = base.y + base.h / 2
  // 对角那家的主基地中心（地图中心对称或左右、上下都对称，都在这里）
  const vx = game.width - cx - cx
  const vy = game.height - cy - cy
  const len = Math.hypot(vx, vy) || 1
  const ux = vx / len
  const uy = vy / len
  const from = { x: cx + Math.sign(vx) * (base.w / 2) + ux * WALL_FROM, y: cy + Math.sign(vy) * (base.h / 2) + uy * WALL_FROM }
  const to = { x: game.width / 2 + ux * WALL_PAST, y: game.height / 2 + uy * WALL_PAST }
  let x0 = Math.round(from.x)
  let y0 = Math.round(from.y)
  const x1 = Math.round(to.x)
  const y1 = Math.round(to.y)
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  const out: Pos[] = []
  for (;;) {
    out.push({ x: x0, y: y0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  // 不贴着石头、水砌：周围 8 格都要能走（两头和中间留缝，不会和地形连成一道把路封死）
  return out.filter((p) => {
    for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) if (!walkAt(p.x + ddx, p.y + ddy)) return false
    return true
  })
}

export function onTick(view: View, cmd: Commands): void {
  const me = view.me
  let gold = view.resources.gold ?? 0
  let units = 0
  let base: Entity | undefined
  const barracks: Entity[] = []
  const gunworks: Entity[] = []
  const workers: Entity[] = []
  const idleArmy: Entity[] = []
  const mines: Entity[] = []
  const solid: Entity[] = []
  for (const e of view.entities) {
    const kind = game.types[e.type].kind
    if (kind !== "unit") solid.push(e)
    if (e.owner === me) {
      if (e.type === "base") base = e
      else if (e.type === "barracks") barracks.push(e)
      else if (e.type === "gunworks") gunworks.push(e)
      else if (e.type === "worker") workers.push(e)
      else if (e.order?.kind === "idle" && kind === "unit" && e.type !== "scout") idleArmy.push(e)
      if (kind === "unit") units++
      if (e.queue) units += e.queue.length
    } else if (e.type === "goldmine" && (e.amount ?? 0) > 0) mines.push(e)
  }
  if (!base) return
  rally ??= towardCenter(base, 7)
  wallLine ??= planWall(base)
  const room = () => game.unitCap === 0 || units < game.unitCap

  // ---------- 砌墙的工人：一直留一个，死了换一个；墙最便宜，先给它钱 ----------
  let w = workers.find((x) => x.id === mason)
  if (!w && workers.length > 1) {
    w = nearest(wallLine[0] ?? base, workers.filter((x) => x.order?.kind !== "build"))
    mason = w?.id ?? -1
  }
  const wallAt = (p: Pos) => solid.some((e) => e.type === "wall" && e.x === p.x && e.y === p.y)
  if (target && wallAt(target)) target = null
  if (w && w.order?.kind !== "build") {
    // 挑下一格（砌好一格才挑一次，省燃料）：还没有墙、离金矿和别的建筑隔着一格（给采矿和进出留路）、这一轮没跳过的第一格
    if (!target) {
      const near = new Set<number>()
      for (const e of solid)
        if (e.type !== "wall") for (let y = e.y - 1; y <= e.y + e.h; y++) for (let x = e.x - 1; x <= e.x + e.w; x++) near.add(y * game.width + x)
      target = wallLine.find((p) => !wallAt(p) && !near.has(p.y * game.width + p.x) && !skipped.has(p.y * game.width + p.x)) ?? null
      waited = 0
      // 一整条都砌过一遍：被跳过的格子下一轮再试
      if (!target && skipped.size) skipped.clear()
    }
    if (!target) {
      if (w.order?.kind === "idle") {
        const m = nearest(w, mines)
        if (m) cmd.gather(w, m)
      }
    } else if (dist(w, target) === 1) {
      if (gold >= cost("wall") && buildProblem(view, "wall", target.x, target.y) === null) {
        cmd.build(w, "wall", target.x, target.y)
        gold -= cost("wall")
      } else if (++waited > 40) {
        // 有人站在上面或者别的原因一直放不下：这一轮先跳过
        skipped.add(target.y * game.width + target.x)
        target = null
      }
    } else {
      // 站到这格旁边（不站在要砌的那条线上）
      const t = target
      const stand = [{ x: t.x, y: t.y - 1 }, { x: t.x - 1, y: t.y }, { x: t.x + 1, y: t.y }, { x: t.x, y: t.y + 1 }].find(
        (p) => walkAt(p.x, p.y) && !wallLine!.some((q) => q.x === p.x && q.y === p.y) && !solid.some((e) => p.x >= e.x && p.x < e.x + e.w && p.y >= e.y && p.y < e.y + e.h),
      )
      if (stand && (w.order?.kind !== "move" || w.order.x !== stand.x || w.order.y !== stand.y)) cmd.move(w, stand.x, stand.y)
      else if (!stand) {
        skipped.add(t.y * game.width + t.x)
        target = null
      }
    }
  }

  let builder: Entity | undefined
  const free = workers.filter((x) => x.id !== mason && x.order?.kind !== "build")
  if (barracks.length < BARRACKS || (gunworks.length < GUNWORKS && view.tick >= GUNWORKS_TICK)) {
    // 兵营（开局）、火药工坊（第 GUNWORKS_TICK tick 起）没放齐之前钱都攒着放它们（一次放一座：同一次调用里 view 不变，两座会找到同一个位置）
    const type: TypeName = barracks.length < BARRACKS ? "barracks" : "gunworks"
    builder = free[0]
    const spot = builder && gold >= cost(type) ? findBuildSpot(view, type, base) : null
    if (builder && spot) cmd.build(builder, type, spot.x, spot.y)
    else builder = undefined
  }
  else {
    // 出兵和造工人轮流来：兵（兵营按枪兵、弓兵、骑兵，火药工坊按线列步兵、炮，哪座队列有空给哪座）、工人、兵、工人……
    // 轮到的那样钱不够就等着攒，不让后面的插队（不然钱一到 50 就被主基地拿去造工人，兵营永远排不上）
    const added = new Map<number, number>()
    const queued = (b: Entity) => (b.queue?.length ?? 0) + (added.get(b.id) ?? 0)
    for (let n = 0; n < 8 && room(); n++) {
      if (buyWorker || workers.length + queued(base) < MIN_WORKERS) {
        if (queued(base) >= BASE_QUEUE) buyWorker = false
        else if (gold >= cost("worker")) {
          cmd.produce(base, "worker")
          gold -= cost("worker")
          units++
          added.set(base.id, (added.get(base.id) ?? 0) + 1)
          buyWorker = false
          continue
        } else break
      }
      // 兵：兵营、火药工坊轮流，队列有空的那座出它的下一种兵
      const bs = barracks.filter((b) => !b.construction && queued(b) < QUEUE)
      const gs = gunworks.filter((b) => !b.construction && queued(b) < QUEUE)
      const useGun = gs.length > 0 && (gunTurn || bs.length === 0)
      const b = useGun ? gs[0] : bs[0]
      if (!b) {
        // 兵营、火药工坊都排满了：钱给工人
        if (queued(base) < BASE_QUEUE) buyWorker = true
        else break
        continue
      }
      const type = useGun ? GUN_ARMY[nextGun] : BARRACKS_ARMY[nextBarracks]
      if (gold < cost(type)) break
      cmd.produce(b, type)
      gold -= cost(type)
      units++
      added.set(b.id, (added.get(b.id) ?? 0) + 1)
      if (useGun) nextGun = (nextGun + 1) % GUN_ARMY.length
      else nextBarracks = (nextBarracks + 1) % BARRACKS_ARMY.length
      gunTurn = !gunTurn
      buyWorker = true
    }
  }
  // 闲着的工人去采矿（近的、人少的：每多一个人算远 6 格，一个矿旁边只站得下几个），闲着的兵去家门口站着
  const load = new Map<number, number>()
  for (const x of workers) if (x.order?.kind === "gather") load.set(x.order.target, (load.get(x.order.target) ?? 0) + 1)
  for (const x of workers) {
    if (x === builder || x.id === mason || x.order?.kind !== "idle") continue
    let m: Entity | undefined
    let best = Infinity
    for (const g of mines) {
      const d = dist(x, g) + 6 * (load.get(g.id) ?? 0)
      if (d < best) {
        best = d
        m = g
      }
    }
    if (m) {
      cmd.gather(x, m)
      load.set(m.id, (load.get(m.id) ?? 0) + 1)
    }
  }
  for (const u of idleArmy) if (dist(u, rally) > 3) cmd.move(u, rally.x, rally.y)
}
