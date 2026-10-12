// 回放播放器：选回放、播放控制、侧栏（玩家、选中实体、bot 日志）
import type { Replay } from "../../src/core/types.ts"
import { applyFrame, ReplayModel, type State } from "./model.ts"
import { initArena } from "./arena.ts"
import { playerColor, Renderer } from "./render.ts"
import { createBattleArt } from "../../src/video/battle-art.ts"
import { trainingQueue } from "../../src/video/visual-state.ts"

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
$("brand-logo").setAttribute("src", new URL("../../assets/brand/logo.svg", import.meta.url).href)
$("brand-icon").setAttribute("href", new URL("../../assets/brand/favicon.svg", import.meta.url).href)
const select = $<HTMLSelectElement>("replay-select")
const slider = $<HTMLInputElement>("slider")
const playBtn = $<HTMLButtonElement>("play")
const speedSel = $<HTMLSelectElement>("speed")
const povSel = $<HTMLSelectElement>("pov")

const renderer = new Renderer()
const art = createBattleArt()
let model: ReplayModel | null = null
let state: State | null = null
/** 带小数的当前 tick（动画用） */
let now = 0
let playing = false
let logFilter: number | null = null
/** 按哪一队的视野看；null 是全图 */
let pov: number | null = null
let lastLogDraw = 0

/** 回放文件可能是别人给的，拼进 HTML 的值一律转义 */
function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

/** 已经拼好的 HTML，放进 html`` 时不再转义 */
class Raw {
  readonly s: string
  constructor(s: string) {
    this.s = s
  }
}

/** 模板里的 ${} 一律转义；Raw 和 Raw 数组原样放入 */
function html(strings: TemplateStringsArray, ...vals: unknown[]): Raw {
  let out = strings[0]
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    const part = v instanceof Raw ? v.s : Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.s : esc(x))).join("") : esc(v)
    out += part + strings[i + 1]
  }
  return new Raw(out)
}

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0")
}

// ---------- 加载 ----------

async function refreshList(prefer?: string): Promise<void> {
  let list: { name: string; mtime: number; size: number }[] = []
  try {
    const res = await fetch("/api/replays")
    if (res.ok) list = await res.json()
  } catch {
    // 静态部署时没有列表接口，只能打开本地文件
  }
  select.innerHTML = html`${list.map((r) => html`<option value="${r.name}">${r.name}（${(r.size / 1024).toFixed(0)} KB）</option>`)}`.s
  const want = prefer ?? new URLSearchParams(location.search).get("replay") ?? list[0]?.name
  if (want && list.some((r) => r.name === want)) {
    select.value = want
    await loadByName(want)
  }
}

async function loadByName(name: string): Promise<void> {
  const res = await fetch(`/replays/${encodeURIComponent(name)}`)
  if (!res.ok) return alert(`读取 ${name} 失败：${res.status}`)
  load(await res.json())
  const url = new URL(location.href)
  url.searchParams.set("replay", name)
  history.replaceState(null, "", url)
}

function load(replay: Replay): void {
  try {
    model = new ReplayModel(replay)
  } catch (e) {
    alert((e as Error).message)
    return
  }
  state = model.stateAt(0)
  now = 0
  playing = false
  renderer.selected = null
  renderer.load(replay, state)
  slider.max = String(model.lastTick)
  $("empty").hidden = true
  drawPov()
  const r = replay
  $("match-title").textContent = `${r.ruleset.name} · ${r.players.length} 方对局`
  $("match-title").title = `种子 ${r.seed} · ${r.players.map((p) => p.name).join(" vs ")}`
  $("match-meta").textContent = `种子 ${r.seed} · 地图 ${r.map.width} × ${r.map.height}`
  drawFilter()
  drawBotStats()
  updateUI(true)
}

// ---------- 播放 ----------

function seek(t: number): void {
  if (!model) return
  state = model.stateAt(t)
  now = state.tick
  renderer.jump(state)
  updateUI(true)
}

function advanceTo(t: number): void {
  if (!model || !state) return
  if (t - state.tick > 300) return seek(t)
  while (state.tick < t) {
    const f = model.frame(state.tick + 1)
    if (!f) break
    renderer.advance(state, applyFrame(state, f))
  }
}

function setPlaying(p: boolean): void {
  if (!model) return
  if (p && state!.tick >= model.lastTick) seek(0)
  playing = p
  drawPlayback()
}

