import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

// 使用真实存档、键盘与房间清理触发祝福，不直接修改局内状态。
fs.mkdirSync("checks/artifacts/roguelite", { recursive: true });
const browser = await chromium.launch({
  channel: process.env.GAME_BROWSER || "msedge",
  headless: true,
});
const page = await browser.newPage({
  viewport:
    process.env.GAME_VIEWPORT === "large"
      ? { width: 1920, height: 1080 }
      : { width: 1366, height: 768 },
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(process.env.GAME_URL || "http://127.0.0.1:4173");
await page.waitForFunction(() => window.render_game_to_text);
const read = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
const stored = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("ashen-frontier-v1")));
const keys = ["a", "d", "w", "s", "j", "k", "l", "u", "Space", "Enter"];
const item = (slot, extra = {}) => ({
  id: slot,
  name: "试玩装备",
  slot,
  level: 1,
  quality: 2,
  base: slot === "weapon" ? 120 : 0,
  affixes: [],
  locked: false,
  ...extra,
});
const fixture = {
  version: 1,
  level: 5,
  xp: 0,
  gold: 1000,
  bag: [],
  equipped: { weapon: item("weapon") },
  cleared: [0, 1, 2],
  pity: 0,
  settings: { sound: false, shake: false },
  kills: 0,
  runs: 0,
};
let passed = 0;
async function check(condition, message) {
  if (!condition) {
    console.log("FAILED", JSON.stringify(await read()));
    await page.screenshot({
      path: "checks/artifacts/roguelite/failure.png",
      fullPage: true,
    });
  }
  assert.ok(condition, message);
  console.log("PASS", message);
  passed++;
}
async function release() {
  for (const key of keys) await page.keyboard.up(key);
}
async function random(value) {
  await page.evaluate((value) => {
    // 保留足够随机性供画布纹理生成唯一编号，同时让候选抽取落入指定区间。
    window.originalGameRandom ??= Math.random;
    const lower = Math.max(0, Math.min(0.84, value - 0.08));
    Math.random = () => lower + window.originalGameRandom() * 0.16;
  }, value);
}
async function fresh(save = fixture, hard = false) {
  await release();
  await page.evaluate((save) => {
    localStorage.setItem("ashen-frontier-v1", JSON.stringify(save));
    localStorage.removeItem("ashen-frontier-v1-backup");
  }, save);
  await page.reload();
  await page.waitForFunction(() => window.setManualTime);
  await page.evaluate(() => window.setManualTime(true));
  await page.click("#start-btn");
  if (hard) await page.click('[data-difficulty="hard"]');
  await page.click("#enter-dungeon");
}
let sawFire = false,
  sawBurst = false;
async function playToGate() {
  for (let tick = 0; tick < 2200; tick++) {
    const s = await read();
    sawFire ||= s.firePatches.length > 0;
    sawBurst ||= s.effects.some((effect) => effect.kind === "blast");
    if (s.blessingOffers.length || s.mode === "result") {
      await release();
      return s;
    }
    if (s.paused) {
      await page.keyboard.press("Escape");
      continue;
    }
    if (s.door) {
      await page.keyboard.down("Enter");
      await step(17);
      await page.keyboard.up("Enter");
      continue;
    }
    const enemy = [...s.enemies].sort(
      (a, b) =>
        Math.hypot(a.x - s.player.x, a.y - s.player.y) -
        Math.hypot(b.x - s.player.x, b.y - s.player.y),
    )[0];
    if (!enemy) {
      await step(50);
      continue;
    }
    const dx = enemy.x - s.player.x,
      dy = enemy.y - s.player.y;
    let skill = null;
    const charging = s.player.action?.kind === "charging";
    const holdCharge =
      charging && s.player.action.time < s.player.action.windup;
    if (!charging && (!s.player.action || s.player.action.canSkill)) {
      if (s.cooldowns.k === 0 && Math.abs(dy) < 45 && Math.abs(dx) < 650)
        skill = "k";
      else if (s.cooldowns.l === 0 && Math.hypot(dx, dy * 1.8) < 150)
        skill = "l";
      else if (
        s.cooldowns.u === 0 &&
        Math.abs(dy) < 35 &&
        Math.abs(dx) > 150 &&
        Math.abs(dx) < 300
      )
        skill = "u";
    }
    for (const [key, on] of [
      ["a", dx < -85],
      ["d", dx > 85],
      ["w", dy < -12],
      ["s", dy > 12],
      ["j", !skill && !charging && Math.abs(dx) < 125 && Math.abs(dy) < 40],
      ["k", holdCharge || skill === "k"],
      ["l", skill === "l"],
      ["u", skill === "u"],
    ])
      if (on) await page.keyboard.down(key);
      else await page.keyboard.up(key);
    await step(100);
  }
  throw Error("未抵达房间选择或结算");
}
async function choose(id) {
  const state = await read();
  assert.ok(state.blessingOffers.includes(id), "目标祝福应在真实候选中：" + id);
  await page.click(`[data-boon="${id}"]`);
}
async function enterNextRoom() {
  const room = (await read()).run.room;
  await page.keyboard.down("Enter");
  for (let i = 0; i < 10 && (await read()).run.room === room; i++)
    await step(50);
  await page.keyboard.up("Enter");
  await check((await read()).run.room > room, "选择完成后进入下一个房间");
}
async function seekPrecision(boss = false) {
  for (let i = 0; i < 900; i++) {
    const s = await read();
    const target = [...s.enemies]
      .filter((e) => (boss ? e.boss : e.name === "骷髅兵"))
      .sort(
        (a, b) =>
          Math.hypot(a.x - s.player.x, a.y - s.player.y) -
          Math.hypot(b.x - s.player.x, b.y - s.player.y),
      )[0];
    const dx = target.x - s.player.x,
      dy = target.y - s.player.y;
    if (
      target.state === "windup" &&
      target.move === (boss ? "heavy" : "slash") &&
      target.windup - target.stateTime < 0.07 &&
      target.windup - target.stateTime > 0.015 &&
      Math.abs(dx) < 100 &&
      Math.abs(dy) < 25 &&
      !s.player.action &&
      s.player.inv === 0 &&
      s.cooldowns.space === 0
    ) {
      const direction = dx > 0 ? "d" : "a";
      await page.keyboard.down(direction);
      await page.keyboard.down("Space");
      await step(160);
      await release();
      if ((await read()).player.counter > 0) return;
    } else {
      for (const [key, held] of [
        ["a", dx < -85],
        ["d", dx > 85],
        ["w", dy < -8],
        ["s", dy > 8],
      ])
        if (held) await page.keyboard.down(key);
        else await page.keyboard.up(key);
      await step(17);
    }
  }
  throw Error("未能触发精准闪避");
}
async function counter() {
  const s = await read();
  const target = [...s.enemies].sort(
    (a, b) => Math.abs(a.x - s.player.x) - Math.abs(b.x - s.player.x),
  )[0];
  const direction = target.x > s.player.x ? "d" : "a";
  await page.keyboard.down(direction);
  await page.keyboard.down("j");
  await step(140);
  await release();
}

