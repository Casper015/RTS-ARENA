import assert from "node:assert/strict"
import { test } from "node:test"
import { runMatch } from "../src/core/match.ts"
import { ReplayModel } from "../src/core/replay-model.ts"
import type { Ruleset } from "../src/core/types.ts"
import { STANDARD_TERRAIN } from "../rulesets/common/standard.ts"
import { fnBot, idle } from "./helpers.ts"

test("recorded queues follow production, cancellation and capture and survive backwards seeking",()=>{
  let base=0
  const seen=new Map<number,{type:string;ticksLeft:number}[]>()
  const rules:Ruleset={id:"queues",name:"队列",players:{min:2,max:2},maxTicks:15,tickRate:10,decisionInterval:1,fuel:100,unitCap:0,fog:false,resources:["gold"],terrain:STANDARD_TERRAIN,
    types:{barracks:{kind:"building",maxHp:500,produces:["soldier"],parallel:2,look:{shape:"square"}},soldier:{kind:"unit",maxHp:50,moveTicks:2,buildTicks:4,cost:{gold:1},look:{shape:"circle"}}},
    setup(ctx){ctx.setTerrain(Array(12).fill(".".repeat(12)));base=ctx.spawn("barracks",0,3,3);ctx.spawn("barracks",1,9,9);ctx.setResources(0,{gold:100})},
    onTick(ctx){if(ctx.tick===7)ctx.setOwner(base,1)},objectives:()=>({}),result:()=>null,timeUp:()=>({winner:null,reason:"测试结束"})}
  const replay=runMatch({ruleset:rules,seed:2,bots:[{name:"a",file:"",runner:fnBot((v,cmd)=>{
    const b=v.entities.find(e=>e.id===base&&e.owner===0)
    if(!b)return
    seen.set(v.tick,b.queue!.map(q=>({...q})))
    if(v.tick===0)for(let i=0;i<3;i++)cmd.produce(b,"soldier")
    if(v.tick===2)cmd.cancel(b)
    if(v.tick===5)cmd.produce(b,"soldier")
  })},{name:"b",file:"",runner:idle()}]})
  const model=new ReplayModel(replay)
  assert.deepEqual(model.stateAt(0).ents.get(base)!.queue,[])
  for(const [tick,queue] of seen)assert.deepEqual(model.stateAt(tick).ents.get(base)!.queue,queue,`tick ${tick}`)
  assert.equal(model.stateAt(1).ents.get(base)!.queue!.length,3)
  assert.equal(model.stateAt(3).ents.get(base)!.queue!.length,2)
  assert.deepEqual(model.stateAt(4).ents.get(base)!.queue,[])
  assert.deepEqual(model.stateAt(7).ents.get(base)!.queue,[])
  assert.equal(model.stateAt(7).ents.get(base)!.owner,1)
  const early=model.stateAt(1).ents.get(base)!.queue
  model.stateAt(15)
  assert.deepEqual(model.stateAt(1).ents.get(base)!.queue,early)
})