function drawPlayback(): void {
  playBtn.textContent = playing ? "Ⅱ 暂停" : "▶ 播放"
  playBtn.setAttribute("aria-label", playing ? "暂停" : "播放")
}

renderer.onSelect = () => updateUI(true)

// ---------- 侧栏 ----------

function updateUI(force = false): void {
  if (!model || !state) return
  const r = model.replay
  slider.value = String(state.tick)
  slider.style.setProperty("--progress", `${model.lastTick ? state.tick / model.lastTick * 100 : 0}%`)
  $("tick-label").textContent = `${state.tick} / ${model.lastTick}`
  drawPlayback()
  $("status-line").textContent = state.status

  const teamed = new Set(r.players.map((p) => p.team)).size < r.players.length
  const rows = r.players.map((p, i) => {
    const ps = state!.players[i]
    // 按视野看时，对手的资源和单位数 bot 是不知道的
    const hidden = pov !== null && (typeof p.team === "number" ? p.team : i) !== pov
    const resourceNames: Record<string,string> = { gold:"金币", food:"粮食", wood:"木材", stone:"石料" }
    const res = hidden
      ? [html`<span class="resource-chip">资源未知</span>`]
      : Object.entries(ps.resources)
          .map(([k, v]) => html`<span class="resource-chip">${resourceNames[k]??k} ${Math.round(v)}</span>`)
    let army=0,workers=0,buildings=0
    if(!hidden)for(const e of state!.ents.values())if(e.owner===i){const type=r.types[e.type];if(type?.kind==="building")buildings++;else if(type?.kind==="unit")type.worker?workers++:army++}
    // 分队时在名字后面标队伍（老回放没有 team 字段）
    const team = teamed && typeof p.team === "number" ? ` [队${p.team + 1}]` : ""
    return html`<article class="player-card ${ps.alive?"":"eliminated"}" style="--player-color:${hex(playerColor(i))}"><div class="player-heading"><div class="player-seat">P${i}</div><div class="player-identity"><div class="player-name">${p.name}</div><div class="player-sub">${ps.alive?"场上":"已出局"}${team}</div></div><div class="player-score">${Math.round(ps.score)}<small>得分</small></div></div><div class="player-metrics"><div><b>${hidden?"？":army}</b>作战部队</div><div><b>${hidden?"？":workers}</b>农民</div><div><b>${hidden?"？":buildings}</b>建筑</div></div><div class="resources">${res}</div></article>`
  })
  $("players").innerHTML = html`${rows}`.s

  const sel = renderer.selected
  if (sel === null) $("selected").innerHTML = '<div class="selection-empty"><i>◇</i><div>选择一个单位<small>点击战场，查看属性与命令</small></div></div>'
  else {
    const e = state.ents.get(sel)
    if (!e) $("selected").innerHTML = html`<span class="muted">#${sel} 已经不在了</span>`.s
    else if (!renderer.shown(sel)) $("selected").innerHTML = html`<span class="muted">#${sel} 现在在视野外</span>`.s
    else {
      const info = r.types[e.type]
      const names: Record<string,string> = { worker:"农民", soldier:"剑盾兵", spearman:"枪兵", archer:"弓箭手", cavalry:"重骑兵", scout:"侦察骑兵", cannon:"火炮", lord:"领主", base:"主基地", barracks:"兵营", tower:"箭塔", wall:"城墙", depot:"仓库", farm:"农田", goldmine:"金矿" }
      const name = info.look?.name ?? names[e.type] ?? e.type
      const owner = e.owner < 0 ? "中立" : `P${e.owner} ${r.players[e.owner]?.name}`
      const hp = info?.kind === "resource" ? `储量 ${e.hp}` : `${e.hp} / ${e.st?.maxHp ?? info?.maxHp}`
      $("selected").innerHTML = html`<div class="entity-heading"><canvas id="entity-icon" width="112" height="112" aria-hidden="true"></canvas><div><strong>${name}</strong><small>#${e.id} · ${owner}</small></div></div><div class="kv"><span class="muted">id</span><span>#${e.id} ${e.type}</span>
        <span class="muted">归属</span><span>${owner}</span><span class="muted">位置</span><span>(${e.x}, ${e.y})</span>
        <span class="muted">生命</span><span>${hp}</span><span class="muted">命令</span><span>${e.ord}</span>${
          e.bp === undefined ? "" : html`<span class="muted">建造</span><span>${e.bp}%（还没建好）</span>`
        }${e.bf?.length ? html`<span class="muted">增益</span><span>${e.bf.join("、")}</span>` : ""}${
          info?.skills?.length
            ? html`<span class="muted">技能</span><span>${renderer
                .cooldownsAt(e.id, e.type, state.tick)
                .map((k) => (k.left === 0 ? `${k.name}：可以放了` : `${k.name}：冷却还要 ${k.left} tick（共 ${k.cooldown}）`))
                .join("；")}</span>`
            : ""
        }${info?.auras?.length ? html`<span class="muted">光环</span><span>${info.auras.map((a) => `${a.name}（${a.radius < 0 ? "视野" : `${a.radius} 格`}内）`).join("、")}</span>` : ""}${
          info?.passives?.some((x) => x.kind === "regen")
            ? html`<span class="muted">回血</span><span>${renderer.healingAt(e.id, e.type, state.tick) ? "正在回血" : e.hp >= (e.st?.maxHp ?? info.maxHp) ? "满血" : "没在回血（出手或挨打后要歇一会儿）"}</span>`
            : ""
        }</div>`.s
      const icon=$<HTMLCanvasElement>("entity-icon").getContext("2d")!
      const scale=60/Math.max(1,info.w,info.h)
      icon.translate(56-info.w*scale/2,60-info.h*scale/2);icon.scale(scale,scale)
      art.entity(icon,{name:e.type,kind:info.kind,worker:info.worker,range:info.attack?.range,splash:info.attack?.splash},0,0,info.w,info.h,info.look?.color??hex(playerColor(e.owner)),{angle:0},e.bp??100)
      if(info.produces?.length || e.queue!==undefined) {
        const hidden=pov!==null&&(r.players[e.owner]?.team??e.owner)!==pov
        const queue=hidden?undefined:trainingQueue(r,e)
        const content=hidden?html`<p class="muted">敌方生产队列不可见</p>`:queue===undefined?html`<p class="muted">旧回放未记录生产队列</p>`:queue.length===0?html`<p class="muted">当前没有训练任务</p>`:html`<ol>${queue.map((q,i)=>html`<li class="${q.active?"training":"waiting"}"><canvas data-queue-type="${q.type}" width="80" height="80" aria-hidden="true"></canvas><div><b>${r.types[q.type]?.look?.name??names[q.type]??q.type}</b><small>${q.blocked?"训练完成 · 等待出口":q.active?`训练中 · 剩余 ${Math.ceil(q.ticksLeft/Math.max(1,r.tickRate))} 秒`:(e.bp??100)<100?"等待建筑完工":`排队中 · 第 ${i+1} 位`}</small><progress max="1" value="${q.progress}" aria-label="训练进度"></progress></div></li>`)}</ol>`
        $("selected").insertAdjacentHTML("beforeend",html`<section class="production-queue"><h4>训练队列 <span>${queue?.length??"—"}</span></h4>${content}</section>`.s)
        for(const canvas of $("selected").querySelectorAll<HTMLCanvasElement>("[data-queue-type]")) {
          const name=canvas.dataset.queueType!,type=r.types[name];if(!type)continue
          const ctx=canvas.getContext("2d")!,scale=43/Math.max(1,type.w,type.h)
          ctx.translate(40-type.w*scale/2,44-type.h*scale/2);ctx.scale(scale,scale)
          art.entity(ctx,{name,kind:type.kind,worker:type.worker,range:type.attack?.range,splash:type.attack?.splash},0,0,type.w,type.h,hex(playerColor(e.owner)),{angle:0})
        }
      }
    }
  }

  const banner = $("result-banner")
  if (state.tick >= model.lastTick) {
    const res = r.result
    const won = Array.isArray(res.winners) ? res.winners : res.winner === null ? [] : [res.winner]
    const head = won.length === 0 ? `平局——${res.reason}` : `${won.map((w) => `P${w} ${r.players[w]?.name}`).join("、")} 获胜——${res.reason}`
    const ranks =
      r.players.length > 2 && Array.isArray(res.ranking)
        ? "\n名次：" + res.ranking.map((g, i) => `${i + 1}. ${g.map((p) => `P${p} ${r.players[p]?.name}`).join(" = ")}`).join("　")
        : ""
    banner.textContent = head + ranks
    banner.hidden = false
  } else banner.hidden = true

  const t = performance.now()
  if (force || t - lastLogDraw > 120) {
    lastLogDraw = t
    drawLogs()
  }
}

