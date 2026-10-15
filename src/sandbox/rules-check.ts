// 检查沙箱规则包导出的静态数据（参数、地形、实体类型）。规则包是别人写的，格式不对要在开局前说清楚哪里不对，
// 而不是在对局中途让内核崩掉。平台自带的规则包也要能通过（测试里查）。

/** 沙箱规则包的硬上限（超出直接拒绝；建议上限见 src/core/limits.ts，那个只提醒） */
export const RULES_HARD = {
  mapSide: 256,
  players: 8,
  entities: 5000,
  maxTicks: 100_000,
  botFuel: 2000,
  types: 64,
  resources: 8,
  terrain: 16,
  /** 单个建筑最大边长 */
  buildingSide: 8,
}

const SHAPES = ["circle", "square", "triangle", "diamond", "hex"]
const LAYERS = ["ground", "air", "under"]

function checkArt(art: unknown, at: string, bad: (msg: string) => void): void {
  if (!isObj(art)) return bad(`${at} 要写成 { base?, under?, over?, sprite?, weapon?, motion? }`)
  for (const k of Object.keys(art)) if (!["base", "under", "over", "sprite", "weapon", "motion"].includes(k)) bad(`${at} 只能写 base、under、over、sprite、weapon、motion（多了 ${k}）`)
  if (art.base !== undefined && (typeof art.base !== "string" || !NAME.test(art.base))) bad(`${at}.base 要写平台造型的名字（小写英文，比如 soldier、cavalry、tower）`)
  for (const k of ["under", "over", "sprite"])
    if (art[k] !== undefined && (typeof art[k] !== "string" || !(/\.svg$/i.test(art[k] as string) || /^\s*</.test(art[k] as string))))
      bad(`${at}.${k} 要写规则包目录里的 .svg 文件路径（相对规则包目录，比如 "art/lord.svg"）`)
  if (art.weapon !== undefined && !["autocannon", "siege-shell", "missile", "plasma", "detonation"].includes(art.weapon as string)) bad(`${at}.weapon 要是 autocannon、siege-shell、missile、plasma、detonation 之一`)
  if (art.motion !== undefined && !["armored", "tracked", "walker", "hover", "burrow"].includes(art.motion as string)) bad(`${at}.motion 要是 armored、tracked、walker、hover、burrow 之一`)
}

/** 攻击的写法：伤害、射程、冷却、溅射、命中率、克制倍数，能打哪一层、打一下就没了（D-269） */
function checkAttack(a: unknown, at: string, names: Set<string>, bad: (msg: string) => void): void {
  if (!isObj(a) || !isInt(a.damage, 0) || !isInt(a.range, 1, 16) || !isInt(a.cooldown, 1)) bad(`${at}.attack 要写成 { damage ≥ 0, range 1～16, cooldown ≥ 1 }（整数）`)
  else if (a.splash !== undefined && !isInt(a.splash, 1, 3)) bad(`${at}.attack.splash（溅射）要是 1～3 的整数`)
  else if (a.accuracy !== undefined && !isInt(a.accuracy, 1, 100)) bad(`${at}.attack.accuracy（命中率，百分数）要是 1～100 的整数`)
  else if (a.hits !== undefined && (!Array.isArray(a.hits) || a.hits.length === 0 || a.hits.some((x) => x !== "ground" && x !== "air") || new Set(a.hits).size !== a.hits.length))
    bad(`${at}.attack.hits 要是 ["ground"]、["air"] 或 ["ground", "air"]`)
  else if (a.suicide !== undefined && a.suicide !== true) bad(`${at}.attack.suicide 只能写 true（打一下就没了）`)
  else if (a.vs !== undefined) {
    // 克制倍数（D-166）：打这些类型时伤害乘几倍
    if (!isObj(a.vs)) bad(`${at}.attack.vs 要写成 { 类型名: 倍数 }，比如 { cavalry: 3 }`)
    else
      for (const [k, m] of Object.entries(a.vs))
        if (!names.has(k) || typeof m !== "number" || !Number.isFinite(m) || m < 0 || m > 10) bad(`${at}.attack.vs.${k}：类型要是已定义的类型名，倍数是 0～10 的数`)
  }
}
const KINDS = ["unit", "building", "resource"]
const NAME = /^[a-z][a-z0-9_]{0,31}$/

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v)
const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max

