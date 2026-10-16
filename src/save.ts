import { freshSave, slots, specialItems, type Save, type Item } from "./data";
const key = "ashen-frontier-v1";
export let storageWarning = "";
function validItem(value: unknown): value is Item {
  if (!value || typeof value !== "object") return false;
  const i = value as Item;
  return (
    typeof i.id === "string" &&
    typeof i.name === "string" &&
    slots.includes(i.slot) &&
    Number.isInteger(i.level) &&
    i.level >= 1 &&
    i.level <= 15 &&
    Number.isInteger(i.quality) &&
    i.quality >= 0 &&
    i.quality <= 3 &&
    Number.isFinite(i.base) &&
    Array.isArray(i.affixes) &&
    i.affixes.every(
      (a) =>
        [
          "attack",
          "health",
          "defense",
          "crit",
          "speed",
          "skill",
          "cdr",
        ].includes(a.stat) && Number.isFinite(a.value),
    ) &&
    (i.set === undefined || [0, 1, 2].includes(i.set)) &&
    (i.special === undefined ||
      (Object.hasOwn(specialItems, i.special) &&
        specialItems[i.special].slot === i.slot &&
        i.quality >= 2 &&
        i.set === undefined))
  );
}
export function validateSave(value: unknown): value is Save {
  if (!value || typeof value !== "object") return false;
  const s = value as Save;
  return (
    s.version === 1 &&
    (s.specialIntro === undefined || typeof s.specialIntro === "boolean") &&
    Number.isInteger(s.level) &&
    s.level >= 1 &&
    s.level <= 15 &&
    [s.xp, s.gold, s.pity, s.kills, s.runs].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) &&
    Array.isArray(s.bag) &&
    s.bag.length <= 60 &&
    s.bag.every(validItem) &&
    !!s.equipped &&
    Object.entries(s.equipped).every(
      ([k, v]) =>
        slots.includes(k as (typeof slots)[number]) &&
        validItem(v) &&
        v.slot === k,
    ) &&
    Array.isArray(s.cleared) &&
    s.cleared.every((n) => Number.isInteger(n) && n >= 0 && n <= 2) &&
    !!s.settings &&
    typeof s.settings.sound === "boolean" &&
    typeof s.settings.shake === "boolean"
  );
}
export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return freshSave();
    try {
      const s = JSON.parse(raw);
      if (validateSave(s)) return s;
    } catch {}
    const backup = localStorage.getItem(key + "-backup");
    if (backup) {
      try {
        const s = JSON.parse(backup);
        if (validateSave(s)) {
          storageWarning = "已从备份恢复冒险进度";
          return s;
        }
      } catch {}
    }
    storageWarning =
      "存档无法读取。原始数据已保留，请在提示中选择是否重新开始。";
    return freshSave();
  } catch {
    storageWarning = "浏览器禁止本地存储，本次进度无法保存。";
    return freshSave();
  }
}
export function persist(save: Save) {
  try {
    const previous = localStorage.getItem(key);
    if (previous) {
      try {
        if (validateSave(JSON.parse(previous)))
          localStorage.setItem(key + "-backup", previous);
      } catch {}
    }
    localStorage.setItem(key, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}
