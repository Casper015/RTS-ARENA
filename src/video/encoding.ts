/** 标准横竖屏尺寸；4K 保持同样的布局，把每边的像素数翻倍。 */
export function videoDimensions(vertical = false, fourK = false): { width: number; height: number } {
  const scale = fourK ? 2 : 1
  return { width: (vertical ? 1080 : 1920) * scale, height: (vertical ? 1920 : 1080) * scale }
}

/** AVC 的等级同时限制每帧宏块数和每秒宏块数；4K30 用 High 5.1，4K60 用 High 5.2。 */
export function videoEncoderConfig(width: number, height: number, fps: number): VideoEncoderConfig {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n % 2 === 0)) throw new Error("视频宽高必须是正偶数")
  if (!Number.isInteger(fps) || fps < 10 || fps > 60) throw new Error("视频帧率必须是 10～60 的整数")
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  const levels = [
    { codec: "avc1.64002a", frame: 8704, second: 522240 },
    { codec: "avc1.640033", frame: 36864, second: 983040 },
    { codec: "avc1.640034", frame: 36864, second: 2073600 },
  ]
  const level = levels.find((l) => blocks <= l.frame && blocks * fps <= l.second)
  if (!level) throw new Error(`暂不支持 ${width}×${height}、${fps} fps 的 H.264 导出`)
  return { codec: level.codec, width, height, framerate: fps, bitrate: Math.round(width * height * fps / 7.8) }
}