/** 联赛视频选手页的看点（D-249） */
function checkSpotlight(s: unknown, bad: (msg: string) => void): void {
  const form = "spotlight 要写成 1～4 项的数组：[{ stat, unit?, lower?, note? }]"
  if (!Array.isArray(s) || s.length === 0 || s.length > 4) return bad(form)
  s.forEach((it, k) => {
    const at = `spotlight[${k}]`
    if (!isObj(it)) return bad(`${at} 要写成 { stat, unit?, lower?, note? }`)
    for (const key of Object.keys(it)) if (!["stat", "unit", "lower", "note"].includes(key)) bad(`${at} 只能写 stat、unit、lower、note（多了 ${key}）`)
    if (!str(it.stat, 20)) bad(`${at}.stat 要写对局结果 stats 里的名字（1～20 字）`)
    if (it.unit !== undefined && !str(it.unit, 4)) bad(`${at}.unit 要是 1～4 字`)
    if (it.lower !== undefined && typeof it.lower !== "boolean") bad(`${at}.lower 要是 true / false`)
    if (it.note !== undefined && !str(it.note, 40)) bad(`${at}.note 要是 1～40 字`)
  })
}

/** 返回所有问题；空数组表示没问题 */
export function checkRulesetData(d: unknown, callbacks: string[]): string[] {
  const errs: string[] = []
  const bad = (msg: string) => errs.push(msg)
  if (!isObj(d)) return ["默认导出不是对象（要写成 export default { id, name, ... } 或 export default ruleset）"]

  if (typeof d.id !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(d.id)) bad("id 要是小写字母开头、只含小写字母数字 _ - 的字符串（最长 32）")
  if (typeof d.name !== "string" || d.name.length === 0 || d.name.length > 40) bad("name 要是 1～40 字的字符串")
  if (d.summary !== undefined && (typeof d.summary !== "string" || d.summary.length > 60)) bad("summary 要是最长 60 字的字符串（一句话玩法简介）")
  const players = d.players
  if (!isObj(players) || !isInt(players.min, 1, RULES_HARD.players) || !isInt(players.max, 1, RULES_HARD.players) || players.min > players.max)
    bad(`players 要写成 { min, max }，1 ≤ min ≤ max ≤ ${RULES_HARD.players}`)
  if (d.teams !== undefined && typeof d.teams !== "boolean") bad("teams 要是 true / false")
  if (d.sharedResources !== undefined && typeof d.sharedResources !== "boolean") bad("sharedResources 要是 true / false")
  if (d.spotlight !== undefined) checkSpotlight(d.spotlight, bad)
  if (!isInt(d.maxTicks, 1, RULES_HARD.maxTicks)) bad(`maxTicks 要是 1～${RULES_HARD.maxTicks} 的整数`)
  if (typeof d.tickRate !== "number" || !(d.tickRate >= 1 && d.tickRate <= 120)) bad("tickRate 要是 1～120 的数")
  if (!isInt(d.decisionInterval, 1, 1000)) bad("decisionInterval 要是 1～1000 的整数")
  if (!isInt(d.fuel, 1, RULES_HARD.botFuel)) bad(`fuel 要是 1～${RULES_HARD.botFuel} 的整数`)
  if (!isInt(d.unitCap, 0, RULES_HARD.entities)) bad(`unitCap 要是 0～${RULES_HARD.entities} 的整数（0 是不限）`)
  if (typeof d.fog !== "boolean") bad("fog 要是 true / false")

  const resources = Array.isArray(d.resources) ? d.resources : null
  if (!resources || resources.length === 0 || resources.length > RULES_HARD.resources || resources.some((r) => typeof r !== "string" || !NAME.test(r)))
    bad(`resources 要是 1～${RULES_HARD.resources} 个小写名字的数组，如 ["gold"]`)
  const resSet = new Set((resources ?? []).filter((r): r is string => typeof r === "string"))

  if (!isObj(d.terrain) || Object.keys(d.terrain).length === 0 || Object.keys(d.terrain).length > RULES_HARD.terrain) bad(`terrain 要是 1～${RULES_HARD.terrain} 种地形`)
  else
    for (const [ch, t] of Object.entries(d.terrain)) {
      if ([...ch].length !== 1) bad(`地形 "${ch}" 的键要是单个字符`)
      if (!isObj(t) || typeof t.walkable !== "boolean" || typeof t.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(t.color))
        bad(`地形 "${ch}" 要写成 { walkable: true/false, color: "#rrggbb" }`)
    }

  if (!isObj(d.types) || Object.keys(d.types).length === 0 || Object.keys(d.types).length > RULES_HARD.types) bad(`types 要是 1～${RULES_HARD.types} 种实体类型`)
  else {
    const types = d.types
    const names = new Set(Object.keys(types))
    for (const [name, s] of Object.entries(types)) {
      const at = `types.${name}`
      if (!NAME.test(name)) bad(`${at}：类型名要是小写字母开头的小写名字`)
      if (!isObj(s)) {
        bad(`${at} 要是对象`)
        continue
      }
      const kind = s.kind
      if (typeof kind !== "string" || !KINDS.includes(kind)) {
        bad(`${at}.kind 要是 unit、building、resource 之一`)
        continue
      }
      // 单位最大 3×3（D-269：大型单位）
      const side = kind === "unit" ? 3 : RULES_HARD.buildingSide
      for (const k of ["w", "h"]) if (s[k] !== undefined && !isInt(s[k], 1, side)) bad(`${at}.${k} 要是 1～${side} 的整数${kind === "unit" ? "（单位最大 3×3）" : ""}`)
      // 层、探测、状态、驻扎（D-269）
      if (s.layer !== undefined && (kind !== "unit" || !LAYERS.includes(s.layer as string))) bad(`${at}.layer：只有单位能写，要是 ${LAYERS.join("、")} 之一`)
      if (s.detect !== undefined && !isInt(s.detect, 0, 16)) bad(`${at}.detect（探测半径）要是 0～16 的整数`)
      if (s.garrison !== undefined) {
        const g = s.garrison
        if (kind !== "building") bad(`${at}.garrison：只有建筑能驻扎单位`)
        else if (!isObj(g) || !isInt(g.capacity, 1, 12) || (g.rangeBonus !== undefined && !isInt(g.rangeBonus, 0, 4))) bad(`${at}.garrison 要写成 { capacity: 1～12, types?: [单位类型], rangeBonus?: 0～4 }`)
        else if (g.types !== undefined && (!Array.isArray(g.types) || g.types.some((x) => typeof x !== "string" || (types[x as string] as Obj | undefined)?.kind !== "unit")))
          bad(`${at}.garrison.types 要是单位类型名的数组`)
      }
      if (s.modes !== undefined) {
        const ms = s.modes
        if (kind === "resource") bad(`${at}.modes：资源点不能有几种状态`)
        else if (!Array.isArray(ms) || ms.length < 2 || ms.length > 4) bad(`${at}.modes 要是 2～4 个状态的数组（第一个是刚造出来时的状态）`)
        else {
          const ids = new Set<string>()
          ms.forEach((m, i) => {
            const w = `${at}.modes[${i}]`
            if (!isObj(m) || typeof m.id !== "string" || !/^[a-z][a-zA-Z0-9]{0,15}$/.test(m.id)) return bad(`${w}.id 要是小写字母开头的英文名（cmd.mode 用它）`)
            if (ids.has(m.id)) bad(`${w}.id "${m.id}" 重复了`)
            ids.add(m.id)
            if (typeof m.name !== "string" || [...m.name].length < 1 || [...m.name].length > 6) bad(`${w}.name 要写 1～6 个字`)
            if (m.switchTicks !== undefined && !isInt(m.switchTicks, 0, 600)) bad(`${w}.switchTicks 要是 0～600 的整数`)
            const extra = Object.keys(m).filter((k) => !["id", "name", "switchTicks", "look"].includes(k))
            if (i === 0 && extra.length) bad(`${w}：第一个状态的数值就是类型上写的，只能写 id、name、switchTicks、look（多了 ${extra.join("、")}）`)
            for (const k of extra) if (!["moveTicks", "sight", "attack", "layer"].includes(k)) bad(`${w} 只能写 id、name、switchTicks、moveTicks、sight、attack、layer、look（多了 ${k}）`)
            // 建筑的状态（D-270）：只能是飞起来（air，要能走）和落在地上（不能走）
            if (kind === "building" && i > 0) {
              if (m.layer === "under") bad(`${w}.layer：建筑不能钻到地下`)
              if (m.layer === "air" && !isInt(m.moveTicks, 1)) bad(`${w}：建筑飞起来的状态要写 moveTicks（走一格几 tick，≥ 1）`)
              if (m.layer !== "air" && m.moveTicks !== undefined && m.moveTicks !== 0) bad(`${w}：建筑落在地上不能走（moveTicks 只能是 0），要能走就写 layer: "air"`)
            }
            if (m.moveTicks !== undefined && !isInt(m.moveTicks, 0)) bad(`${w}.moveTicks 要是非负整数`)
            if (m.sight !== undefined && !isInt(m.sight, 0, 32)) bad(`${w}.sight 要是 0～32 的整数`)
            if (m.layer !== undefined && !LAYERS.includes(m.layer as string)) bad(`${w}.layer 要是 ${LAYERS.join("、")} 之一`)
            if (m.attack !== undefined && m.attack !== null) checkAttack(m.attack, w, names, bad)
            if (m.look !== undefined) {
              const l = m.look
              if (!isObj(l) || Object.keys(l).some((k) => !["label", "art"].includes(k))) bad(`${w}.look 只能写 label、art`)
              else if (l.label !== undefined && (typeof l.label !== "string" || [...l.label].length > 2)) bad(`${w}.look.label 最多 2 个字`)
              else if (l.art !== undefined) checkArt(l.art, `${w}.look.art`, bad)
            }
          })
        }
      }
      for (const k of ["maxHp", "buildTicks", "moveTicks", "amount"]) if (s[k] !== undefined && !isInt(s[k], 0)) bad(`${at}.${k} 要是非负整数`)
      if (s.sight !== undefined && !isInt(s.sight, 0, 32)) bad(`${at}.sight 要是 0～32 的整数`)
      if (s.cost !== undefined) {
        if (!isObj(s.cost)) bad(`${at}.cost 要写成 { 资源名: 数量 }`)
        else for (const [r, n] of Object.entries(s.cost)) if (!resSet.has(r) || !isInt(n, 0)) bad(`${at}.cost.${r}：资源要在 resources 里，数量是非负整数`)
      }
      if (s.attack !== undefined && s.attack !== null) checkAttack(s.attack, at, names, bad)
      if (s.gather !== undefined && s.gather !== null) {
        const g = s.gather
        if (kind !== "unit") bad(`${at}.gather：只有单位能采集`)
        if (!isObj(g) || !isInt(g.amount, 1) || !isInt(g.ticks, 1) || !isInt(g.capacity, 1)) bad(`${at}.gather 要写成 { amount, ticks, capacity }（正整数）`)
      }
      if (s.dropOff !== undefined && typeof s.dropOff !== "boolean") bad(`${at}.dropOff 要是 true / false`)
      for (const k of ["produces", "builds"]) {
        const list = s[k]
        if (list === undefined) continue
        if (!Array.isArray(list) || list.some((x) => typeof x !== "string" || !names.has(x))) bad(`${at}.${k} 要是已定义的类型名数组`)
        else if (k === "builds" && list.some((x) => (types[x as string] as Obj | undefined)?.kind !== "building")) bad(`${at}.builds 里只能是建筑类型`)
      }
      if (s.parallel !== undefined && (!isInt(s.parallel, 1, 5) || !Array.isArray(s.produces) || s.produces.length === 0)) bad(`${at}.parallel 要是 1～5 的整数（同时造几个，生产队列最多 5 个），而且要有 produces`)
      checkTech(s, at, kind, types, d.researches, bad)
      checkAbilities(s, at, names, kind, resSet, bad)
      if (kind === "resource" && (typeof s.resource !== "string" || !resSet.has(s.resource))) bad(`${at}.resource：资源点要写产出的资源名（在 resources 里）`)
      if (kind !== "resource" && s.resource !== undefined && s.resource !== null) bad(`${at}.resource：只有资源点能写`)
      const look = s.look
      if (!isObj(look) || typeof look.shape !== "string" || !SHAPES.includes(look.shape)) bad(`${at}.look.shape 要是 ${SHAPES.join("、")} 之一`)
      else {
        if (look.label !== undefined && (typeof look.label !== "string" || [...look.label].length > 2)) bad(`${at}.look.label 最多 2 个字`)
        if (look.color !== undefined && (typeof look.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(look.color))) bad(`${at}.look.color 要写成 "#rrggbb"`)
        if (look.name !== undefined && (typeof look.name !== "string" || [...look.name].length < 1 || [...look.name].length > 6)) bad(`${at}.look.name 要写 1～6 个字`)
        // 规则包自带的素材（D-233）：这里只查写法，文件由加载规则包的宿主去读（inlineRulesetArt）
        const art = look.art
        if (art !== undefined) checkArt(art, `${at}.look.art`, bad)
      }
    }
  }

  checkResearches(d, resSet, bad)
  for (const fn of ["setup", "objectives", "result", "timeUp"]) if (!callbacks.includes(fn)) bad(`缺少函数 ${fn}(ctx)`)
  // 技能的效果在 onCast 里实现（D-186），没有的话 bot 放什么技能都会被拒
  const withSkills = isObj(d.types) ? Object.entries(d.types).filter(([, t]) => isObj(t) && Array.isArray(t.skills) && t.skills.length > 0).map(([k]) => k) : []
  if (withSkills.length && !callbacks.includes("onCast")) bad(`${withSkills.join("、")} 有技能（skills），要导出 onCast(ctx, cast) 实现技能效果`)
  return errs
}

