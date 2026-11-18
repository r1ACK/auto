// Teacher dashboard: navigation, timed scheduling run, results, timetable viewer
import { getStore, cleanDataset } from './store.js';
import { validateData, generateSchedule } from './scheduler.js';
import { $, $$, esc, toast, busy, guard, demoBanner, fmtDate, fmtSec, confirmDialog } from './ui.js';
import { initGuide } from './guide.js';
import { renderTimetable, VIEW_TYPES, entityName } from './timetable.js';
import { renderEntityList, renderUsers } from './data-admin.js';
import { renderImportExport } from './import-export.js';

const state = {
  store: null, session: null, data: null,
  schedule: null, history: [], view: 'run',
  viewType: 'teacher', viewId: null,
  running: false, lastTotalMs: null
};
const root = $('#view-root');

const ctx = {
  get store() { return state.store; },
  get session() { return state.session; },
  getData: () => state.data,
  reload: async () => { await loadData(); render(); }
};

// ---------- boot ----------
(async function boot() {
  demoBanner();
  initGuide('teacher');
  try {
    state.store = await getStore();
    state.session = await guard('teacher');
    if (!state.session) return;
    $('#user-chip').innerHTML = `<strong>${esc(state.session.fullName || state.session.username)}</strong>ครู`;
    const notice = sessionStorage.getItem('tt_notice');
    if (notice) { toast(notice, 'error'); sessionStorage.removeItem('tt_notice'); }
    await Promise.all([loadData(), loadSchedules()]);
    const fromHash = location.hash.slice(1);
    if (fromHash) state.view = fromHash;
    render();
  } catch (err) {
    root.innerHTML = `<div class="card state"><h3>โหลดข้อมูลไม่สำเร็จ</h3><p>${esc(err.message)}</p>
      <button type="button" class="btn btn-primary" onclick="location.reload()">ลองอีกครั้ง</button></div>`;
  }
})();

async function loadData() {
  state.data = await state.store.loadDataset();
  $$('[data-count]').forEach((el) => { el.textContent = state.data[el.dataset.count]?.length ?? ''; });
}
async function loadSchedules() {
  const [latest, history] = await Promise.all([state.store.getSchedule('latest'), state.store.listSchedules()]);
  state.schedule = latest;
  state.history = history;
}

$('#logout').addEventListener('click', async () => {
  await state.store.signOut();
  location.replace('index.html');
});

function go(view) {
  if (state.running) return toast('กำลังประมวลผล กรุณารอสักครู่', 'error');
  state.view = view;
  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo(0, 0);
}
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));
$('#mobile-nav-select').addEventListener('change', (e) => go(e.target.value));

function render() {
  $$('[data-nav]').forEach((b) => b.toggleAttribute('aria-current', b.dataset.nav === state.view));
  $$('[data-nav]').forEach((b) => { if (b.dataset.nav === state.view) b.setAttribute('aria-current', 'page'); });
  $('#mobile-nav-select').value = state.view;
  switch (state.view) {
    case 'view': return renderViewer();
    case 'teachers': case 'groups': case 'rooms': case 'subjects': return renderEntityList(root, state.view, ctx);
    case 'import': return renderImportExport(root, ctx);
    case 'users': return renderUsers(root, ctx);
    default: state.view = 'run'; return renderRun();
  }
}

const isStale = () => state.schedule && JSON.stringify(cleanDataset(state.schedule.dataSnapshot)) !== JSON.stringify(cleanDataset(state.data));
const printUrl = (params) => `print.html?${new URLSearchParams({ schedule: state.schedule?.id ?? 'latest', ...params })}`;