await fresh();
await random(0);
let state = await playToGate();
await check(
  state.run.room === 0 &&
    state.wave === 3 &&
    state.blessingOffers.length === 3 &&
    state.paused,
  "完整清完三波后才出现第一次三选一",
);
await check(
  state.blessingOffers.includes("ember-seed") &&
    !state.blessingOffers.includes("ember-field"),
  "未有点燃来源时只提供可用的灼烧入口",
);
await page.screenshot({
  path: "checks/artifacts/roguelite/first-choice.png",
  fullPage: true,
});
const time = state.run.time;
await step(3000);
await page.keyboard.press("Escape");
await page.keyboard.down("Enter");
await step(1000);
await page.keyboard.up("Enter");
state = await read();
await check(
  state.run.time === time &&
    state.run.room === 0 &&
    state.blessingOffers.length === 3,
  "选择期间计时冻结，Esc和Enter不能跳过",
);
const original = [...state.blessingOffers];
await page.keyboard.press("r");
state = await read();
await check(
  state.rerolls === 0 &&
    state.blessingOffers.every((id) => !original.includes(id)),
  "一次免费刷新替换整组三个选项",
);
const refreshed = [...state.blessingOffers];
await page.keyboard.press("r");
await check(
  JSON.stringify((await read()).blessingOffers) === JSON.stringify(refreshed),
  "刷新次数用完后不能再次刷新",
);
await choose(refreshed[0]);
await page.keyboard.press("1");
await check((await read()).blessings.length === 1, "选择仅发放一次且解除暂停");
await check(
  !(await stored()).blessings && !(await stored()).rerolls,
  "祝福与刷新次数没有写入永久存档",
);
await page.keyboard.down("Enter");
for (let i = 0; i < 10 && (await read()).run.room === 0; i++) await step(50);
await page.keyboard.up("Enter");
await check((await read()).run.room === 1, "选择后传送门恢复可用");
const permanentGold = (await stored()).gold;
for (let i = 0; i < 240 && (await read()).mode === "battle"; i++)
  await step(500);
state = await read();
await check(
  state.mode === "result" &&
    state.blessings.length === 0 &&
    (await stored()).gold >= permanentGold,
  "死亡清除祝福并保留已保存奖励",
);
await page.click('[data-action="retry"]');
await check(
  (await read()).blessings.length === 0 && (await read()).rerolls === 1,
  "重试重置祝福与整局刷新次数",
);

