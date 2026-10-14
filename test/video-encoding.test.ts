import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { videoDimensions, videoEncoderConfig } from "../src/video/encoding.ts"
import { createBattleArt } from "../src/video/battle-art.ts"
import { installVideoPage, type SceneData } from "../src/video/page.ts"
import { findBrowser, launchBrowser } from "../src/video/browser.ts"

test("视频尺寸和 AVC 等级适配横竖屏、4K30 和 4K60，1080p 默认配置保持兼容", () => {
  assert.deepEqual(videoDimensions(), { width: 1920, height: 1080 })
  assert.deepEqual(videoDimensions(true), { width: 1080, height: 1920 })
  assert.deepEqual(videoDimensions(false, true), { width: 3840, height: 2160 })
  assert.deepEqual(videoDimensions(true, true), { width: 2160, height: 3840 })
  for (const [w, h] of [[1920, 1080], [1080, 1920]]) assert.equal(videoEncoderConfig(w, h, 60).codec, "avc1.64002a")
  for (const [w, h] of [[3840, 2160], [2160, 3840]]) {
    assert.equal(videoEncoderConfig(w, h, 30).codec, "avc1.640033")
    assert.equal(videoEncoderConfig(w, h, 60).codec, "avc1.640034")
  }
  assert.ok(Math.abs(videoEncoderConfig(3840, 2160, 30).bitrate! - videoEncoderConfig(1920, 1080, 30).bitrate! * 4) <= 4)
  assert.throws(() => videoEncoderConfig(3841, 2160, 30), /正偶数/)
  assert.throws(() => videoEncoderConfig(3840, 2160, 120), /10～60/)
  assert.throws(() => videoEncoderConfig(7680, 4320, 30), /暂不支持/)
})

test("浏览器实际编码并解码 4K 横竖屏、30/60 fps；不支持的配置在编码前清楚报错", { skip: !findBrowser() }, async (t) => {
  const browser = await launchBrowser(findBrowser()!)
  try {
    await browser.evaluate(readFileSync(createRequire(import.meta.url).resolve("mp4-muxer"), "utf8") + ";true")
    await browser.evaluate(`(${installVideoPage.toString()})(${createBattleArt.toString()});true`)
    await browser.evaluate(`__brand(${JSON.stringify(readFileSync(new URL("../assets/brand/logo.svg", import.meta.url), "utf8"))})`)
    for (const [width, height, fps] of [[1920, 1080, 30], [3840, 2160, 30], [3840, 2160, 60], [2160, 3840, 60]]) {
      const config = videoEncoderConfig(width, height, fps)
      const supported = await browser.evaluate<boolean>(`VideoEncoder.isConfigSupported(${JSON.stringify(config)}).then(r=>r.supported)`)
      await t.test(`${width}×${height} ${fps}fps`, { skip: !supported && "本机浏览器不支持此编码配置" }, async () => {
        await browser.evaluate(`__size(${width},${height});true`)
        await browser.evaluate(`__init(${JSON.stringify(config)})`)
        const scene: SceneData = { kind: "brandClose", outro: "4K 编码验证", credits: [], frames: fps, first: true }
        await browser.evaluate(`__scene(${JSON.stringify(scene)})`)
        await browser.evaluate(`__frames(${JSON.stringify(Array.from({ length: 12 }, (_, i) => [i, null]))})`)
        const size = await browser.evaluate<number>("__finish()")
        assert.ok(size > 1000)
        const probe = await browser.evaluate<{ width: number; height: number; duration: number; shotSize: number }>("__probe([0.05]).then(({width,height,duration,shots})=>({width,height,duration,shotSize:shots[0].length}))")
        assert.deepEqual([probe.width, probe.height], [width, height])
        assert.ok(Math.abs(probe.duration - 12 / fps) < .05)
        assert.ok(probe.shotSize > 1000)
      })
    }
    await browser.evaluate("__size(3840,2160)")
    const message = await browser.evaluate<string>(`(async()=>{
      const original=VideoEncoder.isConfigSupported;
      VideoEncoder.isConfigSupported=async config=>({supported:false,config});
      try {await __init(${JSON.stringify(videoEncoderConfig(3840, 2160, 30))});return 'unexpected success';}
      catch(e){return e.message;}
      finally{VideoEncoder.isConfigSupported=original;}
    })()`)
    assert.match(message, /不支持 3840×2160、30 fps/)
    assert.match(message, /去掉 --4k、降低 --fps/)
  } finally {
    await browser.close()
  }
})