/** 视角下拉框：全图，或者按队伍（不分队时每人一队） */
function drawPov(): void {
  if (!model) return
  const r = model.replay
  const teams = new Map<number, number[]>()
  r.players.forEach((p, i) => {
    const t = typeof p.team === "number" ? p.team : i
    teams.set(t, [...(teams.get(t) ?? []), i])
  })
  const label = (ps: number[]) => ps.map((i) => `P${i} ${r.players[i].name}`).join("、")
  const opts = [html`<option value="">视角：全图</option>`]
  for (const [t, ps] of teams) opts.push(html`<option value="${t}">视角：${ps.length > 1 ? `队${t + 1}（${label(ps)}）` : label(ps)}</option>`)
  povSel.innerHTML = html`${opts}`.s
  povSel.disabled = !renderer.canPerspective
  if (!renderer.canPerspective) povSel.title = "这份回放是老版本生成的，没有视野信息"
  const want = new URLSearchParams(location.search).get("pov")
  setPov(want !== null && want !== "" && teams.has(Number(want)) && renderer.canPerspective ? Number(want) : null)
}

function setPov(team: number | null): void {
  pov = team
  povSel.value = team === null ? "" : String(team)
  renderer.setPerspective(team)
  // 只有一个人的视角：日志也只看他的
  const members = model!.replay.players.map((p, i) => ((typeof p.team === "number" ? p.team : i) === team ? i : -1)).filter((i) => i >= 0)
  logFilter = members.length === 1 ? members[0] : null
  const url = new URL(location.href)
  if (team === null) url.searchParams.delete("pov")
  else url.searchParams.set("pov", String(team))
  history.replaceState(null, "", url)
}

