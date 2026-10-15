import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { extname, join, resolve, sep } from "node:path"
import { test } from "node:test"
import { importRuleset } from "../src/cli/catalog.ts"
import { runMatch } from "../src/core/match.ts"
import { createBattleArt } from "../src/video/battle-art.ts"
import { findBrowser, launchBrowser } from "../src/video/browser.ts"
import { battleTypeOf } from "../src/video/visual-state.ts"
import { idle } from "./helpers.ts"

test("unit dossier and training icons match the battlefield SVG, mode, layer and owner colour", { skip: !findBrowser(), timeout: 60000 }, async () => {
  const root=resolve(import.meta.dirname,".."), temp=mkdtempSync(join(tmpdir(),"rts-arena-icons-"))
  const built=join(temp,"viewer")
  const server=createServer()
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined
  try {
    const build=spawnSync(process.execPath,[join(root,"node_modules/vite/bin/vite.js"),"build","viewer","--outDir",built,"--emptyOutDir"],{cwd:root,encoding:"utf8"})
    assert.equal(build.status,0,build.stderr)
    const rules=await importRuleset("combined-arms")
    const replay=await runMatch({ruleset:{...rules,maxTicks:1},seed:7,bots:[0,1].map(i=>({name:`p${i}`,file:"idle",runner:idle()}))})
    // The queue also needs to honour a fixed colour instead of always taking the player's colour.
    replay.types.worker.look.color="#debc56"
    const entries=Object.keys(replay.types).flatMap(name=>[
      {name,mode:undefined as string|undefined},...(replay.types[name].modes??[]).slice(1).map(m=>({name,mode:m.id}))
    ]).map((entry,i)=>{
      const t=replay.types[entry.name]
      return {...entry,id:i+1,x:2+(i%4)*5,y:2+Math.floor(i/4)*6,w:t.w,h:t.h,owner:t.kind==="resource"?-1:i%2,
        color:t.look.color??(t.kind==="resource"?"#9aa0a6":i%2?"#ff3939":"#269dff"),type:battleTypeOf(replay,entry.name,entry.mode)}
    })
    replay.map={...replay.map,width:24,height:27,terrain:Array(27).fill(".".repeat(24))}
    replay.fog=false
    replay.initial.entities=entries.map(e=>({id:e.id,type:e.name,owner:e.owner,x:e.x,y:e.y,hp:replay.types[e.name].maxHp,ord:"idle",md:e.mode,
      ...(replay.types[e.name].produces?.length?{queue:replay.types[e.name].produces!.map(type=>({type,ticksLeft:10}))}:{})}))
    const fixture=JSON.stringify(replay)
    server.on("request",(req,res)=>{
      const path=new URL(req.url??"/","http://localhost").pathname
      if(path==="/api/replays"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify([{name:"icons.json",mtime:0,size:fixture.length}]));return}
      if(path==="/replays/icons.json"){res.setHeader("Content-Type","application/json");res.end(fixture);return}
      if(path==="/api/arena"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({rulesets:[],bots:[]}));return}
      const file=resolve(built,"."+(path==="/"?"/index.html":path))
      if(!file.startsWith(built+sep)){res.writeHead(404).end();return}
      try {
        res.setHeader("Content-Type",({".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"} as Record<string,string>)[extname(file)]??"application/octet-stream")
        const data=readFileSync(file)
        res.end(extname(file)===".html"?'<script>window.__errors=[];addEventListener("error",e=>__errors.push(e.message));addEventListener("unhandledrejection",e=>__errors.push(String(e.reason)))</script>'+data.toString():data)
      } catch {res.writeHead(404).end()}
    })
    await new Promise<void>(ok=>server.listen(0,"127.0.0.1",ok))
    browser=await launchBrowser(findBrowser()!)
    const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/?tab=replay&replay=icons.json`
    await browser.evaluate(`location.assign(${JSON.stringify(url)});true`)
    let loaded=false
    for(let i=0;i<80&&!loaded;i++){
      await new Promise(r=>setTimeout(r,100))
      try {loaded=await browser.evaluate<boolean>(`!!document.querySelector('#stage canvas') && document.querySelector('#slider')?.max==='1'`)} catch {}
    }
    assert.ok(loaded,"the built viewer must load the fixture")
    const result=await browser.evaluate<{failures:string[];errors:string[];portraits:number;queueIcons:number}>(`(async()=>{
      const art=(${createBattleArt.toString()})(), entries=${JSON.stringify(entries)}, types=${JSON.stringify(replay.types)};
      await art.prepare(entries.map(e=>e.type),['#269dff','#ff3939','#9aa0a6','#debc56']);
      const style=document.createElement('style');style.textContent='#stage{width:800px!important;height:600px!important}.battle-shell{width:800px!important;height:600px!important}#replay-page{width:1250px!important;grid-template-columns:800px 420px!important}';document.head.append(style);
      await new Promise(r=>setTimeout(r,150));
      const host=document.getElementById('stage');host.setPointerCapture=()=>{};
      const failures=[], hashes=new Map();let portraits=0,queueIcons=0;
      function pixels(canvas){return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data}
      function expected(type,w,h,color,size){const c=document.createElement('canvas');c.width=c.height=size;art.thumbnail(c.getContext('2d'),type,w,h,color,size,size);return pixels(c)}
      function check(canvas,want,label){if(!canvas){failures.push(label+': missing');return}const actual=pixels(canvas);if(!actual.some((v,i)=>i%4===3&&v))failures.push(label+': blank');if(actual.length!==want.length||actual.some((v,i)=>v!==want[i]))failures.push(label+': wrong artwork');for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if((x<3||y<3||x>=canvas.width-3||y>=canvas.height-3)&&actual[(y*canvas.width+x)*4+3]){failures.push(label+': clipped');return}}
      for(const e of entries){
        const rect=host.getBoundingClientRect(),sw=host.clientWidth,sh=host.clientHeight,scale=Math.min(sw/(24*16),sh/(27*16))*.96;
        const x=rect.left+(sw-24*16*scale)/2+(e.x+e.w/2)*16*scale,y=rect.top+(sh-27*16*scale)/2+(e.y+e.h/2)*16*scale;
        for(const event of ['pointerdown','pointerup'])host.dispatchEvent(new PointerEvent(event,{clientX:x,clientY:y,pointerId:1,bubbles:true}));
        const label=e.name+(e.mode?'@'+e.mode:'');
        if(!document.getElementById('selected').textContent.includes('#'+e.id+' '))failures.push(label+': selection mismatch');
        const icon=document.getElementById('entity-icon');check(icon,expected(e.type,e.w,e.h,e.color,112),label);portraits++;
        if(icon)hashes.set(label,icon.toDataURL());
        for(const canvas of document.querySelectorAll('[data-queue-type]')){const name=canvas.dataset.queueType,t=types[name];check(canvas,expected({name,kind:t.kind,worker:t.worker,art:t.look.art,layer:t.layer,range:t.attack?.range,splash:t.attack?.splash},t.w,t.h,t.look.color??(e.owner===0?'#269dff':'#ff3939'),80),label+' queue '+name);queueIcons++}
      }
      if(hashes.get('tank')===hashes.get('tank@siege'))failures.push('tank modes are identical');
      if(hashes.get('mine')===hashes.get('mine@buried'))failures.push('mine modes are identical');
      return {failures,errors:window.__errors,portraits,queueIcons};
    })()`)
    assert.deepEqual(result.errors,[])
    assert.deepEqual(result.failures,[])
    assert.equal(result.portraits,16)
    assert.ok(result.queueIcons>=6)
  } finally {
    await browser?.close()
    await new Promise<void>(ok=>server.close(()=>ok()))
    rmSync(temp,{recursive:true,force:true})
  }
})
