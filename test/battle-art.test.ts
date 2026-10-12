import assert from "node:assert/strict"
import { test } from "node:test"
import type { EntSnap, Replay } from "../src/core/types.ts"
import { createBattleArt } from "../src/video/battle-art.ts"
import { pacing, replayScene, zoomFrames } from "../src/video/render.ts"
import { faceToward, farmWorkers, homeFacing, legacySplashEffects, trainingQueue, workerPose } from "../src/video/visual-state.ts"
import { battleCameraTrack } from "../src/video/battle-camera.ts"

function fixture(): Replay {
  const unit = (range: number) => ({ kind: "unit" as const, w: 1, h: 1, maxHp: 100, moveTicks: 4, look: { shape: "circle" as const }, attack: { damage: 10, range, cooldown: 8 } })
  const building = { ...unit(6), kind: "building" as const, w: 3, h: 3, maxHp: 1000, moveTicks: 0 }
  const entity = (id: number, type: string, owner: number, x: number, y: number) => ({ id, type, owner, x, y, hp: 100, ord: "idle" })
  const frames: Replay["frames"] = Array.from({ length: 120 }, (_, i) => ({ t: i + 1 }))
  // The target dies on the strike tick. Its own simultaneous attack and all incoming hits still draw.
  frames[9] = { t: 10, shots: [1, 2, 2, 1, 3, 2, 4, 2, 5, 1, 6, 2], die: [2], hp: [2, 0], spawn: [entity(6, "soldier", 0, 5, 4)] }
  frames[39] = { t: 40, move: [1, 6, 5] }
  return {
    format: "rts-arena-replay", version: 1, ruleset: { id: "test", name: "test" }, seed: 1,
    tickRate: 10, maxTicks: 120,
    players: [{ name: "Blue", bot: "blue", team: 0 }, { name: "Red", bot: "red", team: 1 }],
    map: { width: 16, height: 12, terrain: Array(12).fill(".".repeat(16)), colors: { ".": "#2f3b2b" } },
    types: { soldier: unit(1), spearman: unit(1), archer: unit(4), cannon: { ...unit(5), attack: { damage: 12, range: 5, cooldown: 30, splash: 1 } }, tower: { ...building, w: 2, h: 2 }, base: building },
    initial: {
      entities: [entity(1,"soldier",0,4,5),entity(2,"spearman",1,5,5),entity(3,"archer",0,2,4),entity(4,"cannon",0,1,5),entity(5,"tower",1,7,5),entity(20,"base",0,0,0),entity(21,"base",1,12,8)],
      players: [{ resources: {}, score: 0, alive: true }, { resources: {}, score: 0, alive: true }], markers: [], status: "",
    },
    frames, result: { tick: 120, winner: 0, winners: [0], reason: "test" }, bots: [], perf: { peakEntities: 8, simMs: 0, botMs: 0 },
  }
}

const scene = (replay = fixture()) => replayScene(replay, 1, "test", null, [{ name: "Blue", color: "#4ea1ff" }, { name: "Red", color: "#ff5d5d" }], "test", 30)

test("idle farmers use the ruleset assignment, excluding diagonals, unfinished/enemy farms and duplicate workers",()=>{
  const r=fixture()
  r.types.worker={...r.types.soldier,worker:true}
  r.types.farm={...r.types.base,w:2,h:2}
  const farm={id:100,type:"farm",owner:0,x:4,y:4,hp:300,ord:"idle"}
  const a={id:50,type:"worker",owner:0,x:3,y:4,hp:40,ord:"idle"},b={...a,id:51,y:5}
  const entities=new Map<number,EntSnap>([b,farm,a].map(e=>[e.id,e]))
  assert.deepEqual([...farmWorkers(r,entities).keys()],[50])
  const pose=workerPose(r,entities,a,1,false)!
  assert.equal(pose.job,"farm");assert.ok(pose.work!>=0)
  assert.notEqual(pose.work,workerPose(r,entities,a,1.3,false)!.work)
  assert.equal(workerPose(r,entities,b,1,false)!.work,-1)
  assert.equal(workerPose(r,entities,a,1,true)!.work,-1)
  assert.equal(workerPose(r,entities,{...a,bf:["眩晕"]},1,false)!.work,-1)
  entities.delete(b.id);a.y=3
  assert.equal(farmWorkers(r,entities).size,0,"diagonal is not adjacent in the rules")
  a.y=4;entities.set(farm.id,{...farm,bp:50})
  assert.equal(farmWorkers(r,entities).size,0)
  entities.set(farm.id,{...farm,owner:1});assert.equal(farmWorkers(r,entities).size,0)
  entities.set(farm.id,farm);a.ord="move (2,2)";assert.equal(farmWorkers(r,entities).size,0)
})