povSel.addEventListener("change", () => {
  if (!model) return
  setPov(povSel.value === "" ? null : Number(povSel.value))
  drawFilter()
  updateUI(true)
})

function drawFilter(): void {
  if (!model) return
  const btns = [html`<button data-p="" class="${logFilter === null ? "on" : ""}">全部</button>`]
  model.replay.players.forEach((_, i) => btns.push(html`<button data-p="${i}" class="${logFilter === i ? "on" : ""}">P${i}</button>`))
  $("log-filter").innerHTML = html`${btns}`.s
}

$("log-filter").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button")
  if (!b) return
  logFilter = b.dataset.p === "" ? null : Number(b.dataset.p)
  drawFilter()
  drawLogs()
})

/** 最近 200 tick 的日志和报错 */
function drawLogs(): void {
  if (!model || !state) return
  const lines: Raw[] = []
  const from = Math.max(1, state.tick - 200)
  for (let t = from; t <= state.tick; t++) {
    const f = model.frame(t)
    if (!f) continue
    const cls = t === state.tick ? " now" : ""
    for (const l of f.logs ?? []) {
      if (logFilter !== null && l.p !== logFilter) continue
      for (const text of Array.isArray(l.text) ? l.text : []) lines.push(html`<div class="line${cls}"><span class="t">${t} P${l.p}</span> ${text}</div>`)
    }
    for (const e of f.errs ?? []) {
      if (logFilter !== null && e.p !== logFilter) continue
      const kind = String(e.msg).startsWith("命令被拒") ? "rej" : "err"
      lines.push(html`<div class="line ${kind}${cls}"><span class="t">${t} P${e.p}</span> ${e.msg}</div>`)
    }
    // 规则包写的事件、放的技能（D-186）
    for (const n of f.notes ?? []) {
      if (logFilter !== null && n.p >= 0 && n.p !== logFilter) continue
      lines.push(html`<div class="line${cls}"><span class="t">${t}${n.p >= 0 ? ` P${n.p}` : ""}</span> （规则包）${n.text}</div>`)
    }
    for (const c of f.casts ?? []) lines.push(html`<div class="line${cls}"><span class="t">${t}</span> #${c.u} 放了技能 ${c.s}</div>`)
  }
  const box = $("logs")
  box.innerHTML = lines.length ? html`${lines.slice(-400)}`.s : '<span class="muted">最近 200 tick 没有日志</span>'
  box.scrollTop = box.scrollHeight
}

