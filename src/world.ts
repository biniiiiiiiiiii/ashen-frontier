import Phaser from "phaser";
import { Combat, actions, type Bridge, type Enemy, type Input } from "./combat";
import { enemyArea } from "./encounters";
export type { Bridge, Enemy, Run } from "./combat";
const W = 1100,
  H = 610;
const noise = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** 场景只适配键盘、绘制动作和表现，战斗规则由控制器统一推进。 */
export class World extends Phaser.Scene {
  g!: Phaser.GameObjects.Graphics;
  words!: Phaser.GameObjects.Container;
  keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  combat: Combat;
  manualTime = false;
  constructor(public bridge: Bridge) {
    super("world");
    this.combat = new Combat(bridge, (duration, amount) => {
      if (this.g) this.cameras.main.shake(duration, amount);
    });
  }
  get player() {
    return this.combat.player;
  }
  get enemies() {
    return this.combat.enemies;
  }
  get hazards() {
    return this.combat.hazards;
  }
  get effects() {
    return this.combat.effects;
  }
  get cooldowns() {
    return this.combat.cooldowns;
  }
  get clock() {
    return this.combat.clock;
  }
  get wave() {
    return this.combat.wave;
  }
  get door() {
    return this.combat.door;
  }
  create() {
    this.g = this.add.graphics();
    this.words = this.add.container();
    this.keys = this.input.keyboard!.addKeys(
      "W,A,S,D,J,K,L,U,SPACE,UP,DOWN,LEFT,RIGHT,ENTER",
    ) as Record<string, Phaser.Input.Keyboard.Key>;
    this.draw();
  }
  start(dungeon: number, hard: boolean) {
    this.combat.start(dungeon, hard);
  }
  update(_time: number, delta: number) {
    if (!this.manualTime) this.step(Math.min(delta / 1000, 0.04));
    this.draw();
  }
  step(dt: number) {
    const k = this.keys;
    const input: Input = {
      x:
        Number(k.D?.isDown || k.RIGHT?.isDown) -
        Number(k.A?.isDown || k.LEFT?.isDown),
      y:
        Number(k.S?.isDown || k.DOWN?.isDown) -
        Number(k.W?.isDown || k.UP?.isDown),
      keys: new Set(),
      enter: !!k.ENTER?.isDown,
    };
    for (const [name, key] of [
      ["j", "J"],
      ["k", "K"],
      ["l", "L"],
      ["u", "U"],
      ["space", "SPACE"],
    ] as const)
      if (k[key]?.isDown) input.keys.add(name);
    this.combat.step(dt, input);
  }
  draw() {
    if (!this.g) return;
    this.g.clear();
    this.words.removeAll(true);
    const camp = this.bridge.mode !== "battle" && this.bridge.mode !== "result";
    this.background(camp, this.bridge.run?.dungeon ?? 0);
    if (camp) {
      this.actor(585, 425, "hero", 1, 1);
      this.fire(470, 445, 1.4);
      this.actor(760, 392, "npc", -1, 0.85);
      return;
    }
    this.telegraphs();
    for (const fx of this.effects) {
      if (fx.kind === "ghost") {
        const t = fx.life / fx.max;
        this.rect(fx.x - 12, fx.y - 55, 24, 40, 0x8eadad, t * 0.2);
        this.rect(fx.x - 8, fx.y - 70, 17, 15, 0xb7c6b8, t * 0.18);
      } else if (fx.kind === "dust")
        this.ellipse(
          fx.x,
          fx.y,
          42 * (1 - fx.life / fx.max),
          13,
          0xb4a57a,
          fx.life * 0.4,
        );
    }
    const bodies = [
      ...this.enemies.map((e) => ({ x: e.x, y: e.y, e })),
      { x: this.player.x, y: this.player.y, e: null },
    ].sort((a, b) => a.y - b.y);
    for (const body of bodies) {
      const e = body.e;
      if (e) {
        this.actor(
          e.x,
          e.y,
          e.kind % 2 ? "ranged" : "skeleton",
          e.facing,
          e.boss ? 1.75 : e.elite ? 1.15 : 1,
          e.flash > 0
            ? 0xffffff
            : e.kind >= 4
              ? 0xaf6650
              : e.kind >= 2
                ? 0x85a478
                : 0xb9b6a2,
          e.kind,
          e,
        );
        if (e.armor) {
          this.g.lineStyle(2, 0xe7bc67, 0.75);
          this.g.strokeEllipse(
            e.x,
            e.y - 48 * (e.boss ? 1.6 : 1),
            e.boss ? 90 : 58,
            e.boss ? 115 : 78,
          );
        }
        const scale = e.boss ? 1.75 : 1;
        this.rect(e.x - 23, e.y - 78 * scale, 46, 4, 0x222420);
        this.rect(
          e.x - 23,
          e.y - 78 * scale,
          46 * Math.max(0, e.hp / e.max),
          4,
          e.armor ? 0xd8b062 : e.elite ? 0xd8aa64 : 0xb35f50,
        );
        if ((e.boss || e.elite) && e.state === "recover")
          this.label(
            e.x,
            e.y - (e.boss ? 145 : 95),
            e.followup ? "追击将至 · 保持警惕" : "破绽 · 蓄力反击",
            12,
            e.followup ? "#edb47e" : "#bddd9a",
          );
        if (e.elite && e.state !== "recover")
          this.label(e.x, e.y - 95, "裂骨先锋", 11, "#e5bb75");
        if (e.burn > 0) this.fire(e.x, e.y - 35, 0.45);
      } else
        this.actor(
          body.x,
          body.y,
          "hero",
          this.player.facing,
          1,
          this.player.inv > 0 && Math.floor(this.clock * 18) % 2
            ? 0xcbdccb
            : undefined,
        );
    }
    this.drawProjectiles();
    const action = this.player.action;
    if (action?.kind === "charging") {
      const progress = Math.min(1, action.time / 0.8);
      this.g.lineStyle(2, progress === 1 ? 0xf5d588 : 0x9acfb9, 0.8);
      this.g.strokeEllipse(
        this.player.x,
        this.player.y - 30,
        45 + progress * 30,
        80 + progress * 20,
      );
      this.rect(this.player.x - 30, this.player.y - 92, 60, 5, 0x29372f);
      this.rect(
        this.player.x - 30,
        this.player.y - 92,
        progress * 60,
        5,
        progress === 1 ? 0xf5d588 : 0x9acfb9,
      );
      this.label(
        this.player.x,
        this.player.y - 110,
        progress === 1 ? "满蓄 · 松开K" : "凝风蓄力",
        12,
        "#f1d58e",
      );
    }
    if (this.player.counter > 0) {
      this.g.lineStyle(2, 0xafe8d6, 0.7);
      this.g.strokeEllipse(this.player.x, this.player.y, 72, 26);
      this.label(
        this.player.x,
        this.player.y - 110,
        `J 反击 · ${this.player.counter.toFixed(1)}s`,
        13,
        "#afe8d6",
      );
    }
    if (this.door) {
      this.ellipse(1035, 435, 50, 130, 0xb5d8b1, 0.12);
      this.g.lineStyle(3, 0xb7d49e, 0.8);
      this.g.strokeEllipse(1035, 435, 42, 110);
      this.label(1010, 510, "下一房间", 12, "#d8e5b3");
    }
    this.drawEffects();
  }
  telegraphs() {
    for (const h of this.hazards) {
      const progress = 1 - Math.max(0, h.timer) / h.duration;
      this.ellipse(
        h.x,
        h.y,
        h.r * 2,
        h.r,
        0xc75e45,
        h.fired ? 0.32 : 0.1 + progress * 0.2,
      );
      this.g.lineStyle(2, 0xef9b68, 0.8);
      this.g.strokeEllipse(h.x, h.y, h.r * 2, h.r);
      if (!h.fired)
        this.ellipse(
          h.x,
          h.y,
          h.r * 2 * progress,
          h.r * progress,
          0xe28b55,
          0.15,
        );
    }
    for (const e of this.enemies) {
      if (e.state !== "windup") continue;
      const t = Math.min(1, e.stateTime / e.windup),
        color = e.armor ? 0xe7a65c : 0xd09163;
      if (e.move === "arrow") {
        this.g.lineStyle(1, color, 0.25 + t * 0.4);
        this.g.beginPath();
        this.g.moveTo(e.x, e.y);
        this.g.lineTo(e.aimX, e.aimY);
        this.g.strokePath();
        this.g.lineStyle(1, color, 0.7);
        this.g.strokeEllipse(e.aimX, e.aimY, 24, 12);
      } else if (e.move === "charge") {
        const area = enemyArea(e);
        this.rect(area.x, area.y, area.w, area.h, color, 0.08 + t * 0.16);
        this.g.lineStyle(1, color, 0.7);
        this.g.strokeRect(area.x, area.y, area.w, area.h);
        for (let i = 1; i < 5; i++) {
          const px = e.x + ((e.aimX - e.x) * i) / 5;
          this.g.beginPath();
          this.g.moveTo(px - e.facing * 12, e.y - 9);
          this.g.lineTo(px, e.y);
          this.g.lineTo(px - e.facing * 12, e.y + 9);
          this.g.strokePath();
        }
      } else if (["slash", "heavy", "combo"].includes(e.move)) {
        const area = enemyArea(e);
        this.rect(area.x, area.y, area.w, area.h, color, 0.06 + t * 0.12);
        this.g.lineStyle(1, color, 0.4 + t * 0.5);
        this.g.strokeRect(area.x, area.y, area.w, area.h);
        this.rect(area.x, area.y + area.h - 3, area.w * t, 3, color, 0.8);
      }
      if (e.boss || e.elite || e.move === "arrow")
        this.label(
          e.x,
          e.y - (e.boss ? 145 : 100),
          e.move === "charge"
            ? "冲锋 · 横向突进"
            : e.move === "combo"
              ? "三连斩"
              : e.move === "heavy"
                ? "重斩 · 闪避后反击"
                : e.move === "arrow"
                  ? e.active > 0.3
                    ? "二连射"
                    : "瞄准射击"
                  : "横扫",
          11,
          "#edbb84",
        );
    }
  }
  drawProjectiles() {
    const g = this.g;
    for (const p of this.combat.projectiles) {
      if (p.kind === "wave") {
        const x = p.x,
          y = p.y - 33 + (p.visualOffset ?? 0);
        this.ellipse(
          x,
          y,
          p.charged ? 75 : 45,
          p.charged ? 145 : 100,
          p.charged ? 0xf3ce8c : 0xb9e0c2,
          0.14,
        );
        if (p.charged) {
          g.lineStyle(3, p.returning ? 0x9de1dd : 0xf3ce8c, 0.8);
          g.strokeEllipse(x, y, 22, 125);
        }
        g.lineStyle(9, 0x78a98d, 0.2);
        g.beginPath();
        g.arc(
          x - p.facing * 20,
          y,
          43,
          p.facing > 0 ? -1.1 : 2.04,
          p.facing > 0 ? 1.1 : 4.24,
        );
        g.strokePath();
        g.lineStyle(4, 0xe9ecc2, 0.95);
        g.beginPath();
        g.arc(
          x - p.facing * 20,
          y,
          39,
          p.facing > 0 ? -1.1 : 2.04,
          p.facing > 0 ? 1.1 : 4.24,
        );
        g.strokePath();
        for (let i = 0; i < 4; i++)
          this.rect(
            x - p.facing * (i * 12 + 10),
            y - 25 + i * 15,
            14,
            2,
            0xbbd8a3,
            0.5 - i * 0.1,
          );
      } else {
        const angle = Math.atan2(p.vy, p.vx),
          x = p.x,
          y = p.y - 32;
        this.pixelLine(
          x - Math.cos(angle) * 27,
          y - Math.sin(angle) * 27,
          x,
          y,
          0xbca66c,
          2,
        );
        this.pixelLine(
          x - Math.cos(angle) * 8,
          y - Math.sin(angle) * 8,
          x + Math.cos(angle) * 5,
          y + Math.sin(angle) * 5,
          0xe0d9ae,
          3,
        );
        if (p.kind === "orb") {
          this.ellipse(x, y, 16, 16, 0xd7955a, 0.8);
          this.ellipse(x, y, 28, 28, 0xe59f5b, 0.14);
        }
      }
    }
  }
  drawEffects() {
    const g = this.g;
    for (const e of this.effects) {
      const t = e.life / e.max;
      if (e.kind === "text") {
        this.label(
          e.x,
          e.y - (1 - t) * 37,
          e.text!,
          e.text?.endsWith("!") ? 20 : 16,
          e.color ? "#" + e.color.toString(16) : "#fff",
        );
        continue;
      }
      if (e.kind === "impact" || e.kind === "spark") {
        for (let i = 0; i < 7; i++) {
          const angle = (i / 7) * Math.PI * 2,
            dist = (1 - t) * 35;
          this.pixelLine(
            e.x + Math.cos(angle) * dist * 0.3,
            e.y + Math.sin(angle) * dist * 0.3,
            e.x + Math.cos(angle) * dist,
            e.y + Math.sin(angle) * dist,
            0xf7dda0,
            2,
            t,
          );
        }
        this.ellipse(e.x, e.y, 18 * t, 18 * t, 0xffefc2, t * 0.7);
      } else if (e.kind === "death") {
        for (let i = 0; i < 10; i++)
          this.rect(
            e.x + (noise(i) * 2 - 1) * (1 - t) * 60,
            e.y - noise(i + 4) * (1 - t) * 100,
            4,
            4,
            0xc5af70,
            t,
          );
      } else if (e.kind === "blast" || e.kind === "perfect") {
        g.lineStyle(3, e.kind === "perfect" ? 0xafe8d6 : 0xe1ba7b, t);
        g.strokeEllipse(e.x, e.y, 180 * (1 - t), 85 * (1 - t));
      }
    }
  }
  pixelLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    width = 4,
    alpha = 1,
  ) {
    const count = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      this.rect(
        x1 + (x2 - x1) * t - width / 2,
        y1 + (y2 - y1) * t - width / 2,
        width,
        width,
        color,
        alpha,
      );
    }
  }
  actor(
    x: number,
    y: number,
    kind: string,
    facing: number,
    s = 1,
    tint?: number,
    variant = 0,
    enemy?: Enemy,
  ) {
    const hero = kind === "hero",
      npc = kind === "npc",
      a = hero && this.bridge.mode === "battle" ? this.player.action : null;
    const phase = a ? this.combat.phase(a) : "idle",
      ePhase = enemy?.state,
      walking = hero
        ? this.bridge.mode === "battle" && this.player.moving
        : enemy?.moving;
    const gait = walking
      ? Math.sin(hero ? this.player.walk : (enemy?.walk ?? 0)) * 5
      : 0;
    let lean = 0,
      compress = 1,
      angle = 0.9,
      armX = 14,
      armY = -40,
      swing = 0;
    if (a) {
      const t = a.time,
        sp = a.spec,
        progress = Math.max(0, Math.min(1, (t - sp.windup) / sp.active)),
        wind = Math.min(1, t / Math.max(0.001, sp.windup)),
        recover = Math.max(0, (t - sp.windup - sp.active) / sp.recovery);
      if (a.kind === "dodge") {
        compress = 0.65;
        lean = 17;
        angle = 2.7;
      } else if (a.kind === "hurt") {
        lean = -9;
        angle = 1.6;
      } else if (
        a.kind === "light1" ||
        a.kind === "light2" ||
        a.kind === "heavy" ||
        a.kind === "counter"
      ) {
        const reverse = a.kind === "light2",
          heavy = a.kind === "heavy" || a.kind === "counter";
        const start = reverse ? 1.8 : heavy ? -2 : -1.65,
          end = reverse ? -1.35 : 1.2;
        angle =
          phase === "windup"
            ? 0.8 + (start - 0.8) * wind
            : phase === "active"
              ? start + (end - start) * progress
              : end + (0.9 - end) * recover;
        lean =
          phase === "windup"
            ? -5 * wind
            : phase === "active"
              ? (heavy ? 14 : 7) * Math.sin(progress * Math.PI)
              : (heavy ? 10 : 5) * (1 - recover);
        swing = phase === "active" ? 1 : 0;
      } else if (a.kind === "charging") {
        angle = -1.65;
        lean = -6;
        compress = 0.92;
      } else if (a.kind === "wave") {
        angle =
          phase === "windup"
            ? -1.4 * wind
            : phase === "active"
              ? -0.6 + progress * 1.5
              : 0.9;
        lean = phase === "active" ? 9 : 0;
        swing = phase === "active" ? 0.7 : 0;
      } else if (a.kind === "spin") {
        angle =
          phase === "active"
            ? -2 + progress * Math.PI * 5
            : phase === "windup"
              ? -1.7 * wind
              : 1;
        lean = Math.sin(angle) * 5;
        swing = phase === "active" ? 1 : 0;
      } else if (a.kind === "rush") {
        lean =
          phase === "active" ? 18 : phase === "windup" ? -7 : 8 * (1 - recover);
        angle = phase === "windup" ? 2.7 : phase === "active" ? -0.12 : 1.1;
        swing = phase === "active" ? 0.6 : 0;
      }
    } else if (enemy) {
      const progress = Math.min(
        1,
        enemy.stateTime / (ePhase === "windup" ? enemy.windup : enemy.active),
      );
      if (ePhase === "hurt") {
        lean = -8;
        angle = 1.6;
      } else if (ePhase === "windup") {
        angle = enemy.move === "arrow" ? 0.05 : 0.9 - 2.9 * progress;
        lean = -6 * progress;
      } else if (ePhase === "active") {
        angle =
          enemy.move === "arrow"
            ? 0.05
            : enemy.move === "charge"
              ? 0.1
              : -1.8 + ((enemy.stateTime % 0.24) / 0.24) * 3;
        lean = enemy.move === "charge" ? 15 : 10;
        swing = enemy.move === "arrow" ? 0 : 1;
      } else if (ePhase === "recover") {
        angle = 1.5 - Math.min(1, enemy.stateTime / enemy.recovery) * 0.6;
        lean = 6 * (1 - enemy.stateTime / enemy.recovery);
      }
    }
    const armor = tint ?? (hero ? 0x91a69c : npc ? 0x857f61 : 0xb9b6a2);
    this.ellipse(x, y + 3, 44 * s, 13 * s, 0x0c1410, 0.6);
    const point = (px: number, py: number) => ({
      x: x + (px + lean * (py < -20 ? 1 : 0.3)) * s * facing,
      y: y + py * s * compress,
    });
    const r = (
      px: number,
      py: number,
      w: number,
      h: number,
      color: number,
      alpha = 1,
    ) => {
      const p = point(px, py);
      this.rect(
        p.x - (facing < 0 ? w * s : 0),
        p.y,
        w * s,
        h * s * compress,
        color,
        alpha,
      );
    };
    const line = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      c: number,
      w = 4,
    ) => {
      const p = point(x1, y1),
        q = point(x2, y2);
      this.pixelLine(p.x, p.y, q.x, q.y, c, w * s);
    };
    if (!hero && !npc && variant === 2) {
      r(-22, -25, 44, 18, armor);
      r(-12, -37, 25, 18, armor);
      r(-18, -30, 7, 5, 0xd2d76d);
      for (let i = 0; i < 4; i++)
        line(-24 + i * 14, -12, -28 + i * 14 + gait, -1, armor, 4);
      return;
    }
    if (hero) {
      r(
        -21,
        -48,
        13,
        38 + (walking ? Math.sin(this.player.walk) * 3 : 0),
        0x734a3a,
      );
      r(-25 - (walking ? 3 : 0), -37, 10, 27, 0x4c342d);
    }
    line(-7, -22, -9 - gait * 0.65, -5, 0x38453d, 8);
    line(7, -22, 10 + gait * 0.65, -5, 0x465246, 8);
    r(-15 - gait * 0.65, -5, 15, 6, 0x263129);
    r(5 + gait * 0.65, -5, 15, 6, 0x263129);
    r(-13, -49, 28, 29, armor);
    r(-9, -48, 8, 24, hero ? 0xc0c4a5 : 0x596552);
    r(-13, -23, 29, 6, 0x4f4934);
    r(-2, -24, 7, 7, 0xc4aa69);
    r(-19, -49, 10, 12, hero ? 0x667d70 : armor);
    r(13, -48, 12, 13, hero ? 0xa8b5a0 : armor);
    r(-10, -68, 23, 20, armor);
    r(-14, -54, 29, 6, hero ? 0x526e61 : 0x737c65);
    r(5, -59, 9, 5, hero ? 0xd7ba91 : 0x333d34);
    r(-6, -69, 18, 5, hero ? 0x91a895 : 0x8a927b);
    if (hero) {
      r(-15, -70, 6, 18, 0xb18c56);
      r(-18, -65, 4, 14, 0x906b3e);
    }
    if (kind === "ranged" && !npc) {
      const hand = point(25, -42);
      line(17, -43, 27, -43, armor, 7);
      line(25, -66, 34, -55, 0xa78e56, 3);
      line(34, -55, 34, -27, 0xa78e56, 3);
      line(34, -27, 25, -17, 0xa78e56, 3);
      const pull =
        ePhase === "windup"
          ? 14 * Math.min(1, (enemy?.stateTime ?? 0) / (enemy?.windup ?? 1))
          : 0;
      line(25, -66, 25 - pull, -42, 0xd1c49b, 1);
      line(25 - pull, -42, 25, -17, 0xd1c49b, 1);
      if (ePhase === "windup") {
        line(12 - pull, -42, 40, -42, 0xd3c99d, 2);
        line(0, -41, 25 - pull, -42, armor, 6);
      } else line(-13, -42, -16, -26, armor, 6);
      void hand;
    } else {
      const gripX = armX + Math.cos(angle) * 12,
        gripY = armY + Math.sin(angle) * 12;
      line(15, -43, gripX, gripY, hero ? 0x839482 : armor, 8);
      r(gripX - 3, gripY - 3, 7, 7, hero ? 0xc6b28c : 0x9ba587);
      const tipX = gripX + Math.cos(angle) * 53,
        tipY = gripY + Math.sin(angle) * 53;
      line(gripX, gripY, tipX, tipY, hero ? 0xd8dfbf : 0xb5bca3, 5);
      line(
        gripX + Math.sin(angle) * 8,
        gripY - Math.cos(angle) * 8,
        gripX - Math.sin(angle) * 8,
        gripY + Math.cos(angle) * 8,
        0xb49a5e,
        4,
      );
      line(
        gripX - Math.cos(angle) * 10,
        gripY - Math.sin(angle) * 10,
        gripX,
        gripY,
        0x786340,
        4,
      );
      if (swing) {
        const pivot = point(gripX, gripY);
        this.g.lineStyle(
          (a?.kind === "heavy" ? 9 : 5) * s,
          hero ? 0xf3e7ba : 0xd89164,
          0.7,
        );
        const angleWorld = facing > 0 ? angle : Math.PI - angle;
        this.g.beginPath();
        this.g.arc(
          pivot.x,
          pivot.y,
          47 * s,
          angleWorld - (facing > 0 ? 0.85 : 0),
          angleWorld + (facing > 0 ? 0 : 0.85),
        );
        this.g.strokePath();
      }
    }
  }
  snapshot() {
    return this.combat.snapshot();
  }

  rect(x: number, y: number, w: number, h: number, c: number, a = 1) {
    this.g.fillStyle(c, a);
    this.g.fillRect(Math.round(x), Math.round(y), w, h);
  }
  ellipse(x: number, y: number, w: number, h: number, c: number, a = 1) {
    this.g.fillStyle(c, a);
    this.g.fillEllipse(x, y, w, h);
  }
  label(x: number, y: number, text: string, size = 14, color = "#ded8bc") {
    const t = this.add
      .text(x, y, text, {
        fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
        fontSize: size,
        color,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.words.add(t);
  }
  background(camp: boolean, d: number) {
    const g = this.g;
    const tint = d === 1 ? 0x263a32 : d === 2 ? 0x402b29 : 0x303b3a;
    this.rect(0, 0, W, H, 0x171e20);
    for (let i = 0; i < 15; i++)
      this.rect(
        0,
        i * 25,
        W,
        26,
        Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(0x151d23),
          Phaser.Display.Color.ValueToColor(tint),
          15,
          i,
        ).color,
      );
    this.ellipse(760, 105, 102, 102, 0xd1d0ab, 0.15);
    this.ellipse(760, 105, 65, 65, 0xd9d7af, 0.23);
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < 22; i++) {
        const x = i * 66 - 30 + noise(i + layer * 6) * 30,
          y = 110 + layer * 37 + noise(i + 10) * 75;
        this.rect(
          x,
          y,
          30 + noise(i) * 45,
          260,
          layer === 0 ? 0x202b2c : layer === 1 ? 0x253131 : 0x2b3834,
        );
        this.rect(x + 10, y - 10, 12, 20, 0x202b2c);
      }
    }
    for (let i = 0; i < 7; i++) {
      const x = i * 180 - 15;
      this.rect(x, 155, 32, 220, 0x343d37);
      this.rect(x - 5, 150, 43, 12, 0x495045);
      this.rect(x + 5, 170, 6, 190, 0x4c5245, 0.5);
      this.rect(x - 5, 355, 44, 14, 0x1d2523);
      this.rect(x + 30, 167, 140, 15, 0x38423a);
      for (let j = 0; j < 5; j++)
        this.rect(
          x + 35 + j * 28,
          185 + Math.abs(2 - j) * 15,
          25,
          16,
          0x354037,
        );
    }
    for (let i = 0; i < 8; i++) {
      const x = i * 165 + noise(i + 18) * 35;
      this.rect(x, 260, 21, 120, 0x202a27);
      this.rect(x - 12, 255, 44, 13, 0x414a3d);
      this.rect(x + 2, 278, 6, 75, 0x515446, 0.5);
    }
    this.rect(0, 350, W, 260, 0x343a2e);
    this.rect(0, 350, W, 5, 0x68705a, 0.45);
    for (let i = 0; i < 210; i++) {
      const x = noise(i + 100) * W,
        y = 355 + noise(i + 400) * 255;
      this.rect(
        x,
        y,
        12 + noise(i) * 50,
        2 + noise(i + 2) * 3,
        noise(i + 3) > 0.5 ? 0x59604a : 0x242d26,
        0.55,
      );
    }
    for (let i = 0; i < 70; i++) {
      const x = noise(i + 800) * W,
        y = 360 + noise(i + 900) * 235;
      this.rect(x, y, 3, 8 + noise(i) * 10, 0x687050, 0.4);
      this.rect(x - 3, y + 4, 3, 6, 0x58664b, 0.5);
    }
    this.ellipse(450, 345, 900, 30, 0x9bab92, 0.035);
    this.ellipse(850, 300, 700, 20, 0xbbc8b0, 0.025);
    if (camp) {
      this.tent(85, 310, 1);
      this.tent(820, 315, 0.8);
      this.rect(280, 286, 9, 132, 0x74634c);
      this.rect(289, 295, 50, 77, 0x8b5340);
      this.rect(294, 300, 40, 63, 0x56372e);
      this.rect(311, 312, 7, 35, 0xc3a26b);
      this.rect(302, 323, 25, 6, 0xc3a26b);
      this.rect(630, 387, 80, 20, 0x584b36);
      this.rect(640, 374, 60, 15, 0x72624a);
      this.rect(643, 390, 5, 30, 0x352c22);
      this.rect(695, 390, 5, 30, 0x352c22);
      this.rect(656, 361, 6, 15, 0xb5ad89);
      this.rect(674, 360, 16, 14, 0x574e3b);
      for (let i = 0; i < 5; i++)
        this.rect(150 + i * 17, 426 + noise(i) * 18, 18, 22, 0x544e3b);
      this.fire(350, 350, 0.6);
    } else {
      this.rect(40, 230, 16, 125, 0x4c4635);
      this.fire(48, 245, 0.7);
      this.rect(1030, 230, 16, 125, 0x4c4635);
      this.fire(1038, 245, 0.7);
      for (let i = 0; i < 8; i++) {
        this.rect(120 + i * 125, 370 + noise(i) * 160, 12, 7, 0x7d7960, 0.4);
      }
    }
    for (let i = 0; i < 24; i++) {
      const x =
          (noise(i + 70) * W + Math.sin(this.clock * 0.2 + i) * 20 + W) % W,
        y = (noise(i + 20) * H - this.clock * (4 + noise(i) * 8)) % H;
      this.rect(x, y < 0 ? y + H : y, 2, 2, 0xd1af6d, 0.25 + noise(i) * 0.4);
    }
    this.rect(0, H - 30, W, 30, 0x111a17, 0.6);
  }
  tent(x: number, y: number, s: number) {
    const g = this.g;
    g.fillStyle(0x655d45);
    g.fillTriangle(
      x,
      y + 100 * s,
      x + 100 * s,
      y - 35 * s,
      x + 200 * s,
      y + 100 * s,
    );
    g.fillStyle(0x393b2d);
    g.fillTriangle(
      x + 100 * s,
      y - 20 * s,
      x + 120 * s,
      y + 100 * s,
      x + 200 * s,
      y + 100 * s,
    );
    g.fillStyle(0x1b2520);
    g.fillTriangle(
      x + 100 * s,
      y + 15 * s,
      x + 67 * s,
      y + 100 * s,
      x + 133 * s,
      y + 100 * s,
    );
    this.rect(x + 97 * s, y - 40 * s, 5, 145 * s, 0x8d7b55);
    g.lineStyle(2, 0x9b926d, 0.5);
    g.lineBetween(x + 100 * s, y - 35 * s, x - 20 * s, y + 120 * s);
  }
  fire(x: number, y: number, s: number) {
    const g = this.g;
    this.ellipse(x, y + 2, 70 * s, 22 * s, 0xf5a94a, 0.08);
    this.rect(x - 16 * s, y, 32 * s, 6 * s, 0x6d4a32);
    for (let i = 0; i < 9; i++) {
      const h = (15 + noise(i + Math.floor(this.clock * 8)) * 23) * s;
      this.rect(
        x + (i - 4) * 3 * s,
        y - h,
        4 * s,
        h,
        i % 3 ? 0xdb914c : 0xf4cf78,
        0.8,
      );
    }
    this.rect(x - 4 * s, y - 17 * s, 8 * s, 17 * s, 0xffe6a0);
  }
}
