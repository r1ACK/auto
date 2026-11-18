// Student page: view own group timetable (read-only)
import { getStore } from './store.js';
import { $, esc, guard, demoBanner, fmtDate } from './ui.js';
import { initGuide } from './guide.js';
import { renderTimetable, filterAssignments } from './timetable.js';

const root = $('#view-root');

(async function boot() {
  demoBanner();
  initGuide('student');
  try {
    const store = await getStore();
    const session = await guard('student');
    if (!session) return;
    $('#logout').onclick = async () => { await store.signOut(); location.replace('index.html'); };
    $('#user-chip').innerHTML = `<strong>${esc(session.fullName || session.username)}</strong>รหัส ${esc(session.username)}`;

    if (!session.groupId) {
      root.innerHTML = `<div class="card state"><h3>บัญชีของคุณยังไม่ได้ระบุกลุ่มเรียน</h3>
        <p>แจ้งครูให้กำหนดกลุ่มเรียนที่เมนู "ผู้ใช้งาน" แล้วเข้าสู่ระบบใหม่อีกครั้ง</p></div>`;
      return;
    }
    const s = await store.getSchedule('latest');
    if (!s) {
      root.innerHTML = `<div class="card state"><h3>ยังไม่มีตารางเรียน</h3>
        <p>ครูยังไม่ได้ประมวลผลจัดตาราง กลับมาดูใหม่ภายหลัง</p>
        <button type="button" class="btn btn-secondary" onclick="location.reload()">ตรวจสอบอีกครั้ง</button></div>`;
      return;
    }
    const snap = s.dataSnapshot;
    const group = snap.groups.find((g) => g.id === session.groupId);
    if (!group) {
      root.innerHTML = `<div class="card state"><h3>ไม่พบกลุ่มเรียนของคุณในตารางล่าสุด</h3><p>แจ้งครูให้ตรวจสอบกลุ่มเรียนของบัญชีนี้</p></div>`;
      return;
    }
    const mine = filterAssignments(s.assignments, 'group', group.id);
    const subjMap = new Map(snap.subjects.map((x) => [x.id, x]));
    const teachMap = new Map(snap.teachers.map((x) => [x.id, x]));
    const bySubject = [...new Map(mine.map((a) => [a.subjectId, a])).values()];
    const advisor = teachMap.get(group.advisorId)?.name || '-';

    root.innerHTML = `
      <div class="page-head">
        <div><h1>ตารางเรียน ${esc(group.name)}</h1><p>ครูที่ปรึกษา ${esc(advisor)} · อัปเดต ${esc(fmtDate(s.createdAt))}</p></div>
        <a class="btn btn-primary" href="print.html?schedule=${encodeURIComponent(s.id)}&type=group&id=${encodeURIComponent(group.id)}" target="_blank" rel="noopener">พิมพ์ / บันทึก PDF</a>
      </div>
      <div class="card">${renderTimetable(snap, s.assignments, 'group', group.id)}</div>
      <div class="card">
        <div class="card-head"><h2>รายวิชาที่เรียน</h2></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>วิชา</th><th class="num">คาบ / สัปดาห์</th><th>ครูผู้สอน</th></tr></thead>
          <tbody>${bySubject.map((a) => {
            const sj = subjMap.get(a.subjectId) || {};
            return `<tr><td>${esc(sj.name || a.subjectId)}</td><td class="num">${esc(sj.periods ?? '')}</td><td>${esc(teachMap.get(a.teacherId)?.name || '-')}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
  } catch (err) {
    root.innerHTML = `<div class="card state"><h3>โหลดตารางเรียนไม่สำเร็จ</h3><p>${esc(err.message)}</p>
      <button type="button" class="btn btn-primary" onclick="location.reload()">ลองอีกครั้ง</button></div>`;
  }
})();