test("training progress distinguishes parallel jobs, waiting jobs, blocked exits and legacy data",()=>{
  const r=fixture();r.types.base.parallel=2;r.types.soldier.buildTicks=10
  const e={...r.initial.entities[5],queue:[{type:"soldier",ticksLeft:0},{type:"soldier",ticksLeft:5},{type:"soldier",ticksLeft:10}]}
  assert.deepEqual(trainingQueue(r,e)?.map(q=>[q.active,q.blocked,q.progress]),[[true,true,1],[true,false,.5],[false,false,0]])
  assert.ok(trainingQueue(r,{...e,bp:50})?.every(q=>!q.active))
  assert.equal(trainingQueue(r,{...e,queue:undefined}),undefined)
  assert.deepEqual(trainingQueue(r,{...e,queue:[]}),[])
})

test("combat animation includes melee, arrows, shells and attacks on a target killed in the same tick", () => {
  const sc = scene()
  let i = 0
  while (sc.frame!(i).t < 10) i++
  const hit = sc.frame!(i)
  assert.deepEqual(new Set(hit.combat!.map((a) => a.style)), new Set(["slash", "thrust", "arrow", "shell"]))
  assert.equal(hit.combat!.length, 6)
  assert.ok(hit.combat!.some((a) => a.source === 6), "newly spawned attackers also animate")
  assert.ok(hit.combat!.some((a) => a.source === 2), "a dying attacker retains its simultaneous strike")
  const tower = hit.combat!.find((a) => a.source === 5)!
  assert.deepEqual([tower.x1, tower.y1], [8, 6], "projectiles originate at the building's center")
  assert.equal(hit.poses![2], 0, "melee body starts its weapon action on the hit frame")
  assert.ok(hit.fallen!.length > 0)
  const next = sc.frame!(i + 1)
  assert.ok(next.combat!.find((a) => a.source === 1)!.age > 0, "action survives frames with no new hits")
  assert.ok(next.poses![2] > 0)
  assert.deepEqual(sc.frame!(i + 1), next, "seeking back reconstructs the same poses and effects")
  assert.equal(sc.frame!(i + 25).combat!.length, 0, "finished effects expire")
})

test("two-cell ordinary movement is interpolated without a spurious knockback trail", () => {
  const sc = scene()
  let i = 0
  while (sc.frame!(i).t < 40) i++
  const f = sc.frame!(i)
  assert.equal(f.knockFx, undefined)
  assert.ok(f.ents[0] >= 4 && f.ents[0] <= 6)
})

test("projectiles use the combat position before a surviving target moves in the same tick", () => {
  const replay = fixture()
  replay.frames[9] = { t:10, shots:[4,2], move:[2,6,5] }
  const sc = scene(replay)
  let i=0
  while(sc.frame!(i).t<10)i++
  const shell=sc.frame!(i).combat!.find(a=>a.style==="shell")!
  assert.deepEqual([shell.x2,shell.y2],[5.5,5.5])
})

test("combat factory survives serialization and uses range for custom or old replay types", () => {
  const art = new Function(`return (${createBattleArt.toString()})()`)() as ReturnType<typeof createBattleArt>
  assert.equal(art.attackStyle({ name: "archer", kind: "unit" }), "arrow")
  assert.equal(art.attackStyle({ name: "custom-ranged", kind: "unit", range: 5 }), "arrow")
  assert.equal(art.attackStyle({ name: "spearman", kind: "unit", range: 1 }), "thrust")
  assert.equal(art.attackStyle({ name: "custom-siege", kind: "unit", range: 5, splash: 1 }), "shell")
})

