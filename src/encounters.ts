import type { Enemy } from "./combat-model";

/** 墓道九组遭遇分别配置近战、弓手与精英；每波有不同的进攻方向。 */
export const tombWaves = [
  [
    [0, 0, 0, 1],
    [0, 1, 0, 1],
    [0, 0, 0, 0, 1],
  ],
  [
    [1, 0, 1, 0, 0],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 1, 0, 0],
  ],
  [
    [0, 0, 1, 0, 1, 0],
    [0, 1, 0, 0, 1],
    [0, 0, 1, 0, 1, 0],
  ],
];
export const tombWaveNames = [
  ["散骨巡游", "弓阵牵制", "近卫增援"],
  ["交错火力", "双侧夹击", "破阵突围"],
  ["裂骨先锋", "游猎弓阵", "守卫前哨"],
];

/** 地面预警与近战判定共用边界，冲锋固定纵向路径并包含角色碰撞宽度。 */
export function enemyArea(e: Enemy) {
  if (e.move === "charge")
    return {
      x: Math.min(e.x, e.aimX) - 68,
      y: e.y - 32,
      w: Math.abs(e.aimX - e.x) + 136,
      h: 64,
    };
  const range = e.move === "heavy" ? 180 : e.boss ? 145 : 105;
  const depth = e.move === "heavy" ? 65 : 43;
  return {
    x: e.facing > 0 ? e.x - 12 : e.x - range,
    y: e.y - depth,
    w: range + 12,
    h: depth * 2,
  };
}
