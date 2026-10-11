// 大模型试写（Haiku 60 分钟写的 v11）：工人只补 8 个、兵营一直排满，兵够 4 个就带着领主轮流清野，家附近来敌人全军回防、打不过整队撤；兵够 24 个（或 4200 tick 后 12 个、或看到对方领主）全军带领主推家。
// 外部大模型试写的 bot（2026-10-10，D-213，换掉第二轮测试员写的旧 llm）：子代理（Haiku）只读了 PROMPT.md、看不到平台源码和参考 bot 的源码，
// 27 分钟迭代到第 11 版，当时对 baseline、assassin、llm（旧）、turtle 各 16 局全胜，escort 15-1，llm2 14-2，farmer 12-4。原样收录，只改了开头的说明。
//
// 打法：
// 经济：工人只补到 8 个（少了反而能早出兵、工人不容易被卷进战斗），分散去家门口的金矿采，矿旁 6 格内有敌人就不去，工人 4 格内有敌人就先撤回家；
//       主基地只排工人，兵营队列尽量排满（战士:弓手约 2:1）。
// 领主：跟在军队后面 3 格吃光环；领主 8 格内（同领主视野）有 3 个以上敌方单位就放击退。
// 清野：兵够 4 个，就去离军队最近、还有野怪、附近没有敌军扎营的营地，用 attackMove 加 neutral 集火清（每次决策重下命令，清完换下一个，等野怪刷新再回来）。
// 守家：家附近 12 格内出现敌方单位，全军过去打，打完再回集结点；打不过（8 格内敌方战斗单位不少于 0.9 倍我方兵数）就整队撤回集结点。
// 进攻：兵够 24 个，或 4200 tick 后兵够 12 个，或看到对方领主（兵够 8 个），就全军带领主推对方主基地；落后的兵先回到军队中心再一起上；兵折到 6 个以下撤回守家。

const WORKER_TARGET = 8
const CLEAR_MIN = 4
const ATTACK_MIN = 24
const LATE_TICK = 4200
const LATE_ATTACK_MIN = 12
const RETREAT_BELOW = 6
const LORD_SAFE_HP = 600

let inited = false
let homeC: Pos = { x: 0, y: 0 }
let enemyC: Pos = { x: 0, y: 0 }
let rally: Pos = { x: 0, y: 0 }
let campIdx = -1
let attacking = false

function walk(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= game.width || y >= game.height) return false
  return game.walkable[game.terrain[y][x]] === true
}

// 离 p 最近的能走的格（一圈圈往外找）
function nearWalk(p: Pos, r: number): Pos {
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  for (let d = 0; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== d) continue
        if (walk(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy }
      }
    }
  }
  return { x: Math.min(game.width - 1, Math.max(0, x0)), y: Math.min(game.height - 1, Math.max(0, y0)) }
}

// 从 from 往 to 的方向走 k 格（曼哈顿），落到能走的格上
function along(from: Pos, to: Pos, k: number): Pos {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.abs(dx) + Math.abs(dy)
  if (d === 0) return nearWalk(from, 3)
  const s = Math.min(1, k / d)
  return nearWalk({ x: from.x + dx * s, y: from.y + dy * s }, 3)
}

function centroid(us: Entity[]): Pos {
  let sx = 0
  let sy = 0
  for (const u of us) {
    sx += u.x
    sy += u.y
  }
  return { x: sx / us.length, y: sy / us.length }
}

function nearestTo(list: Entity[], p: Pos): Entity {
  let best = list[0]
  let bd = dist(best, p)
  for (const e of list) {
    const d = dist(e, p)
    if (d < bd) {
      bd = d
      best = e
    }
  }
  return best
}

