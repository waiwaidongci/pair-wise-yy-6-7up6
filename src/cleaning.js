// 清洗记录：磨石清洗的登记、更正与洁净状态判定。
// 规则：磨石未清洗、清洗后又被磨脏（磨过一锭或复看见残墨），
// 或最新冲洗水浊度高于二度时，磨石一律视为待清洗。

export const TURBIDITY_LIMIT = 2; // 冲洗水浊度上限（度），高于此值不合格

export function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function latestCleaning(stone) {
  const list = stone.cleanings || [];
  return list.length ? list[list.length - 1] : null;
}

export function needsCleaning(stone) {
  const cleaning = latestCleaning(stone);
  if (!cleaning) return true; // 磨石未清洗
  if (stone.dirtySince && Date.parse(cleaning.at) < Date.parse(stone.dirtySince)) return true; // 清洗后又磨过或复看见残墨
  return Number(cleaning.turbidity) > TURBIDITY_LIMIT; // 浊度高于二度
}

export function stoneView(stone) {
  return { ...stone, latestCleaning: latestCleaning(stone), needsCleaning: needsCleaning(stone) };
}

export function addStone(db, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) fail("请填写磨石名称");
  const id = "STONE-" + String(db.stones.length + 1).padStart(2, "0");
  const stone = { id, name: trimmed, cleanings: [], dirtySince: null, lastGroundCode: "" };
  db.stones.push(stone);
  return stone;
}

export function addCleaning(stone, input, at) {
  const times = Number(input.times);
  const turbidity = Number(input.turbidity);
  const cleanedBy = String(input.cleanedBy || "").trim();
  if (!Number.isInteger(times) || times < 1) fail("清洗次数须为不小于 1 的整数");
  if (!Number.isFinite(turbidity) || turbidity < 0) fail("冲洗水浊度须为不小于 0 的数值");
  if (!cleanedBy) fail("请填写清洗人");
  const rec = {
    id: "CL-" + String((stone.cleanings || []).length + 1).padStart(3, "0"),
    at,
    times,
    turbidity,
    cleanedBy,
    note: String(input.note || ""),
    revisions: []
  };
  stone.cleanings ||= [];
  stone.cleanings.push(rec);
  return rec;
}

export function correctCleaning(stone, cleaningId, patch, at) {
  const rec = (stone.cleanings || []).find(c => c.id === cleaningId);
  if (!rec) fail("清洗记录不存在");
  const before = { times: rec.times, turbidity: rec.turbidity, cleanedBy: rec.cleanedBy, note: rec.note };
  const next = {
    times: patch.times !== undefined ? Number(patch.times) : rec.times,
    turbidity: patch.turbidity !== undefined ? Number(patch.turbidity) : rec.turbidity,
    cleanedBy: patch.cleanedBy !== undefined ? String(patch.cleanedBy).trim() : rec.cleanedBy,
    note: patch.note !== undefined ? String(patch.note) : rec.note
  };
  if (!Number.isInteger(next.times) || next.times < 1) fail("清洗次数须为不小于 1 的整数");
  if (!Number.isFinite(next.turbidity) || next.turbidity < 0) fail("冲洗水浊度须为不小于 0 的数值");
  if (!next.cleanedBy) fail("请填写清洗人");
  rec.revisions ||= [];
  rec.revisions.push({ at, before }); // 旧值留在清洗履历
  Object.assign(rec, next, { correctedAt: at });
  return rec;
}

// 受某次清洗更正波及的清洗记录 id：该次及其后的全部清洗
export function affectedCleaningIds(stone, cleaning) {
  return (stone.cleanings || [])
    .filter(c => Date.parse(c.at) >= Date.parse(cleaning.at))
    .map(c => c.id);
}
