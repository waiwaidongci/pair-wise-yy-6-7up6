// 页面队列：磨石清洗与试磨队列的页面片段（HTML + 前端脚本）。
import { TURBIDITY_LIMIT } from "./cleaning.js";
import { SOOT_DEPTHS } from "./schedule.js";

export function queueSectionHtml() {
  return `
    <section class="queue-wrap">
      <div class="panel">
        <h2>磨石清洗</h2>
        <p class="meta">磨石未清洗或冲洗水浊度高于 ${TURBIDITY_LIMIT} 度时，试磨只能待清洗；每次试磨记录烟料深浅、清洗次数、冲洗水浊度和上一锭编号。</p>
        <div class="grid" id="stones"></div>
        <form id="stoneForm" class="inline-form"><input name="name" placeholder="新增磨石名称" required><button>添加磨石</button></form>
      </div>
      <div class="panel">
        <h2>试磨队列</h2>
        <p class="meta">按先后顺序排队；换到更浅烟料前须由另一人复看磨面，确认无残墨才排入；更正上一锭或清洗记录后，其后试磨立即失效重排，旧结果留在履历。</p>
        <div class="meta" id="queueStats"></div>
        <form id="enqueueForm" class="enqueue">
          <div class="row">
            <div><label>磨石</label><select name="stoneId" id="enqueueStone" required></select></div>
            <div><label>墨锭</label><select name="itemCode" id="enqueueItem" required></select></div>
            <div><label>烟料深浅</label><select name="sootDepth" id="enqueueDepth"></select></div>
            <div><label>上一锭编号</label><input name="prevCode" placeholder="留空取队尾"></div>
            <div><label>排入人</label><input name="operator" placeholder="姓名" required></div>
            <div><label>&nbsp;</label><button>排入队列</button></div>
          </div>
        </form>
        <div id="queueList"></div>
      </div>
    </section>`;
}

