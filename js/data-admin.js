// CRUD screens for teachers / groups / rooms / subjects, plus user management
import { DAYS, PERIODS, POSITIONS, DEPARTMENTS, ROOM_TYPES, SUBJECT_ROOM_TYPES, SUBJECT_CATEGORIES } from './config.js';
import { $, $$, esc, toast, openModal, confirmDialog, busy } from './ui.js';

const opt = (obj) => Object.entries(obj);
const nameOf = (list, id) => (list.find((x) => x.id === id) || {}).name || '-';
const fmtWin = (arr) => (arr || []).map((w) => `${DAYS[w.day]} ${w.start}-${w.end}`).join(', ') || '-';

export const ENTITIES = {
  teachers: {
    title: 'ข้อมูลครู', single: 'ครู', desc: 'ครูแผนกคอมพิวเตอร์สอนวิชาชีพ ครูสามัญสอนวิชาที่เลือกไว้',
    columns: [
      { label: 'รหัส', render: (r) => esc(r.id) },
      { label: 'ชื่อครู', render: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: 'ตำแหน่ง', render: (r) => esc(POSITIONS[r.position] || r.position) },
      { label: 'ชั่วโมงสอน', render: (r) => (r.minHours != null || r.maxHours != null ? `${r.minHours ?? 0} - ${r.maxHours ?? '∞'}` : '-'), num: true },
      { label: 'วิชาที่สอน', render: (r, d) => (r.department === 'general' ? esc((r.subjectIds || []).map((id) => nameOf(d.subjects, id)).join(', ') || '-') : 'วิชาชีพ (ระบบจัดให้)') },
      { label: 'เวลาไม่สะดวก', render: (r) => esc(fmtWin(r.unavailable)) }
    ],
    fields: [
      { key: 'id', label: 'รหัสครู', type: 'text', required: true, idField: true, hint: 'เช่น T07' },
      { key: 'name', label: 'ชื่อครู', type: 'text', required: true },
      { key: 'department', label: 'แผนก', type: 'select', options: () => opt(DEPARTMENTS) },
      { key: 'position', label: 'ตำแหน่ง', type: 'select', options: () => opt(POSITIONS) },
      { key: 'minHours', label: 'ชั่วโมงสอนต่ำสุด / สัปดาห์', type: 'number', half: true, hint: 'เว้นว่าง = ไม่กำหนด' },
      { key: 'maxHours', label: 'ชั่วโมงสอนสูงสุด / สัปดาห์', type: 'number', half: true },
      { key: 'subjectIds', label: 'วิชาที่สอน (ครูสามัญ)', type: 'multicheck', options: (d) => d.subjects.filter((s) => s.category === 'general').map((s) => [s.id, s.name]), showIf: (o) => o.department === 'general' },
      { key: 'unavailable', label: 'เวลาไม่สะดวก (ห้ามจัดสอน)', type: 'windows' },
      { key: 'softUnavailable', label: 'เวลาที่อยากว่าง (ถ้าเป็นไปได้)', type: 'windows' }
    ],
    blank: () => ({ id: '', name: '', department: 'computer', position: 'regular', minHours: 18, maxHours: 35, unavailable: [], softUnavailable: [], subjectIds: [] })
  },
  groups: {
    title: 'กลุ่มเรียน', single: 'กลุ่มเรียน', desc: 'ครูที่ปรึกษาเป็นผู้สอนวิชากิจกรรม (ลูกเสือ) ของกลุ่มนั้น',
    columns: [
      { label: 'รหัส', render: (r) => esc(r.id) },
      { label: 'ชั้นเรียน', render: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: 'จำนวนนักเรียน', render: (r) => esc(r.students), num: true },
      { label: 'ครูที่ปรึกษา', render: (r, d) => esc(nameOf(d.teachers, r.advisorId)) }
    ],
    fields: [
      { key: 'id', label: 'รหัสกลุ่ม', type: 'text', required: true, idField: true, hint: 'เช่น G4' },
      { key: 'name', label: 'ชั้นเรียน', type: 'text', required: true, hint: 'เช่น ปวช.1/4' },
      { key: 'students', label: 'จำนวนนักเรียน', type: 'number', required: true },
      { key: 'advisorId', label: 'ครูที่ปรึกษา', type: 'select', options: (d) => [['', 'ไม่ระบุ'], ...d.teachers.map((t) => [t.id, t.name])] }
    ],
    blank: () => ({ id: '', name: '', students: 0, advisorId: '' })
  },
  rooms: {
    title: 'ห้องเรียน', single: 'ห้องเรียน', desc: 'วิชาคอมพิวเตอร์ใช้ได้เฉพาะห้องคอมพิวเตอร์',
    columns: [
      { label: 'รหัส', render: (r) => esc(r.id) },
      { label: 'ชื่อห้อง', render: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: 'ประเภท', render: (r) => `<span class="badge ${r.type === 'computer' ? 'badge-info' : 'badge-neutral'}">${esc(ROOM_TYPES[r.type] || r.type)}</span>` }
    ],
    fields: [
      { key: 'id', label: 'รหัสห้อง', type: 'text', required: true, idField: true, hint: 'เช่น R5' },
      { key: 'name', label: 'ชื่อห้อง', type: 'text', required: true },
      { key: 'type', label: 'ประเภท', type: 'select', options: () => opt(ROOM_TYPES) }
    ],
    blank: () => ({ id: '', name: '', type: 'theory' })
  },
  subjects: {
    title: 'รายวิชา', single: 'รายวิชา', desc: 'ทุกกลุ่มเรียนเรียนตามแผนการเรียนเดียวกัน',
    columns: [
      { label: 'รหัส', render: (r) => esc(r.id) },
      { label: 'ชื่อวิชา', render: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: 'คาบ', render: (r) => esc(r.periods), num: true },
      { label: 'ห้องเรียน', render: (r) => esc(r.roomType === 'field' ? (r.locationText || 'สนาม') : SUBJECT_ROOM_TYPES[r.roomType]) },
      { label: 'หมวด', render: (r) => esc(SUBJECT_CATEGORIES[r.category] || r.category) },
      { label: 'เวลาเรียนที่กำหนด', render: (r) => (r.fixedDay != null && r.fixedStart ? esc(`${DAYS[r.fixedDay]} ${r.fixedStart}`) : '-') }
    ],
    fields: [
      { key: 'id', label: 'รหัสวิชา', type: 'text', required: true, idField: true, hint: 'เช่น S12' },
      { key: 'name', label: 'ชื่อวิชา', type: 'text', required: true },
      { key: 'periods', label: 'จำนวนคาบ / สัปดาห์', type: 'number', required: true, half: true },
      { key: 'category', label: 'หมวดวิชา', type: 'select', options: () => opt(SUBJECT_CATEGORIES), half: true },
      { key: 'roomType', label: 'ประเภทห้อง', type: 'select', options: () => opt(SUBJECT_ROOM_TYPES) },
      { key: 'fixedDay', label: 'วันที่กำหนด (ถ้ามี)', type: 'select', options: () => [['', 'ไม่กำหนด'], ...DAYS.map((d, i) => [String(i), d])], half: true },
      { key: 'fixedStart', label: 'เวลาเริ่มที่กำหนด', type: 'select', options: () => [['', 'ไม่กำหนด'], ...PERIODS.map((p) => [p.start, p.start])], half: true },
      { key: 'locationText', label: 'สถานที่ (กรณีเรียนนอกห้อง)', type: 'text', showIf: (o) => o.roomType === 'field' },
      { key: 'combined', label: 'เรียนรวมทุกกลุ่มพร้อมกัน', type: 'checkbox' }
    ],
    blank: () => ({ id: '', name: '', periods: 2, category: 'dept', roomType: 'theory', fixedDay: null, fixedStart: null, combined: false, locationText: '' })
  }
};

