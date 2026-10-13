// 火药科技玩法给 bot 的目标信息（这个文件也会原样进 arena.d.ts）

/** 科技建筑的类型名：铁匠铺、护甲坊、靶场、矿业所 */
export type TechId = "forge" | "armory" | "range" | "mining"

export interface Objectives {
  /** 对手（不同队的玩家）主基地（base，3×3）开局时的左上角位置；基地不会移动。两人局被摧毁后仍然列在这里；3～4 人局只列还没出局的 */
  enemyBases: { owner: number; x: number; y: number }[]
  /** 3～4 人分队时，还没出局的盟友主基地开局时的左上角位置；不分队、两人局时为空 */
  allyBases: { owner: number; x: number; y: number }[]
  /** 每个玩家的击杀价值，下标是玩家编号；到时间上限时比这个。和 view.players[i].score 是同一个数 */
  killValue: number[]
  /**
   * 你自己建好的农田：工人停在农田旁边（贴着它、命令是 idle）就在耕作，每耕 56 tick 给你 5 金。
   * farmer 是正在耕的工人 id（没人耕是 null），nextIn 是再耕几 tick 给下一次金子
   */
  farms: { id: number; x: number; y: number; farmer: number | null; nextIn: number }[]
  /** 每个玩家现在生效的科技（有建好、还在的这种科技建筑），下标是玩家编号；整局公开，不受迷雾影响 */
  techs: TechId[][]
  /** 已经出局的玩家编号，按出局先后排（3～4 人局；两人局一直是空的） */
  eliminated: number[]
}
