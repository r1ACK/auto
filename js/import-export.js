// Import (JSON / CSV) and export of the input dataset
import { DAYS } from './config.js';
import { cleanDataset, fetchSeed } from './store.js';
import { validateData } from './scheduler.js';
import { $, esc, toast, busy, download, confirmDialog } from './ui.js';

export const TABLE_LABELS = { teachers: 'ข้อมูลครู', groups: 'กลุ่มเรียน', rooms: 'ห้องเรียน', subjects: 'รายวิชา' };

// ---------- CSV basics ----------
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (head, rows) => '﻿' + [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');

// "จันทร์ 08:00-12:00; ศุกร์ 13:00-17:00"  <->  [{day,start,end}]
const dayIndex = (d) => {
  const t = String(d).trim();
  if (/^\d+$/.test(t)) return Number(t);
  return DAYS.findIndex((x) => x === t || x.startsWith(t.replace(/^วัน/, '')));
};
function parseWindows(str) {
  if (!str) return [];
  return str.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(\S+)\s+(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})$/);
    if (!m) throw new Error(`รูปแบบเวลาไม่ถูกต้อง: "${p}" (ตัวอย่าง: จันทร์ 08:00-12:00)`);
    const day = dayIndex(m[1]);
    if (day < 0) throw new Error(`ไม่รู้จักวัน "${m[1]}"`);
    const fix = (t) => t.replace('.', ':').padStart(5, '0');
    return { day, start: fix(m[2]), end: fix(m[3]) };
  });
}
const fmtWindows = (arr) => (arr || []).map((w) => `${DAYS[w.day]} ${w.start}-${w.end}`).join('; ');
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

const CSV_SPEC = {
  teachers: {
    head: ['id', 'name', 'position', 'department', 'min_hours', 'max_hours', 'unavailable', 'soft_unavailable', 'subject_ids'],
    to: (t) => [t.id, t.name, t.position, t.department, t.minHours ?? '', t.maxHours ?? '', fmtWindows(t.unavailable), fmtWindows(t.softUnavailable), (t.subjectIds || []).join(';')],
    from: (r) => ({
      id: r.id, name: r.name, position: r.position || 'regular', department: r.department || 'computer',
      minHours: numOrNull(r.min_hours), maxHours: numOrNull(r.max_hours),
      unavailable: parseWindows(r.unavailable), softUnavailable: parseWindows(r.soft_unavailable),
      subjectIds: (r.subject_ids || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean)
    })
  },
  groups: {
    head: ['id', 'name', 'students', 'advisor_id'],
    to: (g) => [g.id, g.name, g.students, g.advisorId ?? ''],
    from: (r) => ({ id: r.id, name: r.name, students: Number(r.students || 0), advisorId: r.advisor_id || null })
  },
  rooms: {
    head: ['id', 'name', 'type'],
    to: (x) => [x.id, x.name, x.type],
    from: (r) => ({ id: r.id, name: r.name, type: r.type })
  },
  subjects: {
    head: ['id', 'name', 'periods', 'room_type', 'category', 'fixed_day', 'fixed_start', 'combined', 'location_text'],
    to: (s) => [s.id, s.name, s.periods, s.roomType, s.category, s.fixedDay != null ? DAYS[s.fixedDay] : '', s.fixedStart ?? '', s.combined ? 'true' : 'false', s.locationText ?? ''],
    from: (r) => ({
      id: r.id, name: r.name, periods: Number(r.periods), roomType: r.room_type || 'theory', category: r.category || 'dept',
      fixedDay: r.fixed_day === '' || r.fixed_day == null ? null : dayIndex(r.fixed_day),
      fixedStart: r.fixed_start || null, combined: /^(true|1|yes|ใช่)$/i.test(r.combined || ''), locationText: r.location_text || null
    })
  }
};

export function tableToCSV(table, rows) {
  const spec = CSV_SPEC[table];
  return toCSV(spec.head, rows.map(spec.to));
}