/** 前置可以写建筑类型（要有建好的）或研究 id（要先研究好） */
function checkReqs(v: unknown, w: string, types: Obj, researches: unknown, bad: (msg: string) => void): void {
  const res = isObj(researches) ? researches : {}
  if (!Array.isArray(v) || v.length > 8 || v.some((x) => typeof x !== "string" || !((types[x] as Obj | undefined)?.kind === "building" || Object.hasOwn(res, x))))
    bad(`${w} 要是建筑类型名或研究 id 的数组（最多 8 个）`)
}

/** 护甲、标签、科技前置、挂件、研究、能量、治疗、修理（D-270） */
function checkTech(s: Obj, at: string, kind: string, types: Obj, researches: unknown, bad: (msg: string) => void): void {
  const res = isObj(researches) ? researches : {}
  const tagList = (v: unknown) => Array.isArray(v) && v.length >= 1 && v.length <= 8 && v.every((x) => typeof x === "string" && NAME.test(x))
  if (s.armor !== undefined && !isInt(s.armor, 0, 1000)) bad(`${at}.armor（护甲）要是 0～1000 的整数`)
  if (s.tags !== undefined && !tagList(s.tags)) bad(`${at}.tags 要是 1～8 个小写英文标签的数组，比如 ["bio"]`)
  if (s.requires !== undefined) checkReqs(s.requires, `${at}.requires`, types, researches, bad)
  if (s.needsAddon !== undefined && !isObj((types[s.needsAddon as string] as Obj | undefined)?.addon)) bad(`${at}.needsAddon 要写挂件类型名（写了 addon 的建筑）`)
  if (s.addons !== undefined) {
    if (kind !== "building") bad(`${at}.addons：只有建筑能建挂件`)
    else if (!Array.isArray(s.addons) || s.addons.some((x) => typeof x !== "string" || !isObj((types[x] as Obj | undefined)?.addon))) bad(`${at}.addons 要是挂件类型名的数组（挂件是写了 addon 的建筑）`)
  }
  if (s.addon !== undefined) {
    if (kind !== "building") bad(`${at}.addon：只有建筑能当挂件`)
    else if (!isObj(s.addon) || (s.addon.parallel !== undefined && !isInt(s.addon.parallel, 1, 5))) bad(`${at}.addon 要写成 { parallel?: 1～5 }`)
  }
  if (s.researches !== undefined) {
    if (kind !== "building") bad(`${at}.researches：只有建筑能研究`)
    else if (!Array.isArray(s.researches) || s.researches.some((x) => typeof x !== "string" || !Object.hasOwn(res, x))) bad(`${at}.researches 要是规则包 researches 里的 id 数组`)
  }
  const en = s.energy
  if (en !== undefined) {
    if (kind === "resource" || !isObj(en) || !isInt(en.max, 1, 1000) || (en.start !== undefined && !isInt(en.start, 0, en.max as number)) || (en.regenTicks !== undefined && !isInt(en.regenTicks, 1, 1000)))
      bad(`${at}.energy 要写成 { max: 1～1000, start?: 0～max, regenTicks?: 1～1000 }`)
  }
  const h = s.heal
  if (h !== undefined) {
    if (kind === "resource" || !isObj(h) || !isInt(h.amount, 1, 100_000) || !isInt(h.range, 1, 16) || !isInt(h.cooldown, 1, 10_000) || (h.energy !== undefined && !isInt(h.energy, 0, 1000)) || !tagList(h.tags))
      bad(`${at}.heal 要写成 { amount ≥ 1, range: 1～16, cooldown ≥ 1, energy?: 0～1000, tags: ["bio"] }`)
    else if ((h.energy as number) > 0 && !isObj(en)) bad(`${at}.heal.energy：要写 energy（能量上限）才能花能量治疗`)
  }
  const r = s.repair
  if (r !== undefined) {
    if (kind !== "unit") bad(`${at}.repair：只有单位能修理`)
    else if (!isObj(r) || !Array.isArray(r.tags) || r.tags.some((x) => typeof x !== "string" || !NAME.test(x)) || (r.buildings !== undefined && typeof r.buildings !== "boolean") || (r.costPct !== undefined && !isInt(r.costPct, 0, 1000)))
      bad(`${at}.repair 要写成 { tags: ["mech"], buildings?: true/false, costPct?: 0～1000 }`)
  }
  if (s.lifetime !== undefined && (kind !== "unit" || !isInt(s.lifetime, 1, 100_000))) bad(`${at}.lifetime：只有单位能写，要是 1～100000 的整数（几 tick 后消失）`)
  if (Array.isArray(s.skills))
    s.skills.forEach((k, i) => {
      if (isObj(k) && typeof k.requires === "string" && !Object.hasOwn(res, k.requires)) bad(`${at}.skills[${i}].requires 要写规则包 researches 里的 id`)
    })
}