const durable = {
  ...fixture,
  equipped: {
    ...fixture.equipped,
    chest: item("chest", { affixes: [{ stat: "health", value: 10000 }] }),
  },
};
await fresh(durable);
await random(0);
await playToGate();
await choose("ember-seed");
await random(0.73);
state = await playToGate();
await check(
  state.blessingOffers.includes("ember-field") &&
    !state.blessingOffers.includes("ember-seed"),
  "点燃祝福开启后续灼烧能力，已选能力不重复",
);
await choose("ember-field");
await page.click('[data-action="blessing-info"]');
await check(
  (await page.locator('[role="dialog"]').innerText()).includes("余烬之地"),
  "战斗中可查看本局能力的完整效果",
);
await page.click('[data-action="close"]');
await random(0.73);
state = await playToGate();
await check(sawFire, "灼烧敌人死亡后生成只伤害敌人的余烬火区");
await choose(
  state.blessingOffers.includes("ember-hunt")
    ? "ember-hunt"
    : state.blessingOffers[0],
);
await page.screenshot({
  path: "checks/artifacts/roguelite/fire-build.png",
  fullPage: true,
});
await playToGate();
state = await read();
await check(
  state.mode === "result" &&
    state.enemies.length === 0 &&
    state.blessings.length === 0,
  "三次选择后的灼烧流派可击败Boss，结算清除祝福",
);

const wind = {
  ...durable,
  equipped: {
    weapon: item("weapon"),
    head: item("head", { set: 1 }),
    chest: item("chest", {
      set: 1,
      affixes: [{ stat: "health", value: 10000 }],
    }),
    legs: item("legs", { set: 1 }),
    ring: item("ring", { set: 1 }),
    charm: item("charm", { special: "returning", name: "回风坠饰" }),
  },
};
await fresh(wind, true);
await random(0.999);
await playToGate();
await choose("wind-mobility");
await step((await read()).cooldowns.k * 1000 + 250);
await page.keyboard.down("k");
await step(575);
state = await read();
await check(
  state.player.action?.kind === "charging" &&
    state.player.action.windup === 0.55,
  "轻身凝风实际缩短满蓄时间",
);
await page.keyboard.up("k");
await step(200);
await check(
  (await read()).projectiles.some((shot) => shot.charged),
  "缩短后的蓄力时长能正常产生满蓄剑气",
);
await random(0.3);
state = await playToGate();
await choose("wind-echo");
await step((await read()).cooldowns.k * 1000 + 250);
await page.keyboard.down("k");
await step(575);
await page.keyboard.up("k");
await step(160);
state = await read();
await check(
  state.projectiles.filter((shot) => shot.kind === "wave").length === 4 &&
    state.projectiles.some((shot) => shot.delay > 0),
  "风之残响与永久风行四件叠加为双剑气加延迟剑影",
);
await step(850);
await check(
  (await read()).projectiles.filter((shot) => shot.returning).length === 4,
  "延迟剑影继承回风坠饰折返",
);
await page.screenshot({
  path: "checks/artifacts/roguelite/echo-wind.png",
  fullPage: true,
});
await random(0.5);
state = await playToGate();
await choose("wind-burst");
sawBurst = false;
await playToGate();
state = await read();
await check(
  state.mode === "result" && state.enemies.length === 0 && sawBurst,
  "蓄力震荡组合在困难Boss战实际触发并可通关",
);

await fresh({
  ...durable,
  equipped: {
    ...durable.equipped,
    weapon: item("weapon", { special: "reprisal", name: "曙光回击" }),
  },
});
await random(0);
await playToGate();
await choose("riposte-fan");
await enterNextRoom();
await seekPrecision();
await step(250);
await counter();
await check(
  (await read()).projectiles.filter((shot) => shot.kind === "wave").length ===
    3,
  "回身断浪的侧向剑气与曙光回击的正面剑气同时生效",
);
await random(0);
await playToGate();
await choose("riposte-guard");
await enterNextRoom();
await seekPrecision();
await check((await read()).player.counter > 2.5, "从容一瞬实际延长反击机会");
await step(250);
await counter();
await random(0);
await playToGate();
await choose("riposte-tempo");
await enterNextRoom();
state = await read();
await step(Math.max(state.cooldowns.k, state.cooldowns.l, state.cooldowns.u) * 1000 + 300);
await seekPrecision(true);
await step(250);
await page.keyboard.down("l");
await step(1050);
await page.keyboard.up("l");
const beforeCounter = (await read()).cooldowns.l;
await check(beforeCounter > 0, "反击返还验证前，旋刃已实际进入冷却");
await counter();
await check(
  beforeCounter - (await read()).cooldowns.l > 1.1,
  "余势回流在反击命中Boss后实际削减技能冷却",
);

await fresh(durable);
await random(0);
await playToGate();
await choose("riposte-fan");
const savedGold = (await stored()).gold;
await page.reload();
await page.waitForFunction(() => window.render_game_to_text);
state = await read();
await check(
  state.mode === "camp" &&
    state.blessings.length === 0 &&
    (await stored()).gold === savedGold,
  "副本内刷新回营地，局内能力清空而永久奖励保留",
);
await check(errors.length === 0, "轻肉鸽整局流程无浏览器异常");
console.log("TOTAL", passed, "ERRORS", errors);
await browser.close();
