import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

// 通过真实页面、存档和键盘验证新版操作与装备组合。
fs.mkdirSync("checks/artifacts/content", { recursive: true });
const browser = await chromium.launch({
  channel: process.env.GAME_BROWSER || "msedge",
  headless: true,
});
const page = await browser.newPage({ viewport: process.env.GAME_VIEWPORT === "large" ? { width: 1920, height: 1080 } : { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const url = process.env.GAME_URL || "http://127.0.0.1:4173";
await page.goto(url);
await page.waitForFunction(() => window.render_game_to_text);
const read = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
const keys = ["j", "k", "l", "u", "Space", "a", "d", "w", "s", "Enter"];
const down = (key) => page.keyboard.down(key);
const up = (key) => page.keyboard.up(key);
const item = (slot, extra = {}) => ({
  id: slot,
  name: "试玩装备",
  slot,
  level: 1,
  quality: 2,
  base: slot === "weapon" ? 5 : 0,
  affixes: slot === "chest" ? [{ stat: "health", value: 10000 }] : [],
  locked: false,
  ...extra,
});
const fixture = {
  version: 1,
  level: 5,
  xp: 0,
  gold: 1000,
  bag: [],
  equipped: { weapon: item("weapon"), chest: item("chest") },
  cleared: [0],
  pity: 0,
  settings: { sound: false, shake: false },
  kills: 0,
  runs: 0,
};
let passed = 0;
async function check(condition, message) {
  if (!condition) {
    console.log(JSON.stringify(await read()));
    await page.screenshot({
      path: "checks/artifacts/content/failure.png",
      fullPage: true,
    });
  }
  assert.ok(condition, message);
  passed++;
  console.log("PASS", message);
}
async function fresh(save = fixture) {
  for (const key of keys) await up(key);
  await page.evaluate((save) => {
    localStorage.setItem("ashen-frontier-v1", JSON.stringify(save));
    localStorage.removeItem("ashen-frontier-v1-backup");
  }, save);
  await page.reload();
  await page.waitForFunction(() => window.setManualTime);
  await page.evaluate(() => window.setManualTime(true));
  await page.click("#start-btn");
  await page.click("#enter-dungeon");
}
async function approach() {
  for (let i = 0; i < 240; i++) {
    const state = await read();
    const enemy = state.enemies
      .filter((e) => !e.name.includes("弓手"))
      .sort(
        (a, b) =>
          Math.hypot(a.x - state.player.x, a.y - state.player.y) -
          Math.hypot(b.x - state.player.x, b.y - state.player.y),
      )[0];
    const dx = enemy.x - state.player.x,
      dy = enemy.y - state.player.y;
    if (Math.abs(dx) < 90 && Math.abs(dy) < 12) {
      for (const key of ["a", "d", "w", "s"]) await up(key);
      return;
    }
    for (const [key, held] of [
      ["a", dx < -78],
      ["d", dx > 78],
      ["w", dy < -8],
      ["s", dy > 8],
    ])
      if (held) await down(key);
      else await up(key);
    await step(34);
  }
  throw Error("无法接近敌人");
}

await fresh();
await down("k");
await step(850);
let state = await read();
await check(
  state.player.action?.kind === "charging" && state.cooldowns.k === 0,
  "按住K进入满蓄，尚未消耗冷却",
);
await page.screenshot({
  path: "checks/artifacts/content/full-charge.png",
  fullPage: true,
});
await page.keyboard.press("Escape");
const chargeTime = state.player.action.time;
await step(1200);
await check(
  (await read()).player.action.time === chargeTime,
  "暂停冻结蓄力进度",
);
await page.keyboard.press("Escape");
await down("Space");
await step(34);
state = await read();
await check(
  state.player.action?.kind === "dodge" && state.cooldowns.k === 0,
  "闪避取消蓄力，不产生剑气冷却",
);
await up("k");
await up("Space");

await fresh();
await down("k");
await step(17);
await up("k");
await step(160);
state = await read();
await check(
  state.projectiles.some((shot) => shot.kind === "wave" && !shot.charged) &&
    state.cooldowns.k > 0,
  "点按K释放普通剑气并开始冷却",
);

const wind = {
  ...fixture,
  bag: [item("weapon", { id: "special-drop", special: "reprisal", name: "曙光回击" })],
  equipped: {
    weapon: item("weapon"),
    head: item("head", { set: 1 }),
    chest: item("chest", { set: 1 }),
    legs: item("legs", { set: 1 }),
    ring: item("ring", { set: 1 }),
    charm: item("charm", { special: "returning", name: "回风坠饰" }),
  },
};
await fresh(wind);
const initialX = (await read()).player.x;
await down("k");
await down("d");
await step(200);
await up("d");
await step(650);
state = await read();
await check(
  state.player.x > initialX && state.player.x - initialX < 25,
  "蓄力期间可缓慢走位",
);
await up("k");
await step(160);
state = await read();
await check(
  state.projectiles.filter((shot) => shot.kind === "wave" && shot.charged)
    .length === 2,
  "满蓄剑气与风行四件的双剑气叠加",
);
for (let i = 0; i < 45; i++) {
  await step(34);
  state = await read();
  if (
    state.projectiles.filter((shot) => shot.returning && shot.vx < 0).length ===
    2
  )
    break;
}
await check(
  state.projectiles.filter((shot) => shot.returning && shot.vx < 0).length ===
    2,
  "回风坠饰使两道满蓄剑气折返",
);
await page.screenshot({
  path: "checks/artifacts/content/returning-waves.png",
  fullPage: true,
});
await page.keyboard.press("b");
await check(
  (await page.locator(".equipment-column").innerText()).includes("回风剑术"),
  "背包显示已生效特效与套装状态",
);
await page.click('[data-item="special-drop"]');
await check((await page.locator(".detail-column").innerText()).includes("反击额外发射"), "装备比较展示特效触发条件");
await page.click('[data-action="equip"]');
await page.screenshot({ path: "checks/artifacts/content/special-inventory.png", fullPage: true });
await page.reload();
await page.waitForFunction(() => window.render_game_to_text);
await check(
  (await read()).specials.includes("returning"),
  "刷新恢复特效装备及其效果",
);

await fresh({
  ...fixture,
  equipped: {
    ...fixture.equipped,
    weapon: item("weapon", { special: "reprisal", name: "曙光回击" }),
  },
});
await approach();
let precise = false;
for (let i = 0; i < 750; i++) {
  state = await read();
  const enemy = state.enemies.find(
    (e) =>
      e.move === "slash" &&
      e.state === "windup" &&
      e.windup - e.stateTime <= 0.07 &&
      e.windup - e.stateTime > 0.015 &&
      Math.abs(e.y - state.player.y) < 30 &&
      Math.abs(e.x - state.player.x) < 100,
  );
  if (
    enemy &&
    state.cooldowns.space === 0 &&
    !state.player.action &&
    state.player.inv === 0
  ) {
    const direction = enemy.x > state.player.x ? "d" : "a";
    await down(direction);
    await down("Space");
    await step(160);
    await up(direction);
    await up("Space");
    if ((await read()).player.counter > 0) {
      precise = true;
      break;
    }
  } else await step(17);
}
await check(precise, "真实敌人攻击与闪避判定重叠时触发精准闪避");
await page.screenshot({
  path: "checks/artifacts/content/perfect-dodge.png",
  fullPage: true,
});
await step(250);
await down("j");
await step(140);
await up("j");
state = await read();
await check(
  state.player.action?.kind === "counter" && state.player.counter === 0,
  "J消耗一次反击机会并发动强化斩击",
);
await check(
  state.projectiles.some((shot) => shot.kind === "wave"),
  "曙光回击让反击额外释放穿透剑气",
);
await page.screenshot({
  path: "checks/artifacts/content/counter-wave.png",
  fullPage: true,
});

await fresh({
  ...fixture,
  equipped: {
    ...fixture.equipped,
    ring: item("ring", { special: "wildfire", name: "燎原指环" }),
  },
});
await approach();
await down("l");
await step(250);
await up("l");
await check(
  (await read()).enemies.some((enemy) => enemy.burn > 0),
  "燎原指环使技能附加灼烧，无需余烬套装",
);
let explosion = false;
await down("j");
for (let i = 0; i < 180; i++) {
  await step(34);
  state = await read();
  if (state.effects.some((effect) => effect.kind === "blast")) {
    explosion = true;
    break;
  }
}
await up("j");
await check(
  explosion && state.run.gold > 0,
  "灼烧敌人死亡产生燎原爆发并正常发奖",
);
await page.screenshot({
  path: "checks/artifacts/content/wildfire.png",
  fullPage: true,
});
await check(errors.length === 0, "新内容浏览器流程无脚本异常");
console.log("TOTAL", passed, "ERRORS", errors);
await browser.close();