/** 规则包的研究（D-270） */
function checkResearches(d: Obj, resSet: Set<string>, bad: (msg: string) => void): void {
  const rs = d.researches
  if (rs === undefined) return
  if (!isObj(rs) || Object.keys(rs).length > 64) return bad("researches 要写成 { 研究 id: { name, cost, ticks, desc, requires?, effects? } }，最多 64 项")
  const types = isObj(d.types) ? d.types : {}
  const PATCH: Record<string, string[] | null> = { maxHp: null, moveTicks: null, sight: null, armor: null, attack: ["damage", "range", "cooldown", "accuracy"], gather: ["amount", "ticks", "capacity"] }
  for (const [id, r] of Object.entries(rs)) {
    const at = `researches.${id}`
    if (!NAME.test(id)) bad(`${at}：研究 id 要是小写字母开头的小写名字（cmd.research 用它）`)
    if (Object.hasOwn(types, id)) bad(`${at}：研究 id 不能和类型名一样（前置 requires 里分不清）`)
    if (!isObj(r)) {
      bad(`${at} 要是对象`)
      continue
    }
    for (const k of Object.keys(r)) if (!["name", "cost", "ticks", "requires", "effects", "desc"].includes(k)) bad(`${at} 只能写 name、cost、ticks、requires、effects、desc（多了 ${k}）`)
    if (typeof r.name !== "string" || [...r.name].length < 1 || [...r.name].length > 8) bad(`${at}.name 要写 1～8 个字`)
    if (typeof r.desc !== "string" || [...r.desc].length < 1 || [...r.desc].length > 80) bad(`${at}.desc 要写 1～80 字的说明（bot 作者看它）`)
    if (!isInt(r.ticks, 1, 100_000)) bad(`${at}.ticks 要是 1～100000 的整数`)
    if (!isObj(r.cost)) bad(`${at}.cost 要写成 { 资源名: 数量 }`)
    else for (const [k, n] of Object.entries(r.cost)) if (!resSet.has(k) || !isInt(n, 0)) bad(`${at}.cost.${k}：资源要在 resources 里，数量是非负整数`)
    if (r.requires !== undefined) {
      checkReqs(r.requires, `${at}.requires`, types, rs, bad)
      if (Array.isArray(r.requires) && r.requires.includes(id)) bad(`${at}.requires 不能写自己`)
    }
    if (r.effects !== undefined) {
      if (!isObj(r.effects)) {
        bad(`${at}.effects 要写成 { 类型名: { armor: 1, attack: { damage: 1 } } }（加多少）`)
        continue
      }
      for (const [t, p] of Object.entries(r.effects)) {
        const w = `${at}.effects.${t}`
        if (!Object.hasOwn(types, t)) bad(`${w}：没有这个类型`)
        if (!isObj(p)) {
          bad(`${w} 要写成 { armor: 1, attack: { damage: 1 } }`)
          continue
        }
        for (const [k, v] of Object.entries(p)) {
          if (!Object.hasOwn(PATCH, k)) bad(`${w} 只能加 ${Object.keys(PATCH).join("、")}（多了 ${k}）`)
          else if (PATCH[k] === null) {
            if (!isInt(v, -100_000, 100_000)) bad(`${w}.${k} 要是整数（加多少，可以是负数）`)
          } else if (!isObj(v)) bad(`${w}.${k} 要写成对象`)
          else for (const [kk, vv] of Object.entries(v)) if (!PATCH[k]!.includes(kk) || !isInt(vv, -100_000, 100_000)) bad(`${w}.${k}.${kk}：只能加 ${PATCH[k]!.join("、")}，要是整数`)
        }
      }
    }
  }
}

