// Render one timetable (teacher / group / room) as an HTML table string
import { DAYS, PERIODS, LUNCH } from './config.js';
import { esc } from './ui.js';

export const VIEW_TYPES = {
  teacher: { label: 'ครู', title: (n) => `ตารางสอน ${n}`, list: 'teachers' },
  group: { label: 'กลุ่มเรียน', title: (n) => `ตารางเรียน ${n}`, list: 'groups' },
  room: { label: 'ห้องเรียน', title: (n) => `ตารางการใช้ห้องเรียน ${n}`, list: 'rooms' }
};

function lookup(data) {
  const m = (arr) => new Map((arr || []).map((x) => [x.id, x]));
  return { t: m(data.teachers), g: m(data.groups), r: m(data.rooms), s: m(data.subjects) };
}

export function filterAssignments(assignments, type, id) {
  if (type === 'teacher') return assignments.filter((a) => a.teacherId === id);
  if (type === 'group') return assignments.filter((a) => a.groupId === id);
  return assignments.filter((a) => a.roomId === id);
}

export function entityName(data, type, id) {
  const L = lookup(data);
  const map = type === 'teacher' ? L.t : type === 'group' ? L.g : L.r;
  return map.get(id)?.name || id;
}

export function renderTimetable(data, assignments, type, id) {
  const L = lookup(data);
  const list = filterAssignments(assignments, type, id);
  const startAt = new Map(list.map((a) => [`${a.day}-${a.start}`, a]));
  const covered = new Set();
  list.forEach((a) => { for (let k = 1; k < a.length; k++) covered.add(`${a.day}-${a.start + k}`); });

  const blockHtml = (a) => {
    const s = L.s.get(a.subjectId) || { name: a.subjectId, category: 'dept' };
    const teacher = L.t.get(a.teacherId)?.name || '-';
    const group = L.g.get(a.groupId)?.name || '-';
    const place = a.roomId ? (L.r.get(a.roomId)?.name || a.location) : (a.location || '-');
    const meta = type === 'teacher' ? [group, place]
      : type === 'group' ? [teacher, place]
        : [teacher, group];
    return `<div class="tt-block cat-${esc(s.category)}">
      <span class="s-name">${esc(s.name)}</span>
      ${meta.map((x) => `<span class="s-meta">${esc(x)}</span>`).join('')}
    </div>`;
  };

  const head = PERIODS.map((p, i) => {
    const th = `<th scope="col"><span class="p-no">คาบ ${p.no}</span><span class="p-time">${p.start}-${p.end}</span></th>`;
    return i === LUNCH.afterIndex ? th + '<th scope="col" class="lunch-h" aria-label="พักกลางวัน"><span class="p-time">12-13</span></th>' : th;
  }).join('');

  const rows = DAYS.map((day, d) => {
    let cells = '';
    for (let p = 0; p < PERIODS.length; p++) {
      const key = `${d}-${p}`;
      if (!covered.has(key)) {
        const a = startAt.get(key);
        if (a) {
          // never merge across the lunch column
          const span = Math.min(a.length, p <= LUNCH.afterIndex ? LUNCH.afterIndex + 1 - p : PERIODS.length - p);
          cells += `<td class="slot" colspan="${span}">${blockHtml(a)}</td>`;
        } else {
          cells += '<td class="empty"></td>';
        }
      }
      if (p === LUNCH.afterIndex && d === 0) cells += `<td class="lunch" rowspan="${DAYS.length}">พักกลางวัน ${LUNCH.start}-${LUNCH.end}</td>`;
    }
    return `<tr><th scope="row" class="day">${day}</th>${cells}</tr>`;
  }).join('');

  // Mobile: day-by-day list instead of a wide grid
  const dayList = DAYS.map((day, d) => {
    const items = list.filter((a) => a.day === d).sort((x, y) => x.start - y.start);
    return `<div class="tt-day"><h3>${day}</h3>${items.length ? items.map((a) => `
      <div class="tt-day-item"><span class="tt-day-time num">${PERIODS[a.start].start}-${PERIODS[a.start + a.length - 1].end}</span>${blockHtml(a)}</div>`).join('')
      : '<p class="muted small">ไม่มีคาบ</p>'}</div>`;
  }).join('');

  const hours = list.reduce((x, a) => x + a.length, 0);
  const subjects = new Set(list.map((a) => a.subjectId)).size;
  const label = type === 'room' ? 'ชั่วโมงใช้งาน' : type === 'teacher' ? 'ชั่วโมงสอน' : 'ชั่วโมงเรียน';

  return `
    <div class="tt-wrap">
      <table class="tt">
        <colgroup><col style="width:92px">${PERIODS.map((_, i) => (i === LUNCH.afterIndex ? '<col><col class="lunch-col">' : '<col>')).join('')}</colgroup>
        <thead><tr><th scope="col">วัน / เวลา</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="tt-days">${dayList}</div>
    <div class="tt-summary">
      <span>${label}รวม <strong>${hours}</strong> ชม./สัปดาห์</span>
      <span>จำนวนวิชา <strong>${subjects}</strong></span>
    </div>
    <div class="tt-legend"><span><i></i>วิชาชีพ</span><span><i class="g"></i>วิชาสามัญ</span><span><i class="a"></i>กิจกรรม</span></div>`;
}

// All 13 sheets in the order of the brief's output checklist
export function allSheets(data) {
  return [
    ...data.teachers.map((t) => ({ type: 'teacher', id: t.id })),
    ...data.groups.map((g) => ({ type: 'group', id: g.id })),
    ...data.rooms.map((r) => ({ type: 'room', id: r.id }))
  ];
}
