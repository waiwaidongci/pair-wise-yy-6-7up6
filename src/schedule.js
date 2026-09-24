// 排程规则：试磨队列按先后顺序排队。
// - 磨石未清洗或冲洗水浊度高于二度时，试磨只能待清洗；
// - 换到更浅烟料前，须由另一人复看磨面，确认无残墨才排入；
// - 更正上一锭或清洗记录后，其后试磨立即失效重排，旧结果留在履历。
import {
  fail, latestCleaning, needsCleaning,
  addCleaning, correctCleaning, affectedCleaningIds, stoneView
} from "./cleaning.js";

export const QUEUE_STAGES = ["待清洗", "待复看", "排队中", "已试磨"];
export const SOOT_DEPTHS = [[1, "1·轻烟"], [2, "2·偏轻"], [3, "3·中等"], [4, "4·偏重"], [5, "5·重油烟/陈墨"]];

const now = () => new Date().toISOString();
const trialsOf = (db, stoneId) => db.trials.filter(t => t.stoneId === stoneId).sort((a, b) => a.seq - b.seq);
const findStone = (db, stoneId) => db.stones.find(s => s.id === stoneId);

// 每次试磨记录清洗次数与冲洗水浊度：快照当前最近一次清洗
function refreshSnapshot(entry, stone) {
  const cleaning = latestCleaning(stone);
  entry.cleaningId = cleaning ? cleaning.id : null;
  entry.cleaningTimes = cleaning ? cleaning.times : 0;
  entry.turbidity = cleaning ? cleaning.turbidity : null;
}

function evaluate(entry, stone, prevEntry) {
  if (needsCleaning(stone)) return "待清洗"; // 磨石未清洗或浊度高于二度
  if (prevEntry && Number(entry.sootDepth) < Number(prevEntry.sootDepth)) {
    if (!entry.review || !entry.review.residueFree) return "待复看"; // 换更浅烟料须另一人复看无残墨
  }
  return "排队中";
}

// 按序号重排某块磨石上的全部未完成试磨
export function reevaluate(db, stoneId) {
  const stone = findStone(db, stoneId);
  if (!stone) return;
  let prev = null;
  for (const entry of trialsOf(db, stoneId)) {
    if (entry.status !== "已试磨") {
      refreshSnapshot(entry, stone);
      entry.status = evaluate(entry, stone, prev);
      entry.updatedAt = now();
    }
    prev = entry;
  }
}

export function queueView(db) {
  return {
    stones: db.stones.map(stoneView),
    trials: db.trials.slice().sort((a, b) => a.seq - b.seq)
  };
}

export function enqueueTrial(db, input) {
  const stone = findStone(db, input.stoneId);
  if (!stone) fail("磨石不存在");
  const item = db.items.find(x => x.code === input.itemCode || x.id === input.itemCode);
  if (!item) fail("墨锭不存在");
  const sootDepth = Number(input.sootDepth);
  if (!Number.isInteger(sootDepth) || sootDepth < 1 || sootDepth > 5) fail("烟料深浅须为 1 至 5 的整数");
  const operator = String(input.operator || "").trim();
  if (!operator) fail("请填写排入人");
  const list = trialsOf(db, stone.id);
  const prev = list[list.length - 1] || null;
  const declared = String(input.prevCode || "").trim();
  const seq = db.meta.nextSeq;
  db.meta.nextSeq += 1;
  const entry = {
    id: "TR-" + String(seq).padStart(3, "0"),
    seq,
    stoneId: stone.id,
    itemCode: item.code,
    sootDepth,
    prevCode: declared || (prev ? prev.itemCode : stone.lastGroundCode || ""), // 上一锭编号
    operator,
    review: null,
    result: null,
    history: [],
    invalidations: 0,
    createdAt: now(),
    updatedAt: now()
  };
  db.trials.push(entry);
  reevaluate(db, stone.id);
  return entry;
}

export function recordCleaning(db, stoneId, input) {
  const stone = findStone(db, stoneId);
  if (!stone) fail("磨石不存在");
  const rec = addCleaning(stone, input, now());
  for (const entry of trialsOf(db, stoneId)) {
    if (entry.status !== "已试磨") entry.review = null; // 重新清洗后磨面已变，复看结论作废
  }
  reevaluate(db, stoneId);
  return rec;
}

