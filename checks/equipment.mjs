import fs from "node:fs";
fs.mkdirSync("checks/artifacts", { recursive: true });
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto("http://127.0.0.1:4173");
await page.waitForFunction(() => window.render_game_to_text);
const slots = ["weapon", "head", "chest", "legs", "ring", "charm"];
const item = (slot, i, set) => ({
  id: "eq" + i,
  name: "验证装备" + i,
  slot,
  level: 15,
  quality: 2,
  base: slot === "weapon" ? 40 : 0,
  affixes: [{ stat: "health", value: 500 }],
  ...(set === undefined ? {} : { set }),
  locked: false,
});
function seed(set) {
  return {
    version: 1,
    level: 15,
    xp: 0,
    gold: 5000,
    bag: [],
    equipped: Object.fromEntries(
      slots.map((slot, i) => [slot, item(slot, i, set)]),
    ),
    cleared: [0, 1, 2],
    pity: 0,
    settings: { sound: false, shake: false },
    kills: 0,
    runs: 0,
  };
}
async function install(s) {
  await page.evaluate((s) => {
    localStorage.setItem("ashen-frontier-v1", JSON.stringify(s));
    localStorage.removeItem("ashen-frontier-v1-backup");
  }, s);
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  await page.evaluate(
    () =>
      (Math.random = (() => {
        let n = 1;
        return () => 0.1 + ((n++ * 0.618033988749895) % 1) * 0.89;
      })()),
  );
}
async function skill(set) {
  await install(seed(set));
  await page.click('[data-nav="dungeons"]');
  await page.click('[data-dungeon="2"]');
  await page.click('[data-difficulty="hard"]');
  await page.click("#enter-dungeon");
  const b = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  await page.keyboard.down("k");
  await page.evaluate(() => window.advanceTime(1250));
  await page.keyboard.up("k");
  const a = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  return Math.max(...a.enemies.map((e, i) => b.enemies[i].hp - e.hp));
}
const normal = await skill(undefined),
  wind = await skill(1),
  ember = await skill(2);
assert.ok(Math.abs(wind - normal - Math.round(normal * 0.8)) <= 1);
assert.ok(ember > normal);
console.log("PASS 风行四件额外剑气伤害", normal, wind, "余烬灼烧伤害", ember);
const full = seed(undefined);
full.bag = Array.from({ length: 60 }, (_, i) => ({
  ...item("head", i),
  id: "bag" + i,
}));
await install(full);
await page.evaluate(
  () =>
    (Math.random = (() => {
      let n = 1;
      return () => 0.051 + ((n++ * 0.618033988749895) % 1) * 0.09;
    })()),
);
await page.click('[data-nav="dungeons"]');
await page.click("#enter-dungeon");
await page.keyboard.down("k");
await page.evaluate(() => window.advanceTime(1250));
await page.keyboard.up("k");
const s = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("ashen-frontier-v1")),
);
assert.equal(s.bag.length, 60);
assert.ok(s.gold > 5020);
assert.ok((await page.locator("#toast").innerText()).includes("已转换为"));
console.log("PASS 满背包掉落自动折现", s.gold);
await page.screenshot({
  path: "checks/artifacts/full-bag-drop.png",
  fullPage: true,
});
await browser.close();