test("cannon impacts replace matching legacy splash rings, preserving unrelated rule effects", () => {
  const replay = fixture(), frame = replay.frames[9]
  const ring = { x: 4, y: 4, w: 3, h: 3, color: "#ff9a3c", radius: 1 }
  const ability = { ...ring, text: "击退" }
  const elsewhere = { ...ring, x: 0 }
  frame.fx = [ring, ability, elsewhere]
  assert.deepEqual([...legacySplashEffects(replay, frame, new Map(replay.initial.entities.map(e => [e.id,e])))], [ring])
  const sc = scene(replay)
  let i = 0
  while (sc.frame!(i).t < 10) i++
  const output = sc.frame!(i)
  assert.equal(output.ruleFx?.length, 2)
  assert.ok(output.combat?.some(a => a.style === "shell"))
  // Combat resolves before movement; a target that moves away still matches its original impact.
  const entities = new Map(replay.initial.entities.map(e => [e.id,{...e}]))
  Object.assign(entities.get(2)!, { x:0, y:0 })
  frame.move = [2, 1, 0]
  frame.fx = [{ ...ring, x: 0, y: 0, w: 2, h: 2 }]
  assert.equal(legacySplashEffects(replay, frame, entities).size, 1)
})

test("villagers work only beside their assigned resource, stop when travelling, stunned or depleted, and carry on return", () => {
  const replay = fixture()
  replay.types.worker = { ...replay.types.soldier, worker: true, gather: true }
  replay.types.goldmine = { ...replay.types.soldier, kind: "resource", w: 2, h: 2 }
  const worker = { id: 50, type: "worker", owner: 0, x: 3, y: 3, hp: 40, ord: "gather #51" }
  const node = { id: 51, type: "goldmine", owner: -1, x: 4, y: 3, hp: 200, ord: "idle" }
  const ents = new Map([[50,worker],[51,node]])
  const pose = workerPose(replay, ents, worker, 1, false)!
  assert.ok(pose.work! >= 0)
  assert.equal(pose.job,"mine")
  assert.notEqual(pose.work, workerPose(replay,ents,worker,1.2,false)!.work)
  assert.equal(workerPose(replay,ents,worker,1,true)!.work,-1)
  assert.equal(workerPose(replay,ents,{...worker,x:0},1,false)!.work,-1)
  assert.equal(workerPose(replay,ents,{...worker,bf:["眩晕"]},1,false)!.work,-1)
  const back = workerPose(replay,ents,{...worker,ord:"gather #51 回程"},1,false)!
  assert.equal(back.work,-1)
  assert.equal(back.carrying,true)
  node.hp = 0
  assert.equal(workerPose(replay,ents,worker,1,false)!.work,-1)
  ents.delete(51)
  assert.equal(workerPose(replay,ents,worker,1,false)!.work,-1)
  assert.equal(workerPose(replay,ents,{...worker,ord:"idle"},1,false)!.work,-1)
})

test("video supplies worker activity aligned with entities, with deterministic work poses after seeking", () => {
  const replay = fixture()
  replay.types.worker = { ...replay.types.soldier, worker:true, gather:true }
  replay.types.goldmine = { ...replay.types.soldier, kind:"resource", w:2, h:2 }
  replay.initial.entities.push({id:50,type:"worker",owner:0,x:9,y:2,hp:40,ord:"gather #51"},{id:51,type:"goldmine",owner:-1,x:10,y:2,hp:400,ord:"idle"})
  const sc = scene(replay), f = sc.frame!(5)
  const work = f.workers!.find(w=>w.index===7)!
  assert.ok(work.pose.work!>=0)
  assert.equal(f.ents[work.index*8+5],Object.keys(replay.types).indexOf("worker"))
  sc.frame!(10)
  assert.deepEqual(sc.frame!(5),f)
})

