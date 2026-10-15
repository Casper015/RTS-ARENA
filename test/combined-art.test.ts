import assert from "node:assert/strict"
import { test } from "node:test"
import { importRuleset } from "../src/cli/catalog.ts"
import { runMatch } from "../src/core/match.ts"
import type { EntSnap, Replay } from "../src/core/types.ts"
import { checkRulesetData } from "../src/sandbox/rules-check.ts"
import { createBattleArt } from "../src/video/battle-art.ts"
import { replayScene } from "../src/video/render.ts"
import { battleTypeOf, legacySplashEffects, shotTypeOf } from "../src/video/visual-state.ts"
import combined from "../rulesets/combined-arms/index.ts"
import { idle } from "./helpers.ts"

async function fixture(): Promise<Replay> {
  const rules = await importRuleset("combined-arms")
  const replay = await runMatch({ ruleset: { ...rules, maxTicks: 1 }, seed: 7,
    bots: [0,1].map(i => ({ name: `p${i}`, file: "idle", runner: idle() })) })
  const entity = (id: number, type: string, owner: number, x: number, y: number, md?: string): EntSnap => ({ id, type, owner, x, y, hp: replay.types[type].maxHp, ord: "idle", ...(md ? {md} : {}) })
  replay.initial.entities = [entity(1,"rifleman",0,3,4),entity(2,"tank",0,3,6),entity(3,"mech",0,3,8),entity(4,"warship",0,3,11),entity(5,"mine",0,8,6,"buried"),entity(6,"warship",1,10,7),entity(7,"rifleman",1,9,6)]
  replay.frames = Array.from({length:90},(_,i)=>({t:i+1}))
  replay.frames[9] = { t:10, md:[[2,"siege"]], shots:[1,6,2,7,3,6,4,6,5,7], die:[5], hp:[5,0], fx:[{x:8,y:5,w:3,h:3,color:"#ff9a3c",radius:1}] }
  replay.result.tick=90
  return replay
}

test("combined artwork is embedded for the full roster and alternate modes, with explicit weapon identities", async () => {
  const r=await fixture(), art=createBattleArt()
  let sprites=0
  for(const [name,t] of Object.entries(r.types)) {
    assert.match(t.look.art?.sprite ?? "", /<svg\b/, name)
    sprites++
    for(const m of (t.modes ?? []).slice(1)) {
      assert.match(m.look?.art?.sprite ?? "", /<svg\b/, `${name}@${m.id}`)
      sprites++
    }
  }
  assert.equal(sprites,16)
  assert.equal(art.attackStyle(battleTypeOf(r,"rifleman")),"autocannon")
  assert.equal(art.attackStyle(battleTypeOf(r,"tank","siege")),"siege-shell")
  assert.equal(art.attackStyle(battleTypeOf(r,"mine","buried")),"detonation")
  assert.equal(art.attackStyle(battleTypeOf(r,"mech")),"missile")
  assert.equal(art.attackStyle(battleTypeOf(r,"warship")),"plasma")
  assert.equal(battleTypeOf(r,"tank","siege").art?.motion,"tracked","mode artwork inherits the chassis motion")
})

test("modern effects survive replay seeking, mode changes on the strike tick, flight and a dying mine", async () => {
  const r=await fixture(), f=r.frames[9]
  assert.equal(shotTypeOf(r,f,r.initial.entities[1]).art?.weapon,"siege-shell")
  assert.equal(legacySplashEffects(r,f,new Map(r.initial.entities.map(e=>[e.id,e]))).size,1,"the new artillery impact replaces its old generic splash")
  const sc=replayScene(r,1,"test",null,[{name:"Blue",color:"#58aeef"},{name:"Red",color:"#ed826d"}],"test",30)
  let i=0
  while(sc.frame!(i).t<10)i++
  const frame=sc.frame!(i), attacks=frame.combat!
  assert.deepEqual(new Set(attacks.map(a=>a.style)),new Set(["autocannon","siege-shell","missile","plasma","detonation"]))
  assert.equal(frame.ruleFx?.length ?? 0,0)
  assert.ok(attacks.some(a=>a.source===5),"a self-destructing mine still explodes")
  assert.equal(attacks.find(a=>a.source===1)?.targetLift,.84)
  const ship=attacks.find(a=>a.source===4)!
  assert.deepEqual(ship.muzzle,[1.2,-.78],"the energy bolt starts at the scaled airborne cannon")
  assert.equal(frame.combat!.find(a=>a.source===2)?.duration,Math.round(30*.85))
  sc.frame!(i+15)
  assert.deepEqual(sc.frame!(i),frame,"backward seeking restores identical effects")
  assert.equal(sc.frame!(i+40).combat?.length,0)
})

test("weapon and motion metadata is validated for both base artwork and mode artwork", () => {
  const callbacks=["setup","objectives","result","timeUp"]
  assert.deepEqual(checkRulesetData(combined,callbacks),[])
  const invalid=structuredClone({...combined,setup:undefined,onTick:undefined,objectives:undefined,result:undefined,timeUp:undefined})
  Object.assign(invalid.types.rifleman.look.art!,{weapon:"unknown",motion:"unknown"})
  Object.assign(invalid.types.tank.modes![1].look!.art!,{weapon:"unknown",sprite:42})
  const errors=checkRulesetData(invalid,callbacks).join("\n")
  assert.match(errors,/types\.rifleman\.look\.art\.weapon/)
  assert.match(errors,/types\.rifleman\.look\.art\.motion/)
  assert.match(errors,/types\.tank\.modes\[1\]\.look\.art\.weapon/)
  assert.match(errors,/types\.tank\.modes\[1\]\.look\.art\.sprite/)
})

test("serialized combat factory draws every modern effect deterministically at launch, flight and impact", () => {
  const art=(0,eval)(`(${createBattleArt.toString()})()`) as ReturnType<typeof createBattleArt>
  const calls: unknown[][]=[]
  const context=new Proxy({}, {set:()=>true,get:(_t,key)=>(...args:unknown[])=>{for(const v of args)if(typeof v==="number")assert.ok(Number.isFinite(v),`${String(key)} has a nonfinite coordinate`);calls.push([key,...args])}}) as CanvasRenderingContext2D
  for(const style of ["autocannon","siege-shell","missile","plasma","detonation"] as const) {
    const a={source:1,target:2,x1:3,y1:4,x2:7,y2:6,owner:0,style,age:0,duration:20}
    for(const age of [0,4,9,15]) {
      a.age=age;calls.length=0;art.attack(context,a,"#58aeef");const first=[...calls]
      assert.ok(first.length>0,style)
      calls.length=0;art.attack(context,a,"#58aeef");assert.deepEqual(calls,first)
    }
    calls.length=0;art.attack(context,{...a,age:20},"#58aeef");assert.equal(calls.length,0)
  }
  assert.equal(art.attackStyle({name:"musketeer",kind:"unit",range:4}),"musket","legacy styles remain available")
})
