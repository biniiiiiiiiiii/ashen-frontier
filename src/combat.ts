import { dungeons, stats } from "./data";
import { tombWaves, tombWaveNames, enemyArea } from "./encounters";
import { BlessingRun, type BlessingId } from "./blessings";
import {
  actions,
  type AttackKey,
  type ActionKind,
  type Action,
  type Enemy,
  type EnemyMove,
  type Hazard,
  type Effect,
  type Projectile,
  type Bridge,
  type Input,
} from "./combat-model";
export { actions, actionNames } from "./combat-model";
export type { Bridge, Enemy, Run, Input } from "./combat-model";
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const runIsTomb = (bridge: Bridge) => bridge.run?.dungeon === 0;
const noise = (i: number) => {
  const n = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const basic = (kind: ActionKind) =>
  ["light1", "light2", "heavy", "counter"].includes(kind);
/** 战斗控制器负责动作、实体弹道和受击状态，不直接绘制场景。 */
export class Combat {
  boons = new BlessingRun();
  firePatches: {
    x: number;
    y: number;
    life: number;
    tick: number;
    damage: number;
  }[] = [];
  player = {
    x: 220,
    y: 440,
    hp: 228,
    facing: 1,
    inv: 0,
    attack: 0,
    combo: 0,
    comboTimer: 0,
    action: null as Action | null,
    moving: false,
    walk: 0,
    vx: 0,
    vy: 0,
    counter: 0,
  };
  enemies: Enemy[] = [];
  hazards: Hazard[] = [];
  effects: Effect[] = [];
  projectiles: Projectile[] = [];
  cooldowns = { j: 0, k: 0, l: 0, u: 0, space: 0 };
  clock = 0;
  hitstop = 0;
  door = false;
  wave = 0;
  previous = new Set<AttackKey>();
  buffer: { key: AttackKey; life: number } | null = null;
  serial = 0;
  constructor(
    public bridge: Bridge,
    private shake: (duration: number, amount: number) => void,
  ) {}
  phase(action = this.player.action) {
    if (!action) return "idle";
    return action.time < action.spec.windup
      ? "windup"
      : action.time < action.spec.windup + action.spec.active
        ? "active"
        : "recovery";
  }
  canCancel(key: AttackKey) {
    const a = this.player.action;
    if (!a) return true;
    if (a.kind === "charging") return key === "space";
    if (a.kind === "hurt" || a.kind === "dodge") return false;
    if (basic(a.kind))
      return key === "space"
        ? a.time >= 0.035
        : key === "j"
          ? a.time >= a.spec.windup + a.spec.active + a.spec.recovery * 0.72
          : a.time >= a.spec.windup + 0.045;
    if (key === "space" && a.time < a.spec.windup) return true;
    return a.time >= a.spec.windup + a.spec.active + a.spec.recovery * 0.65;
  }
  start(dungeon: number, hard: boolean) {
    this.clearBlessings();
    this.bridge.run = {
      dungeon,
      hard,
      room: 0,
      time: 0,
      gold: 0,
      xp: 0,
      items: [],
      finished: false,
    };
    Object.assign(this.player, {
      x: 170,
      y: 450,
      hp: stats(this.bridge.save).health,
      facing: 1,
      inv: 0.7,
      attack: 0,
      combo: 0,
      comboTimer: 0,
      action: null,
      moving: false,
      walk: 0,
      vx: 0,
      vy: 0,
      counter: 0,
    });
    this.cooldowns = { j: 0, k: 0, l: 0, u: 0, space: 0 };
    this.previous.clear();
    this.buffer = null;
    this.hitstop = 0;
    this.wave = 0;
    this.spawn();
  }
  spawn() {
    const run = this.bridge.run!;
    this.enemies = [];
    this.hazards = [];
    this.effects = [];
    this.projectiles = [];
    if (this.wave === 0) this.firePatches = [];
    this.door = false;
    this.player.action = null;
    this.player.counter = 0;
    this.buffer = null;
    const boss = run.room === 3,
      formation =
        run.dungeon === 0 && !boss ? tombWaves[run.room][this.wave] : null,
      seed = run.room * 19 + this.wave * 31,
      n = boss ? 1 : (formation?.length ?? 4 + run.room * 2),
      scale = (1 + run.dungeon * 1.7) * (run.hard ? 1.65 : 1);
    for (let i = 0; i < n; i++) {
      const variant =
        formation?.[i] ?? (run.dungeon === 0 ? (i % 3 === 1 ? 1 : 0) : i % 2);
      const elite =
          !boss &&
          run.room === 2 &&
          i === 0 &&
          (run.dungeon !== 0 || this.wave !== 1),
        hp = Math.round((boss ? 3400 : elite ? 550 : 285) * scale);
      this.enemies.push({
        id: "e" + ++this.serial,
        x: boss
          ? 820
          : formation
            ? (variant === 1 ? 790 : 510) + noise(i + seed) * 180
            : 580 + noise(i + run.room * 9) * 370,
        y: boss
          ? 440
          : formation
            ? 355 + noise(i + 37 + seed) * 180
            : 365 + noise(i + 37) * 160,
        hp,
        max: hp,
        kind: run.dungeon * 2 + variant,
        boss,
        elite,
        cool: 0.6 + noise(i) * 1.2,
        flash: 0,
        burn: 0,
        burnTick: 1,
        phase: 0,
        name: boss
          ? dungeons[run.dungeon].boss
          : elite && run.dungeon === 0
            ? "裂骨先锋"
            : dungeons[run.dungeon].monsters[variant],
        state: "idle",
        stateTime: 0,
        move: "slash",
        facing: -1,
        aimX: 0,
        aimY: 0,
        windup: 0.5,
        active: 0.16,
        recovery: 0.5,
        hitstun: 0,
        vx: 0,
        vy: 0,
        pulse: -1,
        armor: false,
        moving: false,
        walk: 0,
      });
    }
    this.bridge.changed();
  }
  step(dt: number, input: Input) {
    if (this.bridge.paused || this.boons.offers.length) return;
    this.clock += dt;
    if (
      this.bridge.mode !== "battle" ||
      !this.bridge.run ||
      this.bridge.run.finished
    )
      return;
    const run = this.bridge.run,
      p = this.player,
      s = stats(this.bridge.save);
    run.time += dt;
    const pressed = (["space", "u", "l", "k", "j"] as AttackKey[]).filter(
      (k) => input.keys.has(k) && !this.previous.has(k),
    );
    this.previous = new Set(input.keys);
    for (const key of pressed) {
      if (this.available(key)) {
        this.buffer = { key, life: 0.24 };
        break;
      }
    }
    if (this.buffer) {
      this.buffer.life -= dt;
      if (this.buffer.life <= 0) this.buffer = null;
    }
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }
    for (const key of Object.keys(this.cooldowns) as AttackKey[])
      this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    p.inv = Math.max(0, p.inv - dt);
    p.counter = Math.max(0, p.counter - dt);
    p.comboTimer -= dt;
    if (p.comboTimer <= 0 && !p.action) p.combo = 0;
    const pending = this.buffer;
    if (pending && this.available(pending.key) && this.canCancel(pending.key)) {
      this.begin(pending.key, input);
      this.buffer = null;
    } else if (!p.action && input.keys.has("j")) this.begin("j", input);
    p.moving = false;
    if (!p.action) {
      const len = Math.hypot(input.x, input.y) || 1;
      if (input.x) p.facing = Math.sign(input.x);
      p.x += (input.x / len) * 215 * dt;
      p.y += (input.y / len) * 160 * dt;
      p.moving = !!(input.x || input.y);
    } else this.actionStep(dt, input);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-12 * dt);
    p.vy *= Math.exp(-12 * dt);
    p.x = clamp(p.x, 55, 1040);
    p.y = clamp(p.y, 335, 555);
    if (p.moving) p.walk += dt * 11;
    for (const e of [...this.enemies]) {
      this.enemyStep(e, dt);
      if (run.finished) break;
    }
    if (!run.finished) {
      this.projectileStep(dt);
      this.firePatchStep(dt);
      this.hazardStep(dt);
      this.separate(dt);
    }
    this.effects.forEach((e) => (e.life -= dt));
    this.effects = this.effects.filter((e) => e.life > 0);
    if (run.finished) return;
    if (!this.enemies.length && !this.door) {
      if (run.room < 3 && this.wave < 2) {
        this.wave++;
        p.hp = Math.min(s.health, p.hp + s.health * 0.12);
        this.spawn();
        this.bridge.toast(
          `增援来袭 · ${run.dungeon === 0 ? tombWaveNames[run.room][this.wave] : `第 ${this.wave + 1} / 3 波`} · 恢复少量生命`,
        );
        return;
      }
      this.door = true;
      this.bridge.changed();
      if (run.room === 3) {
        run.finished = true;
        this.bridge.finish(true);
        return;
      }
      if (run.dungeon === 0 && this.boons.selected.length < 3) {
        this.boons.draw(this.bridge.save, p.hp);
        this.bridge.blessing?.();
        return;
      }
      this.bridge.toast("房间已清理 · 前往右侧传送门，或按 Enter 继续");
    }
    if (this.door && (p.x > 995 || input.enter)) {
      run.room++;
      this.wave = 0;
      p.x = 140;
      p.hp = Math.min(s.health, p.hp + s.health * 0.25);
      this.spawn();
    }
  }
  available(key: AttackKey) {
    return (
      this.cooldowns[key] <= 0 &&
      (key !== "l" || this.bridge.save.level >= 3) &&
      (key !== "u" || this.bridge.save.level >= 5)
    );
  }
  begin(key: AttackKey, input: Input) {
    const p = this.player,
      s = stats(this.bridge.save);
    let kind: ActionKind;
    if (key === "j") {
      if (p.counter > 0) {
        kind = "counter";
        p.counter = 0;
        p.combo = 0;
      } else {
        p.combo = p.comboTimer > 0 ? (p.combo % 3) + 1 : 1;
        kind = p.combo === 1 ? "light1" : p.combo === 2 ? "light2" : "heavy";
      }
    } else {
      kind =
        key === "k"
          ? "charging"
          : key === "l"
            ? "spin"
            : key === "u"
              ? "rush"
              : "dodge";
      p.combo = 0;
    }
    if (input.x) p.facing = Math.sign(input.x);
    const speed = basic(kind) ? 1 / (1 + s.speed / 100) : 1;
    const original =
        kind === "charging" && this.boons.has("wind-mobility")
          ? { ...actions.charging, windup: 0.55 }
          : actions[kind],
      spec = {
        ...original,
        windup: original.windup * speed,
        active: original.active * speed,
        recovery: original.recovery * speed,
      };
    const length = Math.hypot(input.x, input.y) || 1;
    const vx =
        kind === "dodge"
          ? ((input.x || (!input.y ? p.facing : 0)) / length) * 590
          : kind === "rush"
            ? p.facing * 810
            : 0,
      vy = kind === "dodge" ? (input.y / length) * 405 : 0;
    p.action = {
      kind,
      time: 0,
      spec,
      facing: p.facing,
      hit: new Set(),
      fired: false,
      vx,
      vy,
      trail: 0,
    };
    p.comboTimer = 1.25;
    p.attack = 0;
    this.cooldowns[key] =
      original.cooldown *
      (key === "space" && this.boons.has("step-wind") ? 0.75 : 1) *
      (key === "j" || key === "space" ? 1 : 1 - s.cdr / 100);
    this.bridge.audio(
      kind === "dodge"
        ? "dash"
        : kind === "heavy" || kind === "rush"
          ? "swingHeavy"
          : "swing",
    );
  }
  actionStep(dt: number, input: Input) {
    const p = this.player,
      a = p.action!;
    if (a.kind === "charging") {
      const previous = a.time;
      a.time += dt;
      if (input.x) a.facing = p.facing = Math.sign(input.x);
      const length = Math.hypot(input.x, input.y) || 1;
      const pace = this.boons.has("wind-mobility") ? 1.85 : 1;
      p.x += (input.x / length) * 72 * pace * dt;
      p.y += (input.y / length) * 54 * pace * dt;
      p.moving = !!(input.x || input.y);
      if (previous < a.spec.windup && a.time >= a.spec.windup) {
        this.effect("perfect", p.x, p.y - 30, 0.4);
        this.bridge.audio("loot");
      }
      if (!input.keys.has("k")) {
        p.action = {
          ...a,
          kind: "wave",
          time: 0,
          charged: a.time >= a.spec.windup,
          spec: { ...actions.wave, windup: 0.1 },
          hit: new Set(),
        };
      }
      return;
    }
    const previous = a.time;
    a.time += dt;
    p.facing = a.facing;
    const start = a.spec.windup,
      end = start + a.spec.active,
      total = end + a.spec.recovery;
    const activeTime = Math.max(
      0,
      Math.min(a.time, end) - Math.max(previous, start),
    );
    if (a.kind === "dodge") {
      p.inv = Math.max(p.inv, a.time >= start && a.time <= end ? 0.07 : 0);
      p.x += a.vx * activeTime;
      p.y += a.vy * activeTime;
      p.moving = true;
    } else if (a.kind === "rush") {
      p.x += a.vx * activeTime;
      p.moving = activeTime > 0;
    } else if (basic(a.kind)) {
      const amount = a.kind === "heavy" ? 37 : 15;
      p.x += (a.facing * amount * activeTime) / a.spec.active;
    }
    if ((a.kind === "dodge" || a.kind === "rush") && activeTime > 0) {
      a.trail -= dt;
      if (a.trail <= 0) {
        a.trail = 0.045;
        this.effect("ghost", p.x, p.y, 0.2, a.facing);
      }
    }
    if (a.kind === "hurt") {
      p.attack = 0;
    } else if (a.time >= start && previous < end) {
      p.attack = 1;
      if (a.kind === "wave" && !a.fired) {
        a.fired = true;
        this.launchWave(a);
      } else if (a.kind !== "wave" && a.kind !== "dodge") {
        if (a.kind === "counter" && !a.fired) {
          a.fired = true;
          this.effect("perfect", p.x, p.y - 30, 0.35);
          if (stats(this.bridge.save).specials.includes("reprisal"))
            this.launchWave({ ...a, spec: { ...a.spec, damage: 1.3 } });
          if (this.boons.has("riposte-fan")) this.launchFan(a);
        }
        const pulse =
          a.kind === "spin"
            ? Math.min(4, Math.floor((a.time - start) / 0.096))
            : 0;
        if (!basic(a.kind) || a.time >= start + a.spec.active * 0.22)
          this.melee(a, pulse);
      }
    } else p.attack = 0;
    if (a.time >= total) {
      p.action = null;
      p.attack = 0;
      p.comboTimer = Math.max(p.comboTimer, 0.75);
    }
    if (!p.action && (input.x || input.y)) p.moving = true;
  }
  melee(a: Action, pulse: number) {
    const p = this.player,
      s = stats(this.bridge.save);
    for (const e of [...this.enemies]) {
      const token = e.id + ":" + pulse;
      if (a.hit.has(token)) continue;
      const dx = (e.x - p.x) * a.facing,
        dy = Math.abs(e.y - p.y),
        hit =
          a.kind === "spin"
            ? Math.hypot(e.x - p.x, (e.y - p.y) * 1.8) < a.spec.range
            : dx >= -14 && dx <= a.spec.range && dy < a.spec.depth;
      if (!hit) continue;
      a.hit.add(token);
      const crit = Math.random() * 100 < s.crit;
      let multiplier =
        a.spec.damage *
        (basic(a.kind) ? (s.counts[0] >= 2 ? 1.15 : 1) : 1 + s.skill / 100);
      if (a.kind === "heavy" && s.counts[0] >= 4) multiplier += 0.7;
      if (e.burn > 0 && s.counts[2] >= 4) multiplier *= 1.25;
      if (e.burn > 0 && a.kind === "counter" && this.boons.has("ember-hunt"))
        multiplier *= 1.3;
      const damage = Math.round(s.attack * multiplier * (crit ? 1.7 : 1));
      if (
        (!basic(a.kind) || a.kind === "counter") &&
        (s.counts[2] >= 2 ||
          s.specials.includes("wildfire") ||
          (a.kind === "counter" && this.boons.has("ember-seed")))
      )
        e.burn = 4;
      const push =
        a.kind === "heavy" || a.kind === "counter"
          ? 280
          : a.kind === "rush"
            ? 210
            : a.kind === "spin"
              ? -40
              : 40;
      this.damage(e, damage, crit, {
        stun:
          a.kind === "counter"
            ? 0.55
            : a.kind === "heavy"
              ? 0.38
              : a.kind === "spin"
                ? 0.15
                : 0.25,
        push: a.facing * push,
        heavy: a.kind === "heavy" || a.kind === "rush" || a.kind === "counter",
      });
      if (a.kind === "counter") this.counterTempo(a.hit);
      if (a.kind === "spin" && !e.boss && !e.armor) {
        e.vx = (p.x - e.x) * 2.5;
        e.vy = (p.y - e.y) * 2.5;
      }
    }
  }
  launchWave(a: Action) {
    const s = stats(this.bridge.save),
      count = s.counts[1] >= 4 ? 2 : 1;
    if (a.kind === "wave")
      this.cooldowns.k = actions.wave.cooldown * (1 - s.cdr / 100);
    const echo = a.charged && this.boons.has("wind-echo") ? 2 : 1;
    for (let layer = 0; layer < echo; layer++)
      for (let i = 0; i < count; i++)
        this.projectiles.push({
          id: ++this.serial,
          x: this.player.x + a.facing * (34 - i * 40),
          y: this.player.y,
          visualOffset: i * 9,
          oldX: this.player.x,
          oldY: this.player.y,
          vx: a.facing * 720,
          vy: 0,
          life: 0.95 + i * 0.06,
          kind: "wave",
          facing: a.facing,
          damage:
            s.attack *
            a.spec.damage *
            (1 + s.skill / 100) *
            (i ? 0.8 : 1) *
            (a.charged ? 1.7 : 1) *
            (layer ? 0.5 : 1),
          crit: s.crit,
          burn:
            s.counts[2] >= 2 ||
            s.specials.includes("wildfire") ||
            ((!!a.charged || a.kind === "counter") &&
              this.boons.has("ember-seed")),
          ember: s.counts[2] >= 4,
          hit: new Set(),
          charged: !!a.charged,
          returnAt:
            a.charged && s.specials.includes("returning") ? 0.6 : undefined,
          age: 0,
          delay: layer ? 0.22 : 0,
          counterHit: a.kind === "counter" ? a.hit : undefined,
        });
  }
  /** 反击祝福的侧向剑气独立生成，与武器附带的正面剑气同时生效。 */
  launchFan(a: Action) {
    const s = stats(this.bridge.save);
    for (const side of [-1, 1])
      this.projectiles.push({
        id: ++this.serial,
        x: this.player.x,
        y: this.player.y,
        oldX: this.player.x,
        oldY: this.player.y,
        vx: a.facing * 520,
        vy: side * 170,
        life: 0.65,
        kind: "wave",
        facing: a.facing,
        damage: s.attack,
        crit: s.crit,
        burn: this.boons.fireSource(this.bridge.save),
        ember: s.counts[2] >= 4,
        hit: new Set(),
        counterHit: a.hit,
      });
  }
  /** 同一次反击的斩击、武器剑气与侧向剑气共用一次冷却返还。 */
  counterTempo(hit: Set<string>) {
    if (!this.boons.has("riposte-tempo") || hit.has("tempo")) return;
    hit.add("tempo");
    for (const key of ["k", "l", "u"] as const)
      this.cooldowns[key] = Math.max(0, this.cooldowns[key] - 1.2);
  }
  damage(
    e: Enemy,
    raw: number,
    crit = false,
    options: {
      stun?: number;
      push?: number;
      heavy?: boolean;
      dot?: boolean;
    } = {},
  ) {
    if (e.hp <= 0 || !this.enemies.includes(e)) return;
    const damage = Math.max(
      1,
      Math.round(
        raw *
          (e.boss && e.state === "recover" && !e.followup ? 1.2 : 1) *
          ((e.boss || e.elite) &&
          e.state === "recover" &&
          !e.followup &&
          this.boons.has("opening")
            ? 1.2
            : 1),
      ),
    );
    e.hp -= damage;
    e.flash = 0.1;
    if (!options.dot) {
      this.hitstop = Math.max(this.hitstop, options.heavy ? 0.055 : 0.032);
      this.bridge.audio(options.heavy ? "heavyHit" : "hit");
      this.effect("impact", e.x, e.y - 34, 0.22);
      if (this.bridge.save.settings.shake)
        this.shake(options.heavy ? 70 : 40, options.heavy ? 0.0021 : 0.001);
    }
    if (!e.boss && !e.armor && !options.dot) {
      e.state = "hurt";
      e.stateTime = 0;
      e.hitstun = Math.max(e.hitstun, options.stun ?? 0.2);
      e.vx = options.push ?? 0;
      e.armor = false;
      e.followup = undefined;
      this.hazards = this.hazards.filter((h) => h.caster !== e || h.fired);
    }
    this.effects.push({
      x: e.x,
      y: e.y - 70,
      life: 0.65,
      max: 0.65,
      kind: "text",
      facing: 1,
      text: String(damage) + (crit ? "!" : ""),
      color: crit ? 0xffd182 : options.dot ? 0xeaa06a : 0xe5e6d4,
    });
    if (e.hp <= 0) {
      this.enemies.splice(this.enemies.indexOf(e), 1);
      this.hazards = this.hazards.filter((h) => h.caster !== e || h.fired);
      this.effect("death", e.x, e.y, 0.55);
      this.bridge.reward(e);
      if (e.burn > 0 && this.boons.has("ember-field")) {
        if (this.firePatches.length >= 6) this.firePatches.shift();
        this.firePatches.push({
          x: e.x,
          y: e.y,
          life: 2.5,
          tick: 0.5,
          damage: stats(this.bridge.save).attack * 0.225,
        });
      }
      if (e.burn > 0 && stats(this.bridge.save).specials.includes("wildfire")) {
        this.effect("blast", e.x, e.y, 0.4);
        for (const nearby of [...this.enemies]) {
          if (Math.hypot(nearby.x - e.x, (nearby.y - e.y) * 1.8) >= 130)
            continue;
          nearby.burn = 4;
          this.damage(nearby, stats(this.bridge.save).attack * 0.65, false, {
            dot: true,
          });
        }
      }
    }
  }
  hurt(raw: number, sourceX = this.player.x - 1, allowPrecision = true) {
    const p = this.player;
    if (this.bridge.run?.finished) return;
    if (p.inv > 0) {
      const a = p.action;
      if (
        allowPrecision &&
        a?.kind === "dodge" &&
        this.phase(a) === "active" &&
        a.time <= (this.boons.has("riposte-guard") ? 0.23 : 0.17) &&
        !a.hit.has("perfect")
      ) {
        a.hit.add("perfect");
        p.counter = this.boons.has("riposte-guard") ? 2.8 : 1.8;
        this.effect("perfect", p.x, p.y - 30, 0.45);
        this.effects.push({
          x: p.x,
          y: p.y - 85,
          kind: "text",
          text: "精准闪避 · J反击",
          color: 0xafe8d6,
          life: 0.9,
          max: 0.9,
          facing: 1,
        });
        this.bridge.audio("loot");
      }
      return;
    }
    const damage = Math.max(
      2,
      Math.round((raw * 100) / (100 + stats(this.bridge.save).defense)),
    );
    p.hp = Math.max(0, p.hp - damage);
    p.inv = 0.65;
    p.vx = (p.x >= sourceX ? 1 : -1) * 135;
    p.action = {
      kind: "hurt",
      time: 0,
      spec: { ...actions.hurt },
      facing: p.facing,
      hit: new Set(),
      fired: false,
      vx: 0,
      vy: 0,
      trail: 0,
    };
    p.combo = 0;
    p.counter = 0;
    this.buffer = null;
    this.effects.push({
      x: p.x,
      y: p.y - 75,
      life: 0.7,
      max: 0.7,
      kind: "text",
      facing: 1,
      text: "−" + damage,
      color: 0xef8a7d,
    });
    this.effect("impact", p.x, p.y - 35, 0.2);
    this.bridge.audio("hurt");
    if (this.bridge.save.settings.shake) this.shake(80, 0.0025);
    if (p.hp <= 0) {
      this.bridge.run!.finished = true;
      this.bridge.finish(false);
    }
  }
  enemyStep(e: Enemy, dt: number) {
    if (e.hp <= 0) return;
    const p = this.player;
    e.flash = Math.max(0, e.flash - dt);
    e.cool -= dt;
    e.burn = Math.max(0, e.burn - dt);
    e.burnTick -= dt;
    e.moving = false;
    if (e.burn > 0 && e.burnTick <= 0) {
      e.burnTick = 1;
      this.damage(e, stats(this.bridge.save).attack * 0.35, false, {
        dot: true,
      });
      if (e.hp <= 0) return;
    }
    e.x = clamp(e.x + e.vx * dt, 55, 1040);
    e.y = clamp(e.y + e.vy * dt, 335, 555);
    e.vx *= Math.exp(-9 * dt);
    e.vy *= Math.exp(-9 * dt);
    if (e.hitstun > 0) {
      e.hitstun = Math.max(0, e.hitstun - dt);
      e.state = "hurt";
      if (e.hitstun <= 0) {
        e.state = "idle";
        e.cool = Math.max(e.cool, 0.22);
      }
      return;
    }
    e.stateTime += dt;
    if (e.state === "windup") {
      if (e.stateTime >= e.windup) {
        e.state = "active";
        e.stateTime = 0;
        e.pulse = -1;
        this.executeEnemy(e);
      }
      return;
    }
    if (e.state === "active") {
      this.enemyActive(e, dt);
      if (e.stateTime >= e.active) {
        e.state = "recover";
        e.stateTime = 0;
        e.armor = !!e.followup;
      }
      return;
    }
    if (e.state === "recover") {
      if (e.stateTime >= e.recovery) {
        if (e.followup) {
          const next = e.followup;
          this.prepareEnemy(e, next);
          return;
        }
        e.state = "idle";
        e.stateTime = 0;
        e.cool = e.kind % 2 === 1 && !e.boss ? 0.8 : 0.35;
      }
      return;
    }
    const dx = p.x - e.x,
      dy = p.y - e.y,
      dist = Math.hypot(dx, dy),
      ranged = e.kind % 2 === 1 && !e.boss;
    e.facing = dx >= 0 ? 1 : -1;
    const pace = e.boss ? 72 : e.kind === 2 ? 110 : 78;
    if (ranged) {
      if (dist < 190) {
        e.x -= (dx / (dist || 1)) * 65 * dt;
        e.y -= (dy / (dist || 1)) * 45 * dt;
        e.moving = true;
      } else if (dist > 330) {
        e.x += (dx / (dist || 1)) * pace * dt;
        e.y += (dy / (dist || 1)) * pace * 0.7 * dt;
        e.moving = true;
      }
    } else if (dist > (e.boss ? 155 : 90) || Math.abs(dy) > 38) {
      e.x += (dx / (dist || 1)) * pace * dt;
      e.y += (dy / (dist || 1)) * pace * 0.8 * dt;
      e.moving = true;
    }
    e.x = clamp(e.x, 55, 1040);
    e.y = clamp(e.y, 335, 555);
    if (e.moving) e.walk += dt * 9;
    if (e.cool > 0) return;
    if (e.boss) {
      if (dist < 190 || e.phase % 3 === 2 || e.kind === 2)
        this.prepareEnemy(
          e,
          e.kind === 2
            ? e.phase % 2
              ? "poison"
              : "burrow"
            : dist > 260
              ? "charge"
              : (["combo", "heavy", "charge"] as EnemyMove[])[e.phase % 3],
        );
    } else if (ranged && dist < 550)
      this.prepareEnemy(e, e.kind === 3 ? "explode" : "arrow");
    else if (dist < 120 && Math.abs(dy) < 44)
      this.prepareEnemy(
        e,
        e.elite && (runIsTomb(this.bridge) ? e.phase % 2 === 1 : true)
          ? "heavy"
          : "slash",
      );
  }
  prepareEnemy(e: Enemy, move: EnemyMove) {
    e.move = move;
    e.state = "windup";
    e.stateTime = 0;
    e.pulse = -1;
    e.aimX = this.player.x;
    e.aimY = this.player.y;
    e.facing = e.aimX >= e.x ? 1 : -1;
    e.phase++;
    e.followup = undefined;
    if (
      runIsTomb(this.bridge) &&
      ((e.boss && e.hp < e.max * 0.5 && move === "combo") ||
        (e.elite && move === "slash"))
    )
      e.followup = e.boss ? "charge" : "heavy";
    e.armor = e.boss || (e.elite && move === "heavy");
    e.windup =
      move === "arrow"
        ? 0.7
        : move === "charge"
          ? 0.86
          : move === "heavy"
            ? 0.88
            : move === "combo"
              ? 0.65
              : move === "slash"
                ? 0.43
                : 0.85;
    e.active =
      move === "charge"
        ? 0.53
        : move === "combo"
          ? 0.72
          : move === "arrow"
            ? 0.12
            : 0.18;
    if (e.kind === 1 && !e.boss && move === "arrow" && e.phase % 2 === 0)
      e.active = 0.34;
    e.recovery = e.boss
      ? move === "heavy"
        ? 1.18
        : move === "charge"
          ? 1.05
          : 0.85
      : move === "arrow"
        ? 0.55
        : 0.48;
    if (e.boss && e.hp < e.max * 0.5) {
      e.windup *= 0.85;
      e.recovery *= 0.86;
    }
    if (e.followup) e.recovery = 0.28;
    else if (runIsTomb(this.bridge) && (e.boss || e.elite))
      e.recovery =
        move === "charge" ? 1.45 : move === "heavy" ? 1.35 : e.recovery;
    if (move === "charge") {
      e.aimX = clamp(e.x + e.facing * 820 * e.active, 55, 1040);
      e.aimY = e.y;
    }
    if (move === "burrow" || move === "poison" || move === "explode")
      this.hazards.push({
        x: e.aimX,
        y: e.aimY,
        r: move === "poison" ? 120 : 90,
        w: 0,
        timer: e.windup,
        duration: e.windup,
        damage: this.enemyDamage(e),
        type: "circle",
        fired: false,
        linger: move === "poison" ? 3 : 0,
        caster: e,
      });
  }
  enemyDamage(e: Enemy) {
    const run = this.bridge.run!;
    return (e.boss ? 28 : 9) * (1 + run.dungeon * 1.1) * (run.hard ? 1.5 : 1);
  }
  executeEnemy(e: Enemy) {
    if (e.move === "arrow") {
      const dx = e.aimX - e.x,
        dy = e.aimY - e.y,
        len = Math.hypot(dx, dy) || 1;
      this.projectiles.push({
        id: ++this.serial,
        x: e.x + e.facing * 25,
        y: e.y,
        oldX: e.x,
        oldY: e.y,
        vx: (dx / len) * 420,
        vy: (dy / len) * 420,
        life: 2.1,
        kind: e.kind === 1 ? "arrow" : "orb",
        facing: e.facing,
        damage: this.enemyDamage(e),
        crit: 0,
        burn: false,
        ember: false,
        hit: new Set(),
      });
    }
    if (e.move === "burrow") {
      e.x = clamp(e.aimX + 65, 55, 1040);
      e.y = e.aimY;
      this.effect("blast", e.x, e.y, 0.3);
    }
    if (e.move === "explode") {
      e.hp = 0;
      this.enemies.splice(this.enemies.indexOf(e), 1);
      this.bridge.reward(e);
      this.effect("death", e.x, e.y, 0.4);
    }
  }
  enemyActive(e: Enemy, dt: number) {
    const p = this.player,
      dx = (p.x - e.x) * e.facing,
      dy = Math.abs(p.y - e.y);
    let pulse = 0;
    if (e.move === "charge") {
      const previousX = e.x;
      e.x =
        e.facing > 0
          ? Math.min(e.aimX, e.x + 820 * dt)
          : Math.max(e.aimX, e.x - 820 * dt);
      if (
        p.x > Math.min(previousX, e.x) - 68 &&
        p.x < Math.max(previousX, e.x) + 68 &&
        dy < 32
      )
        this.hurt(this.enemyDamage(e), e.x);
      if (Math.floor(e.stateTime * 25) !== Math.floor((e.stateTime - dt) * 25))
        this.effect("dust", e.x, e.y, 0.3);
      return;
    }
    if (
      e.move === "arrow" &&
      e.active > 0.3 &&
      e.stateTime >= 0.2 &&
      e.pulse < 1
    ) {
      e.pulse = 1;
      this.executeEnemy(e);
    }
    if (!["slash", "heavy", "combo"].includes(e.move)) return;
    if (e.move === "combo") pulse = Math.min(2, Math.floor(e.stateTime / 0.24));
    if (
      e.pulse === pulse ||
      e.stateTime - (e.move === "combo" ? pulse * 0.24 : 0) < 0.065
    )
      return;
    e.pulse = pulse;
    this.effect("enemy", e.x, e.y, 0.18, e.facing);
    const area = enemyArea(e);
    if (
      p.x > area.x &&
      p.x < area.x + area.w &&
      p.y > area.y &&
      p.y < area.y + area.h
    )
      this.hurt(
        this.enemyDamage(e) *
          (e.move === "heavy" ? 1.4 : e.move === "combo" ? 0.7 : 1),
        e.x,
      );
  }
  projectileStep(dt: number) {
    for (const shot of this.projectiles) {
      if ((shot.delay ?? 0) > 0) {
        shot.delay = Math.max(0, shot.delay! - dt);
        continue;
      }
      shot.oldX = shot.x;
      shot.oldY = shot.y;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      shot.age = (shot.age ?? 0) + dt;
      if (
        shot.returnAt !== undefined &&
        !shot.returning &&
        (shot.age >= shot.returnAt || shot.x >= 1040 || shot.x <= 55)
      ) {
        shot.returning = true;
        shot.vx *= -1;
        shot.facing *= -1;
        shot.damage *= 0.6;
        shot.life = 1.05;
        shot.hit.clear();
        shot.oldX = shot.x;
        shot.oldY = shot.y;
      }
      if (shot.kind === "wave") {
        for (const e of [...this.enemies]) {
          if (
            shot.hit.has(e.id) ||
            !this.swept(
              shot,
              e.x,
              e.y,
              shot.charged ? 40 : 28,
              shot.charged ? 60 : 38,
            )
          )
            continue;
          shot.hit.add(e.id);
          const wasBurning = e.burn > 0;
          if (shot.burn) e.burn = 4;
          const crit = Math.random() * 100 < shot.crit;
          this.damage(
            e,
            shot.damage *
              (crit ? 1.7 : 1) *
              (shot.ember && wasBurning ? 1.25 : 1) *
              ((shot.charged || shot.counterHit) &&
              wasBurning &&
              this.boons.has("ember-hunt")
                ? 1.3
                : 1) *
              (shot.charged && e.boss && e.state === "recover" && !e.followup
                ? 1.25
                : 1),
            crit,
            {
              stun: shot.charged ? 0.5 : 0.34,
              push: shot.facing * (shot.charged ? 240 : 100),
              heavy: !!shot.charged,
            },
          );
          if (shot.counterHit) this.counterTempo(shot.counterHit);
          if (shot.charged && !shot.burst && this.boons.has("wind-burst")) {
            shot.burst = true;
            this.effect("blast", e.x, e.y, 0.35);
            for (const nearby of [...this.enemies])
              if (Math.hypot(nearby.x - e.x, (nearby.y - e.y) * 1.8) < 100)
                this.damage(
                  nearby,
                  stats(this.bridge.save).attack * 0.7,
                  false,
                  { stun: 0.15, push: shot.facing * 70 },
                );
          }
        }
      } else if (this.swept(shot, this.player.x, this.player.y, 20, 17)) {
        this.hurt(shot.damage, shot.oldX);
        shot.life = 0;
        this.effect("spark", shot.x, shot.y - 30, 0.16);
      }
    }
    this.projectiles = this.projectiles.filter(
      (s) => s.life > 0 && s.x > -100 && s.x < 1200 && s.y > 280 && s.y < 610,
    );
  }
  swept(shot: Projectile, x: number, y: number, rx: number, ry: number) {
    const dx = shot.x - shot.oldX,
      dy = shot.y - shot.oldY,
      len = dx * dx + dy * dy;
    const t = len
      ? clamp(((x - shot.oldX) * dx + (y - shot.oldY) * dy) / len, 0, 1)
      : 0;
    return (
      Math.abs(x - shot.oldX - dx * t) < rx &&
      Math.abs(y - shot.oldY - dy * t) < ry
    );
  }
  /** 友方余烬火区只伤害敌人，暂停时由战斗主循环一并冻结。 */
  firePatchStep(dt: number) {
    for (const patch of [...this.firePatches]) {
      if (!this.firePatches.includes(patch)) continue;
      patch.life -= dt;
      patch.tick -= dt;
      if (patch.life < 0 || patch.tick > 0) continue;
      patch.tick += 0.5;
      for (const e of [...this.enemies])
        if (Math.hypot(e.x - patch.x, (e.y - patch.y) * 1.8) < 110)
          this.damage(e, patch.damage, false, { dot: true });
    }
    this.firePatches = this.firePatches.filter((patch) => patch.life > 0);
  }

  /** 清除本局祝福；结算、撤离与重新开局均不会写回永久属性。 */
  clearBlessings() {
    this.boons.reset();
    this.firePatches = [];
  }

  chooseBlessing(id: BlessingId) {
    if (!this.boons.choose(id)) return false;
    this.previous.clear();
    this.buffer = null;
    this.player.action = null;
    this.player.attack = 0;
    if (id === "step-wind") this.cooldowns.space *= 0.75;
    if (id === "vital-spark") {
      const maximum = stats(this.bridge.save).health;
      this.player.hp = Math.min(maximum, this.player.hp + maximum * 0.25);
    }
    this.bridge.audio("loot");
    this.bridge.changed();
    return true;
  }
  hazardStep(dt: number) {
    for (const h of this.hazards) {
      h.timer -= dt;
      if (h.timer <= 0 && !h.fired) {
        h.fired = true;
        if (Math.hypot(this.player.x - h.x, (this.player.y - h.y) * 1.8) < h.r)
          this.hurt(h.damage, h.x);
        this.effect("blast", h.x, h.y, 0.35);
      }
      if (h.fired && h.linger > 0) {
        h.linger -= dt;
        if (Math.hypot(this.player.x - h.x, (this.player.y - h.y) * 1.8) < h.r)
          this.hurt(h.damage * 0.25, h.x, false);
      }
    }
    this.hazards = this.hazards.filter(
      (h) => !h.fired || h.linger > 0 || h.timer > -0.3,
    );
  }
  separate(dt: number) {
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j],
          dx = a.x - b.x,
          dy = (a.y - b.y) * 1.5,
          len = Math.hypot(dx, dy);
        if (len > 0 && len < 30) {
          const push = (30 - len) * dt * 2;
          if (a.state === "idle") {
            a.x += (dx / len) * push;
            a.y += (dy / len) * push * 0.6;
          }
          if (b.state === "idle") {
            b.x -= (dx / len) * push;
            b.y -= (dy / len) * push * 0.6;
          }
        }
      }
    }
  }
  effect(
    kind: string,
    x: number,
    y: number,
    life: number,
    facing = this.player.facing,
  ) {
    this.effects.push({ kind, x, y, life, max: life, facing });
  }
  snapshot() {
    const p = this.player,
      a = p.action;
    return {
      mode: this.bridge.mode,
      paused: this.bridge.paused,
      coordinates: "1100×610，原点左上，x向右，y向下；战斗地面 y=335..555",
      player: {
        ...p,
        action: a
          ? {
              kind: a.kind,
              phase: this.phase(),
              time: +a.time.toFixed(3),
              windup: a.spec.windup,
              active: a.spec.active,
              recovery: a.spec.recovery,
              facing: a.facing,
              canDodge: this.canCancel("space"),
              canSkill: this.canCancel("k"),
            }
          : null,
      },
      level: this.bridge.save.level,
      wave: this.wave + 1,
      encounter:
        this.bridge.run?.dungeon === 0 && this.bridge.run.room < 3
          ? tombWaveNames[this.bridge.run.room][this.wave]
          : null,
      specials: stats(this.bridge.save).specials,
      blessings: [...this.boons.selected],
      blessingOffers: [...this.boons.offers],
      rerolls: this.boons.rerolls,
      firePatches: this.firePatches.map((patch) => ({ ...patch })),
      effects: this.effects
        .filter((e) => e.kind === "perfect" || e.kind === "blast")
        .map((e) => ({ kind: e.kind, x: e.x, y: e.y })),
      cooldowns: this.cooldowns,
      buffer: this.buffer,
      hitstop: this.hitstop,
      enemies: this.enemies.map((e) => ({
        id: e.id,
        name: e.name,
        x: Math.round(e.x),
        y: Math.round(e.y),
        hp: Math.round(e.hp),
        max: e.max,
        boss: e.boss,
        state: e.state,
        move: e.move,
        stateTime: +e.stateTime.toFixed(3),
        windup: e.windup,
        active: e.active,
        recovery: e.recovery,
        armor: e.armor,
        hitstun: e.hitstun,
        burn: e.burn,
        facing: e.facing,
        elite: e.elite,
        followup: e.followup,
        warning:
          e.state === "windup" &&
          ["slash", "heavy", "combo", "charge"].includes(e.move)
            ? enemyArea(e)
            : undefined,
      })),
      projectiles: this.projectiles.map(({ hit, counterHit, ...s }) => s),
      hazards: this.hazards.map(({ caster, ...h }) => h),
      door: this.door,
      run: this.bridge.run,
      bag: this.bridge.save.bag.length,
      gold: this.bridge.save.gold,
    };
  }
}