// ---------- Run view ----------
function renderRun() {
  const d = state.data;
  const errors = validateData(d);
  const weekly = d.subjects.reduce((a, s) => a + (s.periods || 0), 0);
  const s = state.schedule;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>จัดตารางสอน</h1><p>ภาคเรียนที่ 1/2569 ประมวลผลตามเงื่อนไข 18 ข้อของโจทย์</p></div>
    </div>
    ${isStale() ? '<div class="alert alert-warn">ข้อมูลนำเข้ามีการเปลี่ยนแปลงหลังจัดตารางล่าสุด ตารางที่แสดงอยู่อาจไม่ตรงกับข้อมูลปัจจุบัน กด "เริ่มประมวลผลจัดตาราง" เพื่อสร้างใหม่</div>' : ''}
    <div class="card">
      <div class="run-panel">
        <div class="run-main">
          <div class="stat-row">
            <div class="stat"><span class="v">${d.teachers.length}</span><span class="k">ครู</span></div>
            <div class="stat"><span class="v">${d.groups.length}</span><span class="k">กลุ่มเรียน</span></div>
            <div class="stat"><span class="v">${d.rooms.length}</span><span class="k">ห้องเรียน</span></div>
            <div class="stat"><span class="v">${d.subjects.length}</span><span class="k">รายวิชา</span></div>
            <div class="stat"><span class="v">${weekly}</span><span class="k">คาบ / กลุ่ม / สัปดาห์</span></div>
          </div>
          ${errors.length ? `<div class="alert alert-error"><strong>ต้องแก้ข้อมูลก่อนประมวลผล</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
          <div>
            <button type="button" class="btn btn-primary btn-lg" id="run-btn" ${errors.length ? 'disabled' : ''}>เริ่มประมวลผลจัดตาราง</button>
          </div>
          <p class="muted small" style="margin:0">ตามกติกา: แจ้งกรรมการให้พร้อมจับเวลาก่อนกด การกดแต่ละครั้งบันทึกเป็นผลลัพธ์ใหม่พร้อมเวลาที่ใช้</p>
        </div>
        <div class="timer-box" id="timer-box" aria-live="polite">
          <span class="label">เวลาประมวลผล</span>
          <span class="clock num" id="clock">${state.lastTotalMs != null ? fmtSec(state.lastTotalMs) : '0.000'}<small>วินาที</small></span>
          <span class="sub" id="timer-sub">${state.lastTotalMs != null ? 'ประมวลผลและบันทึกผลเสร็จสมบูรณ์' : 'พร้อมประมวลผล'}</span>
          <div class="progress"><span id="progress-bar" style="width:${state.lastTotalMs != null ? 100 : 0}%"></span></div>
        </div>
      </div>
    </div>
    <div id="result-area">${s ? resultHtml(s) : `
      <div class="card state"><h3>ยังไม่มีตารางสอน</h3><p>ตรวจข้อมูลนำเข้าให้ครบ แล้วกด "เริ่มประมวลผลจัดตาราง" ระบบจะสร้างตาราง 13 ชุดให้อัตโนมัติ</p></div>`}</div>`;

  $('#run-btn').addEventListener('click', runSchedule);
  bindResult();
}

function resultHtml(s) {
  const r = s.report;
  const hardBad = r.rules.filter((x) => x.type === 'hard' && x.violated).length;
  const passed = r.rules.filter((x) => !x.violated).length;
  return `
    <div class="card">
      <div class="card-head">
        <div><h2>ผลการจัดตาราง</h2><span class="muted small">สร้างเมื่อ ${esc(fmtDate(s.createdAt))} · ชุดที่ ${esc(s.id)}</span></div>
        <div class="row">
          <a class="btn btn-primary" href="${printUrl({ type: 'all' })}" target="_blank" rel="noopener">Export PDF ทั้งหมด (13 ตาราง)</a>
          <button type="button" class="btn btn-secondary" data-goto="view">ดูตาราง</button>
        </div>
      </div>
      <div class="result-strip">
        <div class="stat"><span class="v">${fmtSec(s.durationMs)} วิ</span><span class="k">เวลาอัลกอริทึม</span></div>
        <div class="stat"><span class="v">${passed} / ${r.rules.length}</span><span class="k">เงื่อนไขที่ผ่าน</span></div>
        <div class="stat"><span class="v">${hardBad}</span><span class="k">เงื่อนไขบังคับที่ละเมิด</span></div>
        <div class="stat"><span class="v">${esc(r.score)}</span><span class="k">คะแนนความเหมาะสม (เต็ม 100)</span></div>
      </div>
      <p class="small muted" style="margin:0"><strong>อัลกอริทึม:</strong> ${esc(s.algorithm)} · ค้นหา ${esc(s.attempts)} รอบ</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>ตรวจเงื่อนไข 18 ข้อ</h2>
        <span class="badge ${hardBad ? 'badge-bad' : 'badge-ok'}">${hardBad ? `ละเมิดเงื่อนไขบังคับ ${hardBad} ข้อ` : 'ผ่านเงื่อนไขบังคับทุกข้อ'}</span></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th class="rule-no">ข้อ</th><th>เงื่อนไข</th><th>ประเภท</th><th>ผล</th><th class="num">ละเมิด (ครั้ง)</th><th>รายละเอียด</th></tr></thead>
        <tbody>${r.rules.map((x) => `<tr>
          <td class="rule-no">${x.no}</td><td>${esc(x.text)}</td>
          <td><span class="badge ${x.type === 'hard' ? 'badge-info' : 'badge-neutral'}">${x.type === 'hard' ? 'บังคับ' : 'ถ้าเป็นไปได้'}</span></td>
          <td><span class="badge ${x.violated ? (x.type === 'hard' ? 'badge-bad' : 'badge-warn') : 'badge-ok'}">${x.violated ? 'ละเมิด' : 'ผ่าน'}</span></td>
          <td class="num">${x.count}</td><td class="small muted">${esc(x.detail)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>ชั่วโมงสอนของครู</h2></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>ครู</th><th class="num">ชั่วโมง / สัปดาห์</th><th>ช่วงที่กำหนด</th><th class="actions"><span class="sr-only">ดู</span></th></tr></thead>
        <tbody>${r.teacherHours.map((t) => {
          const def = (s.dataSnapshot.teachers || []).find((x) => x.id === t.teacherId) || {};
          const range = def.minHours != null || def.maxHours != null ? `${def.minHours ?? 0} - ${def.maxHours ?? '∞'}` : '-';
          return `<tr><td>${esc(t.name)}</td><td class="num">${t.hours}</td><td>${range}</td>
            <td class="actions"><button type="button" class="btn btn-ghost btn-sm" data-open-tt="teacher|${esc(t.teacherId)}">ดูตาราง</button></td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>ประวัติการจัดตาราง</h2><span class="muted small">นักศึกษาเห็นตารางชุดล่าสุดเสมอ</span></div>
      ${state.history.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>ชุดที่</th><th>วันที่สร้าง</th><th class="num">เวลา (วิ)</th><th class="num">คะแนน</th><th class="actions"><span class="sr-only">จัดการ</span></th></tr></thead>
        <tbody>${state.history.map((h, i) => `<tr>
          <td>${esc(h.id)} ${i === 0 ? '<span class="badge badge-info">ล่าสุด</span>' : ''}</td><td>${esc(fmtDate(h.createdAt))}</td>
          <td class="num">${fmtSec(h.durationMs)}</td><td class="num">${esc(h.score ?? '-')}</td>
          <td class="actions"><a class="btn btn-ghost btn-sm" href="print.html?schedule=${encodeURIComponent(h.id)}&type=all" target="_blank" rel="noopener">เปิด PDF</a>
          ${i === 0 ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-del-sch="${esc(h.id)}">ลบ</button>`}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">ยังไม่มีประวัติ</p>'}
    </div>`;
}

function bindResult() {
  $$('[data-goto]', root).forEach((b) => { b.onclick = () => go(b.dataset.goto); });
  $$('[data-open-tt]', root).forEach((b) => {
    b.onclick = () => { const [t, id] = b.dataset.openTt.split('|'); state.viewType = t; state.viewId = id; go('view'); };
  });
  $$('[data-del-sch]', root).forEach((b) => {
    b.onclick = async () => {
      const ok = await confirmDialog({ title: `ลบตารางชุดที่ ${b.dataset.delSch}?`, message: 'ลบออกจากประวัติถาวร', confirmText: 'ลบตารางชุดนี้', danger: true });
      if (!ok) return;
      try {
        await state.store.deleteSchedule(b.dataset.delSch);
        await loadSchedules();
        renderRun();
        toast('ลบแล้ว', 'success');
      } catch (err) { toast(`ลบไม่สำเร็จ: ${err.message}`, 'error'); }
    };
  });
}

function runInWorker(data, onProgress) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./scheduler-worker.js', import.meta.url), { type: 'module' });
    } catch {
      // Fallback: same algorithm on the main thread
      return resolve(generateSchedule(data, { onProgress }));
    }
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data);
      else { worker.terminate(); resolve(e.data.result); }
    };
    worker.onerror = (e) => { worker.terminate(); resolve({ ok: false, errors: [`ตัวประมวลผลขัดข้อง: ${e.message || 'unknown'}`] }); };
    worker.postMessage({ data, options: {} });
  });
}