test("portrait camera follows the busiest battle smoothly, then returns to the overview", () => {
  const replay = fixture()
  replay.map={...replay.map,width:56,height:40,terrain:Array(40).fill(".".repeat(56))}
  replay.initial.entities.push({id:31,type:"soldier",owner:0,x:50,y:34,hp:100,ord:"idle"},{id:32,type:"soldier",owner:1,x:51,y:34,hp:100,ord:"idle"})
  replay.frames=Array.from({length:120},(_,i)=>({t:i+1,...(i<40&&i%2===0?{shots:[1,2,1,2,1,2,1,2,31,32]}:{})}))
  const ticks=Array.from({length:360},(_,i)=>Math.floor(i/3))
  const path=battleCameraTrack(replay,ticks,30)
  assert.equal(path[0].zoom,1)
  assert.ok(path[110].zoom>2.6,"readable battle close-up")
  assert.ok(path[110].x<12&&path[110].y<12,"secondary skirmish does not pull camera to an empty midpoint")
  assert.ok(path.at(-1)!.zoom<1.02,"quiet end returns to the full map")
  for(let i=1;i<path.length;i++) {
    assert.ok(Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y)<2,"no hard camera cuts")
    assert.ok(Math.abs(path[i].zoom-path[i-1].zoom)<.15)
    assert.ok(path[i].x>=0&&path[i].x<=56&&path[i].y>=0&&path[i].y<=40)
  }
  assert.deepEqual(battleCameraTrack(replay,ticks,30),path,"reproducible camera track")
})

test("quiet video segments show the exact complete map after a bounded return even with recent attacks", () => {
  const replay=fixture()
  replay.map={...replay.map,width:56,height:40,terrain:Array(40).fill(".".repeat(56))}
  replay.frames=Array.from({length:120},(_,i)=>({t:i+1,shots:[1,2]}))
  const ticks=Array.from({length:250},(_,i)=>Math.floor(i/3))
  const path=battleCameraTrack(replay,ticks,30,ticks.map((_,i)=>i<100))
  assert.ok(path[99].zoom>2.7)
  for(let i=122;i<path.length;i++)assert.deepEqual(path[i],{x:28,y:20,zoom:1},"no retained crop during quiet segments")
})

test("规则包自带的素材（D-233）：base 换平台造型；领主不再是平台造型，没有素材时画成剑盾兵；带素材的头顶多留一点", () => {
  const art = createBattleArt()
  assert.equal(art.role({ name: "lord", kind: "unit" }), "soldier")
  assert.equal(art.role({ name: "lord", kind: "unit", art: { base: "infantry" } }), "infantry")
  assert.equal(art.role({ name: "gate", kind: "building", art: { base: "tower" } }), "tower")
  assert.equal(art.attackStyle({ name: "lord", kind: "unit", art: { base: "infantry" } }), "slash")
  const plain = art.headroom({ name: "lord", kind: "unit", art: { base: "infantry" } })
  assert.equal(plain, art.headroom({ name: "soldier", kind: "unit" }))
  assert.ok(Math.abs(art.headroom({ name: "lord", kind: "unit", art: { base: "infantry", over: "<svg/>" } }) - plain - .05) < 1e-9)
  // Node 里没有 Image：素材画不出来也不报错（视频和网页回放在浏览器里先 prepare 再画）
  const calls: string[] = []
  const g = new Proxy({}, { get: (_t, k) => (k === "globalAlpha" ? 1 : (...a: unknown[]) => { calls.push(String(k)); return a }), set: () => true }) as unknown as CanvasRenderingContext2D
  art.entity(g, { name: "lord", kind: "unit", art: { base: "infantry", under: "<svg viewBox='0 0 1 1'/>", over: "<svg viewBox='0 0 1 1'/>" } }, 0, 0, 1, 1, "#4ea1ff")
  assert.ok(calls.length > 10 && !calls.includes("drawImage"))
})

