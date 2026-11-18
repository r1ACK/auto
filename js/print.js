// PDF export page: one timetable per A4 landscape page, with signature line
import { getStore } from './store.js';
import { $, esc, guard, fmtDate, fmtSec } from './ui.js';
import { initGuide } from './guide.js';
import { renderTimetable, allSheets, VIEW_TYPES, entityName } from './timetable.js';

const root = $('#print-root');
const params = new URLSearchParams(location.search);

(async function boot() {
  initGuide('teacher');
  try {
    const store = await getStore();
    const session = await guard(null);
    if (!session) return;
    const s = await store.getSchedule(params.get('schedule') || 'latest');
    if (!s) {
      root.innerHTML = '<div class="card state"><h3>ไม่พบตารางที่ต้องการพิมพ์</h3><p>ตารางอาจถูกลบไปแล้ว กลับไปหน้าหลักแล้วเลือกใหม่</p></div>';
      $('#print-title').textContent = 'ไม่พบตาราง';
      return;
    }
    const snap = s.dataSnapshot;
    const type = params.get('type') || 'all';
    const id = params.get('id');

    let sheets = type === 'all' ? allSheets(snap) : [{ type, id }];
    // Students may only print their own group
    if (session.role === 'student') sheets = [{ type: 'group', id: session.groupId }];
    sheets = sheets.filter((x) => (snap[VIEW_TYPES[x.type]?.list] || []).some((e) => e.id === x.id));
    if (!sheets.length) {
      root.innerHTML = '<div class="card state"><h3>ไม่มีตารางให้พิมพ์</h3><p>ตรวจสอบลิงก์อีกครั้ง</p></div>';
      return;
    }

    const now = fmtDate(new Date().toISOString());
    root.innerHTML = sheets.map((sh, i) => {
      const name = entityName(snap, sh.type, sh.id);
      return `<section class="sheet">
        <div class="sheet-head">
          <div><h2>${esc(VIEW_TYPES[sh.type].title(name))}</h2>
            <div class="small muted">แผนกวิชาคอมพิวเตอร์ · ภาคเรียนที่ 1/2569</div></div>
          <div class="meta">ตารางชุดที่ ${esc(s.id)} · จัดเมื่อ ${esc(fmtDate(s.createdAt))}<br>
            เวลาประมวลผล ${fmtSec(s.durationMs)} วินาที · หน้า ${i + 1}/${sheets.length}</div>
        </div>
        ${renderTimetable(snap, s.assignments, sh.type, sh.id)}
        <div class="sheet-foot">
          <div>พิมพ์เมื่อ ${esc(now)}<br>สร้างโดยระบบจัดตารางสอนอัตโนมัติ</div>
          <div class="sign">ลงชื่อ ........................................................ ผู้เข้าแข่งขัน<br>( ........................................................ )</div>
        </div>
      </section>`;
    }).join('');

    $('#print-title').textContent = sheets.length > 1 ? `ตารางทั้งหมด ${sheets.length} ตาราง` : VIEW_TYPES[sheets[0].type].title(entityName(snap, sheets[0].type, sheets[0].id));
    document.title = `${$('#print-title').textContent} | Export PDF`;
    const btn = $('#print-btn');
    btn.disabled = false;
    btn.onclick = () => window.print();
  } catch (err) {
    root.innerHTML = `<div class="card state"><h3>เตรียมเอกสารไม่สำเร็จ</h3><p>${esc(err.message)}</p>
      <button type="button" class="btn btn-primary" onclick="location.reload()">ลองอีกครั้ง</button></div>`;
  }
})();
