import { stats, type Save } from "./data";

export type BlessingGroup = "counter" | "wind" | "ember" | "common";
export const blessingGroups: Record<BlessingGroup, string> = {
  counter: "反击",
  wind: "凝风",
  ember: "余烬",
  common: "旅人",
};
/** 局内能力均使用初始已解锁操作，只有灼烧分支需要先获得点燃来源。 */
export const blessings = {
  "riposte-fan": {
    name: "回身断浪",
    group: "counter",
    description:
      "闪避反击额外向两侧释放短程剑气，各造成100%攻击伤害，可与曙光回击叠加。",
  },
  "riposte-tempo": {
    name: "余势回流",
    group: "counter",
    description:
      "反击首次命中敌人时，裂风斩、旋刃和突袭的剩余冷却减少1.2秒。每次反击只触发一次。",
  },
  "riposte-guard": {
    name: "从容一瞬",
    group: "counter",
    description: "精准闪避的有效时机扩大，成功后的反击机会从1.8秒延长至2.8秒。",
  },
  "wind-echo": {
    name: "风之残响",
    group: "wind",
    description:
      "满蓄剑气在0.22秒后追加一道50%伤害的剑影，继承风行双剑气与回风折返。",
  },
  "wind-burst": {
    name: "裂风震荡",
    group: "wind",
    description:
      "每道满蓄剑气首次命中时引发范围冲击，对周围敌人造成70%攻击伤害。",
  },
  "wind-mobility": {
    name: "轻身凝风",
    group: "wind",
    description: "满蓄时间从0.8秒缩短至0.55秒，蓄力期间的移动速度提高约85%。",
  },
  "ember-seed": {
    name: "借火",
    group: "ember",
    description: "反击与满蓄剑气命中时附加4秒灼烧，为本局开启余烬分支。",
  },
  "ember-field": {
    name: "余烬之地",
    group: "ember",
    description:
      "灼烧敌人死亡后留下2.5秒火区，每秒对其中敌人造成45%攻击伤害。最多同时存在6处。",
  },
  "ember-hunt": {
    name: "逐烬",
    group: "ember",
    description: "反击与满蓄剑气命中已在灼烧的敌人时，额外造成30%伤害。",
  },
  "vital-spark": {
    name: "生命火种",
    group: "common",
    description:
      "立刻恢复25%最大生命。本局只可选择一次，生命充足时不会占用候选位置。",
  },
  "step-wind": {
    name: "游风步",
    group: "common",
    description: "闪避冷却缩短25%，方便连续走位与寻找精准反击机会。",
  },
  opening: {
    name: "乘隙而入",
    group: "common",
    description:
      "对精英与首领完整收招期间造成的伤害提高20%，组合攻击的中间停顿不生效。",
  },
} satisfies Record<
  string,
  { name: string; group: BlessingGroup; description: string }
>;
export type BlessingId = keyof typeof blessings;

/** 仅驻留当前副本的选择状态；不属于存档或装备属性。 */
export class BlessingRun {
  selected: BlessingId[] = [];
  offers: BlessingId[] = [];
  rerolls = 1;

  reset() {
    this.selected = [];
    this.offers = [];
    this.rerolls = 1;
  }

  has(id: BlessingId) {
    return this.selected.includes(id);
  }

  fireSource(save: Save) {
    const s = stats(save);
    return (
      this.has("ember-seed") ||
      s.specials.includes("wildfire") ||
      s.counts[2] >= 2
    );
  }

  affinity(id: BlessingId, save: Save) {
    const s = stats(save),
      group = blessings[id].group;
    return (
      this.selected.some((chosen) => blessings[chosen].group === group) ||
      (group === "counter" && s.specials.includes("reprisal")) ||
      (group === "wind" &&
        (s.specials.includes("returning") || s.counts[1] >= 2)) ||
      (group === "ember" &&
        (s.specials.includes("wildfire") || s.counts[2] >= 2))
    );
  }

  /** 不放回抽取；有点燃来源才出现灼烧强化，首次尽量提供三个不同方向。 */
  draw(save: Save, hp: number, excluded: BlessingId[] = []) {
    const source = this.fireSource(save);
    const pool = (Object.keys(blessings) as BlessingId[]).filter(
      (id) =>
        !this.has(id) &&
        !excluded.includes(id) &&
        (id !== "ember-seed" || !source) &&
        (!["ember-field", "ember-hunt"].includes(id) || source) &&
        (id !== "vital-spark" || hp < stats(save).health * 0.95),
    );
    const result: BlessingId[] = [];
    const pick = (candidates: BlessingId[]) => {
      if (!candidates.length) return;
      const weights = candidates.map(
        (id) =>
          1 +
          (this.affinity(id, save) ? 4 : 0) +
          (id === "vital-spark" && hp < stats(save).health * 0.5 ? 3 : 0),
      );
      let roll = Math.random() * weights.reduce((sum, value) => sum + value, 0);
      let index = 0;
      while (index < weights.length - 1 && roll >= weights[index])
        roll -= weights[index++];
      result.push(candidates[index]);
    };
    if (!this.selected.length)
      for (const group of ["counter", "wind", "ember"] as const)
        pick(pool.filter((id) => blessings[id].group === group));
    while (result.length < 3) {
      const remaining = pool.filter((id) => !result.includes(id));
      if (!remaining.length) break;
      pick(remaining);
    }
    this.offers = result;
  }

  choose(id: BlessingId) {
    if (!this.offers.includes(id) || this.has(id) || this.selected.length >= 3)
      return false;
    this.selected.push(id);
    this.offers = [];
    return true;
  }

  reroll(save: Save, hp: number) {
    if (this.rerolls <= 0 || !this.offers.length) return false;
    const previous = [...this.offers];
    this.draw(save, hp, previous);
    this.rerolls--;
    return true;
  }
}