/** 技能、光环、被动（D-186） */
function checkAbilities(s: Obj, at: string, names: Set<string>, kind: string, resSet: Set<string>, bad: (msg: string) => void): void {
  const short = (v: unknown, max: number) => typeof v === "string" && [...v].length >= 1 && [...v].length <= max
  if (s.skills !== undefined) {
    if (!Array.isArray(s.skills) || s.skills.length > 8) bad(`${at}.skills 要是数组，最多 8 个`)
    else {
      if (kind === "resource" && s.skills.length) bad(`${at}.skills：资源点不能有技能`)
      const ids = new Set<string>()
      s.skills.forEach((k, i) => {
        const w = `${at}.skills[${i}]`
        if (!isObj(k)) return bad(`${w} 要写成 { id, name, cooldown, desc }`)
        if (typeof k.id !== "string" || !NAME.test(k.id)) bad(`${w}.id 要是小写字母开头的小写名字（cmd.cast 用它）`)
        else if (ids.has(k.id)) bad(`${w}.id 和前面的技能重名`)
        else ids.add(k.id)
        if (!short(k.name, 6)) bad(`${w}.name 要写 1～6 个字的中文名`)
        if (!short(k.desc, 80)) bad(`${w}.desc 要写 1～80 字的效果说明（bot 作者看它）`)
        if (!isInt(k.cooldown, 1, 100_000)) bad(`${w}.cooldown 要是 1～100000 的整数（tick）`)
        if (k.initialCooldown !== undefined && !isInt(k.initialCooldown, 0, 100_000)) bad(`${w}.initialCooldown 要是 0～100000 的整数`)
        if (k.target !== undefined && !["none", "point", "unit"].includes(k.target as string)) bad(`${w}.target 要是 none、point、unit 之一`)
        if (k.range !== undefined && !isInt(k.range, 0, 64)) bad(`${w}.range 要是 0～64 的整数`)
        if ((k.target === "point" || k.target === "unit") && !isInt(k.range, 1, 64)) bad(`${w}：target 是 ${k.target} 时要写 range（1～64）`)
        if (k.situational !== undefined && typeof k.situational !== "boolean") bad(`${w}.situational 要是 true / false`)
        if (k.cost !== undefined) {
          if (!isObj(k.cost)) bad(`${w}.cost 要写成 { 资源名: 数量 }`)
          else for (const [r, n] of Object.entries(k.cost)) if (!resSet.has(r) || !isInt(n, 0)) bad(`${w}.cost.${r}：资源要在 resources 里，数量是非负整数`)
        }
        // 能量、要先研究（D-270）
        if (k.energy !== undefined && !isInt(k.energy, 0, 1000)) bad(`${w}.energy 要是 0～1000 的整数（每放一次花多少能量）`)
        if ((k.energy as number) > 0 && !isObj(s.energy)) bad(`${w}.energy：类型要写 energy（能量上限）才能花能量`)
        if (k.requires !== undefined && k.requires !== null && typeof k.requires !== "string") bad(`${w}.requires 要写研究 id`)
      })
    }
  }
  if (s.auras !== undefined) {
    if (!Array.isArray(s.auras) || s.auras.length > 4) bad(`${at}.auras 要是数组，最多 4 个`)
    else
      s.auras.forEach((a, i) => {
        const w = `${at}.auras[${i}]`
        if (!isObj(a)) return bad(`${w} 要写成 { name, damagePct, defensePct, ... }`)
        if (!short(a.name, 6)) bad(`${w}.name 要写 1～6 个字的中文名`)
        if (a.radius !== undefined && !isInt(a.radius, -1, 32)) bad(`${w}.radius 要是 -1～32 的整数（-1 是等于视野）`)
        if (a.affects !== undefined && !["own", "allies", "enemies"].includes(a.affects as string)) bad(`${w}.affects 要是 own、allies、enemies 之一`)
        if (a.types !== undefined && (!Array.isArray(a.types) || a.types.some((t) => typeof t !== "string" || !names.has(t)))) bad(`${w}.types 要是已定义的类型名数组`)
        if (a.self !== undefined && typeof a.self !== "boolean") bad(`${w}.self 要是 true / false`)
        if (a.damagePct !== undefined && !isInt(a.damagePct, -100, 1000)) bad(`${w}.damagePct 要是 -100～1000 的整数（百分比）`)
        if (a.defensePct !== undefined && !isInt(a.defensePct, -1000, 90)) bad(`${w}.defensePct 要是 -1000～90 的整数（百分比）`)
        if (!a.damagePct && !a.defensePct) bad(`${w}：damagePct、defensePct 至少写一项（不然光环没有效果）`)
      })
  }
  if (s.passives !== undefined) {
    if (!Array.isArray(s.passives) || s.passives.length > 4) bad(`${at}.passives 要是数组，最多 4 个`)
    else
      s.passives.forEach((x, i) => {
        const w = `${at}.passives[${i}]`
        if (!isObj(x) || x.kind !== "regen") return bad(`${w} 现在只支持 { kind: "regen", name, delay, every, amount }（脱战回血）`)
        if (!short(x.name, 6)) bad(`${w}.name 要写 1～6 个字的中文名`)
        if (!isInt(x.delay, 0, 100_000) || !isInt(x.every, 1, 100_000) || !isInt(x.amount, 1, 100_000)) bad(`${w}：delay ≥ 0、every ≥ 1、amount ≥ 1（整数）`)
        if (kind === "resource") bad(`${w}：资源点不能有被动`)
      })
  }
}