// 选还有野怪、离军队最近的营地；当前营地还有怪就继续清它。营地 9 格内有 2 个以上敌方单位的算有人，不去
function pickCamp(view: View, c: Pos, foeUnits: Entity[]): number {
  const camps = view.objectives.creepCamps
  const hot = (cp: { x: number; y: number }): boolean =>
    foeUnits.filter((e) => Math.abs(e.x - cp.x) + Math.abs(e.y - cp.y) <= 9).length >= 2
  if (campIdx >= 0 && camps[campIdx] && camps[campIdx].alive > 0 && !hot(camps[campIdx])) return campIdx
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < camps.length; i++) {
    if (camps[i].alive <= 0 || hot(camps[i])) continue
    const d = Math.abs(camps[i].x - c.x) + Math.abs(camps[i].y - c.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function onTick(view: View, cmd: Commands): void {
  const me = view.me
  const E = view.entities
  const T = game.types
  const mine = E.filter((e) => e.owner === me)
  const base = mine.find((e) => e.type === "base")
  if (!base) return
  const barracks = mine.find((e) => e.type === "barracks")
  const lord = mine.find((e) => e.type === "lord")
  const workers = mine.filter((e) => e.type === "worker")
  const army = mine.filter((e) => e.type === "soldier" || e.type === "archer")
  const eb = view.objectives.enemyBases.find((b) => b.owner !== me)
  if (!eb) return
  if (!inited) {
    homeC = { x: base.x + 1, y: base.y + 1 }
    enemyC = { x: eb.x + 1, y: eb.y + 1 }
    rally = along(homeC, enemyC, 6)
    inited = true
  }

  // 敌方（非中立）单位
  const myTeam = view.players[me].team
  const foes = E.filter((e) => e.owner >= 0 && view.players[e.owner].team !== myTeam)
  const foeUnits = foes.filter((e) => T[e.type].kind === "unit")
  const foeLord = foes.find((e) => e.type === "lord")
  const threat = foeUnits.filter(
    (e) => dist(e, base) <= 12 || (barracks !== undefined && dist(e, barracks) <= 12),
  )

  // 模式切换（进攻有滞后，不会一兵没了就来回切）
  const n = army.length
  if (attacking && n < RETREAT_BELOW) attacking = false
  const lateGo = view.tick >= LATE_TICK && n >= LATE_ATTACK_MIN
  if (!attacking && (n >= ATTACK_MIN || lateGo || (foeLord !== undefined && n >= 8))) attacking = true

  const c: Pos = n > 0 ? centroid(army) : rally
  let mode: "defend" | "clear" | "attack" = "defend"
  let goal: Pos = rally
  if (threat.length > 0) {
    mode = "defend"
    const t = nearestTo(threat, homeC)
    goal = { x: t.x, y: t.y }
  } else if (attacking) {
    mode = "attack"
    goal = foeLord ? { x: foeLord.x, y: foeLord.y } : enemyC
  } else if (n >= CLEAR_MIN) {
    campIdx = pickCamp(view, c, foeUnits)
    if (campIdx >= 0) {
      mode = "clear"
      const cp = view.objectives.creepCamps[campIdx]
      goal = { x: cp.x, y: cp.y }
    } else {
      campIdx = -1
    }
  } else {
    campIdx = -1
  }

  // 打不过就撤：兵群 8 格内的敌方战斗单位（兵、弓、领主）不少于 0.9 倍我方兵数（且至少 3 个），
  // 全军用 move 撤回集结点，让仗打在家门口（基地的火力和击退都在那边）
  const fighters = foeUnits.filter((f) => f.type === "soldier" || f.type === "archer" || f.type === "lord")
  const foesNear = fighters.filter((f) => dist(f, c) <= 8).length
  const retreat = n > 0 && mode !== "defend" && foesNear >= 3 && foesNear * 10 >= n * 9
  if (retreat) {
    console.log(`t${view.tick} 撤退 army=${n} foes=${foesNear}`)
    mode = "defend"
    goal = rally
    attacking = false
  }

  // 军队：进攻时离中心太远的先回到中心再一起上，别一个一个送
  const gather = nearWalk(c, 2)
  for (const u of army) {
    if (retreat) cmd.move(u, rally.x, rally.y)
    else if (mode === "clear") cmd.attackMove(u, goal.x, goal.y, { neutral: true })
    else if (mode === "attack" && dist(u, c) > 7) cmd.attackMove(u, gather.x, gather.y)
    else cmd.attackMove(u, goal.x, goal.y)
  }

  // 领主：跟在军队后面 3 格吃光环；血少就回家
  if (lord) {
    let lg: Pos
    if (lord.hp < LORD_SAFE_HP) lg = along(homeC, rally, 2)
    else if (n > 0) lg = along(c, homeC, 3)
    else lg = along(homeC, rally, 3)
    cmd.move(lord, lg.x, lg.y)
    const cd = lord.skillCooldowns?.repel ?? 0
    const close = foeUnits.filter((e) => dist(e, lord) <= 8).length
    if (cd === 0 && close >= 3) cmd.cast(lord, "repel")
  }

  // 经济：金币记账，工人优先
  let gold = view.resources.gold
  const wCost = T.worker.cost.gold ?? 50

  const baseQ = base.queue?.length ?? 0
  if (baseQ < 1 && workers.length < WORKER_TARGET && gold >= wCost) {
    cmd.produce(base, "worker")
    gold -= wCost
  }

  if (barracks && barracks.construction === undefined) {
    const q = barracks.queue ?? []
    let qn = q.length
    let soldiers = army.filter((a) => a.type === "soldier").length + q.filter((x) => x.type === "soldier").length
    let archers = army.filter((a) => a.type === "archer").length + q.filter((x) => x.type === "archer").length
    const reserve = workers.length < WORKER_TARGET ? wCost : 0
    while (qn < 5) {
      const type: TypeName = soldiers <= 2 * archers ? "soldier" : "archer"
      const cost = T[type].cost.gold ?? 0
      if (gold - reserve < cost) break
      cmd.produce(barracks, type)
      gold -= cost
      qn++
      if (type === "soldier") soldiers++
      else archers++
    }
  }

  // 工人：空闲的去离自己近、人少的金矿采
  // 矿旁 6 格内有敌方单位的不去
  const mines = E.filter(
    (e) => T[e.type].kind === "resource" && (e.amount ?? 0) > 0 && !foeUnits.some((f) => dist(f, e) <= 6),
  )
  const load = new Map<number, number>()
  for (const w of workers) {
    if (w.order?.kind === "gather") load.set(w.order.target, (load.get(w.order.target) ?? 0) + 1)
  }
  for (const w of workers) {
    // 工人 4 格内有敌人就先撤回家
    if (foeUnits.some((f) => dist(f, w) <= 4)) {
      cmd.move(w, homeC.x, homeC.y)
      continue
    }
    if (w.order && w.order.kind !== "idle") continue
    let best: Entity | null = null
    let bestS = Infinity
    for (const m of mines) {
      const s = dist(w, m) + 2 * (load.get(m.id) ?? 0)
      if (s < bestS) {
        bestS = s
        best = m
      }
    }
    if (best) {
      cmd.gather(w, best)
      load.set(best.id, (load.get(best.id) ?? 0) + 1)
    }
  }

  if (view.tick % 300 === 0) {
    console.log(`t${view.tick} mode=${mode} army=${n} workers=${workers.length} gold=${view.resources.gold} camp=${campIdx}`)
  }
}
