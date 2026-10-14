// 回放里的交战时段和「导播」镜头（D-255 从 render.ts 抽出来，网页回放的导播视角和联赛视频共用）。只用回放数据，浏览器里也能跑
import type { Replay } from "../core/types.ts"
import { groupBattles, isRout } from "../cli/battles.ts"
import { battleCameraTrack, type BattleCamera } from "./battle-camera.ts"
import { BATTLE_LEAD, BATTLE_TAIL, deathsOf, zoomBattleTicks } from "./combat.ts"
export { BATTLE_LEAD, BATTLE_TAIL, deathsOf } from "./combat.ts"

/** 侧栏里算"大战"的门槛：一场死 6 个以上 */
export const BIG_BATTLE = 6
/** 两段交火中间只空了这么几 tick 就不快进了，免得快进一闪而过 */
export const SKIRMISH_GAP = 40
/**
 * 有单位倒下的交战按几倍速放：D-172 大战 2 倍速（用户看了一倍速说太慢），D-174 小冲突 4 倍速（用户：快进太快不知道发生了什么），
 * D-225 大战也 4 倍速（用户嫌节奏慢），D-226 不再分大战、小冲突（用户：都是 4 倍速没区别）
 */
export const FIGHT_SPEED = 4

/**
 * 回放里的交火时段（D-172、D-174）：同一套切分里，死 BIG_BATTLE 个以上、又不是一边倒的是大战（和视频侧栏标「大战」的一样），
 * 其余有单位倒下的（哪怕只死一个、一边倒的屠杀）是小冲突。每段从第一个死亡前 BATTLE_LEAD tick 到最后一个死亡后
 * BATTLE_TAIL tick，挨着的合并；小冲突和大战重叠的部分算大战
 */
export function fightWindows(replay: Replay): { battles: [number, number][]; skirmishes: [number, number][] } {
  const T = Math.max(1, replay.result.tick)
  const team = (p: number) => replay.players[p]?.team ?? p
  const deaths = deathsOf(replay)
  const big = (b: (typeof deaths)[number][]) => b.length >= BIG_BATTLE && !isRout(b, team)
  const merged = (bs: (typeof deaths)[number][][]) => {
    const out: [number, number][] = []
    const wins = bs.map((b): [number, number] => [Math.max(0, b[0].t - BATTLE_LEAD), Math.min(T, b[b.length - 1].t + BATTLE_TAIL)]).sort((a, b) => a[0] - b[0])
    for (const w of wins) {
      const last = out[out.length - 1]
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1])
      else out.push([w[0], w[1]])
    }
    return out
  }
  const groups = groupBattles(deaths)
  return { battles: merged(groups.filter(big)), skirmishes: merged(groups.filter((b) => !big(b))) }
}

/** 每个 tick 是不是在交战（1 是）：交火时段，中间只空了不到 SKIRMISH_GAP tick 的也算（视频的倍速、导播都按它） */
export function fightTicks(replay: Replay): Uint8Array {
  const T = Math.max(1, replay.result.tick)
  const { battles, skirmishes } = fightWindows(replay)
  const cls = new Uint8Array(T)
  for (const [x, y] of [...skirmishes, ...battles]) cls.fill(1, x, y)
  for (let t = 0; t < T; ) {
    let e = t
    while (e < T && cls[e] === cls[t]) e++
    if (cls[t] === 0 && t > 0 && e < T && e - t < SKIRMISH_GAP) cls.fill(1, t, e)
    t = e
  }
  return cls
}

/**
 * 网页回放的「导播」视角（D-255，用户：用视频同款的交战缩放）：每个 tick 一个镜头（第 t 个就是第 t tick 的），和视频一样用
 * battleCameraTrack 排好。同一处 60 tick 内至少死 4 个单位才放大，和视频共用判断；镜头的秒数按视频里交战的 4 倍速算
 * （放大镜头至少拍 2.5 秒就是 4 × tickRate × 2.5 tick），网页用别的倍速播放时镜头跟着 tick 走
 */
export function directorTrack(replay: Replay): BattleCamera[] {
  const T = Math.max(1, replay.result.tick)
  const combat = Array.from(zoomBattleTicks(replay), Boolean)
  const ticks = Array.from({ length: T + 1 }, (_, t) => t)
  return battleCameraTrack(replay, ticks, Math.max(1, replay.tickRate || 10) * FIGHT_SPEED, combat)
}