test("朝向（D-234）：没动过的背对自己的主基地；正上正下走、打正上正下的目标不转身；干活的目标在正上正下也不转", () => {
  const r = fixture()
  const face = homeFacing(r)
  // P1 的主基地在右半边：哪怕站在左半边也朝左；中立的朝地图中间
  assert.equal(face({ id: 9, type: "soldier", owner: 1, x: 2, y: 2, hp: 100, ord: "idle" }), Math.PI)
  assert.equal(face({ id: 9, type: "soldier", owner: 0, x: 14, y: 2, hp: 100, ord: "idle" }), 0)
  assert.equal(face({ id: 9, type: "soldier", owner: -1, x: 14, y: 2, hp: 100, ord: "idle" }), Math.PI)
  assert.equal(faceToward(Math.PI, 0), Math.PI)
  assert.equal(faceToward(Math.PI, .2), Math.PI)
  assert.equal(faceToward(Math.PI, 1), 0)
  assert.equal(faceToward(0, -1), Math.PI)
  // 弓手先往左走一步、再往上走一步：还朝左（原来往上走就朝右）
  r.frames[19] = { t: 20, move: [3, 1, 4] }
  r.frames[29] = { t: 30, move: [3, 1, 3] }
  const sc = scene(r)
  const fr = sc.frame!(sc.data.frames - 1)
  const archer = Object.keys(r.types).indexOf("archer")
  const k = (fr.ents.findIndex((v, i) => i % 8 === 5 && v === archer) - 5) / 8
  assert.equal(fr.poses![k * 4], Math.PI)
  // 金矿在工人正上方：不给朝向，照旧用单位自己的
  r.types.worker = { ...r.types.soldier, worker: true }
  r.types.gold = { kind: "resource", w: 1, h: 1, maxHp: 0, moveTicks: 0, look: { shape: "diamond" } }
  const mine = { id: 70, type: "gold", owner: -1, x: 3, y: 2, hp: 500, ord: "idle" }
  const up = { id: 71, type: "worker", owner: 0, x: 3, y: 3, hp: 40, ord: "gather #70" }
  const left = { ...up, id: 72, x: 4, y: 2 }
  const ents = new Map<number, EntSnap>([mine, up, left].map((e) => [e.id, e]))
  assert.equal(workerPose(r, ents, up, 1, false)!.angle, undefined)
  assert.equal(workerPose(r, ents, left, 1, false)!.angle, Math.PI)
})

test("击退拖尾只认真正的击退（D-235）：让路时一 tick 挪 3 格不算；击退落地后又走开，拖尾不跟着拉长", () => {
  const plain = fixture()
  plain.frames[49] = { t: 50, move: [1, 9, 5] }
  let sc = scene(plain), i = 0
  while (sc.frame!(i).t < 50) i++
  assert.equal(sc.frame!(i).knockFx, undefined)
  const knocked = fixture()
  knocked.frames[49] = { t: 50, move: [1, 9, 5], fx: [{ x: 9, y: 5, w: 1, h: 1, color: "#9fd8ff", radius: 1 }], bf: [[1, ["眩晕"]]] }
  knocked.frames[50] = { t: 51, move: [1, 10, 5] }
  sc = scene(knocked); i = 0
  while (sc.frame!(i).t < 50) i++
  const kf = sc.frame!(i).knockFx
  // 同一帧里已经走到 51 tick（快进）就不滑了；还在 50 tick 就从原来的位置往落点滑，终点不过落点
  if (sc.frame!(i).t === 50) assert.ok(kf && kf[0] === 6 && kf[2] <= 9, JSON.stringify(kf))
  while (sc.frame!(i).t < 51) i++
  assert.equal(sc.frame!(i).knockFx, undefined)
})

test("交战缩放（D-236）：一段交战里死的单位不到 2 个就不放大，2 个以上才放大；横屏竖屏用同一条镜头轨迹", () => {
  const one = fixture()
  let pace = pacing(one, 30)
  assert.ok(pace.mode(0) === "fight" || [...Array(pace.playFrames).keys()].some((i) => pace.mode(i) === "fight"))
  assert.ok(!zoomFrames(one, pace, pace.playFrames).some(Boolean))
  const two = fixture()
  two.frames[9] = { ...two.frames[9], die: [2, 3], hp: [2, 0, 3, 0] }
  pace = pacing(two, 30)
  const zoom = zoomFrames(two, pace, pace.playFrames)
  assert.ok(zoom.some(Boolean))
  assert.ok(zoom.every((z, i) => !z || pace.mode(i) === "fight"))
})