export function queueClientScript() {
  return `
    const sootDepths = ${JSON.stringify(SOOT_DEPTHS)};
    let queueData = { stones: [], trials: [] };
    let completeOpenId = null;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function depthLabel(d) { const hit = sootDepths.find(x => x[0] === Number(d)); return hit ? hit[1] : String(d); }
    function stoneName(id) { const s = queueData.stones.find(x => x.id === id); return s ? s.name : id; }
    async function guard(fn) { try { await fn(); } catch (e) { alert(e.message); } }
    async function loadQueue() {
      queueData = await api('/api/queue');
      renderStones();
      renderQueue();
    }
    function stoneHtml(stone) {
      const latest = stone.latestCleaning;
      const state = stone.needsCleaning ? '<span class="pill warn">待清洗</span>' : '<span class="pill">可排入</span>';
      const latestLine = latest
        ? '最近清洗 ' + latest.times + ' 次 · 浊度 ' + latest.turbidity + ' 度 · ' + esc(latest.cleanedBy) + ' · ' + new Date(latest.at).toLocaleString()
        : '磨石未清洗';
      const history = (stone.cleanings || []).slice().reverse().map(c =>
        '<div>#' + c.id + ' · ' + c.times + ' 次 · 浊度 ' + c.turbidity + ' 度 · ' + esc(c.cleanedBy) +
        (c.correctedAt ? ' · 已更正' : '') +
        ' <button type="button" class="link" data-fix-cleaning="' + stone.id + '|' + c.id + '" data-times="' + c.times + '" data-turbidity="' + c.turbidity + '">更正</button>' +
        (c.note ? ' · ' + esc(c.note) : '') +
        (c.revisions || []).map(r => '<div class="meta">履历：原 ' + r.before.times + ' 次 / 浊度 ' + r.before.turbidity + ' 度 · ' + esc(r.before.cleanedBy) + '</div>').join('') +
        '</div>').join('');
      return '<article class="card"><h3>' + esc(stone.name) + '</h3><div class="qhead">' + state + '</div>' +
        '<div class="meta">' + latestLine + '</div>' +
        (stone.lastGroundCode ? '<div class="meta">上一锭 ' + esc(stone.lastGroundCode) + '</div>' : '') +
        '<form data-clean="' + stone.id + '" class="clean-form">' +
        '<label>清洗次数</label><input name="times" type="number" min="1" step="1" required>' +
        '<label>冲洗水浊度（度）</label><input name="turbidity" type="number" min="0" step="0.1" required>' +
        '<label>清洗人</label><input name="cleanedBy" required>' +
        '<label>备注</label><input name="note">' +
        '<button>登记清洗</button></form>' +
        '<div class="logs meta">' + (history || '暂无清洗记录') + '</div></article>';
    }
    function renderStones() {
      document.querySelector('#stones').innerHTML = queueData.stones.map(stoneHtml).join('');
      document.querySelectorAll('[data-clean]').forEach(form => {
        form.onsubmit = event => {
          event.preventDefault();
          guard(async () => {
            await api('/api/stones/' + form.dataset.clean + '/cleanings', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
            form.reset();
            await loadQueue();
          });
        };
      });
      document.querySelectorAll('[data-fix-cleaning]').forEach(btn => {
        btn.onclick = () => guard(async () => {
          const parts = btn.dataset.fixCleaning.split('|');
          const turbidity = prompt('更正冲洗水浊度（度）', btn.dataset.turbidity);
          if (turbidity === null) return;
          const times = prompt('更正清洗次数', btn.dataset.times);
          if (times === null) return;
          await api('/api/stones/' + parts[0] + '/cleanings/' + parts[1], { method: 'PATCH', body: JSON.stringify({ turbidity: Number(turbidity), times: Number(times) }) });
          await loadQueue();
        });
      });
    }
    function queueRow(t, isHead) {
      const pill = '<span class="pill' + (t.status === '待清洗' ? ' warn' : '') + '">' + t.status + '</span>';
      let actions = '';
      if (t.status === '待复看') actions += '<button data-review="' + t.id + '">复看磨面</button>';
      if (t.status === '排队中') actions += isHead ? '<button data-complete="' + t.id + '">完成试磨</button>' : '<span class="meta">顺序等候</span>';
      if (t.status !== '已试磨') actions += '<button class="secondary" data-correct="' + t.id + '" data-prev="' + esc(t.prevCode || '') + '" data-depth="' + t.sootDepth + '">更正</button>';
      let extra = '';
      if (t.status === '已试磨' && t.result) {
        extra += '<div class="meta">结果：' + esc(t.result.paper || '试纸') + ' · 评分 ' + t.result.score + ' · ' + new Date(t.result.at).toLocaleString() + '</div>';
      }
      if (completeOpenId === t.id) {
        extra += '<form class="complete-form" data-complete-form="' + t.id + '">' +
          '<input name="paper" placeholder="试磨纸张" required>' +
          '<input name="water" placeholder="加水量">' +
          '<input name="speed" placeholder="出墨速度">' +
          '<input name="colorLayer" placeholder="墨色层次">' +
          '<input name="sediment" placeholder="沉淀情况">' +
          '<input name="score" type="number" min="0" max="100" step="1" placeholder="评分" required>' +
          '<button>提交结果</button></form>';
      }
      const history = (t.history || []).map(h =>
        '<div>' + esc(h.type) + ' · ' + esc(h.reason || h.note || '') +
        (h.result ? ' · 旧评分 ' + h.result.score : '') +
        ' · ' + new Date(h.at).toLocaleString() + '</div>').join('');
      if (history) extra += '<div class="logs meta">' + history + '</div>';
      return '<div class="qitem">' +
        '<div class="qhead"><b>#' + t.seq + ' · ' + esc(t.itemCode) + '</b>' + pill + '<span class="meta">磨石 ' + esc(stoneName(t.stoneId)) + '</span></div>' +
        '<div class="meta">烟料深浅 ' + depthLabel(t.sootDepth) +
        ' · 上一锭 ' + esc(t.prevCode || '—') +
        ' · 清洗 ' + (t.cleaningTimes || 0) + ' 次' +
        ' · 浊度 ' + (t.turbidity == null ? '—' : t.turbidity + ' 度') +
        ' · 排入人 ' + esc(t.operator) +
        (t.review ? ' · 复看 ' + esc(t.review.by) + (t.review.residueFree ? ' 确认无残墨' : ' 见残墨') : '') +
        (t.invalidations ? ' · 曾失效重排 ' + t.invalidations + ' 次' : '') + '</div>' +
        '<div class="qactions">' + actions + '</div>' + extra + '</div>';
    }
    function renderQueue() {
      const trials = queueData.trials;
      const counts = {};
      trials.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
      document.querySelector('#queueStats').textContent = ['待清洗', '待复看', '排队中', '已试磨'].map(s => s + ' ' + (counts[s] || 0)).join(' · ');
      document.querySelector('#enqueueStone').innerHTML = queueData.stones.map(s => '<option value="' + s.id + '">' + esc(s.name) + (s.needsCleaning ? '（待清洗）' : '') + '</option>').join('');
      document.querySelector('#enqueueItem').innerHTML = items.map(i => '<option value="' + esc(i.code || i.id) + '">' + esc(i.code || i.id) + '</option>').join('');
      document.querySelector('#enqueueDepth').innerHTML = sootDepths.map(d => '<option value="' + d[0] + '">' + d[1] + '</option>').join('');
      const heads = {};
      trials.filter(t => t.status === '排队中').forEach(t => { if (!heads[t.stoneId] || t.seq < heads[t.stoneId]) heads[t.stoneId] = t.seq; });
      document.querySelector('#queueList').innerHTML = trials.length
        ? trials.map(t => queueRow(t, heads[t.stoneId] === t.seq)).join('')
        : '<div class="meta">队列为空，请先排入一锭。</div>';
      bindQueueActions();
    }
    function bindQueueActions() {
      document.querySelectorAll('[data-review]').forEach(btn => btn.onclick = () => guard(async () => {
        const reviewer = prompt('复看人（须为另一人，不能是排入人或清洗人）');
        if (!reviewer) return;
        const residueFree = confirm('磨面是否无残墨？\\n确定＝无残墨，排入队列；取消＝有残墨，退回待清洗');
        await api('/api/queue/' + btn.dataset.review + '/review', { method: 'POST', body: JSON.stringify({ reviewer, residueFree }) });
        await loadQueue();
      }));
      document.querySelectorAll('[data-complete]').forEach(btn => btn.onclick = () => {
        completeOpenId = completeOpenId === btn.dataset.complete ? null : btn.dataset.complete;
        renderQueue();
      });
      document.querySelectorAll('[data-complete-form]').forEach(form => form.onsubmit = event => {
        event.preventDefault();
        guard(async () => {
          await api('/api/queue/' + form.dataset.completeForm + '/complete', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
          completeOpenId = null;
          await load();
        });
      });
      document.querySelectorAll('[data-correct]').forEach(btn => btn.onclick = () => guard(async () => {
        const prevCode = prompt('更正上一锭编号', btn.dataset.prev);
        if (prevCode === null) return;
        const sootDepth = prompt('更正烟料深浅（1 最浅～5 最深）', btn.dataset.depth);
        if (sootDepth === null) return;
        await api('/api/queue/' + btn.dataset.correct, { method: 'PATCH', body: JSON.stringify({ prevCode, sootDepth: Number(sootDepth) }) });
        await loadQueue();
      }));
    }
    document.querySelector('#enqueueForm').onsubmit = event => {
      event.preventDefault();
      guard(async () => {
        const data = Object.fromEntries(new FormData(event.target).entries());
        data.sootDepth = Number(data.sootDepth);
        await api('/api/queue', { method: 'POST', body: JSON.stringify(data) });
        event.target.reset();
        await loadQueue();
      });
    };
    document.querySelector('#stoneForm').onsubmit = event => {
      event.preventDefault();
      guard(async () => {
        await api('/api/stones', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) });
        event.target.reset();
        await loadQueue();
      });
    };
  `;
}