export function reviewEntry(db, entryId, input) {
  const entry = db.trials.find(t => t.id === entryId);
  if (!entry) fail("试磨记录不存在");
  if (entry.status !== "待复看") fail("当前状态无需复看");
  const reviewer = String(input.reviewer || "").trim();
  if (!reviewer) fail("请填写复看人");
  const stone = findStone(db, entry.stoneId);
  const cleaning = latestCleaning(stone);
  if (reviewer === entry.operator) fail("复看须由另一人进行，不能是排入人");
  if (cleaning && reviewer === cleaning.cleanedBy) fail("复看须由另一人进行，不能是清洗人");
  const residueFree = input.residueFree === true || input.residueFree === "true";
  entry.review = { by: reviewer, at: now(), residueFree };
  entry.history.push({ at: now(), type: "复看", note: reviewer + (residueFree ? " 确认磨面无残墨" : " 发现磨面有残墨") });
  if (!residueFree) stone.dirtySince = now(); // 磨面有残墨，视同未清干净
  reevaluate(db, entry.stoneId);
  return entry;
}

export function completeEntry(db, entryId, input) {
  const entry = db.trials.find(t => t.id === entryId);
  if (!entry) fail("试磨记录不存在");
  if (entry.status !== "排队中") fail("仅排队中的试磨可完成");
  const head = trialsOf(db, entry.stoneId).find(t => t.status === "排队中");
  if (!head || head.id !== entry.id) fail("须按先后顺序完成试磨");
  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) fail("评分须为 0 至 100");
  const at = now();
  entry.result = {
    at,
    paper: String(input.paper || ""),
    water: String(input.water || ""),
    speed: String(input.speed || ""),
    colorLayer: String(input.colorLayer || ""),
    sediment: String(input.sediment || ""),
    score,
    note: String(input.note || "")
  };
  entry.status = "已试磨";
  entry.completedAt = at;
  entry.updatedAt = at;
  const stone = findStone(db, entry.stoneId);
  stone.dirtySince = at; // 磨石用毕，须重新清洗才能试下一锭
  stone.lastGroundCode = entry.itemCode;
  const item = db.items.find(x => x.code === entry.itemCode);
  if (item) {
    item.tests ||= [];
    item.tests.push({ at, trialId: entry.id, stoneId: entry.stoneId, ...entry.result });
    item.status = score >= 85 ? "已试磨" : "重点观察";
    item.logs ||= [];
    item.logs.push({ at, step: "试磨", note: (entry.result.paper || "试纸") + "，评分" + score, score });
  }
  reevaluate(db, entry.stoneId);
  return entry;
}

// 其后试磨立即失效重排，旧结果留在履历
function invalidate(db, stoneId, predicate, reason) {
  const at = now();
  for (const entry of trialsOf(db, stoneId)) {
    if (!predicate(entry)) continue;
    if (entry.status === "已试磨" && entry.result) {
      entry.history.push({ at, type: "失效重排", reason, result: entry.result });
      entry.result = null;
      entry.completedAt = null;
      entry.invalidations = (entry.invalidations || 0) + 1;
      entry.status = "待清洗"; // 占位，随后统一重排
    }
    entry.review = null;
  }
  reevaluate(db, stoneId);
}

export function correctEntry(db, entryId, patch) {
  const entry = db.trials.find(t => t.id === entryId);
  if (!entry) fail("试磨记录不存在");
  const changes = [];
  if (patch.prevCode !== undefined && String(patch.prevCode).trim() !== entry.prevCode) {
    changes.push("上一锭编号 " + (entry.prevCode || "空") + " → " + String(patch.prevCode).trim());
    entry.prevCode = String(patch.prevCode).trim();
  }
  if (patch.sootDepth !== undefined) {
    const depth = Number(patch.sootDepth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 5) fail("烟料深浅须为 1 至 5 的整数");
    if (depth !== entry.sootDepth) {
      changes.push("烟料深浅 " + entry.sootDepth + " → " + depth);
      entry.sootDepth = depth;
    }
  }
  if (!changes.length) return entry;
  entry.history.push({ at: now(), type: "更正", note: changes.join("；") });
  entry.updatedAt = now();
  invalidate(db, entry.stoneId, t => t.seq > entry.seq, "更正 " + entry.id + "（" + changes.join("；") + "）");
  return entry;
}

export function correctCleaningRecord(db, stoneId, cleaningId, patch) {
  const stone = findStone(db, stoneId);
  if (!stone) fail("磨石不存在");
  const rec = correctCleaning(stone, cleaningId, patch, now());
  const ids = new Set(affectedCleaningIds(stone, rec));
  // 依托该次及其后清洗的试磨，全部失效重排
  invalidate(db, stoneId, t => t.cleaningId && ids.has(t.cleaningId), "清洗记录 " + rec.id + " 已更正");
  return rec;
}
