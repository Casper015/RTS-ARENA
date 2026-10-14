// 大模型试写（Haiku 40 分钟写的 v3，最强）：补工人、分矿放仓库、早建矿业所，三座兵营按对手兵种的克制算枪兵、弓兵、骑兵的比例，家门口有敌兵就先回防，攒够 14 个兵整队推主基地，打光就收回家门口。
// 外部大模型试写的 bot（2026-10-13，D-258）：子代理（Haiku）只读了 PROMPT.md、看不到平台源码和参考 bot 的源码，从空模板写到第 3 版，
// 当时对 7 个参考 bot 每个 6 局共 39 胜 3 负。代码里也排了火药工坊、铁匠铺、护甲坊、靶场，可钱总被兵营先花掉，实际几乎不建（参考 bot 联赛 48 局一座火药工坊也没建），
// 所以不出线列步兵和炮，赢在兵早：胜局平均第 3000 tick 就拆了对方主基地。原样收录，只改了开头的说明、补了多人局只认别队为敌人。

type Site = { type: TypeName; x: number; y: number; builder: number; born: number };

const ARMY: TypeName[] = ["spearman", "archer", "cavalry", "musketeer", "cannon"];
const BUILDING_TYPES: TypeName[] = ["base", "barracks", "tower", "depot", "wall", "farm", "gunworks", "forge", "armory", "range", "mining"];

let inited = false;
let attackOn = false;
let lastGoal = "";
let sites: Site[] = [];
let farMines: Pos[] = [];
let midMines: Pos[] = [];
const seen: Record<string, { type: TypeName; tick: number }> = {};

function cost(t: TypeName): number {
  return game.types[t].cost?.gold ?? 0;
}

function isUnit(t: TypeName): boolean {
  return game.types[t].kind === "unit";
}

function isArmy(t: TypeName): boolean {
  return ARMY.indexOf(t) >= 0;
}

// 我方类型 a 打敌方类型 b 时，每 tick 能扣掉对方生命的比例（考虑克制倍数）
function eff(a: TypeName, b: TypeName): number {
  const ta = game.types[a];
  if (!ta.attack) return 0;
  const mult = ta.attack.vs ? (ta.attack.vs[b] ?? 1) : 1;
  return (ta.attack.damage * mult) / ta.attack.cooldown / game.types[b].maxHp;
}

function walkableAt(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= game.width || y >= game.height) return false;
  return !!game.walkable[game.terrain[y][x]];
}

function walkableNear(p: Pos): Pos {
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (walkableAt(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
      }
    }
  }
  return p;
}

function towardPoint(from: Pos, to: Pos, d: number): Pos {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const L = Math.abs(dx) + Math.abs(dy) || 1;
  return walkableNear({ x: Math.round(from.x + (dx * d) / L), y: Math.round(from.y + (dy * d) / L) });
}

function occupied(view: View, x: number, y: number): boolean {
  for (const e of view.entities) {
    if (x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h) return true;
  }
  return false;
}

function footprintFree(view: View, type: TypeName, x: number, y: number): boolean {
  const t = game.types[type];
  for (let yy = y; yy < y + t.h; yy++) {
    for (let xx = x; xx < x + t.w; xx++) {
      if (!walkableAt(xx, yy)) return false;
      if (occupied(view, xx, yy)) return false;
    }
  }
  return true;
}

function liveMines(view: View, ps: Pos[]): Pos[] {
  return ps.filter((p) =>
    view.entities.some((e) => e.type === "goldmine" && e.x === p.x && e.y === p.y && (e.amount ?? 0) > 0),
  );
}

