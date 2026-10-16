import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
fs.mkdirSync("checks/artifacts/actions", { recursive: true });
const browser = await chromium.launch({ channel: process.env.GAME_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: process.env.GAME_VIEWPORT === "large" ? { width: 1920, height: 1080 } : { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const URL = "http://127.0.0.1:4173";
await page.goto(URL);
await page.waitForFunction(() => window.setManualTime);
let passed = 0;
const fixture = {
  version: 1,
  level: 5,
  xp: 0,
  gold: 1000,
  bag: [],
  equipped: {
    weapon: {
      id: "blade",
      name: "动作验证长剑",
      slot: "weapon",
      level: 1,
      quality: 0,
      base: 5,
      affixes: [],
      locked: false,
    },
    chest: {
      id: "armor",
      name: "动作验证胸甲",
      slot: "chest",
      level: 1,
      quality: 1,
      base: 10,
      affixes: [{ stat: "health", value: 2000 }],
      locked: false,
    },
  },
  cleared: [0],
  pity: 0,
  settings: { sound: false, shake: false },
  kills: 0,
  runs: 0,
};
const read = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
const down = (k) => page.keyboard.down(k),
  up = (k) => page.keyboard.up(k);
async function tap(k, ms = 17) {
  await down(k);
  await step(ms);
  await up(k);
}
async function check(ok, text) {
  if (!ok) {
    console.log("FAILED STATE", JSON.stringify(await read()));
    await page.screenshot({
      path: "checks/artifacts/actions/failure.png",
      fullPage: true,
    });
  }
  assert.ok(ok, text);
  passed++;
  console.log("PASS", text);
}
async function fresh(seed = fixture) {
  for (const k of ["j", "k", "l", "u", "Space", "a", "d", "w", "s"])
    await up(k);
  await page.evaluate((s) => {
    localStorage.setItem("ashen-frontier-v1", JSON.stringify(s));
    localStorage.removeItem("ashen-frontier-v1-backup");
  }, seed);
  await page.reload();
  await page.waitForFunction(() => window.setManualTime);
  await page.locator("canvas").waitFor();
  await page.evaluate(() => window.setManualTime(true));
  await page.click("#start-btn");
  await page.click("#enter-dungeon");
}
async function approach(kind = 0) {
  for (let i = 0; i < 130; i++) {
    const s = await read(),
      target = s.enemies
        .filter((e) =>
          kind === 1 ? e.name === "骷髅弓手" : e.name === "骷髅兵",
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - s.player.x, a.y - s.player.y) -
            Math.hypot(b.x - s.player.x, b.y - s.player.y),
        )[0];
    if (!target) throw Error("无目标");
    const dx = target.x - s.player.x,
      dy = target.y - s.player.y;
    if (Math.abs(dx) < 86 && Math.abs(dy) < 12) {
      for (const k of ["a", "d", "w", "s"]) await up(k);
      return target.id;
    }
    for (const [k, on] of [
      ["a", dx < -80],
      ["d", dx > 80],
      ["w", dy < -8],
      ["s", dy > 8],
    ]) {
      if (on) await down(k);
      else await up(k);
    }
    await step(50);
  }
  throw Error("接近超时");
}
await fresh();
const initial = await read();
await down("j");
await step(17);
let s = await read();
await check(
  s.player.action.kind === "light1" &&
    s.player.action.phase === "windup" &&
    s.enemies.every((e) => e.hp === e.max),
  "普攻具有起手阶段，不在按键帧扣血",
);
await down("a");
await step(33);
await up("a");
await check((await read()).player.facing === 1, "出招期间朝向锁定");
await tap("k", 50);
await step(67);
s = await read();
await check(
  s.player.action.kind === "wave",
  "提前输入技能可在普攻衔接窗口执行",
);
await up("j");
await step(167);
s = await read();
await check(
  s.projectiles.some((p) => p.kind === "wave") &&
    s.enemies.every((e) => e.hp === e.max),
  "剑气生成后飞行，远处敌人尚未被瞬间扣血",
);
await page.screenshot({
  path: "checks/artifacts/actions/wave-flight.png",
  fullPage: true,
});
await step(600);
s = await read();
await check(
  s.enemies.some((e) => e.hp < e.max),
  "剑气抵达目标后产生伤害",
);
await fresh();
await down("k");
let waveIds = new Set();
for (let i = 0; i < 70; i++) {
  await step(100);
  for (const p of (await read()).projectiles)
    if (p.kind === "wave") waveIds.add(p.id);
}
await up("k");
await check(waveIds.size === 1, "按住技能键不会冷却结束后自动连发");
await fresh();
await step(800);
let before = await read();
await down("Space");
await step(17);
let first = await read();
await step(50);
let middle = await read();
await check(
  first.player.x - before.player.x < 15 &&
    middle.player.x > before.player.x &&
    middle.player.x - before.player.x < 100,
  "闪避沿时间移动，不瞬移",
);
await check(
  middle.player.inv > 0 && middle.player.action.kind === "dodge",
  "闪避有效阶段提供无敌",
);
await up("Space");
await page.screenshot({
  path: "checks/artifacts/actions/dodge.png",
  fullPage: true,
});
await fresh();
await tap("u", 50);
s = await read();
await check(
  s.player.x === 170 && s.player.action.phase === "windup",
  "突袭起手不提前位移",
);
await step(167);
before = await read();
await tap("Space", 50);
s = await read();
await check(
  s.player.action.kind === "rush" && !s.player.action.canDodge,
  "重技能有效阶段无法立即闪避取消",
);
await check(s.player.x > 170 && s.player.x < 380, "突袭沿路径前进");
await page.screenshot({
  path: "checks/artifacts/actions/rush-active.png",
  fullPage: true,
});
await step(367);
await tap("Space", 34);
s = await read();
await step(34);
s = await read();
await check(s.player.action.kind === "dodge", "重技能收招末段可缓冲闪避");
await fresh();
for (let i = 0; i < 60; i++) {
  await step(50);
  s = await read();
  if (s.projectiles.some((p) => p.kind === "arrow")) break;
}
await check(
  s.projectiles.some((p) => p.kind === "arrow") &&
    s.player.hp === initial.player.hp,
  "弓手瞄准后射出实体箭，箭未抵达前不扣血",
);
const hp = s.player.hp;
await down("w");
await step(550);
await up("w");
await step(300);
await check((await read()).player.hp === hp, "纵向走位可躲开已经射出的箭");
await fresh({
  ...fixture,
  equipped: {
    ...fixture.equipped,
    weapon: { ...fixture.equipped.weapon, base: 600 },
  },
  bag: [{ ...fixture.equipped.weapon, id: "weak", base: 5 }],
});
await down("w");
await step(220);
await up("w");
await tap("k", 1200);
await page.keyboard.press("b");
await page.click('[data-item="weak"]');
await page.click('[data-action="equip"]');
await page.keyboard.press("b");
const targetId = await approach();
await down("j");
let seen = new Set();
for (let i = 0; i < 90; i++) {
  await step(17);
  s = await read();
  if (s.player.action) seen.add(s.player.action.kind);
  const e = s.enemies.find((e) => e.id === targetId);
  if (
    e?.state === "hurt" &&
    s.player.action?.kind === "heavy" &&
    s.player.action.phase === "active" &&
    s.player.action.time > 0.23
  )
    break;
}
await up("j");
s = await read();
await check(
  ["light1", "light2", "heavy"].every((k) => seen.has(k)),
  "持续普攻依次出现快、快、重三种动作",
);
let target = s.enemies.find((e) => e.id === targetId);
await check(target && target.hitstun > 0, "命中小怪产生硬直并打断行为");
await page.screenshot({
  path: "checks/artifacts/actions/heavy-hit.png",
  fullPage: true,
});
const afterHeavyHp = target?.hp ?? 0;
await tap("l", 200);
await step(150);
s = await read();
target = s.enemies.find((e) => e.id === targetId);
await check(
  s.player.action?.kind === "spin" && (!target || target.hp < afterHeavyHp),
  "第三段推怪后可以衔接旋刃命中",
);
await page.screenshot({
  path: "checks/artifacts/actions/spin-combo.png",
  fullPage: true,
});
await page.keyboard.press("Escape");
const time = (await read()).run.time;
await step(2000);
await check((await read()).run.time === time, "新动作、弹道和计时在暂停时冻结");
await check(errors.length === 0, "全部动作场景无浏览器错误");
console.log("TOTAL", passed, "ERRORS", errors);
await browser.close();