function rowsFromCSV(table, text) {
  const spec = CSV_SPEC[table];
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('ไฟล์ CSV ไม่มีข้อมูล');
  const missing = ['id', 'name'].filter((h) => !(h in rows[0]));
  if (missing.length) throw new Error(`CSV ขาดคอลัมน์: ${missing.join(', ')} (หัวตารางที่ต้องมี: ${spec.head.join(', ')})`);
  return rows.map((r, i) => {
    if (!r.id || !r.name) throw new Error(`แถวที่ ${i + 2}: ต้องมี id และ name`);
    try { return spec.from(r); } catch (e) { throw new Error(`แถวที่ ${i + 2}: ${e.message}`); }
  });
}

function guessTable(filename) {
  const f = filename.toLowerCase();
  if (/teacher|ครู/.test(f)) return 'teachers';
  if (/group|class|กลุ่ม/.test(f)) return 'groups';
  if (/room|ห้อง/.test(f)) return 'rooms';
  if (/subject|course|วิชา/.test(f)) return 'subjects';
  return '';
}

// ---------- View ----------
export function renderImportExport(root, ctx) {
  let pending = null; // dataset waiting for confirmation

  root.innerHTML = `
    <div class="page-head"><div><h1>นำเข้า / ส่งออกข้อมูล</h1><p>นำเข้าชุดข้อมูลของเจ้าภาพเป็น JSON หรือ CSV ทีละตาราง</p></div></div>
    <div class="card">
      <div class="card-head"><h2>นำเข้าไฟล์</h2></div>
      <div class="grid-2">
        <div class="field">
          <label for="imp-table">ไฟล์ CSV นี้คือข้อมูล</label>
          <select class="input" id="imp-table">
            <option value="">ตรวจจากชื่อไฟล์อัตโนมัติ</option>
            ${Object.entries(TABLE_LABELS).map(([k, v]) => `<option value="${k}">${v} (${k}.csv)</option>`).join('')}
          </select>
          <span class="hint">ไฟล์ JSON ไม่ต้องเลือก ระบบอ่านทุกตารางในไฟล์เดียว</span>
        </div>
      </div>
      <label class="dropzone" id="dropzone">
        <input type="file" id="imp-file" accept=".json,.csv" class="sr-only">
        <strong>ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์</strong><br>
        <span class="small">รองรับ .json (ทั้งชุด) และ .csv (ทีละตาราง)</span>
      </label>
      <div id="imp-preview" class="hidden" style="margin-top:16px"></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>ส่งออก / แม่แบบ</h2></div>
      <p class="muted small">ไฟล์ CSV ที่ส่งออกใช้เป็นแม่แบบสำหรับนำเข้าได้ทันที คอลัมน์เวลาไม่สะดวกเขียนแบบ <code>จันทร์ 08:00-12:00; ศุกร์ 13:00-17:00</code></p>
      <div class="row">
        <button type="button" class="btn btn-secondary" id="exp-json">ดาวน์โหลดข้อมูลทั้งหมด (JSON)</button>
        ${Object.entries(TABLE_LABELS).map(([k, v]) => `<button type="button" class="btn btn-ghost" data-exp="${k}">${v} (CSV)</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>คืนค่าข้อมูลตามโจทย์</h2></div>
      <p class="muted small">แทนที่ข้อมูลทั้งหมดด้วยชุดข้อมูลตั้งต้นจากโจทย์การแข่งขัน (ครู 6 คน กลุ่มเรียน 3 กลุ่ม ห้อง 4 ห้อง วิชา 11 วิชา)</p>
      <button type="button" class="btn btn-danger" id="reset-seed">คืนค่าข้อมูลตามโจทย์</button>
    </div>`;

  const preview = $('#imp-preview', root);
  const fileInput = $('#imp-file', root);
  const zone = $('#dropzone', root);

  const showPreview = (ds, source) => {
    pending = cleanDataset(ds);
    const errors = validateData(pending);
    preview.classList.remove('hidden');
    preview.innerHTML = `
      <div class="alert ${errors.length ? 'alert-warn' : 'alert-info'}">
        <strong>ตรวจไฟล์ ${esc(source)} แล้ว</strong>
        ${errors.length ? `<br>พบปัญหาที่ต้องแก้ก่อนจัดตาราง:<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '<br>ข้อมูลครบ พร้อมนำเข้า'}
      </div>
      <div class="table-wrap"><table class="data"><thead><tr><th>ตาราง</th><th class="num">จำนวนรายการหลังนำเข้า</th></tr></thead><tbody>
        ${Object.entries(TABLE_LABELS).map(([k, v]) => `<tr><td>${v}</td><td class="num">${pending[k].length}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:16px">
        <button type="button" class="btn btn-primary" id="imp-confirm">ยืนยันนำเข้าข้อมูล</button>
        <button type="button" class="btn btn-secondary" id="imp-cancel">ยกเลิก</button>
      </div>`;
    $('#imp-cancel', preview).onclick = () => { pending = null; preview.classList.add('hidden'); fileInput.value = ''; };
    $('#imp-confirm', preview).onclick = async (e) => {
      const restore = busy(e.currentTarget, 'กำลังนำเข้า...');
      try {
        await ctx.store.replaceDataset(pending);
        await ctx.reload();
        toast('นำเข้าข้อมูลสำเร็จ', 'success');
        pending = null;
        preview.classList.add('hidden');
        fileInput.value = '';
      } catch (err) {
        toast(`นำเข้าไม่สำเร็จ: ${err.message}`, 'error');
        restore();
      }
    };
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      if (/\.json$/i.test(file.name)) {
        const json = JSON.parse(text);
        if (!json || typeof json !== 'object' || !Object.keys(TABLE_LABELS).some((k) => Array.isArray(json[k]))) {
          throw new Error('JSON ต้องมี teachers / groups / rooms / subjects อย่างน้อย 1 ตาราง');
        }
        const base = ctx.getData();
        const merged = {};
        Object.keys(TABLE_LABELS).forEach((k) => { merged[k] = Array.isArray(json[k]) ? json[k] : base[k]; });
        showPreview(merged, file.name);
      } else {
        const table = $('#imp-table', root).value || guessTable(file.name);
        if (!table) throw new Error('ระบุไม่ได้ว่าไฟล์ CSV นี้เป็นตารางไหน กรุณาเลือกในช่อง "ไฟล์ CSV นี้คือข้อมูล"');
        const rows = rowsFromCSV(table, text);
        showPreview({ ...ctx.getData(), [table]: rows }, `${file.name} (${TABLE_LABELS[table]})`);
      }
    } catch (err) {
      preview.classList.remove('hidden');
      preview.innerHTML = `<div class="alert alert-error">อ่านไฟล์ไม่สำเร็จ: ${esc(err.message)}</div>`;
      fileInput.value = '';
    }
  };

  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  $('#exp-json', root).onclick = () => download('dataset.json', JSON.stringify(ctx.getData(), null, 2));
  root.querySelectorAll('[data-exp]').forEach((b) => {
    b.onclick = () => download(`${b.dataset.exp}.csv`, tableToCSV(b.dataset.exp, ctx.getData()[b.dataset.exp]), 'text/csv');
  });
  $('#reset-seed', root).onclick = async (e) => {
    const ok = await confirmDialog({ title: 'คืนค่าข้อมูลตามโจทย์?', message: 'ข้อมูลครู กลุ่มเรียน ห้อง และรายวิชาปัจจุบันจะถูกแทนที่ทั้งหมด (ตารางที่จัดไว้แล้วยังอยู่ในประวัติ)', confirmText: 'คืนค่าข้อมูล', danger: true });
    if (!ok) return;
    const restore = busy(e.currentTarget, 'กำลังคืนค่า...');
    try {
      await ctx.store.replaceDataset(await fetchSeed());
      await ctx.reload();
      toast('คืนค่าข้อมูลตามโจทย์แล้ว', 'success');
    } catch (err) {
      toast(`คืนค่าไม่สำเร็จ: ${err.message}`, 'error');
    } finally { restore(); }
  };
}
