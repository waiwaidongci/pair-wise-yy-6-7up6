// 页面队列：试磨队列页渲染，展示磨石状态、排队顺序、清洗记录与试磨履历。
import { SOOT_LEVELS, TURBIDITY_LIMIT } from "./schedule.js";

export function queuePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>试磨队列 · 墨锭试磨室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    section { display:grid; gap:14px; align-content:start; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    a.navlink { color:var(--accent); font-weight:700; text-decoration:none; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; } .stat strong { display:block; font-size:24px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:6px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.dirty { color:var(--warn); border-color:var(--warn); } .pill.ok { color:var(--accent); border-color:var(--accent); }
    .warn { color:var(--warn); font-weight:700; }
    .stone { border-top:1px solid var(--line); padding:10px 0; display:grid; gap:4px; } .stone:first-of-type { border-top:0; }
    table { width:100%; border-collapse:collapse; font-size:14px; } th,td { text-align:left; padding:8px; border-bottom:1px solid var(--line); vertical-align:top; }
    th { color:var(--muted); font-weight:600; white-space:nowrap; } tr.void td { opacity:.55; }
    .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>试磨队列</h1><div class="meta">按先后顺序排队 · 磨石未清洗或浊度高于二度只能待清洗 · 换更浅烟料须另一人复看磨面确认无残墨</div></div>
    <div class="row"><a class="navlink" href="/">← 建档页</a><button id="reload">刷新</button></div>
  </header>
  <main>
    <section>
      <div class="panel"><h2>磨石状态</h2><div id="stones"></div></div>
      <form id="cleanForm"><h2>清洗登记</h2>
        <label>磨石</label><select name="stoneId" id="cleanStone"></select>
        <label>清洗人</label><input name="cleaner" required>
        <label>冲洗水浊度（度，高于二度不合格）</label><input name="turbidity" type="number" step="0.1" min="0" required>
        <label>备注</label><input name="note">
        <div style="margin-top:12px"><button>登记清洗并放行检查</button></div>
      </form>
      <form id="enqueueForm"><h2>排入试磨</h2>
        <label>墨锭</label><select name="inkCode" id="inkSelect"></select>
        <label>烟料深浅</label><select name="sootDepth">${SOOT_LEVELS.map(s => "<option>" + s + "</option>").join("")}</select>
        <label>磨石</label><select name="stoneId" id="queueStone"></select>
        <label>提交人</label><input name="createdBy" required>
        <div style="margin-top:12px"><button>排入队列</button></div>
        <div class="meta" style="margin-top:8px">换到更浅烟料前，须由另一人复看磨面，确认无残墨才排入。</div>
      </form>
    </section>
    <section>
      <div class="stats" id="qstats"></div>
      <div class="panel"><h2>试磨队列（按先后顺序）</h2><div class="grid" id="queue"></div></div>
      <div class="panel"><h2>试磨履历</h2><div class="meta" style="margin-bottom:10px">每次试磨记录烟料深浅、清洗次数、冲洗水浊度和上一锭编号；更正上一锭或清洗记录后，其后试磨立即失效重排，旧结果留在履历。</div><div id="tests"></div></div>
      <div class="panel"><h2>清洗记录</h2><div id="cleaning"></div></div>
    </section>
  </main>
  <script>
    const ACTIVE = ["待清洗","待复看","排队中"];
    const STATS = ["待清洗","待复看","排队中","已完成","已失效"];
    const TURBIDITY_LIMIT = ${TURBIDITY_LIMIT};
    let items = [], stones = [], queue = [], tests = [], cleaning = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function fmt(s) { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString('zh-CN'); }
    function stoneName(id) { const s = stones.find(x => x.id === id); return s ? s.name : id; }
    async function load() {
      [items, stones, queue, tests, cleaning] = await Promise.all([
        api('/api/items'), api('/api/stones'), api('/api/queue'), api('/api/tests'), api('/api/cleaning')
      ]);
      render();
    }
    function render() {
      const stoneOpts = stones.map(s => '<option value="'+s.id+'">'+s.name+'</option>').join('');
      document.querySelector('#cleanStone').innerHTML = stoneOpts;
      document.querySelector('#queueStone').innerHTML = stoneOpts;
      document.querySelector('#inkSelect').innerHTML = items.map(i => '<option value="'+i.code+'">'+i.code+' · '+(i.smokeSource || '')+'</option>').join('');
      document.querySelector('#stones').innerHTML = stones.map(s => {
        const st = s.state;
        return '<div class="stone"><div><b>'+s.name+'</b> '+(st.needsCleaning ? '<span class="pill dirty">待清洗</span>' : '<span class="pill ok">可放行</span>')+'</div>'
          + '<div class="meta">清洗 '+st.cleanCount+' 次 · 最近浊度 '+(st.lastTurbidity === null ? '—' : st.lastTurbidity+'度')+' · 上一锭 '+st.prevInkCode+(st.prevSootDepth ? '（'+st.prevSootDepth+'）' : '')+'</div>'
          + (st.needsCleaning ? '<div class="warn">'+st.reason+'</div>' : '')
          + (st.lastCleaner ? '<div class="meta">最近清洗 '+st.lastCleaner+' · '+fmt(st.lastCleanAt)+'</div>' : '')
          + '</div>';
      }).join('');
      document.querySelector('#qstats').innerHTML = STATS.map(s => '<div class="stat"><span>'+s+'</span><strong>'+queue.filter(e => e.status === s).length+'</strong></div>').join('');
      const heads = {};
      queue.filter(e => ACTIVE.includes(e.status)).forEach(e => { if (heads[e.stoneId] === undefined || e.seq < heads[e.stoneId]) heads[e.stoneId] = e.seq; });
      document.querySelector('#queue').innerHTML = queue.map(e => entryHtml(e, heads[e.stoneId] === e.seq && ACTIVE.includes(e.status))).join('') || '<div class="meta">暂无排队</div>';
      document.querySelector('#tests').innerHTML = testsHtml();
      document.querySelector('#cleaning').innerHTML = cleaningHtml();
      bind();
    }
    function entryHtml(e, isHead) {
      const actions = [];
      if (e.status === '待复看') actions.push('<button data-review="'+e.id+'">复看磨面</button>');
      if (e.status === '排队中' && isHead) actions.push('<button data-complete="'+e.id+'">完成试磨</button>');
      if (e.status === '排队中' && !isHead) actions.push('<span class="meta">顺序等候</span>');
      if (e.status === '待清洗') actions.push('<span class="warn">只能待清洗</span>');
      return '<article class="card"><div><b>#'+e.seq+' · '+e.inkCode+'</b> <span class="pill'+(e.status==='待清洗'?' dirty':e.status==='排队中'?' ok':'')+'">'+e.status+'</span></div>'
        + '<div class="meta">'+stoneName(e.stoneId)+' · 烟料 '+e.sootDepth+' · 上一锭 '+e.prevInkCode+'</div>'
        + '<div class="meta">排入时清洗 '+e.cleanCount+' 次 · 浊度 '+(e.turbidity === null ? '—' : e.turbidity+'度')+' · '+e.createdBy+' · '+fmt(e.createdAt)+'</div>'
        + (e.review ? '<div class="meta">复看 '+e.review.by+'：'+e.review.result+'</div>' : '')
        + (e.note ? '<div class="meta">'+e.note+'</div>' : '')
        + (actions.length ? '<div class="row">'+actions.join('')+'</div>' : '')
        + '</article>';
    }
    function testsHtml() {
      if (!tests.length) return '<div class="meta">暂无试磨记录</div>';
      const rows = tests.slice().sort((a,b) => (b.at || '').localeCompare(a.at || '')).map(t =>
        '<tr class="'+(t.status === '已失效' ? 'void' : '')+'"><td>'+t.inkCode+'</td><td>'+t.sootDepth+'</td><td>'+t.cleanCount+'</td><td>'+(t.turbidity === null ? '—' : t.turbidity)+'</td><td>'+t.prevInkCode+'</td><td>'+t.score+'</td>'
        + '<td>'+t.status+(t.invalidReason ? '<div class="meta">'+t.invalidReason+'</div>' : '')+((t.history || []).map(h => '<div class="meta">'+h.note+'</div>').join(''))+'</td>'
        + '<td>'+fmt(t.at)+'</td>'
        + '<td>'+(t.status === '有效' ? '<button class="secondary" data-correct-test="'+t.id+'">更正上一锭</button>' : '')+'</td></tr>').join('');
      return '<table><thead><tr><th>墨锭</th><th>烟料深浅</th><th>清洗次数</th><th>浊度(度)</th><th>上一锭</th><th>评分</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
    }
    function cleaningHtml() {
      if (!cleaning.length) return '<div class="meta">暂无清洗记录</div>';
      const rows = cleaning.map(r =>
        '<tr><td>'+stoneName(r.stoneId)+'</td><td>'+r.cleaner+'</td><td>'+r.turbidity+'</td>'
        + '<td>'+(r.turbidity > TURBIDITY_LIMIT ? '<span class="warn">不合格</span>' : '合格')+(r.corrected ? '<div class="meta">已更正</div>' : '')+((r.history || []).map(h => '<div class="meta">'+h.note+'</div>').join(''))+'</td>'
        + '<td>'+(r.note || '')+'</td><td>'+fmt(r.at)+'</td>'
        + '<td><button class="secondary" data-correct-clean="'+r.id+'" data-value="'+r.turbidity+'">更正</button></td></tr>').join('');
      return '<table><thead><tr><th>磨石</th><th>清洗人</th><th>浊度(度)</th><th>判定</th><th>备注</th><th>时间</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
    }
    function bind() {
      document.querySelectorAll('[data-review]').forEach(btn => btn.onclick = async () => {
        const reviewer = prompt('复看人（须为清洗人、提交人之外的另一人）');
        if (!reviewer) return;
        const clean = confirm('确认磨面无残墨？\\n确定 = 无残墨放行；取消 = 有残墨，退回待清洗');
        try { await api('/api/queue/'+btn.dataset.review+'/review', { method:'POST', body: JSON.stringify({ reviewer, result: clean ? '无残墨' : '有残墨' }) }); await load(); }
        catch (err) { alert(err.message); }
      });
      document.querySelectorAll('[data-complete]').forEach(btn => btn.onclick = async () => {
        const score = prompt('试磨评分（0-100）');
        if (score === null) return;
        const speed = prompt('出墨速度', '中') || '';
        const colorLayer = prompt('墨色层次', '') || '';
        try { await api('/api/queue/'+btn.dataset.complete+'/complete', { method:'POST', body: JSON.stringify({ score: Number(score), speed, colorLayer }) }); await load(); }
        catch (err) { alert(err.message); }
      });
      document.querySelectorAll('[data-correct-test]').forEach(btn => btn.onclick = async () => {
        const prevInkCode = prompt('更正后的上一锭编号');
        if (!prevInkCode) return;
        const corrector = prompt('更正人') || '';
        try { const r = await api('/api/tests/'+btn.dataset.correctTest, { method:'PATCH', body: JSON.stringify({ prevInkCode, corrector }) }); alert('已更正，'+r.invalidated+' 条后续试磨失效重排'); await load(); }
        catch (err) { alert(err.message); }
      });
      document.querySelectorAll('[data-correct-clean]').forEach(btn => btn.onclick = async () => {
        const turbidity = prompt('更正冲洗水浊度（度）', btn.dataset.value);
        if (turbidity === null || turbidity === '') return;
        const corrector = prompt('更正人') || '';
        try { const r = await api('/api/cleaning/'+btn.dataset.correctClean, { method:'PATCH', body: JSON.stringify({ turbidity: Number(turbidity), corrector }) }); alert('已更正，'+r.invalidated+' 条后续试磨失效重排'); await load(); }
        catch (err) { alert(err.message); }
      });
    }
    document.querySelector('#cleanForm').onsubmit = async event => {
      event.preventDefault();
      try { await api('/api/cleaning', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) }); event.target.reset(); await load(); }
      catch (err) { alert(err.message); }
    };
    document.querySelector('#enqueueForm').onsubmit = async event => {
      event.preventDefault();
      try { await api('/api/queue', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) }); event.target.reset(); await load(); }
      catch (err) { alert(err.message); }
    };
    document.querySelector('#reload').onclick = load;
    load();
  </script>
</body>
</html>`;
}
