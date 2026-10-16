export type Slot = "weapon" | "head" | "chest" | "legs" | "ring" | "charm";
export type Stat =
  "attack" | "health" | "defense" | "crit" | "speed" | "skill" | "cdr";
export type SpecialId = "reprisal" | "returning" | "wildfire";
/** 特效为固定机制，随机属性仍按对应装备部位生成。 */
export const specialItems: Record<
  SpecialId,
  { name: string; slot: Slot; build: string; description: string }
> = {
  reprisal: {
    name: "曙光回击",
    slot: "weapon",
    build: "反击剑士",
    description:
      "闪避反击额外发射一道穿透剑气（130%攻击）；可搭配狂战两件，或风行四件。",
  },
  returning: {
    name: "回风坠饰",
    slot: "charm",
    build: "回风剑术",
    description:
      "满蓄裂风斩在飞行途中折返，回程可再次命中同一敌人，造成60%剑气伤害；风行四件效果同时生效。",
  },
  wildfire: {
    name: "燎原指环",
    slot: "ring",
    build: "余烬燎原",
    description:
      "技能与反击命中附加4秒灼烧；灼烧敌人死亡时向130范围传播灼烧并造成65%攻击伤害，可连锁。",
  },
};
export interface Item {
  id: string;
  name: string;
  slot: Slot;
  level: number;
  quality: number;
  base: number;
  affixes: { stat: Stat; value: number }[];
  set?: number;
  locked: boolean;
  special?: SpecialId;
}
export interface Save {
  version: 1;
  level: number;
  xp: number;
  gold: number;
  bag: Item[];
  equipped: Partial<Record<Slot, Item>>;
  cleared: number[];
  pity: number;
  settings: { sound: boolean; shake: boolean };
  kills: number;
  runs: number;
  specialIntro?: boolean;
}
export interface Dungeon {
  name: string;
  subtitle: string;
  level: number;
  boss: string;
  color: string;
  monsters: string[];
  description: string;
}
export const slots: Slot[] = [
  "weapon",
  "head",
  "chest",
  "legs",
  "ring",
  "charm",
];
export const slotNames: Record<Slot, string> = {
  weapon: "武器",
  head: "头盔",
  chest: "胸甲",
  legs: "护腿",
  ring: "戒指",
  charm: "护符",
};
export const statNames: Record<Stat, string> = {
  attack: "攻击",
  health: "生命",
  defense: "防御",
  crit: "暴击率",
  speed: "攻击速度",
  skill: "技能伤害",
  cdr: "冷却缩减",
};
export const qualities = ["普通", "精良", "史诗", "传说"];
export const colors = ["#a6b2ae", "#6eaed8", "#bb8ee8", "#f2b65f"];
export const sets = [
  { name: "狂战", two: "普攻伤害 +15%", four: "第三段普攻附带冲击" },
  { name: "风行", two: "冷却缩减 +10%", four: "裂风斩额外一道剑气" },
  { name: "余烬", two: "技能命中施加灼烧", four: "对灼烧敌人伤害 +25%" },
];
export const dungeons: Dungeon[] = [
  {
    name: "枯骨墓道",
    subtitle: "THE HOLLOW CRYPT",
    level: 1,
    boss: "骸骨守卫",
    color: "#b5a57b",
    monsters: ["骷髅兵", "骷髅弓手"],
    description: "古老王国的墓道深处，沉睡的守卫再次举起了剑。",
  },
  {
    name: "腐败矿坑",
    subtitle: "THE ROTTEN DEPTHS",
    level: 5,
    boss: "腐化巨虫",
    color: "#86aa83",
    monsters: ["洞穴爬行者", "爆裂孢子"],
    description: "绿色雾气蔓延的废弃矿井，潜藏着贪婪的生命。",
  },
  {
    name: "灰烬圣所",
    subtitle: "THE ASHEN SANCTUM",
    level: 10,
    boss: "灰烬骑士",
    color: "#d5896d",
    monsters: ["圣所卫士", "余烬术士"],
    description: "火焰熄灭之后，最后的骑士仍守望着破碎的誓言。",
  },
];
export const baseNames = [
  ["旅人长剑", "守卫铁剑", "远征重剑"],
  ["破旧兜帽", "守卫头盔", "远征面甲"],
  ["旅人皮甲", "守卫胸铠", "远征战甲"],
  ["旅人绑腿", "守卫护腿", "远征腿铠"],
  ["旧铜指环", "黑铁指环", "银纹指环"],
  ["石质护符", "月纹护符", "古老吊坠"],
];
export const xpNeed = (level: number) => 90 + level * 45;
export const price = (item: Item) =>
  Math.round((12 + item.level * 4) * (item.quality + 1));