async function runSchedule() {
  if (state.running) return;
  state.running = true;
  const btn = $('#run-btn');
  const restore = busy(btn, 'กำลังประมวลผล...');
  const clock = $('#clock');
  const sub = $('#timer-sub');
  const bar = $('#progress-bar');
  const box = $('#timer-box');
  box.classList.remove('done');
  const t0 = performance.now();
  let raf;
  const tick = () => { clock.innerHTML = `${fmtSec(performance.now() - t0)}<small>วินาที</small>`; raf = requestAnimationFrame(tick); };
  tick();
  sub.textContent = 'กำลังจัดครูและวางคาบเรียน...';
  bar.style.width = '5%';

  try {
    const result = await runInWorker(state.data, (p) => {
      sub.textContent = `ค้นหารอบที่ ${p.attempts} · พบคำตอบ ${p.solutions} ชุด · คะแนนดีสุด ${p.bestScore}`;
      bar.style.width = `${Math.min(90, 10 + p.solutions * 13)}%`;
    });
    if (!result.ok) throw new Error((result.errors || ['ไม่ทราบสาเหตุ']).join(' / '));
    sub.textContent = 'กำลังบันทึกผลลัพธ์...';
    const saved = await state.store.saveSchedule({ ...result, dataSnapshot: state.data });
    const total = performance.now() - t0;
    cancelAnimationFrame(raf);
    state.lastTotalMs = total;
    clock.innerHTML = `${fmtSec(total)}<small>วินาที</small>`;
    sub.textContent = `เสร็จสมบูรณ์ · อัลกอริทึม ${fmtSec(result.durationMs)} วิ + บันทึกผล`;
    bar.style.width = '100%';
    box.classList.add('done');
    state.schedule = saved;
    state.history = await state.store.listSchedules();
    $('#result-area').innerHTML = resultHtml(saved);
    bindResult();
    toast('จัดตารางสอนเสร็จแล้ว', 'success');
  } catch (err) {
    cancelAnimationFrame(raf);
    sub.textContent = 'ประมวลผลไม่สำเร็จ';
    bar.style.width = '0%';
    toast(`ประมวลผลไม่สำเร็จ: ${err.message}`, 'error');
  } finally {
    state.running = false;
    restore();
  }
}