function drawBotStats(): void {
  if (!model) return
  const r = model.replay
  const items = r.bots.map((b) => {
    const avg = b.calls ? (b.fuelTotal / b.calls).toFixed(1) : "0"
    const dead = b.status === "dead" ? html`<div class="err">已停止：${b.deadReason ?? ""}</div>` : ""
    return html`<div><b>P${b.player}</b> ${b.bot}<br>调用 ${b.calls}，燃料均值 ${avg} / 最高 ${b.fuelMax}，报错 ${b.errors}，燃料耗尽 ${b.fuelOuts}，被拒 ${b.rejected}，耗时 ${Math.round(Number(b.ms))} ms${dead}</div>`
  })
  $("bot-stats").innerHTML = html`${items}<div class="muted">实体峰值 ${r.perf?.peakEntities}，内核耗时 ${r.perf?.simMs} ms，bot 耗时 ${r.perf?.botMs} ms</div>`.s
}

// ---------- 控件 ----------

playBtn.addEventListener("click", () => setPlaying(!playing))
$("to-start").addEventListener("click", () => {
  setPlaying(false)
  seek(0)
})
$("step-back").addEventListener("click", () => {
  setPlaying(false)
  if (state) seek(state.tick - 1)
})
$("step-fwd").addEventListener("click", () => {
  setPlaying(false)
  if (state) {
    advanceTo(state.tick + 1)
    now = state.tick
    updateUI(true)
  }
})
$("fit").addEventListener("click", () => model && renderer.fit())
slider.addEventListener("input", () => seek(Number(slider.value)))
select.addEventListener("change", () => loadByName(select.value))
$("refresh").addEventListener("click", () => refreshList(select.value || undefined))
$<HTMLInputElement>("file-input").addEventListener("change", async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    load(JSON.parse(await file.text()))
  } catch (e) {
    alert(`读取失败：${(e as Error).message}`)
  }
})
window.addEventListener("keydown", (ev) => {
  if (!model || !state || ["INPUT","SELECT","TEXTAREA","BUTTON"].includes((ev.target as HTMLElement).tagName)) return
  const big = ev.shiftKey ? 50 : 1
  if (ev.key === " ") {
    ev.preventDefault()
    setPlaying(!playing)
  } else if (ev.key === "ArrowRight") {
    setPlaying(false)
    seek(state.tick + big)
  } else if (ev.key === "ArrowLeft") {
    setPlaying(false)
    seek(state.tick - big)
  } else if (ev.key === "Home") {
    setPlaying(false)
    seek(0)
  } else if (ev.key === "End") {
    setPlaying(false)
    seek(model.lastTick)
  }
})

// ---------- 页签 ----------

function showTab(tab: "replay" | "arena"): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button")) b.classList.toggle("on", b.dataset.tab === tab)
  $("replay-page").hidden = tab !== "replay"
  $("replay-footer").hidden = tab !== "replay"
  for (const el of document.querySelectorAll<HTMLElement>(".replay-only")) el.hidden = tab !== "replay"
  $("arena-page").hidden = tab !== "arena"
  if (tab === "replay") {
    setPlaying(false)
    // 画布在隐藏时尺寸是 0，切回来要重新铺满
    requestAnimationFrame(() => model && renderer.fit())
  }
}

document.querySelector(".tabs")!.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button")
  if (b?.dataset.tab === "replay" || b?.dataset.tab === "arena") showTab(b.dataset.tab)
})

initArena({
  openReplay: async (name) => {
    showTab("replay")
    await refreshList(name)
  },
})

// ---------- 主循环 ----------

await renderer.init($("stage"))
new ResizeObserver(()=>requestAnimationFrame(()=>{if(model)renderer.fit()})).observe($("stage"))
renderer.app.ticker.add((tk) => {
  if (model && state && playing) {
    now += (tk.deltaMS / 1000) * model.replay.tickRate * Number(speedSel.value)
    if (now >= model.lastTick) {
      now = model.lastTick
      setPlaying(false)
    }
    const target = Math.floor(now)
    if (target > state.tick) {
      advanceTo(target)
      updateUI()
    }
  }
  renderer.draw(now)
})
await refreshList()