/** 为装备生成独立编号，兼容通过公网 IP 使用 HTTP 访问游戏。 */
function createItemId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function createItem(
  level: number,
  quality: number,
  dungeon = -1,
  fixedSlot?: Slot,
): Item {
  const slotIndex = fixedSlot
      ? slots.indexOf(fixedSlot)
      : Math.floor(Math.random() * 6),
    slot = slots[slotIndex];
  const set =
    quality >= 2 && dungeon >= 0 && Math.random() < 0.65 ? dungeon : undefined;
  const pools: Record<Slot, Stat[]> = {
    weapon: ["attack", "crit", "speed", "skill"],
    head: ["health", "defense", "crit", "cdr"],
    chest: ["health", "defense", "skill", "cdr"],
    legs: ["health", "defense", "speed", "cdr"],
    ring: ["attack", "crit", "speed", "cdr"],
    charm: ["attack", "health", "skill", "cdr"],
  };
  const pool = [...pools[slot]];
  const affixes: Item["affixes"] = [];
  for (let i = 0; i < quality; i++) {
    const stat = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    affixes.push({
      stat,
      value:
        stat === "health"
          ? Math.round(12 + level * 4 + Math.random() * 10)
          : stat === "attack" || stat === "defense"
            ? Math.round(2 + level * 0.7 + Math.random() * 3)
            : Math.round(3 + Math.random() * 5),
    });
  }
  return {
    id: createItemId(),
    name:
      set === undefined
        ? baseNames[slotIndex][Math.min(2, Math.floor((level - 1) / 5))]
        : `${sets[set].name}·${slotNames[slot]}`,
    slot,
    level,
    quality,
    base: Math.round(
      (slot === "weapon"
        ? 8 + level * 3
        : slot === "ring" || slot === "charm"
          ? 2 + level
          : 3 + level * 1.5) *
        (1 + quality * 0.22),
    ),
    affixes,
    set,
    locked: false,
  };
}
/** 特效装备仅在穿戴时生效，保留旧装备和旧存档结构。 */
export function createSpecialItem(
  level: number,
  quality: number,
  special: SpecialId,
): Item {
  const template = specialItems[special];
  return {
    ...createItem(level, Math.max(2, quality), -1, template.slot),
    name: template.name,
    special,
  };
}
export function stats(save: Save) {
  const result = {
    attack: 17 + save.level * 4,
    health: 200 + save.level * 28,
    defense: save.level * 2,
    crit: 5,
    speed: 0,
    skill: 0,
    cdr: 0,
  };
  const counts = [0, 0, 0];
  for (const item of Object.values(save.equipped)) {
    if (!item) continue;
    result[
      item.slot === "weapon" || item.slot === "ring" || item.slot === "charm"
        ? "attack"
        : "defense"
    ] += item.base;
    for (const a of item.affixes) result[a.stat] += a.value;
    if (item.set !== undefined) counts[item.set]++;
  }
  if (counts[1] >= 2) result.cdr += 10;
  result.cdr = Math.min(30, result.cdr);
  result.crit = Math.min(60, result.crit);
  const specials = Object.values(save.equipped).flatMap((item) =>
    item?.special ? [item.special] : [],
  );
  return { ...result, counts, specials };
}
export function freshSave(): Save {
  const sword = createItem(1, 0);
  sword.slot = "weapon";
  sword.name = "旅人长剑";
  sword.base = 11;
  return {
    version: 1,
    level: 1,
    xp: 0,
    gold: 120,
    bag: [],
    equipped: { weapon: sword },
    cleared: [],
    pity: 0,
    settings: { sound: true, shake: true },
    kills: 0,
    runs: 0,
  };
}