// 分矿旁边放仓库：离矿中心近、又不堵住矿边的格子（离矿最近的边隔一格）
function depotSpot(view: View, mines: Pos[]): Pos | null {
  if (mines.length === 0) return null;
  let cx = 0;
  let cy = 0;
  for (const m of mines) {
    cx += m.x;
    cy += m.y;
  }
  cx = Math.round(cx / mines.length);
  cy = Math.round(cy / mines.length);
  let best: Pos | null = null;
  let bs = Infinity;
  for (let y = cy - 6; y <= cy + 6; y++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (!footprintFree(view, "depot", x, y)) continue;
      let md = Infinity;
      for (const m of mines) md = Math.min(md, dist(m, { x, y, w: 2, h: 2 }));
      const s = Math.abs(md - 2);
      if (s < bs) {
        bs = s;
        best = { x, y };
      }
    }
  }
  return best;
}

function nearestFree(workers: Entity[], busy: Record<number, boolean>, p: Pos): Entity | null {
  let best: Entity | null = null;
  let bd = Infinity;
  for (const w of workers) {
    if (busy[w.id]) continue;
    if (w.order && w.order.kind !== "idle" && w.order.kind !== "gather") continue;
    const d = dist(w, { x: p.x, y: p.y, w: 1, h: 1 });
    if (d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

// 按对手已见过的兵种，算每个候选兵种的克制收益，再和现有比例比，选最缺的那种
function pickUnit(view: View, cands: TypeName[], cnt: Partial<Record<TypeName, number>>): TypeName {
  let etot = 0;
  const E: Partial<Record<TypeName, number>> = {};
  for (const k of Object.keys(seen)) {
    const s = seen[k];
    if (view.tick - s.tick > 1200) continue;
    if (!isUnit(s.type) || s.type === "worker" || s.type === "scout") continue;
    E[s.type] = (E[s.type] ?? 0) + 1;
    etot++;
  }
  let armyTot = 0;
  for (const u of ARMY) armyTot += cnt[u] ?? 0;
  const ws: number[] = [];
  let wsum = 0;
  for (const u of cands) {
    let adv = 0;
    if (etot > 0) {
      for (const k of Object.keys(E)) {
        const tt = k as TypeName;
        adv += (E[tt] ?? 0) * (eff(u, tt) - eff(tt, u));
      }
    }
    const w = 0.3 + (etot > 0 ? (20 * Math.max(0, adv)) / etot : 0);
    ws.push(w);
    wsum += w;
  }
  let best: TypeName = cands[0];
  let bestScore = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const u = cands[i];
    const share = armyTot > 0 ? (cnt[u] ?? 0) / armyTot : 0;
    const score = ws[i] / wsum - share;
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}

export function onTick(view: View, cmd: Commands): void {
  const t = view.tick;
  const me = view.me;
  const mine = view.entities.filter((e) => e.owner === me);
  const base = mine.find((e) => e.type === "base");
  if (!base) return;
  const hc: Pos = { x: base.x + 1, y: base.y + 1 };
  const mirror = base.x > game.width / 2;
  // 多人局：只把别的队当敌人，打离自己最近的敌方主基地（收进规则包时补的，两人局不变）
  const foe = (e: Entity): boolean => e.owner >= 0 && e.owner !== me && game.teams[e.owner] !== game.teams[me];
  const eb = view.objectives.enemyBases.slice().sort((a, b) => dist(a, base) - dist(b, base))[0];
  const ec: Pos = eb ? { x: eb.x + 1, y: eb.y + 1 } : { x: game.width - 1 - hc.x, y: game.height - 1 - hc.y };

  // 第一次调用：记下两家的分矿（600 金、离家近）和中间的矿（700 金、离家近）
  if (!inited) {
    inited = true;
    for (const e of view.entities) {
      if (e.type !== "goldmine") continue;
      const d = dist(e, base);
      if (e.amount === 600 && d < 30) farMines.push({ x: e.x, y: e.y });
      if (e.amount === 700 && d < 35) midMines.push({ x: e.x, y: e.y });
    }
  }

  // 记住看见过的敌方实体，死了（看得见的）就删
  for (const e of view.entities) {
    if (foe(e)) seen[String(e.id)] = { type: e.type, tick: t };
  }
  for (const ev of view.events) {
    if (ev.kind === "died" && ev.owner >= 0 && ev.owner !== me) delete seen[String(ev.id)];
  }

  let gold = view.resources.gold;
  const workers = mine.filter((e) => e.type === "worker");
  const busy: Record<number, boolean> = {};
  for (const w of workers) {
    if (w.order && w.order.kind !== "idle" && w.order.kind !== "gather") busy[w.id] = true;
  }
  let spend = sites.reduce((s, x) => s + cost(x.type), 0);
  const numOf = (type: TypeName): number =>
    mine.filter((e) => e.type === type).length + sites.filter((s) => s.type === type).length;

  // 1. 新开地基（每种同时只有一个待放）
  const wants: [TypeName, number][] = [
    ["barracks", t < 400 ? 1 : t < 1000 ? 2 : 3],
    ["mining", t >= 250 ? 1 : 0],
    ["depot", (t >= 300 && workers.length >= 8 ? 1 : 0) + (t >= 1200 ? 1 : 0)],
    ["gunworks", t >= 700 ? 1 : 0],
    ["forge", t >= 1000 ? 1 : 0],
    ["armory", t >= 1300 ? 1 : 0],
    ["range", t >= 1500 ? 1 : 0],
  ];
  for (const [type, want] of wants) {
    if (numOf(type) >= want) continue;
    if (sites.some((s) => s.type === type)) continue;
    if (gold - spend < cost(type)) continue;
    let spot: Pos | null;
    if (type === "depot") {
      spot = numOf("depot") === 0 ? depotSpot(view, liveMines(view, farMines)) : depotSpot(view, liveMines(view, midMines));
    } else {
      spot = findBuildSpot(view, type, hc, 7, 1, mirror);
    }
    if (!spot) continue;
    sites.push({ type, x: spot.x, y: spot.y, builder: -1, born: t });
    spend += cost(type);
  }

  // 2. 地基：派工人去，看得见且钱够就放下
  const keep: Site[] = [];
  for (const s of sites) {
    if (t - s.born > 400) {
      spend -= cost(s.type);
      continue;
    }
    let b: Entity | null = workers.find((w) => w.id === s.builder) ?? null;
    if (!b) {
      b = nearestFree(workers, busy, { x: s.x, y: s.y });
      if (!b) {
        keep.push(s);
        continue;
      }
      s.builder = b.id;
    }
    busy[b.id] = true;
    const problem = buildProblem(view, s.type, s.x, s.y);
    if (problem === null) {
      if (gold >= cost(s.type)) {
        cmd.build(b, s.type, s.x, s.y);
        gold -= cost(s.type);
        spend -= cost(s.type);
      } else {
        keep.push(s);
      }
      continue;
    }
    const stand = walkableNear({ x: s.x - 2, y: s.y });
    cmd.move(b, stand.x, stand.y);
    keep.push(s);
  }
  sites = keep;

  // 3. 没建好的建筑：每座至少两个工人接着建
  for (const e of mine) {
    if (!e.construction) continue;
    const builders = workers.filter((w) => w.order?.kind === "build" && w.order.target === e.id).length;
    if (builders >= 2) continue;
    const w = nearestFree(workers, busy, { x: e.x, y: e.y });
    if (!w) continue;
    busy[w.id] = true;
    cmd.build(w, e.type, e.x, e.y);
  }

  // 4. 闲着的工人去采最合适的矿（离交货点近、人少）
  const mineNodes = view.entities.filter((e) => game.types[e.type].kind === "resource" && (e.amount ?? 0) > 0);
  const drops = mine.filter((e) => game.types[e.type].dropOff && !e.construction);
  const load: Record<number, number> = {};
  for (const w of workers) {
    if (w.order?.kind === "gather") load[w.order.target] = (load[w.order.target] ?? 0) + 1;
  }
  for (const w of workers) {
    if (busy[w.id] || (w.order && w.order.kind !== "idle")) continue;
    let best: Entity | null = null;
    let bs = Infinity;
    for (const m of mineNodes) {
      let dd = Infinity;
      for (const d of drops) dd = Math.min(dd, dist(m, d));
      const sc = (dd === Infinity ? 60 : dd) + 0.3 * dist(w, m) + 6 * (load[m.id] ?? 0);
      if (sc < bs) {
        bs = sc;
        best = m;
      }
    }
    if (best) {
      cmd.gather(w, best);
      load[best.id] = (load[best.id] ?? 0) + 1;
    }
  }

  // 5. 造工人（到目标数为止）
  const workerQ =
    workers.length + mine.reduce((s, e) => s + (e.queue ?? []).filter((q) => q.type === "worker").length, 0);
  const Wt = t < 1500 ? 16 : 20;
  if (workerQ < Wt && (base.queue?.length ?? 0) < 2 && gold - spend >= 50) {
    cmd.produce(base, "worker");
    gold -= 50;
  }

  // 6. 兵营、火药工坊出兵
  const cnt: Partial<Record<TypeName, number>> = {};
  for (const e of mine) {
    if (isArmy(e.type)) cnt[e.type] = (cnt[e.type] ?? 0) + 1;
    for (const q of e.queue ?? []) {
      if (isArmy(q.type)) cnt[q.type] = (cnt[q.type] ?? 0) + 1;
    }
  }
  let enemyBuildings = 0;
  for (const k of Object.keys(seen)) {
    const s = seen[k];
    if (t - s.tick <= 1200 && BUILDING_TYPES.indexOf(s.type) >= 0) enemyBuildings++;
  }
  for (const b of mine) {
    if (b.construction || (b.queue?.length ?? 0) >= 2) continue;
    if (b.type === "barracks") {
      const ut = pickUnit(view, ["spearman", "archer", "cavalry"], cnt);
      if (gold - spend < cost(ut)) continue;
      cmd.produce(b, ut);
      gold -= cost(ut);
      cnt[ut] = (cnt[ut] ?? 0) + 1;
    } else if (b.type === "gunworks") {
      const want = enemyBuildings >= 3 && (cnt.cannon ?? 0) * 3 < (cnt.musketeer ?? 0) + 3 ? "cannon" : "musketeer";
      if (gold - spend < cost(want)) continue;
      cmd.produce(b, want);
      gold -= cost(want);
      cnt[want] = (cnt[want] ?? 0) + 1;
    }
  }

  // 7. 部队：攒够就整队推敌方主基地，打光（4 个以下）就收回家门口
  const rally = towardPoint(hc, ec, 6);
  const army = mine.filter((e) => isArmy(e.type));
  const n = army.length;
  if (!attackOn && n >= (t >= 4000 ? 10 : 14)) attackOn = true;
  if (attackOn && n <= 4) attackOn = false;
  // 家门口 14 格内有敌方部队（骑兵速攻、来抢矿的）就先去打它，打完再回集结点
  let threat: Entity | null = null;
  let td = Infinity;
  for (const e of view.entities) {
    if (!foe(e) || !isUnit(e.type)) continue;
    const d = dist(e, base);
    if (d < td) {
      td = d;
      threat = e;
    }
  }
  const defend = !attackOn && threat !== null && td <= 14;
  const goal = attackOn ? "attack" : defend ? "defend" : "home";
  const goalPt: Pos = attackOn ? ec : defend && threat ? { x: threat.x, y: threat.y } : rally;
  const changed = goal !== lastGoal;
  lastGoal = goal;
  for (const u of army) {
    if (changed || defend || !u.order || u.order.kind === "idle") cmd.attackMove(u, goalPt.x, goalPt.y);
  }

  // 8. 侦察兵停在对方主基地附近看兵
  const scoutPt = towardPoint(ec, hc, 9);
  for (const s of mine) {
    if (s.type === "scout" && (!s.order || s.order.kind === "idle")) cmd.move(s, scoutPt.x, scoutPt.y);
  }
}