// ---------- form building ----------
function windowRow(w = { day: 0, start: '08:00', end: '12:00' }) {
  const times = [...new Set(PERIODS.flatMap((p) => [p.start, p.end]))];
  return `<div class="tw-row">
    <select class="input" data-w="day" aria-label="วัน">${DAYS.map((d, i) => `<option value="${i}" ${i === Number(w.day) ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <select class="input" data-w="start" aria-label="เวลาเริ่ม">${times.map((t) => `<option ${t === w.start ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select class="input" data-w="end" aria-label="เวลาสิ้นสุด">${times.map((t) => `<option ${t === w.end ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button type="button" class="btn btn-ghost btn-sm" data-w-remove>ลบ</button>
  </div>`;
}

function fieldHtml(f, obj, data, isNew) {
  const v = obj[f.key];
  const id = `f-${f.key}`;
  const req = f.required ? 'required' : '';
  let control = '';
  if (f.type === 'text' || f.type === 'number') {
    const ro = f.idField && !isNew ? 'readonly' : '';
    control = `<input class="input" id="${id}" name="${f.key}" type="${f.type}" value="${esc(v ?? '')}" ${req} ${ro} ${f.type === 'number' ? 'min="0" step="1"' : ''}>`;
  } else if (f.type === 'select') {
    const cur = v == null ? '' : String(v);
    control = `<select class="input" id="${id}" name="${f.key}">${f.options(data).map(([k, l]) => `<option value="${esc(k)}" ${String(k) === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if (f.type === 'checkbox') {
    return `<div class="field" data-key="${f.key}"><label class="check"><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
  } else if (f.type === 'multicheck') {
    const opts = f.options(data);
    control = opts.length
      ? `<div class="chips">${opts.map(([k, l]) => `<label class="check"><input type="checkbox" name="${f.key}" value="${esc(k)}" ${(v || []).includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`
      : '<span class="hint">ยังไม่มีวิชาสามัญ เพิ่มที่เมนู "รายวิชา" ก่อน</span>';
  } else if (f.type === 'windows') {
    control = `<div class="tw-list" data-windows="${f.key}">${(v || []).map(windowRow).join('')}</div>
      <div><button type="button" class="btn btn-secondary btn-sm" data-w-add="${f.key}">เพิ่มช่วงเวลา</button></div>`;
  }
  return `<div class="field" data-key="${f.key}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${control}
    ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}<span class="error-text hidden"></span></div>`;
}

function readForm(form, fields) {
  const o = {};
  fields.forEach((f) => {
    if (f.type === 'text') o[f.key] = form.elements[f.key].value.trim();
    else if (f.type === 'number') { const s = form.elements[f.key].value.trim(); o[f.key] = s === '' ? null : Number(s); }
    else if (f.type === 'select') o[f.key] = form.elements[f.key].value;
    else if (f.type === 'checkbox') o[f.key] = form.querySelector(`[name="${f.key}"]`).checked;
    else if (f.type === 'multicheck') o[f.key] = $$(`[name="${f.key}"]:checked`, form).map((x) => x.value);
    else if (f.type === 'windows') {
      o[f.key] = $$(`[data-windows="${f.key}"] .tw-row`, form).map((r) => ({
        day: Number($('[data-w=day]', r).value), start: $('[data-w=start]', r).value, end: $('[data-w=end]', r).value
      }));
    }
  });
  return o;
}

function normalize(table, o) {
  if (table === 'subjects') {
    o.fixedDay = o.fixedDay === '' || o.fixedDay == null ? null : Number(o.fixedDay);
    o.fixedStart = o.fixedStart || null;
    if (o.roomType !== 'field') o.locationText = null;
  }
  if (table === 'groups') o.advisorId = o.advisorId || null;
  if (table === 'teachers' && o.department !== 'general') o.subjectIds = [];
  return o;
}

function validate(table, o, data, isNew) {
  const errs = {};
  const def = ENTITIES[table];
  def.fields.forEach((f) => {
    if (f.required && (o[f.key] === '' || o[f.key] == null)) errs[f.key] = 'กรุณากรอกข้อมูลนี้';
    if (f.type === 'number' && o[f.key] != null && (!Number.isInteger(o[f.key]) || o[f.key] < 0)) errs[f.key] = 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  });
  if (isNew && o.id && data[table].some((r) => r.id === o.id)) errs.id = 'รหัสนี้มีอยู่แล้ว ใช้รหัสอื่น';
  if (o.id && !/^[A-Za-z0-9_-]{1,20}$/.test(o.id)) errs.id = 'ใช้ได้เฉพาะ A-Z, 0-9, _ , - (ไม่เกิน 20 ตัว)';
  if (table === 'teachers' && o.minHours != null && o.maxHours != null && o.minHours > o.maxHours) errs.maxHours = 'ต้องไม่น้อยกว่าชั่วโมงต่ำสุด';
  if (table === 'teachers') ['unavailable', 'softUnavailable'].forEach((k) => {
    if (o[k].some((w) => w.start >= w.end)) errs[k] = 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม';
  });
  if (table === 'subjects') {
    if (o.periods != null && (o.periods < 1 || o.periods > 40)) errs.periods = 'ต้องอยู่ระหว่าง 1 - 40 คาบ';
    if ((o.fixedDay == null) !== (o.fixedStart == null)) errs.fixedStart = 'ต้องกำหนดทั้งวันและเวลาเริ่ม หรือไม่กำหนดทั้งคู่';
  }
  return errs;
}

export function openEntityForm(table, row, ctx) {
  const def = ENTITIES[table];
  const data = ctx.getData();
  const isNew = !row;
  const obj = { ...(row || def.blank()) };

  const body = document.createElement('div');
  const draw = () => {
    const fieldsHtml = def.fields.filter((f) => !f.showIf || f.showIf(obj)).map((f) => ({ f, html: fieldHtml(f, obj, data, isNew) }));
    let html = '';
    for (let i = 0; i < fieldsHtml.length; i++) {
      const cur = fieldsHtml[i];
      const next = fieldsHtml[i + 1];
      if (cur.f.half && next && next.f.half) { html += `<div class="grid-2">${cur.html}${next.html}</div>`; i++; } else html += cur.html;
    }
    body.innerHTML = html;
    $$('[data-w-add]', body).forEach((b) => { b.onclick = () => { $(`[data-windows="${b.dataset.wAdd}"]`, body).insertAdjacentHTML('beforeend', windowRow()); }; });
    // re-render when a field that controls showIf changes
    ['department', 'roomType'].forEach((k) => {
      const el = body.querySelector(`[name="${k}"]`);
      if (el) el.onchange = () => { Object.assign(obj, readForm(body.closest('form'), def.fields.filter((f) => body.querySelector(`[data-key="${f.key}"]`)))); draw(); };
    });
  };
  body.addEventListener('click', (e) => { if (e.target.matches('[data-w-remove]')) e.target.closest('.tw-row')?.remove(); });
  draw();

  openModal({
    title: isNew ? `เพิ่ม${def.single}` : `แก้ไข${def.single}: ${row.name}`,
    body,
    submitText: isNew ? `เพิ่ม${def.single}` : 'บันทึกการเปลี่ยนแปลง',
    onSubmit: async (form) => {
      const visible = def.fields.filter((f) => form.querySelector(`[data-key="${f.key}"]`));
      const o = normalize(table, { ...obj, ...readForm(form, visible) });
      const errs = validate(table, o, data, isNew);
      $$('.field', form).forEach((fe) => {
        const err = errs[fe.dataset.key];
        const t = $('.error-text', fe);
        const input = $('input, select', fe);
        if (input) input.setAttribute('aria-invalid', err ? 'true' : 'false');
        if (t) { t.textContent = err || ''; t.classList.toggle('hidden', !err); }
      });
      if (Object.keys(errs).length) { toast('กรุณาแก้ไขช่องที่มีข้อความสีแดง', 'error'); return false; }
      await ctx.store.saveEntity(table, o);
      await ctx.reload();
      toast(isNew ? `เพิ่ม${def.single} "${o.name}" แล้ว` : `บันทึก "${o.name}" แล้ว`, 'success');
      return true;
    }
  });
}

export function renderEntityList(root, table, ctx) {
  const def = ENTITIES[table];
  const data = ctx.getData();
  const rows = data[table];
  root.innerHTML = `
    <div class="page-head">
      <div><h1>${def.title}</h1><p>${def.desc}</p></div>
      <button type="button" class="btn btn-primary" data-add>เพิ่ม${def.single}</button>
    </div>
    <div class="card">
      ${rows.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr>${def.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}<th class="actions"><span class="sr-only">จัดการ</span></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${def.columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(r, data)}</td>`).join('')}
          <td class="actions"><button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(r.id)}">แก้ไข</button>
          <button type="button" class="btn btn-ghost btn-sm" data-del="${esc(r.id)}">ลบ</button></td></tr>`).join('')}</tbody>
      </table></div>` : `
      <div class="state"><h3>ยังไม่มี${def.single}</h3><p>เพิ่ม${def.single}รายการแรก หรือนำเข้าไฟล์จากเมนู "นำเข้า / ส่งออก"</p>
        <button type="button" class="btn btn-primary" data-add>เพิ่ม${def.single}</button></div>`}
    </div>`;

  $$('[data-add]', root).forEach((b) => { b.onclick = () => openEntityForm(table, null, ctx); });
  $$('[data-edit]', root).forEach((b) => { b.onclick = () => openEntityForm(table, rows.find((r) => r.id === b.dataset.edit), ctx); });
  $$('[data-del]', root).forEach((b) => {
    b.onclick = async () => {
      const r = rows.find((x) => x.id === b.dataset.del);
      const ok = await confirmDialog({ title: `ลบ${def.single} "${r.name}"?`, message: 'ข้อมูลนี้จะถูกลบถาวร ตารางที่จัดไว้แล้วไม่เปลี่ยน แต่การประมวลผลครั้งถัดไปจะไม่มีรายการนี้', confirmText: `ลบ${def.single}`, danger: true });
      if (!ok) return;
      try {
        await ctx.store.deleteEntity(table, r.id);
        await ctx.reload();
        toast(`ลบ "${r.name}" แล้ว`, 'success');
      } catch (err) { toast(`ลบไม่สำเร็จ: ${err.message}`, 'error'); }
    };
  });
}

// ---------- Users ----------
export async function renderUsers(root, ctx) {
  root.innerHTML = `<div class="page-head"><div><h1>ผู้ใช้งาน</h1><p>เปลี่ยนสิทธิ์ หรือกำหนดกลุ่มเรียนของนักศึกษา</p></div></div>
    <div class="card" id="users-card"><div class="skeleton" style="height:180px"></div></div>`;
  const card = $('#users-card', root);
  let users;
  try {
    users = await ctx.store.listProfiles();
  } catch (err) {
    card.innerHTML = `<div class="state"><h3>โหลดรายชื่อผู้ใช้ไม่สำเร็จ</h3><p>${esc(err.message)}</p><button class="btn btn-secondary" id="u-retry">ลองอีกครั้ง</button></div>`;
    $('#u-retry', card).onclick = () => renderUsers(root, ctx);
    return;
  }
  const groups = ctx.getData().groups;
  if (!users.length) { card.innerHTML = '<div class="state"><h3>ยังไม่มีผู้ใช้</h3><p>ให้นักศึกษาสมัครสมาชิกที่หน้า "สมัครสมาชิก"</p></div>'; return; }
  card.innerHTML = `<div class="table-wrap"><table class="data">
    <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ-นามสกุล</th><th>สิทธิ์</th><th>กลุ่มเรียน</th><th class="actions"><span class="sr-only">บันทึก</span></th></tr></thead>
    <tbody>${users.map((u) => `<tr data-uid="${esc(u.id)}">
      <td><strong>${esc(u.username)}</strong>${u.id === ctx.session.userId ? ' <span class="badge badge-info">คุณ</span>' : ''}</td>
      <td>${esc(u.fullName || '-')}</td>
      <td><select class="input" data-f="role" aria-label="สิทธิ์ของ ${esc(u.username)}" ${u.id === ctx.session.userId ? 'disabled' : ''}>
        <option value="student" ${u.role === 'student' ? 'selected' : ''}>นักศึกษา</option>
        <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>ครู</option></select></td>
      <td><select class="input" data-f="group" aria-label="กลุ่มเรียนของ ${esc(u.username)}">
        <option value="">ไม่ระบุ</option>${groups.map((g) => `<option value="${esc(g.id)}" ${g.id === u.groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></td>
      <td class="actions"><button type="button" class="btn btn-secondary btn-sm" data-save>บันทึก</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-save]', card).forEach((b) => {
    b.onclick = async () => {
      const tr = b.closest('tr');
      const restore = busy(b, 'บันทึก...');
      try {
        await ctx.store.updateProfile(tr.dataset.uid, { role: $('[data-f=role]', tr).value, groupId: $('[data-f=group]', tr).value });
        toast('บันทึกผู้ใช้แล้ว', 'success');
      } catch (err) { toast(`บันทึกไม่สำเร็จ: ${err.message}`, 'error'); } finally { restore(); }
    };
  });
}
