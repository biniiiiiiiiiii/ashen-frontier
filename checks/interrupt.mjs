import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
fs.mkdirSync("checks/artifacts/actions", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
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
await down("d");
await step(800);
await up("d");
await down("w");
await step(220);
await up("w");
let target;
for (let i = 0; i < 140; i++) {
  const s = await read();
  target = s.enemies.find(
    (e) =>
      e.name === "骷髅弓手" &&
      e.state === "windup" &&
      e.stateTime < 0.09 &&
      Math.abs(e.x - s.player.x) < 300 &&
      Math.abs(e.y - s.player.y) < 35,
  );
  if (target) break;
  await step(17);
}
await check(!!target, "找到近中距离正在抬弓的弓手");
const id = target.id,
  hp = target.hp;
await tap("k", 17);
let interrupted = false;
for (let i = 0; i < 36; i++) {
  await step(17);
  const s = await read(),
    e = s.enemies.find((e) => e.id === id);
  if (e && e.hp < hp) {
    interrupted = e.state === "hurt" && e.hitstun > 0;
    await page.screenshot({
      path: "checks/artifacts/actions/archer-interrupted.png",
      fullPage: true,
    });
    break;
  }
}
await check(interrupted, "裂风斩在箭矢发射前打断抬弓");
await check(errors.length === 0, "打断场景无浏览器错误");
console.log("TOTAL", passed);
await browser.close();
