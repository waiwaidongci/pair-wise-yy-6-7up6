// 清洗记录业务：磨石清洗登记、清洗状态判定与清洗记录更正。
// 冲洗水浊度限值为二度，高于二度视为未清干净，磨石只能待清洗。
export const TURBIDITY_LIMIT = 2;

export function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 全局事件序号，用于比较"清洗"与"试磨"的先后。
export function nextEvent(db) {
  db.meta ||= { event: 0 };
  db.meta.event = (db.meta.event || 0) + 1;
  return db.meta.event;
}

export function cleaningRecords(db, stoneId) {
  return (db.cleaningRecords || []).filter(r => r.stoneId === stoneId).sort((a, b) => a.n - b.n);
}

export function validTests(db, stoneId) {
  return (db.tests || []).filter(t => t.stoneId === stoneId && t.status !== "已失效").sort((a, b) => a.seq - b.seq);
}

// 磨石当前状态：清洗次数、最近浊度、上一锭、是否只能待清洗。
// 磨过墨（含已失效的试磨）后未再清洗，或最近一次冲洗水浊度高于二度，都判定为待清洗。
export function stoneState(db, stoneId) {
  const records = cleaningRecords(db, stoneId);
  const lastClean = records[records.length - 1] || null;
  const tests = (db.tests || []).filter(t => t.stoneId === stoneId).sort((a, b) => a.n - b.n);
  const lastTest = tests[tests.length - 1] || null;
  let needsCleaning = true;
  let reason = "磨石未清洗";
  if (lastClean) {
    if (Number(lastClean.turbidity) > TURBIDITY_LIMIT) {
      reason = `冲洗水浊度${lastClean.turbidity}度，高于二度`;
    } else if (lastTest && lastTest.n > lastClean.n) {
      reason = "上次清洗后已试磨，磨石未再清洗";
    } else {
      needsCleaning = false;
      reason = "";
    }
  }
  return {
    stoneId,
    cleanCount: records.length,
    lastTurbidity: lastClean ? lastClean.turbidity : null,
    lastCleaner: lastClean ? lastClean.cleaner : null,
    lastCleanAt: lastClean ? lastClean.at : null,
    prevInkCode: lastTest ? lastTest.inkCode : "无",
    prevSootDepth: lastTest ? lastTest.sootDepth : null,
    needsCleaning,
    reason
  };
}

export function recordCleaning(db, { stoneId, cleaner, turbidity, note }) {
  const record = {
    id: uid("CL"),
    n: nextEvent(db),
    stoneId,
    cleaner,
    turbidity: Number(turbidity),
    note: note || "",
    at: new Date().toISOString(),
    history: []
  };
  db.cleaningRecords.push(record);
  return record;
}

// 更正清洗记录：原值留在 history，由排程规则负责其后试磨的失效重排。
export function correctCleaning(db, id, { turbidity, note, corrector }) {
  const record = (db.cleaningRecords || []).find(r => r.id === id);
  if (!record) return null;
  const from = { turbidity: record.turbidity, note: record.note };
  if (turbidity !== undefined && turbidity !== "") record.turbidity = Number(turbidity);
  if (note !== undefined) record.note = note;
  record.history ||= [];
  record.history.push({
    at: new Date().toISOString(),
    by: corrector || "",
    note: `清洗记录更正：浊度 ${from.turbidity} → ${record.turbidity}`,
    from,
    to: { turbidity: record.turbidity, note: record.note }
  });
  record.corrected = true;
  return record;
}
