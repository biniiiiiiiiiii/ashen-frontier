import type { Save } from "./data";
export type AttackKey = "j" | "k" | "l" | "u" | "space";
export type ActionKind =
  | "light1"
  | "light2"
  | "heavy"
  | "wave"
  | "charging"
  | "counter"
  | "spin"
  | "rush"
  | "dodge"
  | "hurt";
export type EnemyState = "idle" | "windup" | "active" | "recover" | "hurt";
export type EnemyMove =
  | "slash"
  | "arrow"
  | "heavy"
  | "combo"
  | "charge"
  | "burrow"
  | "poison"
  | "explode";
export interface ActionSpec {
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  range: number;
  depth: number;
  cooldown: number;
}
/** 每个动作的时序、距离和伤害集中配置，表现与命中共用这份时序。 */
export const actions: Record<ActionKind, ActionSpec> = {
  charging: {
    windup: 0.8,
    active: 0,
    recovery: 0,
    damage: 0,
    range: 0,
    depth: 0,
    cooldown: 0,
  },
  counter: {
    windup: 0.07,
    active: 0.15,
    recovery: 0.22,
    damage: 2.8,
    range: 185,
    depth: 65,
    cooldown: 0,
  },
  light1: {
    windup: 0.085,
    active: 0.1,
    recovery: 0.15,
    damage: 0.92,
    range: 115,
    depth: 40,
    cooldown: 0,
  },
  light2: {
    windup: 0.1,
    active: 0.12,
    recovery: 0.16,
    damage: 1.05,
    range: 125,
    depth: 43,
    cooldown: 0,
  },
  heavy: {
    windup: 0.19,
    active: 0.16,
    recovery: 0.28,
    damage: 1.6,
    range: 150,
    depth: 46,
    cooldown: 0,
  },
  wave: {
    windup: 0.18,
    active: 0.12,
    recovery: 0.25,
    damage: 2.55,
    range: 650,
    depth: 38,
    cooldown: 5,
  },
  spin: {
    windup: 0.2,
    active: 0.48,
    recovery: 0.28,
    damage: 0.66,
    range: 165,
    depth: 82,
    cooldown: 7,
  },
  rush: {
    windup: 0.16,
    active: 0.25,
    recovery: 0.36,
    damage: 3.4,
    range: 105,
    depth: 44,
    cooldown: 9,
  },
  dodge: {
    windup: 0.025,
    active: 0.26,
    recovery: 0.11,
    damage: 0,
    range: 0,
    depth: 0,
    cooldown: 1.25,
  },
  hurt: {
    windup: 0,
    active: 0.15,
    recovery: 0.12,
    damage: 0,
    range: 0,
    depth: 0,
    cooldown: 0,
  },
};
export const actionNames: Record<ActionKind, string> = {
  charging: "凝风蓄力",
  counter: "闪避反击",
  light1: "一式 · 横斩",
  light2: "二式 · 逆斩",
  heavy: "三式 · 重斩",
  wave: "裂风斩",
  spin: "旋刃",
  rush: "破阵突袭",
  dodge: "闪避",
  hurt: "受击",
};
export interface Action {
  kind: ActionKind;
  time: number;
  spec: ActionSpec;
  facing: number;
  hit: Set<string>;
  fired: boolean;
  vx: number;
  vy: number;
  trail: number;
  charged?: boolean;
}
export interface Enemy {
  id: string;
  x: number;
  y: number;
  hp: number;
  max: number;
  kind: number;
  boss: boolean;
  elite: boolean;
  cool: number;
  flash: number;
  burn: number;
  burnTick: number;
  phase: number;
  name: string;
  state: EnemyState;
  stateTime: number;
  move: EnemyMove;
  facing: number;
  aimX: number;
  aimY: number;
  windup: number;
  active: number;
  recovery: number;
  hitstun: number;
  vx: number;
  vy: number;
  pulse: number;
  armor: boolean;
  moving: boolean;
  walk: number;
  followup?: EnemyMove;
}
export interface Hazard {
  x: number;
  y: number;
  r: number;
  w: number;
  timer: number;
  duration: number;
  damage: number;
  type: "circle" | "line" | "cone";
  fired: boolean;
  linger: number;
  direction?: number;
  caster?: Enemy;
}
export interface Effect {
  x: number;
  y: number;
  life: number;
  max: number;
  kind: string;
  facing: number;
  text?: string;
  color?: number;
}
export interface Projectile {
  id: number;
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  vx: number;
  vy: number;
  life: number;
  kind: "wave" | "arrow" | "orb";
  visualOffset?: number;
  facing: number;
  damage: number;
  crit: number;
  burn: boolean;
  ember: boolean;
  hit: Set<string>;
  charged?: boolean;
  returning?: boolean;
  returnAt?: number;
  age?: number;
}
export interface Run {
  dungeon: number;
  hard: boolean;
  room: number;
  time: number;
  gold: number;
  xp: number;
  items: string[];
  finished: boolean;
}
export interface Bridge {
  save: Save;
  mode: string;
  paused: boolean;
  run: Run | null;
  reward: (enemy: Enemy) => void;
  finish: (win: boolean) => void;
  changed: () => void;
  audio: (kind: string) => void;
  toast: (text: string) => void;
}
export interface Input {
  x: number;
  y: number;
  keys: Set<AttackKey>;
  enter: boolean;
}