// ---------- Viewer ----------
function renderViewer() {
  const s = state.schedule;
  if (!s) {
    root.innerHTML = `<div class="page-head"><div><h1>ดูตาราง</h1></div></div>
      <div class="card state"><h3>ยังไม่มีตารางให้ดู</h3><p>ไปที่เมนู "จัดตารางสอน" แล้วกดประมวลผลก่อน</p>
      <button type="button" class="btn btn-primary" data-goto="run">ไปหน้าจัดตารางสอน</button></div>`;
    $$('[data-goto]', root).forEach((b) => { b.onclick = () => go(b.dataset.goto); });
    return;
  }
  const snap = s.dataSnapshot;
  const list = snap[VIEW_TYPES[state.viewType].list] || [];
  if (!list.some((x) => x.id === state.viewId)) state.viewId = list[0]?.id || null;

  root.innerHTML = `
    <div class="page-head"><div><h1>ดูตาราง</h1><p>ตารางชุดที่ ${esc(s.id)} · ${esc(fmtDate(s.createdAt))}</p></div>
      <a class="btn btn-secondary" href="${printUrl({ type: 'all' })}" target="_blank" rel="noopener">Export PDF ทั้งหมด (13 ตาราง)</a></div>
    ${isStale() ? '<div class="alert alert-warn">ข้อมูลนำเข้าเปลี่ยนหลังจัดตารางชุดนี้ ชื่อที่แสดงใช้ข้อมูล ณ เวลาที่จัดตาราง</div>' : ''}
    <div class="card">
      <div class="toolbar">
        <div class="seg-inline" role="tablist" aria-label="ประเภทตาราง">
          ${Object.entries(VIEW_TYPES).map(([k, v]) => `<button type="button" role="tab" data-vt="${k}" aria-selected="${k === state.viewType}">${v.label}</button>`).join('')}
        </div>
        <div class="field">
          <label for="view-id">เลือก${VIEW_TYPES[state.viewType].label}</label>
          <select class="input" id="view-id">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === state.viewId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="tt-title">
        <h2>${esc(VIEW_TYPES[state.viewType].title(entityName(snap, state.viewType, state.viewId)))}</h2>
        <a class="btn btn-primary btn-sm" href="${printUrl({ type: state.viewType, id: state.viewId })}" target="_blank" rel="noopener">Export PDF ตารางนี้</a>
      </div>
      ${state.viewId ? renderTimetable(snap, s.assignments, state.viewType, state.viewId) : '<div class="state">ไม่มีรายการ</div>'}
    </div>`;

  $$('[data-vt]', root).forEach((b) => { b.onclick = () => { state.viewType = b.dataset.vt; state.viewId = null; renderViewer(); }; });
  $('#view-id').onchange = (e) => { state.viewId = e.target.value; renderViewer(); };
}
