import fs from "node:fs";
fs.mkdirSync("checks/artifacts", { recursive: true });
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const URL = "http://127.0.0.1:4173";
const KEY = "ashen-frontier-v1";
let checks = 0;
async function check(value, message) {
  assert.ok(value, message);
  checks++;
  console.log("PASS", message);
}
async function state() {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}
async function stored() {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
}
await page.goto(URL);
await page.waitForFunction(() => window.render_game_to_text);
await page.click('[data-nav="shop"]');
await page.click('[data-action="buy"]');
let s = await stored();
await check(s.bag.length === 1 && s.gold === 32, "商店扣款与随机装备入包");
await page.click('[data-action="buy"]');
await check((await stored()).gold === 32, "金币不足不会重复购买");
await page.click('[data-nav="bag"]');
await page.click(".bag-item");
await page.click('[data-action="lock"]');
await page.click('[data-action="sell-common"]');
await check((await stored()).bag.length === 1, "锁定装备不被批量出售");
await page.click('[data-action="equip"]');
s = await stored();
await check(Object.keys(s.equipped).length >= 1, "装备穿戴成功");
await page.click('[data-action="close"]');
await page.reload();
await page.waitForFunction(() => window.render_game_to_text);
await check(
  JSON.stringify((await stored()).equipped) === JSON.stringify(s.equipped),
  "刷新恢复穿戴",
);
await page.click('[data-nav="dungeons"]');
await page.click("#enter-dungeon");
await page.keyboard.press("Escape");
const t = (await state()).run.time;
await page.evaluate(() => window.advanceTime(5000));
await check((await state()).run.time === t, "暂停冻结战斗计时");
await page.click('[data-action="close"]');
await page.keyboard.press("b");
const t2 = (await state()).run.time;
await page.evaluate(() => window.advanceTime(5000));
await check((await state()).run.time === t2, "背包冻结战斗计时");
await page.keyboard.press("b");
await page.reload();
await page.waitForFunction(() => window.render_game_to_text);
await check((await state()).mode === "camp", "副本刷新后返回营地");
function item(id, slot, set = 0) {
  return {
    id,
    name: "校验·" + slot,
    slot,
    level: 15,
    quality: 3,
    base:
      slot === "weapon" ? 160 : slot === "ring" || slot === "charm" ? 50 : 60,
    affixes: [
      { stat: "crit", value: 30 },
      { stat: "cdr", value: 15 },
      { stat: "health", value: 350 },
    ],
    set,
    locked: false,
  };
}
const seed = {
  version: 1,
  level: 15,
  xp: 0,
  gold: 5000,
  bag: [],
  equipped: Object.fromEntries(
    ["weapon", "head", "chest", "legs", "ring", "charm"].map((slot, i) => [
      slot,
      item("equipped-" + i, slot),
    ]),
  ),
  cleared: [0, 1, 2],
  pity: 9,
  settings: { sound: false, shake: false },
  kills: 0,
  runs: 0,
};
async function seedSave(data) {
  await page.evaluate(
    ({ key, data }) => {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.removeItem(key + "-backup");
    },
    { key: KEY, data },
  );
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
}
await seedSave(seed);
await page.click('[data-nav="bag"]');
await check(
  (await page.locator(".stat-grid").innerText()).includes("60%") &&
    (await page.locator(".stat-grid").innerText()).includes("30%"),
  "暴击及冷却上限生效",
);
await page.screenshot({
  path: "checks/artifacts/stats-capped.png",
  fullPage: true,
});
await page.click('[data-action="close"]');
async function bot(dungeon, hard) {
  await page.click('[data-nav="dungeons"]');
  await page.click(`[data-dungeon="${dungeon}"]`);
  if (hard) await page.click('[data-difficulty="hard"]');
  await page.evaluate(() => window.setManualTime(true));
  await page.click("#enter-dungeon");
  let sawHazard = false,
    escapeUntil = 0,
    escapeY = 0;
  for (let tick = 0; tick < 4000; tick++) {
    const s = await state();
    if (s.mode !== "battle") break;
    if (s.paused) {
      await page.keyboard.press("Escape");
      continue;
    }
    if (s.hazards.length) sawHazard = true;
    if (s.door) {
      await page.keyboard.down("Enter");
      await page.evaluate(() => window.advanceTime(17));
      await page.keyboard.up("Enter");
      continue;
    }
    const p = s.player;
    let targets = s.enemies.filter((e) => /弓手|术士|孢子/.test(e.name));
    if (!targets.length) targets = s.enemies;
    const target = targets.sort(
      (a, b) =>
        Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
    )[0];
    if (!target) continue;
    const dx = target.x - p.x,
      dy = target.y - p.y;
    let mx =
        Math.abs(dx) > 85
          ? Math.sign(dx)
          : Math.sign(dx) !== p.facing
            ? Math.sign(dx)
            : 0,
      my = Math.abs(dy) > 12 ? Math.sign(dy) : 0,
      action = null;
    const danger =
      s.enemies.some(
        (e) =>
          e.boss &&
          e.state === "windup" &&
          e.windup - e.stateTime < 0.24 &&
          Math.abs(e.y - p.y) < 95,
      ) ||
      s.hazards.some((h) => !h.fired && h.timer < 0.25 && h.timer > 0) ||
      s.projectiles.some(
        (b) =>
          b.kind !== "wave" && Math.hypot(b.x - p.x, (b.y - p.y) * 2) < 130,
      );
    if (escapeUntil > s.run.time) {
      mx = 0;
      my = escapeY;
    }
    if (danger && s.cooldowns.space <= 0 && (!p.action || p.action.canDodge)) {
      escapeY = p.y > 445 ? -1 : 1;
      escapeUntil = s.run.time + 0.5;
      mx = 0;
      my = escapeY;
      action = "Space";
    } else if (!p.action || p.action.canSkill) {
      if (s.cooldowns.k <= 0 && Math.abs(dy) < 34 && Math.abs(dx) < 650)
        action = "k";
      else if (
        s.level >= 3 &&
        s.cooldowns.l <= 0 &&
        Math.hypot(dx, dy * 1.8) < 150
      )
        action = "l";
      else if (
        s.level >= 5 &&
        s.cooldowns.u <= 0 &&
        Math.abs(dy) < 30 &&
        Math.abs(dx) > 150 &&
        Math.abs(dx) < 300
      )
        action = "u";
    }
    for (const [k, on] of [
      ["a", mx < 0],
      ["d", mx > 0],
      ["w", my < 0],
      ["s", my > 0],
      [
        "j",
        !action &&
          Math.abs(dx) < 120 &&
          Math.abs(dy) < 40 &&
          escapeUntil <= s.run.time,
      ],
    ]) {
      if (on) await page.keyboard.down(k);
      else await page.keyboard.up(k);
    }
    if (action) await page.keyboard.down(action);
    await page.evaluate(() => window.advanceTime(100));
    if (action) await page.keyboard.up(action);
  }
  for (const k of ["j", "k", "l", "u", "a", "d", "w", "s", "Space"])
    await page.keyboard.up(k);
  const end = await state();
  if (end.mode !== "result" || end.enemies.length)
    console.log("FAILED RUN", JSON.stringify(end));
  await check(
    end.mode === "result" && end.enemies.length === 0,
    `副本${dungeon + 1} ${hard ? "困难" : "普通"}可通关`,
  );
  console.log(
    "RUN",
    dungeon,
    hard,
    "time",
    end.run.time,
    "hp",
    end.player.hp,
    "loot",
    end.run.items.length,
  );
  if (dungeon === 2)
    await page.screenshot({
      path: "checks/artifacts/sanctum-result.png",
      fullPage: true,
    });
  await page.click('[data-action="return"]');
  return { sawHazard, end };
}
const one = await bot(0, true);
s = await stored();
await check(
  s.pity === 0 && s.bag.some((i) => i.quality === 3),
  "困难首领第十次保底传说并重置计数",
);
await bot(0, false);
await bot(1, false);
await bot(1, true);
await bot(2, false);
await bot(2, true);
const full = {
  ...seed,
  bag: Array.from({ length: 60 }, (_, i) => ({
    ...item("bag-" + i, "head"),
    quality: 1,
    set: undefined,
  })),
};
await seedSave(full);
await page.click('[data-nav="shop"]');
await page.click('[data-action="buy"]');
await check(
  (await stored()).gold === 5000 && (await stored()).bag.length === 60,
  "背包满时商店禁止扣款",
);
await page.click('[data-nav="bag"]');
await page.click(".bag-item");
await page.click('[data-action="lock"]');
await page.click('[data-action="sell-common"]');
await check((await stored()).bag.length === 1, "批量出售只清理未锁定白蓝装备");
await page.click('[data-action="close"]');
const backed = await stored();
await page.evaluate((k) => localStorage.setItem(k, "broken"), KEY);
await page.reload();
await page.waitForFunction(() => window.render_game_to_text);
await check((await state()).level === 15, "损坏主存档可恢复有效备份");
await page.evaluate((k) => {
  localStorage.setItem(k, "broken");
  localStorage.setItem(k + "-backup", "broken");
}, KEY);
await page.reload();
await page.waitForFunction(() => window.render_game_to_text);
await check(
  await page.locator('[data-action="reset-corrupt"]').isVisible(),
  "双存档损坏提示选择重新开始",
);
await check(
  (await page.evaluate((k) => localStorage.getItem(k), KEY)) === "broken",
  "损坏数据未自动覆盖",
);
await page.click('[data-action="reset-corrupt"]');
await check((await state()).level === 1, "确认重新开始后创建新档");
await page.setViewportSize({ width: 1920, height: 1080 });
await page.screenshot({
  path: "checks/artifacts/camp-1920.png",
  fullPage: true,
});
await check(errors.length === 0, "全流程无浏览器异常");
console.log("TOTAL", checks, "ERRORS", errors);
await browser.close();
