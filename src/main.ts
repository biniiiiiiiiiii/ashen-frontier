import { actionNames } from "./combat";
import { blessings, blessingGroups, type BlessingId } from "./blessings";
import Phaser from "phaser";
import "./style.css";
import {
  colors,
  createItem,
  createSpecialItem,
  specialItems,
  type SpecialId,
  dungeons,
  freshSave,
  price,
  qualities,
  sets,
  slotNames,
  slots,
  statNames,
  stats,
  xpNeed,
  type Item,
  type Save,
} from "./data";
import { loadSave, persist, storageWarning, validateSave } from "./save";
import { World, type Bridge, type Enemy } from "./world";
const app = document.querySelector<HTMLDivElement>("#app")!;
const icon = (name: string, size = 20) => {
  const paths: Record<string, string> = {
    chest: "m8 3 4 2 4-2 6 5-4 4v10H6V12L2 8l6-5Z",
    legs: "M6 3h12l2 18h-6l-2-10-2 10H4L6 3ZM6 7h12",
    ring: "M19 14a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM8 4l4-3 4 3-4 4-4-4Z",
    charm: "M7 2c0 8 10 8 10 0M12 9l6 7-6 7-6-7 6-7Z",
    camp: "M3 19 12 4l9 15H3Zm5 0 4-7 4 7M12 4V1",
    sword: "m14 3 7-1-1 7L8 21l-5-5L14 3ZM4 11l9 9M2 22l5-5",
    bag: "M5 7h14l2 14H3L5 7Zm3 0V5a4 4 0 0 1 8 0v2M8 12h8",
    shop: "M3 9h18l-2-6H5L3 9Zm1 0v12h16V9M9 21v-7h6v7",
    settings:
      "m10 3 4 0 1 3 3 1 3 3-2 3 0 3-3 2-3-1-3 1-3-2 0-3-2-3 3-3 3-1 1-3Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    coin: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 7v10M9 9h6m-6 6h6",
    helm: "M4 17V9a8 8 0 0 1 16 0v8l-5 4V11h-2v10h-2V11H9v10l-5-4Z",
    cross: "m6 6 12 12M6 18 18 6",
    lock: "M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4",
    check: "m5 12 4 4L19 6",
    heart: "M12 21 3 12C-3 3 9-1 12 6c3-7 15-3 9 6l-9 9Z",
    pause: "M8 5v14M16 5v14",
    play: "m8 4 12 8-12 8V4Z",
    star: "m12 2 3 6 7 1-5 5 1 8-6-3-6 3 1-8-5-5 7-1 3-6Z",
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${(
    paths[name] ?? paths.sword
  )
    .split(" M")
    .map((p, i) => `<path d="${i ? "M" : ""}${p}"/>`)
    .join("")}</svg>`;
};
let save: Save = loadSave(),
  selectedDungeon = 0,
  hard = false,
  active = "camp",
  overlay = "",
  selectedItem = "",
  resultWin = true,
  storageBlocked = storageWarning.includes("无法读取");
let soundContext: AudioContext | undefined;
function audio(kind: string) {
  if (!save.settings.sound) return;
  try {
    soundContext ??= new AudioContext();
    if (soundContext.state === "suspended") void soundContext.resume();
    const osc = soundContext.createOscillator(),
      gain = soundContext.createGain();
    osc.connect(gain);
    gain.connect(soundContext.destination);
    osc.type =
      kind === "heavyHit" || kind === "swingHeavy" ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(
      kind === "heavyHit"
        ? 105
        : kind === "swingHeavy"
          ? 220
          : kind === "swing"
            ? 440
            : kind === "hit"
              ? 170
              : kind === "hurt"
                ? 90
                : kind === "loot"
                  ? 700
                  : 320,
      soundContext.currentTime,
    );
    osc.frequency.exponentialRampToValueAtTime(
      kind === "loot" ? 1100 : 45,
      soundContext.currentTime + 0.12,
    );
    gain.gain.setValueAtTime(0.035, soundContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      soundContext.currentTime + 0.16,
    );
    osc.start();
    osc.stop(soundContext.currentTime + 0.18);
  } catch {}
}
function notify(message: string) {
  const area = document.querySelector("#toast")!;
  (area as HTMLElement).style.color = "";
  area.textContent = message;
  area.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => area.classList.remove("show"), 3500);
}
let toastTimer = 0;
function store() {
  if (storageBlocked) return;
  if (!persist(save)) notify("无法保存进度，请检查浏览器本地存储权限。");
}
const bridge: Bridge = {
  save,
  mode: "camp",
  paused: false,
  run: null,
  reward,
  finish,
  changed: () => renderHud(),
  audio,
  toast: notify,
  blessing: () => openOverlay("blessing"),
};
const slotIcon = (slot: string) =>
  slot === "weapon" ? "sword" : slot === "head" ? "helm" : slot;
const world = new World(bridge);
app.innerHTML = `<aside class="sidebar"><a class="brand" href="#" aria-label="灰烬边境营地"><span class="brand-mark">${icon("sword", 28)}</span><span>灰烬边境<small>ASHEN FRONTIER</small></span></a><div class="chapter">旅人的篇章 <span>01</span></div><nav>${[
  ["camp", "camp", "冒险营地"],
  ["dungeons", "sword", "地下城"],
  ["bag", "bag", "行囊装备"],
  ["shop", "shop", "流浪商人"],
]
  .map(
    ([id, i, t]) =>
      `<button data-nav="${id}" class="nav-item ${id === "camp" ? "active" : ""}">${icon(i)}<span>${t}</span>${id === "dungeons" ? "<b>03</b>" : ""}</button>`,
  )
  .join(
    "",
  )}</nav><div class="sidebar-bottom"><div class="world-status"><i></i> 离线冒险 · 本地存档</div><button class="nav-item" data-action="settings">${icon("settings")}<span>游戏设置</span></button><div class="version">VERSION 1.3 <span>单人冒险</span></div></div></aside><main><header><div class="breadcrumb">灰烬边境 <span>/</span> <b id="page-name">冒险营地</b></div><div class="header-right"><span class="save-tag">${icon("check", 13)} 自动保存</span><span class="wallet">${icon("coin", 17)} <b id="gold">120</b></span><span class="avatar">旅</span></div></header><div class="content"><div id="page-top"></div><section class="stage"><div id="game"></div><div id="scene-ui"></div><div class="scene-bottom" id="scene-bottom"></div></section><div id="below"></div><footer><span>每一件遗落的装备，都藏着一段未完的故事。</span><span>W A S D 移动 <i>·</i> J 攻击 <i>·</i> SPACE 闪避</span></footer></div></main><div id="modal-root"></div><div id="toast" role="status"></div>`;
new Phaser.Game({
  type: Phaser.CANVAS,
  parent: "game",
  width: 1100,
  height: 610,
  backgroundColor: "#171e20",
  pixelArt: true,
  antialias: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [world],
  audio: { noAudio: true },
  banner: false,
});
function escapeText(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function openPage(page: string) {
  if (bridge.mode === "battle" && page !== "bag") {
    notify("冒险进行中，可暂停后撤离回营地。");
    return;
  }
  if (page === "bag") {
    openOverlay("bag");
    return;
  }
  active = page;
  render();
}
function render() {
  bridge.save = save;
  document.querySelector("#gold")!.textContent = save.gold.toLocaleString();
  document
    .querySelectorAll("[data-nav]")
    .forEach((el) =>
      el.classList.toggle("active", el.getAttribute("data-nav") === active),
    );
  const title =
    active === "camp"
      ? "冒险营地"
      : active === "dungeons"
        ? "地下城"
        : active === "shop"
          ? "流浪商人"
          : "冒险营地";
  document.querySelector("#page-name")!.textContent = title;
  const top = document.querySelector("#page-top")!,
    ui = document.querySelector("#scene-ui")!,
    bottom = document.querySelector("#scene-bottom")!,
    below = document.querySelector("#below")!;
  if (bridge.mode === "battle") {
    top.innerHTML = `<div class="page-heading"><div><div class="eyebrow">INTO THE UNKNOWN</div><h1>${dungeons[bridge.run!.dungeon].name} <span class="difficulty">${bridge.run!.hard ? "困难" : "普通"}</span></h1></div><button class="button secondary" data-action="pause">${icon("pause", 16)} 暂停 <kbd>Esc</kbd></button></div>`;
    ui.innerHTML = '<div id="battle-hud"></div>';
    bottom.innerHTML = `<div class="room-track">${[0, 1, 2, 3].map((n) => `<span data-room="${n}">${n === 3 ? "♜" : "◇"} ${n === 3 ? "首领" : "房间 " + (n + 1)}</span>`).join("<i>—</i>")}</div><span id="run-time">00:00</span>`;
    below.innerHTML = `<div class="combat-bar"><div class="hero-mini">${icon("helm", 28)}<div><strong>灰烬剑士</strong><small>Lv. ${save.level} · 旅人</small></div></div><div id="skills">${[
      ["J", "三段斩", "j", 1],
      ["K", "蓄力裂风", "k", 1],
      ["L", "旋刃", "l", 3],
      ["U", "破阵突袭", "u", 5],
      ["SPACE", "闪避", "space", 1],
    ]
      .map(
        ([k, name, id, lv]) =>
          `<div class="skill ${save.level < Number(lv) ? "locked" : ""}" data-skill="${id}"><span>${icon(id === "space" ? "arrow" : "sword", 22)}</span><kbd>${k}</kbd><small>${name}</small><b></b></div>`,
      )
      .join(
        "",
      )}</div><button class="button secondary" data-action="bag">${icon("bag", 17)} 背包 <kbd>B</kbd></button></div>`;
    renderHud();
    return;
  }
  if (bridge.mode === "result") {
    renderResult();
    return;
  }
  top.innerHTML = `<div class="page-heading"><div><div class="eyebrow">${active === "dungeons" ? "CHOOSE YOUR PATH" : active === "shop" ? "THE WANDERING MERCHANT" : "A MOMENT BEFORE THE JOURNEY"}</div><h1>${title}<span class="heading-dot">·</span><span class="heading-sub">${active === "camp" ? "下一场冒险，从这里开始" : active === "dungeons" ? "黑暗之中，总有回响" : "以金币，交换未知"}</span></h1></div><div class="location">${icon("camp", 16)} 边境哨站 <span>安全区域</span></div></div>`;
  if (active === "camp") {
    ui.innerHTML = `<div class="scene-label"><span class="little-line"></span>最后的篝火<small>THE LAST BONFIRE</small></div><div class="camp-copy"><div class="eyebrow">你的征途，尚未结束</div><h2>灰烬之下<br>仍有微光。</h2><p>磨砺剑锋，整理行囊。<br>古老的地下城，正等待下一位旅人。</p><button id="start-btn" class="button primary" data-nav="dungeons">启程冒险 ${icon("arrow", 19)}</button></div><div class="scene-caption"><span>Ⅰ</span>边境哨站<small>远征者的短暂归处</small></div>`;
    bottom.innerHTML = `<span><i class="live-dot"></i> 篝火已点燃 · 生命已恢复</span><span>风声渐起，准备出发。</span>`;
    below.innerHTML = campBelow();
  } else if (active === "dungeons") {
    ui.innerHTML = `<div class="dungeon-overlay"><div class="section-kicker">远征地图 <span>EXPEDITION MAP</span></div><div class="dungeon-grid">${dungeons
      .map((d, i) => {
        const unlocked = isUnlocked(i);
        return `<button class="dungeon-card ${i === selectedDungeon ? "selected" : ""} ${!unlocked ? "unavailable" : ""}" data-dungeon="${i}"><span class="dungeon-number">0${i + 1}</span><span class="dungeon-art art-${i}"><i></i><b>${["♜", "◈", "♛"][i]}</b></span><small>${d.subtitle}</small><h3>${d.name} ${!unlocked ? icon("lock", 14) : ""}</h3><p>${d.description}</p><div class="dungeon-meta"><span>推荐 Lv.${d.level}${i === 0 ? "–5" : i === 1 ? "–10" : "–15"}</span><span>${sets[i].name}套装</span></div>${!unlocked ? `<div class="lock-note">需 Lv.${d.level}，通关${dungeons[i - 1]?.name}</div>` : ""}</button>`;
      })
      .join(
        "",
      )}</div><div class="expedition-options"><div><h4>${dungeons[selectedDungeon].name}</h4><p>3 个战斗房间 + 首领战 · ${selectedDungeon === 0 ? "清房三选一 · 3次局内祝福" : "预计 3–5 分钟"}</p></div><div class="segmented"><button data-difficulty="normal" class="${!hard ? "selected" : ""}">普通</button><button data-difficulty="hard" class="${hard ? "selected" : ""}" ${!save.cleared.includes(selectedDungeon) ? "disabled" : ""}>困难 ${!save.cleared.includes(selectedDungeon) ? "♙" : ""}</button></div><button id="enter-dungeon" class="button primary" data-action="enter" ${!isUnlocked(selectedDungeon) ? "disabled" : ""}>进入地下城 ${icon("arrow", 18)}</button></div></div>`;
    bottom.innerHTML = `<span>${icon("star", 14)} 困难首领十次内必得传说装备</span><span>没有体力限制 · 随时再战</span>`;
    below.innerHTML = `<div class="info-strip">${icon("bag", 24)}<div><strong>为你的流派而战</strong><p>墓道偏向狂战、矿坑偏向风行、圣所偏向余烬。紫色及以上装备有机会属于套装。</p></div><span>探索 · 收集 · 成长</span></div>`;
    if (selectedDungeon === 0)
      below.innerHTML += `<section class="special-catalog"><div class="panel-title"><span>墓道遗珍 · 改变你的打法</span><small>首次击败骸骨守卫必得曙光回击；后续普通35% / 困难55%掉落一件随机遗珍</small></div><div>${Object.values(
        specialItems,
      )
        .map(
          (item) =>
            `<article><small>${item.build}</small><h4>${item.name}</h4><p>${item.description}</p></article>`,
        )
        .join("")}</div></section>`;
  } else {
    ui.innerHTML = `<div class="merchant-overlay"><div class="eyebrow">金钱买不到命运，但可以买一次机会</div><h2>流浪商人的珍藏</h2><p>“从遗迹里捎来的好东西。想试试手气吗，旅人？”</p><div class="merchant-item">${icon("bag", 64)}<div><span>封存的旅人装备</span><h3>与你等级相同的随机装备</h3><p>精良 85% / 史诗 15% · 不含套装与传说</p><button class="button primary" data-action="buy">${icon("coin", 18)} ${shopCost()} 金币 · 购买一件</button></div></div><small>背包 ${save.bag.length} / 60 · 购买后可在行囊中查看</small></div>`;
    bottom.innerHTML =
      "<span>商人的货物永远不会售罄</span><span>每次购买都是一次新的相遇</span>";
    below.innerHTML = campBelow();
  }
}
function campBelow() {
  const s = stats(save);
  return `<div class="camp-panels"><section class="character-panel"><div class="panel-title"><span>旅人档案</span><small>CHARACTER</small><button data-action="bag">查看装备 ${icon("arrow", 14)}</button></div><div class="character-main"><div class="portrait">${icon("helm", 46)}<span>${save.level}</span></div><div class="character-name"><h3>灰烬剑士 <span>Lv.${save.level}</span></h3><p>长剑在手，向着未知。</p><div class="xp-line"><i style="width:${save.level === 15 ? 100 : (save.xp / xpNeed(save.level)) * 100}%"></i></div><small>${save.level === 15 ? "已达最高等级" : save.xp + " / " + xpNeed(save.level) + " 经验"}</small></div><div class="quick-stats"><span>攻击 <b>${s.attack}</b></span><span>生命 <b>${s.health}</b></span><span>防御 <b>${s.defense}</b></span></div></div></section><section class="journey-panel"><div class="panel-title"><span>冒险手记</span><small>JOURNAL</small><span class="journal-mark">◇</span></div><div class="journal-row"><span class="journal-icon">${icon(save.cleared.length ? "star" : "sword", 25)}</span><div><h4>${save.cleared.length ? "向更深的黑暗进发" : "初入边境"}</h4><p>${save.cleared.length ? "收集套装，挑战困难地下城" : "前往枯骨墓道，击败骸骨守卫"}</p></div><span class="journal-progress">${save.cleared.length}/3</span></div></section></div>`;
}
function isUnlocked(i: number) {
  return (
    i === 0 || (save.level >= dungeons[i].level && save.cleared.includes(i - 1))
  );
}
function shopCost() {
  return 70 + save.level * 18;
}
function renderHud() {
  if (bridge.mode !== "battle") return;
  const el = document.querySelector("#battle-hud");
  if (!el) return;
  const s = stats(save),
    run = bridge.run!,
    boss = world.enemies.find((e) => e.boss);
  const heroLevel = document.querySelector(".hero-mini small");
  if (heroLevel) heroLevel.textContent = `Lv. ${save.level} · 旅人`;
  const currentAction = world.player.action;
  const currentPhase = world.combat.phase();
  const phaseName =
    currentPhase === "windup"
      ? "起手"
      : currentPhase === "active"
        ? "挥击"
        : currentPhase === "recovery"
          ? "收招"
          : "";
  const actionHint = currentAction
    ? currentAction.kind === "charging"
      ? `凝风蓄力 ${Math.min(100, Math.floor((currentAction.time / currentAction.spec.windup) * 100))}%`
      : `${currentAction.charged ? "满蓄 · " : ""}${actionNames[currentAction.kind]} · ${phaseName}`
    : world.player.counter > 0
      ? "精准闪避成功 · J 强化反击"
      : "长按K蓄力 · 松开释放";
  const cancelHint = currentAction
    ? world.combat.canCancel("space")
      ? "可闪避"
      : currentAction.kind === "hurt"
        ? "受击中"
        : currentAction.kind === "dodge"
          ? "闪避中"
          : "出招中"
    : world.player.counter > 0
      ? `反击剩余 ${world.player.counter.toFixed(1)}s`
      : "Space闪避 · 抓住破绽";
  el.innerHTML = `<div class="health-panel"><div><strong>灰烬剑士</strong><span>Lv.${save.level}</span></div><div class="hp-track"><i style="width:${(world.player.hp / s.health) * 100}%"></i><span>${Math.ceil(world.player.hp)} / ${s.health}</span></div><div class="mini-xp"><i style="width:${save.level === 15 ? 100 : (save.xp / xpNeed(save.level)) * 100}%"></i></div><div class="action-readout"><span>${actionHint}</span><small class="${currentAction && !world.combat.canCancel("space") ? "committed" : ""}">${cancelHint}</small></div></div><div class="room-label">${run.room === 3 ? "首领战" : "第 " + (run.room + 1) + " 房间 · " + (world.wave + 1) + "/3 波"}<small>${run.dungeon === 0 && run.room < 3 ? world.combat.snapshot().encounter + " · " : ""}剩余敌人 ${world.enemies.length}</small></div>${boss ? `<div class="boss-panel"><span>♛ ${boss.name} <small>${boss.armor ? "霸体出招" : boss.state === "recover" ? "收招破绽" : "逼近中"}</small></span><div><i style="width:${(boss.hp / boss.max) * 100}%"></i></div></div>` : ""}`;
  document.querySelector("#gold")!.textContent = save.gold.toLocaleString();
  if (run.dungeon === 0) {
    let strip = document.querySelector<HTMLElement>("#boon-strip");
    if (!strip) {
      strip = document.createElement("div");
      strip.id = "boon-strip";
      strip.className = "boon-strip";
      document.querySelector("#below")!.append(strip);
    }
    const chosen = world.combat.boons.selected;
    const signature = chosen.join("|");
    if (strip.dataset.signature !== signature) {
      strip.dataset.signature = signature;
      strip.innerHTML = `<strong>本局祝福 ${chosen.length}/3</strong>${chosen.map((id) => `<span>${blessings[id].name}</span>`).join("") || "<small>清完房间后，选择你的流派方向</small>"}<button data-action="blessing-info">查看效果</button>`;
    }
  }
  document
    .querySelectorAll("[data-room]")
    .forEach((el) =>
      el.classList.toggle(
        "current",
        Number(el.getAttribute("data-room")) === run.room,
      ),
    );
  document.querySelector("#run-time")!.textContent = formatTime(run.time);
  document.querySelectorAll<HTMLElement>("[data-skill]").forEach((el) => {
    const cd =
      world.cooldowns[el.dataset.skill as keyof typeof world.cooldowns];
    el.querySelector("b")!.textContent = cd > 0.1 ? cd.toFixed(1) : "";
    el.classList.toggle("cooling", cd > 0.1);
    const actionKey = currentAction
      ? ["wave", "charging"].includes(currentAction.kind)
        ? "k"
        : currentAction.kind === "spin"
          ? "l"
          : currentAction.kind === "rush"
            ? "u"
            : currentAction.kind === "dodge"
              ? "space"
              : ["light1", "light2", "heavy", "counter"].includes(
                    currentAction.kind,
                  )
                ? "j"
                : ""
      : null;
    el.classList.toggle("executing", el.dataset.skill === actionKey);
    const required =
      el.dataset.skill === "l" ? 3 : el.dataset.skill === "u" ? 5 : 1;
    el.classList.toggle("locked", save.level < required);
    el.title =
      save.level < required
        ? `${required} 级解锁`
        : el.dataset.skill === "k"
          ? `点按快斩；长按${world.combat.boons.has("wind-mobility") ? "0.55" : "0.8"}秒蓄力，松开释放；Space取消`
          : el.dataset.skill === "space"
            ? "迎着即将命中的攻击闪避，成功后按J反击"
            : "";
  });
}
function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
function gainXP(amount: number) {
  const old = save.level;
  save.xp += amount;
  while (save.level < 15 && save.xp >= xpNeed(save.level)) {
    save.xp -= xpNeed(save.level);
    save.level++;
  }
  if (save.level === 15) save.xp = 0;
  if (save.level > old) {
    world.player.hp = stats(save).health;
    notify(
      `等级提升 · Lv.${save.level}${save.level === 3 ? " · 旋刃已解锁" : save.level === 5 ? " · 破阵突袭已解锁" : ""}`,
    );
    audio("loot");
  }
}
function addItem(item: Item) {
  if (save.bag.length >= 60) {
    const value = price(item);
    save.gold += value;
    if (bridge.mode === "battle") bridge.run!.gold += value;
    notify(`背包已满，${item.name}已转换为 ${value} 金币`);
    return;
  }
  save.bag.push(item);
  bridge.run?.items.push(item.id);
  notify(
    `获得 ${qualities[item.quality]}装备 · ${item.name} · Lv.${item.level}`,
  );
  document.querySelector<HTMLElement>("#toast")!.style.color =
    colors[item.quality];
  audio("loot");
}
function reward(e: Enemy) {
  const run = bridge.run!,
    gold = Math.round(
      (e.boss ? 70 : 5 + Math.random() * 7) *
        (1 + run.dungeon) *
        (run.hard ? 1.5 : 1),
    ),
    xp = Math.round(
      (e.boss ? 75 : 3) * (1 + run.dungeon * 0.5) * (run.hard ? 1.4 : 1),
    );
  save.gold += gold;
  run.gold += gold;
  run.xp += xp;
  save.kills++;
  gainXP(xp);
  if (e.boss || Math.random() < 0.16) {
    let q: number;
    const roll = Math.random();
    if (e.boss && run.hard) {
      q = save.pity >= 9 || roll < 0.12 ? 3 : roll < 0.65 ? 2 : 1;
      save.pity = q === 3 ? 0 : save.pity + 1;
    } else
      q =
        roll < (e.boss ? 0.025 : 0.008)
          ? 3
          : roll < (e.boss ? 0.28 : 0.1)
            ? 2
            : roll < 0.65
              ? 1
              : 0;
    if (e.boss) q = Math.max(1, q);
    const base = [1, 5, 10][run.dungeon] + (run.hard ? 3 : 0);
    const level = Math.min(
      15,
      Math.max(
        1,
        Math.min(save.level, base + Math.floor(Math.random() * 4) + run.room),
      ),
    );
    if (
      e.boss &&
      run.dungeon === 0 &&
      (!save.specialIntro || Math.random() < (run.hard ? 0.55 : 0.35))
    ) {
      const choices: SpecialId[] = ["reprisal", "returning", "wildfire"];
      const special = save.specialIntro
        ? choices[Math.floor(Math.random() * choices.length)]
        : "reprisal";
      addItem(createSpecialItem(level, q, special));
      save.specialIntro = true;
    } else addItem(createItem(level, q, run.dungeon));
  }
  store();
}
function finish(win: boolean) {
  world.combat.clearBlessings();
  resultWin = win;
  bridge.mode = "result";
  bridge.paused = false;
  save.runs++;
  const run = bridge.run!;
  if (win && !run.hard && !save.cleared.includes(run.dungeon))
    save.cleared.push(run.dungeon);
  store();
  render();
}
function renderResult() {
  const run = bridge.run!;
  document.querySelector("#page-top")!.innerHTML =
    `<div class="page-heading"><div><div class="eyebrow">THE JOURNEY CONTINUES</div><h1>冒险结算</h1></div></div>`;
  document.querySelector("#scene-ui")!.innerHTML =
    `<div class="result-panel"><div class="result-emblem">${icon(resultWin ? "star" : "helm", 48)}</div><div class="eyebrow">${resultWin ? "DUNGEON CLEARED" : "REST, AND RISE AGAIN"}</div><h2>${resultWin ? "黑暗暂退，余烬尚存。" : "歇息片刻，再度启程。"}</h2><p>${dungeons[run.dungeon].name} · ${run.hard ? "困难" : "普通"} · ${resultWin ? "已通关" : "已拾取奖励全部保留"}</p><div class="result-stats"><div><small>冒险用时</small><b>${formatTime(run.time)}</b></div><div><small>获得金币</small><b>+${run.gold}</b></div><div><small>获得经验</small><b>+${run.xp}</b></div><div><small>获得装备</small><b>${run.items.length}</b></div></div><div class="result-loot">${
      save.bag
        .filter((i) => run.items.includes(i.id))
        .slice(-6)
        .map(
          (i) =>
            `<span style="color:${colors[i.quality]}">${icon("sword", 15)} ${i.name}</span>`,
        )
        .join("") || "整装待发，新的宝藏仍在前方"
    }</div><div class="result-buttons"><button class="button secondary" data-action="return">返回营地</button><button class="button secondary" data-action="bag">整理装备</button><button class="button primary" data-action="retry">再次挑战 ${icon("arrow", 17)}</button></div></div>`;
  document.querySelector("#scene-bottom")!.innerHTML =
    "<span>所有收益已自动保存</span><span>胜利不是终点。</span>";
  document.querySelector("#below")!.innerHTML = campBelow();
}
/** 确认选择后才解除暂停，重复点击无法再次获取同一能力。 */
function selectBlessing(id: BlessingId) {
  if (!world.combat.chooseBlessing(id)) return;
  closeOverlay();
  notify(`获得本局祝福 · ${blessings[id].name} · 前往右侧传送门或按Enter继续`);
}
function openOverlay(type: string) {
  if (world.combat.boons.offers.length && type !== "blessing") {
    notify("先选择本房间的祝福，或撤离并保留已拾取奖励。");
    return;
  }
  overlay = type;
  bridge.paused = true;
  if (type === "bag" && !selectedItem) selectedItem = save.bag[0]?.id ?? "";
  renderOverlay();
}
function closeOverlay() {
  if (world.combat.boons.offers.length) return;
  overlay = "";
  document.querySelector("#modal-root")!.innerHTML = "";
  bridge.paused = document.hidden;
  store();
  renderHud();
}
/** 装备详情和比较面板共用固定特效说明。 */
function specialDetails(item: Item) {
  if (!item.special) return "";
  const special = specialItems[item.special];
  return `<div class="special-detail"><strong>◆ ${special.build}</strong><p>${special.description}</p><small>来源：枯骨墓道首领 · 紫色及以上 · 独立特效装备不计入套装件数</small></div>`;
}
function itemDetails(i: Item) {
  return `<span class="item-quality" style="color:${colors[i.quality]}">${qualities[i.quality]} · ${slotNames[i.slot]} · Lv.${i.level}</span><h3 style="color:${colors[i.quality]}">${escapeText(i.name)}</h3><div class="item-base">${i.slot === "weapon" || i.slot === "ring" || i.slot === "charm" ? "攻击" : "防御"} <b>+${i.base}</b></div><div class="affixes">${i.affixes.map((a) => `<p>${statNames[a.stat]} <b>+${a.value}${["crit", "speed", "skill", "cdr"].includes(a.stat) ? "%" : ""}</b></p>`).join("") || "<p>无额外词条</p>"}</div>${specialDetails(i)}${i.set !== undefined ? `<div class="set-detail"><strong>${sets[i.set].name}套装</strong><p>2 件：${sets[i.set].two}</p><p>4 件：${sets[i.set].four}</p></div>` : ""}`;
}
function renderOverlay() {
  const root = document.querySelector("#modal-root")!;
  let body = "";
  if (overlay === "blessing") {
    const boons = world.combat.boons;
    body = `<div class="blessing-heading"><div class="eyebrow">A SPARK FOR THIS JOURNEY</div><h2>灰烬的馈赠</h2><p>第 ${boons.selected.length + 1} / 3 次选择 · 三选一 · 本局有效</p><small>已选：${boons.selected.map((id) => blessings[id].name).join(" · ") || "尚未选择，本次决定你的方向"}</small></div><div class="blessing-grid">${boons.offers.map((id, index) => `<button class="blessing-card blessing-${blessings[id].group}" data-boon="${id}"><span>${blessingGroups[blessings[id].group]} · <kbd>${index + 1}</kbd></span><h3>${blessings[id].name}</h3><p>${blessings[id].description}</p><small>${boons.affinity(id, save) ? "与你的装备或已选能力呼应" : "探索新的组合方向"}</small><b>选择此祝福 →</b></button>`).join("")}</div><div class="blessing-actions"><button class="button secondary" data-action="reroll-boons" ${boons.rerolls === 0 ? "disabled" : ""}>刷新整组选项 · 剩余 ${boons.rerolls} 次 <kbd>R</kbd></button><small>时间与战斗已暂停 · 等级、装备与掉落永久保留，祝福在本局结束后清除</small><button class="text-button" data-action="abandon">撤离 · 保留奖励</button></div>`;
  } else if (overlay === "blessing-info") {
    body = `<div class="modal-title"><h2>本局祝福</h2><button class="icon-button" data-action="close" aria-label="关闭">${icon("cross")}</button></div><div class="settings-content">${world.combat.boons.selected.map((id) => `<div class="active-special"><strong>${blessings[id].name} · ${blessingGroups[blessings[id].group]}</strong><p>${blessings[id].description}</p></div>`).join("") || "每清完一个墓道战斗房间，可从三个祝福中选择一个。"}<p>整局免费刷新一次；本局结束、撤离或刷新页面后祝福清除，已获得的永久奖励仍保留。</p></div>`;
  } else if (overlay === "bag") {
    const s = stats(save),
      item = save.bag.find((i) => i.id === selectedItem),
      wear = item ? save.equipped[item.slot] : undefined;
    body = `<div class="modal-title"><div><div class="eyebrow">YOUR JOURNEY, YOUR BUILD</div><h2>行囊与装备 <span>${save.bag.length} / 60</span></h2></div><button class="icon-button" data-action="close" aria-label="关闭">${icon("cross")}</button></div><div class="inventory-layout"><div class="equipment-column"><h4>灰烬剑士 · Lv.${save.level}</h4><div class="equipped-list">${slots
      .map((slot) => {
        const i = save.equipped[slot];
        return `<div class="equipped"><span>${icon(slotIcon(slot), 19)}</span><div><small>${slotNames[slot]}</small><b style="color:${i ? colors[i.quality] : "#68746a"}">${i ? escapeText(i.name) : "尚未穿戴"}</b></div>${i ? `<button data-unequip="${slot}" title="卸下装备">↙</button>` : ""}</div>`;
      })
      .join(
        "",
      )}</div><div class="stat-grid">${(["attack", "health", "defense", "crit", "speed", "skill", "cdr"] as const).map((k) => `<span>${statNames[k]}<b>${s[k]}${["crit", "speed", "skill", "cdr"].includes(k) ? "%" : ""}</b></span>`).join("")}</div><div class="set-counts">${sets.map((set, i) => `<span class="${s.counts[i] >= 2 ? "lit" : ""}" title="${set.two}；${set.four}">${set.name} ${s.counts[i]}/4</span>`).join("")}</div>${s.specials.map((id) => `<div class="active-special"><strong>◆ ${specialItems[id].build}</strong><p>${specialItems[id].description}</p></div>`).join("")}</div><div class="bag-column"><div class="bag-toolbar"><span>全部装备 <small>按掉落顺序</small></span><button data-action="sell-common">出售白蓝装备</button></div><div class="bag-grid">${Array.from(
      { length: 60 },
      (_, n) => {
        const i = save.bag[n];
        return i
          ? `<button class="bag-item ${selectedItem === i.id ? "selected" : ""}" data-item="${i.id}" style="--quality:${colors[i.quality]}" title="${escapeText(i.name)}${i.special ? " · 特效装备" : ""}">${icon(slotIcon(i.slot), 26)}<small>${i.level}</small>${i.locked ? "<i>◆</i>" : ""}</button>`
          : '<div class="bag-empty"></div>';
      },
    ).join(
      "",
    )}</div><p class="bag-help">选择装备查看属性 · 锁定装备不会被出售</p></div><div class="detail-column">${item ? `${itemDetails(item)}<div class="comparison"><small>当前穿戴</small>${wear ? `<strong style="color:${colors[wear.quality]}">${escapeText(wear.name)} · Lv.${wear.level}</strong><p>基础属性差值 <b class="${item.base >= wear.base ? "positive" : "negative"}">${item.base >= wear.base ? "+" : ""}${item.base - wear.base}</b></p><div class="compare-affixes">${wear.affixes.map((a) => `<p>${statNames[a.stat]} +${a.value}${["crit", "speed", "skill", "cdr"].includes(a.stat) ? "%" : ""}</p>`).join("") || "<p>无额外词条</p>"}${specialDetails(wear)}${wear.set !== undefined ? `<p>${sets[wear.set].name}：${sets[wear.set].two} / ${sets[wear.set].four}</p>` : ""}</div>` : "<p>该部位尚未穿戴装备</p>"}</div><button class="button primary" data-action="equip" ${item.level > save.level ? "disabled" : ""}>${item.level > save.level ? "需要等级 " + item.level : "穿戴装备"}</button><div class="item-actions"><button data-action="lock">${icon("lock", 14)} ${item.locked ? "解锁" : "锁定"}</button><button data-action="sell" ${item.locked ? "disabled" : ""}>出售 · ${price(item)} 金币</button></div>` : '<div class="empty-details">' + icon("bag", 42) + "<h3>等待新的战利品</h3><p>探索地下城，收集属于你的装备。</p></div>"}</div></div>`;
  } else if (overlay === "settings") {
    body = `<div class="modal-title"><h2>游戏设置</h2><button class="icon-button" data-action="close" aria-label="关闭">${icon("cross")}</button></div><div class="settings-content"><label><div><strong>战斗音效</strong><p>攻击、受击与装备掉落的声音</p></div><input type="checkbox" data-setting="sound" ${save.settings.sound ? "checked" : ""}></label><label><div><strong>屏幕震动</strong><p>命中与受击时的轻微反馈</p></div><input type="checkbox" data-setting="shake" ${save.settings.shake ? "checked" : ""}></label><div class="controls-list"><h4>冒险者操作指南</h4><p>WASD / 方向键 移动 · J 普攻</p><p>K 点按快斩，长按0.8秒蓄力，松开释放；蓄力中Space取消。</p><p>迎着即将命中的攻击闪避，触发精准闪避；1.8秒内J强化反击。</p><p>L 旋刃（3级） · U 突袭（5级） · Space 闪避</p><p>B 背包 · Esc 暂停 · Enter 下一房间 · F 全屏</p><small>进度保存在当前浏览器。清理网站数据会删除存档。</small></div><div class="settings-actions"><button class="button secondary" data-action="export">导出存档</button><label class="button secondary">导入存档<input type="file" id="import-save" accept="application/json" hidden></label></div></div>`;
  } else if (overlay === "corrupt") {
    body = `<div class="modal-title"><h2>存档需要处理</h2></div><div class="settings-content"><p>当前存档及备份无法读取。原始数据尚未覆盖，下载备份后可以保留原始记录。</p><div class="settings-actions"><button class="button secondary" data-action="export-raw">下载原始存档</button><button class="button primary" data-action="reset-corrupt">重新开始</button></div></div>`;
  } else {
    body = `<div class="pause-content"><div class="eyebrow">TAKE A BREATH</div><h2>篝火仍在等你。</h2><p>冒险已暂停，时间与冷却均已停止。</p><button class="button primary" data-action="close">继续冒险 ${icon("play", 16)}</button><button class="button secondary" data-action="bag">整理装备</button><button class="text-button" data-action="abandon">撤离回营地 · 保留已拾取奖励</button></div>`;
  }
  root.innerHTML = `<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="${overlay === "bag" ? "行囊与装备" : "游戏菜单"}" class="modal ${overlay === "bag" ? "inventory-modal" : overlay === "blessing" ? "blessing-modal" : "small-modal"}">${body}</section></div>`;
}
function startRun() {
  if (storageBlocked) return;
  bridge.mode = "battle";
  bridge.paused = false;
  active = "dungeons";
  document.querySelector(".content")!.classList.add("combat-view");
  world.start(selectedDungeon, hard);
  render();
  audio("skill");
}
function returnCamp() {
  world.combat.clearBlessings();
  document.querySelector(".content")!.classList.remove("combat-view");
  bridge.mode = "camp";
  bridge.run = null;
  bridge.paused = false;
  overlay = "";
  document.querySelector("#modal-root")!.innerHTML = "";
  active = "camp";
  world.player.hp = stats(save).health;
  render();
  store();
}
function download(data: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
app.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>(
    "button,[data-nav]",
  );
  if (!button || button.hasAttribute("disabled")) return;
  if (button.dataset.boon) {
    selectBlessing(button.dataset.boon as BlessingId);
    return;
  }
  const nav = button.dataset.nav;
  if (nav) {
    openPage(nav);
    return;
  }
  if (button.dataset.dungeon !== undefined) {
    selectedDungeon = Number(button.dataset.dungeon);
    hard = false;
    render();
    return;
  }
  if (button.dataset.difficulty) {
    hard = button.dataset.difficulty === "hard";
    render();
    return;
  }
  if (button.dataset.item) {
    selectedItem = button.dataset.item;
    renderOverlay();
    return;
  }
  if (button.dataset.unequip) {
    const slot = button.dataset.unequip as (typeof slots)[number],
      i = save.equipped[slot];
    if (i) {
      if (save.bag.length >= 60) {
        notify("背包已满，无法卸下");
        return;
      }
      save.bag.push(i);
      delete save.equipped[slot];
      world.player.hp = Math.min(world.player.hp, stats(save).health);
      store();
      renderOverlay();
    }
    return;
  }
  const action = button.dataset.action;
  const item = save.bag.find((i) => i.id === selectedItem);
  switch (action) {
    case "enter":
      if (
        isUnlocked(selectedDungeon) &&
        (!hard || save.cleared.includes(selectedDungeon))
      )
        startRun();
      break;
    case "retry":
      selectedDungeon = bridge.run!.dungeon;
      hard = bridge.run!.hard;
      startRun();
      break;
    case "return":
      returnCamp();
      break;
    case "pause":
      openOverlay("pause");
      break;
    case "close":
      if (!storageBlocked) closeOverlay();
      break;
    case "settings":
      openOverlay("settings");
      break;
    case "bag":
      openOverlay("bag");
      break;
    case "abandon":
      world.combat.clearBlessings();
      closeOverlay();
      finish(false);
      break;
    case "reroll-boons":
      if (world.combat.boons.reroll(save, world.player.hp)) renderOverlay();
      break;
    case "blessing-info":
      openOverlay("blessing-info");
      break;
    case "equip":
      if (item && item.level <= save.level) {
        const old = save.equipped[item.slot];
        save.bag.splice(save.bag.indexOf(item), 1);
        if (old) save.bag.push(old);
        save.equipped[item.slot] = item;
        selectedItem = old?.id ?? save.bag[0]?.id ?? "";
        world.player.hp = Math.min(world.player.hp, stats(save).health);
        store();
        renderOverlay();
        notify("已穿戴 " + item.name);
      }
      break;
    case "lock":
      if (item) {
        item.locked = !item.locked;
        store();
        renderOverlay();
      }
      break;
    case "sell":
      if (item && !item.locked) {
        save.gold += price(item);
        save.bag.splice(save.bag.indexOf(item), 1);
        selectedItem = save.bag[0]?.id ?? "";
        store();
        renderOverlay();
        document.querySelector("#gold")!.textContent =
          save.gold.toLocaleString();
      }
      break;
    case "sell-common": {
      const items = save.bag.filter((i) => i.quality <= 1 && !i.locked);
      const value = items.reduce((sum, i) => sum + price(i), 0);
      save.bag = save.bag.filter((i) => !items.includes(i));
      save.gold += value;
      store();
      renderOverlay();
      document.querySelector("#gold")!.textContent = save.gold.toLocaleString();
      notify(`出售 ${items.length} 件装备，获得 ${value} 金币`);
      break;
    }
    case "buy":
      if (save.gold < shopCost()) {
        notify("金币不足，去地下城寻找更多战利品。");
        break;
      }
      if (save.bag.length >= 60) {
        notify("背包已满，请先整理行囊。");
        break;
      }
      save.gold -= shopCost();
      addItem(createItem(save.level, Math.random() < 0.15 ? 2 : 1));
      store();
      render();
      break;
    case "export":
      download(JSON.stringify(save, null, 2), "灰烬边境-存档.json");
      break;
    case "export-raw":
      download(
        localStorage.getItem("ashen-frontier-v1") ?? "{}",
        "灰烬边境-损坏存档.json",
      );
      break;
    case "reset-corrupt":
      storageBlocked = false;
      save = freshSave();
      bridge.save = save;
      store();
      closeOverlay();
      returnCamp();
      break;
  }
});
app.addEventListener("change", async (e) => {
  const target = e.target as HTMLInputElement;
  if (target.dataset.setting) {
    save.settings[target.dataset.setting as "sound" | "shake"] = target.checked;
    store();
  }
  if (target.id === "import-save" && target.files?.[0]) {
    try {
      const data = JSON.parse(await target.files[0].text());
      if (!validateSave(data)) throw Error();
      save = data;
      bridge.save = save;
      store();
      closeOverlay();
      returnCamp();
      notify("存档已导入");
    } catch {
      notify("存档格式无效，当前进度未改变。");
    }
  }
});
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (world.combat.boons.offers.length) {
    if (e.repeat) return;
    const index = Number(e.code.replace("Digit", "")) - 1;
    const choice = world.combat.boons.offers[index];
    if (choice) selectBlessing(choice);
    else if (
      e.code === "KeyR" &&
      world.combat.boons.reroll(save, world.player.hp)
    )
      renderOverlay();
    e.preventDefault();
    return;
  }
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
      e.code,
    )
  )
    e.preventDefault();
  if (e.repeat) return;
  if (e.code === "KeyB") {
    if (overlay === "bag") closeOverlay();
    else if (!storageBlocked) openOverlay("bag");
  }
  if (e.code === "Escape" && !storageBlocked) {
    if (overlay) closeOverlay();
    else if (bridge.mode === "battle") openOverlay("pause");
  }
  if (e.code === "KeyF") {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => notify("浏览器暂不支持全屏"));
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && bridge.mode === "battle" && !overlay)
    openOverlay("pause");
});
window.addEventListener("blur", () => {
  if (bridge.mode === "battle" && !overlay) openOverlay("pause");
});
setInterval(renderHud, 120);
Object.assign(window, {
  render_game_to_text: () => JSON.stringify(world.snapshot()),
  advanceTime: (ms: number) => {
    for (let i = 0; i < Math.ceil(ms / (1000 / 60)); i++) world.step(1 / 60);
    world.draw();
    renderHud();
  },
  setManualTime: (enabled: boolean) => {
    world.manualTime = enabled;
  },
});
render();
if (storageBlocked) openOverlay("corrupt");
else if (storageWarning) notify(storageWarning);
