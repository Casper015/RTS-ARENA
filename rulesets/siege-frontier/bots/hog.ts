// 抢钱陪练：几乎不花燃料（同一 tick 它的命令先执行、先扣钱），开局放两座兵营，主基地一直造工人，兵营按枪兵、弓兵、骑兵、炮的顺序把队列排满，兵造出来就站在家门口，从不进攻。
// 2v2 共用金子时当队友：钱一进队里就被它排进队列花掉，逼队友想办法（D-251，用户：给 LLM 压力）。两人局里是只守不攻的对手。

/** 兵营按这个顺序轮流出兵（钱不够下一个就等，不跳过） */
const ARMY: TypeName[] = ["spearman", "archer", "cavalry", "cannon"]
const BARRACKS = 2
/** 兵营队列排满（平台上限 5 个） */
const QUEUE = 5
/** 主基地队列里一直排着几个工人 */
const BASE_QUEUE = 2

let next = 0
/** 兵站的地方：主基地往地图中间走几格（不堵兵营出兵和工人采矿），第一次调用时算好 */
let rally: Pos | null = null

const cost = (t: TypeName) => game.types[t].cost.gold ?? 0

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
    if (x >= 0 && y >= 0 && x < game.width && y < game.height && game.walkable[game.terrain[y][x]]) return { x, y }
  }
  return p
}

export function onTick(view: View, cmd: Commands): void {
  const me = view.me
  let gold = view.resources.gold ?? 0
  let units = 0
  let base: Entity | undefined
  const barracks: Entity[] = []
  const workers: Entity[] = []
  const idleArmy: Entity[] = []
  const mines: Entity[] = []
  for (const e of view.entities) {
    if (e.owner === me) {
      if (e.type === "base") base = e
      else if (e.type === "barracks") barracks.push(e)
      else if (e.type === "worker") workers.push(e)
      else if (e.order?.kind === "idle" && game.types[e.type].kind === "unit" && e.type !== "scout") idleArmy.push(e)
      if (game.types[e.type].kind === "unit") units++
      if (e.queue) units += e.queue.length
    } else if (e.type === "goldmine" && (e.amount ?? 0) > 0) mines.push(e)
  }
  if (!base) return
  rally ??= towardCenter(base, 7)
  const room = () => game.unitCap === 0 || units < game.unitCap
  let builder: Entity | undefined
  if (barracks.length < BARRACKS) {
    // 兵营没放齐之前钱都攒着放兵营（一次放一座：同一次调用里 view 不变，两座会找到同一个位置）
    builder = workers.find((w) => w.order?.kind !== "build")
    const spot = builder && gold >= cost("barracks") ? findBuildSpot(view, "barracks", base) : null
    if (builder && spot) cmd.build(builder, "barracks", spot.x, spot.y)
    else builder = undefined
  } else {
    // 兵营：按顺序轮流排满队列
    for (const b of barracks) {
      if (b.construction) continue
      for (let q = b.queue?.length ?? 0; q < QUEUE && room() && gold >= cost(ARMY[next]); q++) {
        cmd.produce(b, ARMY[next])
        gold -= cost(ARMY[next])
        units++
        next = (next + 1) % ARMY.length
      }
    }
    // 主基地一直造工人
    for (let q = base.queue?.length ?? 0; q < BASE_QUEUE && room() && gold >= cost("worker"); q++) {
      cmd.produce(base, "worker")
      gold -= cost("worker")
      units++
    }
  }
  // 闲着的工人去采最近的矿，闲着的兵去家门口站着
  for (const w of workers) {
    if (w === builder || w.order?.kind !== "idle") continue
    const m = nearest(w, mines)
    if (m) cmd.gather(w, m)
  }
  for (const u of idleArmy) if (dist(u, rally) > 3) cmd.move(u, rally.x, rally.y)
}