/** 检查 result / timeUp 的返回值；返回问题说明，没问题返回 null */
export function checkResult(r: unknown, playerCount: number, allowNull: boolean): string | null {
  if (r === null) return allowNull ? null : "timeUp 必须返回结果，不能是 null"
  if (!isObj(r)) return "结果要写成 { winner, reason }（还没分出胜负就返回 null）"
  const player = (v: unknown) => isInt(v, 0, playerCount - 1)
  if (r.winner !== null && !player(r.winner)) return `winner 要是 0～${playerCount - 1} 的玩家编号，平局写 null`
  if (typeof r.reason !== "string" || r.reason.length > 200) return "reason 要是最长 200 字的字符串"
  if (r.winners !== undefined && (!Array.isArray(r.winners) || !r.winners.every(player))) return "winners 要是玩家编号数组"
  if (r.ranking !== undefined && (!Array.isArray(r.ranking) || !r.ranking.every((g) => Array.isArray(g) && g.every(player))))
    return "ranking 要是玩家编号数组的数组，如 [[0], [1, 2]]"
  if (r.stats !== undefined) {
    if (!isObj(r.stats)) return "stats 要写成 { 名字: [每个玩家的数] }"
    const keys = Object.keys(r.stats)
    if (keys.length > 12) return "stats 最多 12 项"
    for (const k of keys) {
      const v = (r.stats as Record<string, unknown>)[k]
      if (k.length === 0 || k.length > 20) return `stats 的名字要是 1～20 字（"${k.slice(0, 30)}"）`
      if (!Array.isArray(v) || v.length !== playerCount || !v.every((x) => typeof x === "number" && Number.isFinite(x)))
        return `stats.${k} 要是 ${playerCount} 个数的数组（按玩家编号排）`
    }
  }
  return null
}
