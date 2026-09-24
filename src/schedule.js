// 排程规则：试磨队列的先后顺序、放行判定、复看放行与失效重排。
import { stoneState, validTests, nextEvent, uid, TURBIDITY_LIMIT } from "./cleaning.js";

export { TURBIDITY_LIMIT };

// 烟料深浅，由浅到深；换到更浅烟料须另一人复看磨面。
export const SOOT_LEVELS = ["轻烟", "中烟", "重烟", "重油烟", "陈墨"];
export const QUEUE_STATUS = ["待清洗", "待复看", "排队中", "已完成", "已失效"];
export const ACTIVE_STATUS = ["待清洗", "待复看", "排队中"];

export function sootRank(depth) {
  return SOOT_LEVELS.indexOf(depth);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

// 放行判定：磨石未清洗或浊度高于二度 → 待清洗；换更浅烟料 → 待复看；否则排队中。
export function decideStatus(db, stoneId, sootDepth) {
  const state = stoneState(db, stoneId);
  if (state.needsCleaning) return "待清洗";
  if (state.prevSootDepth && sootRank(sootDepth) < sootRank(state.prevSootDepth)) return "待复看";
  return "排队中";
}

function nextQueueSeq(db) {
  return (db.queue || []).reduce((max, e) => Math.max(max, e.seq || 0), 0) + 1;
}

function nextTestSeq(db, stoneId) {
  return (db.tests || []).filter(t => t.stoneId === stoneId).reduce((max, t) => Math.max(max, t.seq || 0), 0) + 1;
}

// 排入试磨：按先后顺序取号，记下排入时的上一锭、清洗次数与浊度。
export function enqueue(db, { stoneId, inkCode, sootDepth, createdBy, note }) {
  const state = stoneState(db, stoneId);
  const entry = {
    id: uid("Q"),
    seq: nextQueueSeq(db),
    n: nextEvent(db),
    stoneId,
    inkCode,
    sootDepth,
    createdBy,
    createdAt: new Date().toISOString(),
    prevInkCode: state.prevInkCode,
    cleanCount: state.cleanCount,
    turbidity: state.lastTurbidity,
    status: decideStatus(db, stoneId, sootDepth),
    review: null,
    note: note || ""
  };
  db.queue.push(entry);
  return entry;
}

// 清洗、更正或试磨完成后，按当前磨石状态重排该磨石所有未结队列。
export function refreshStoneQueue(db, stoneId) {
  const pending = (db.queue || [])
    .filter(e => e.stoneId === stoneId && ACTIVE_STATUS.includes(e.status))
    .sort((a, b) => a.seq - b.seq);
  for (const entry of pending) {
    entry.review = null;
    entry.status = decideStatus(db, stoneId, entry.sootDepth);
  }
}

// 复看：换更浅烟料前，由另一人确认磨面无残墨才排入；发现残墨退回待清洗。
export function reviewEntry(db, entryId, { reviewer, result }) {
  const entry = (db.queue || []).find(e => e.id === entryId);
  if (!entry) throw badRequest("队列记录不存在");
  if (entry.status !== "待复看") throw badRequest("当前状态无需复看");
  if (!reviewer) throw badRequest("请填写复看人");
  const state = stoneState(db, entry.stoneId);
  if (reviewer === state.lastCleaner) throw badRequest("复看须由另一人进行，清洗人不能复看");
  if (reviewer === entry.createdBy) throw badRequest("复看须由另一人进行，提交人不能复看");
  entry.review = { by: reviewer, at: new Date().toISOString(), result };
  if (result === "无残墨") {
    entry.status = "排队中";
  } else {
    entry.status = "待清洗";
    entry.note = "复看发现残墨，退回待清洗";
  }
  return entry;
}

export function isHead(db, entry) {
  return !(db.queue || []).some(e => e.stoneId === entry.stoneId && ACTIVE_STATUS.includes(e.status) && e.seq < entry.seq);
}

// 完成试磨：仅队首且已放行可试磨；记录烟料深浅、清洗次数、冲洗水浊度和上一锭编号。
export function completeEntry(db, entryId, input) {
  const entry = (db.queue || []).find(e => e.id === entryId);
  if (!entry) throw badRequest("队列记录不存在");
  if (entry.status !== "排队中") throw badRequest("未放行，不能试磨（待清洗/待复看）");
  if (!isHead(db, entry)) throw badRequest("需按先后顺序试磨");
  const state = stoneState(db, entry.stoneId);
  if (state.needsCleaning) throw badRequest(state.reason + "，只能待清洗");
  const score = Number(input.score || 0);
  const at = new Date().toISOString();
  const test = {
    id: uid("T"),
    seq: nextTestSeq(db, entry.stoneId),
    n: nextEvent(db),
    queueId: entry.id,
    stoneId: entry.stoneId,
    inkCode: entry.inkCode,
    sootDepth: entry.sootDepth,
    prevInkCode: state.prevInkCode,
    cleanCount: state.cleanCount,
    turbidity: state.lastTurbidity,
    operator: input.operator || entry.createdBy,
    paper: input.paper || "",
    speed: input.speed || "",
    colorLayer: input.colorLayer || "",
    score,
    at,
    status: "有效",
    history: []
  };
  db.tests.push(test);
  entry.status = "已完成";
  entry.testId = test.id;
  entry.completedAt = at;
  const item = (db.items || []).find(x => x.code === entry.inkCode || x.id === entry.inkCode);
  if (item) {
    item.tests ||= [];
    item.tests.push({ at, paper: test.paper, speed: test.speed, colorLayer: test.colorLayer, score });
    item.logs ||= [];
    item.logs.push({ at, step: "试磨", note: `${entry.sootDepth} · ${entry.stoneId} · 上一锭${test.prevInkCode} · 评分${score}`, score });
    item.status = score >= 85 ? "已试磨" : "重点观察";
  }
  refreshStoneQueue(db, entry.stoneId);
  return { test, entry };
}

// 失效重排：更正上一锭或清洗记录后，其后试磨立即失效，旧结果留在履历，重新排队。
export function invalidateAfter(db, stoneId, n, reason) {
  const at = new Date().toISOString();
  const affected = validTests(db, stoneId).filter(t => t.n > n);
  for (const test of affected) {
    test.status = "已失效";
    test.invalidReason = reason;
    test.invalidatedAt = at;
    test.history ||= [];
    test.history.push({ at, note: "失效重排：" + reason });
    const item = (db.items || []).find(x => x.code === test.inkCode || x.id === test.inkCode);
    if (item) {
      item.logs ||= [];
      item.logs.push({ at, step: "失效", note: `试磨失效重排：${reason}` });
    }
    enqueue(db, { stoneId, inkCode: test.inkCode, sootDepth: test.sootDepth, createdBy: "系统重排", note: "重排：" + reason });
  }
  refreshStoneQueue(db, stoneId);
  return affected;
}

// 更正上一锭编号：原值留履历，其后试磨立即失效重排。
export function correctTestPrevInk(db, testId, { prevInkCode, corrector }) {
  const test = (db.tests || []).find(t => t.id === testId);
  if (!test) throw badRequest("试磨记录不存在");
  if (test.status === "已失效") throw badRequest("已失效记录不可更正");
  if (!prevInkCode) throw badRequest("请填写更正后的上一锭编号");
  const old = test.prevInkCode;
  test.history ||= [];
  test.history.push({ at: new Date().toISOString(), by: corrector || "", note: `上一锭编号由 ${old} 更正为 ${prevInkCode}` });
  test.prevInkCode = prevInkCode;
  const invalidated = invalidateAfter(db, test.stoneId, test.n, `上一锭更正（${test.inkCode}：${old}→${prevInkCode}）`);
  return { test, invalidated: invalidated.length };
}
