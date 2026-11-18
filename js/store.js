// =====================================================================
// Data service: one API, two backends
//   - Supabase backend (production)
//   - Local backend (Demo mode, browser localStorage) when config is empty
// UI code only talks to `store` and never to Supabase directly.
// =====================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_EMAIL_DOMAIN, IS_DEMO } from './config.js';

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const normalizeUsername = (u) => String(u || '').trim().toLowerCase();
export const isValidUsername = (u) => USERNAME_RE.test(normalizeUsername(u));

// ---------- camelCase <-> snake_case ----------
const MAPS = {
  teachers: { minHours: 'min_hours', maxHours: 'max_hours', softUnavailable: 'soft_unavailable', subjectIds: 'subject_ids' },
  groups: { advisorId: 'advisor_id' },
  rooms: {},
  subjects: { roomType: 'room_type', fixedDay: 'fixed_day', fixedStart: 'fixed_start', locationText: 'location_text' }
};
const FIELDS = {
  teachers: ['id', 'name', 'position', 'department', 'minHours', 'maxHours', 'unavailable', 'softUnavailable', 'subjectIds'],
  groups: ['id', 'name', 'students', 'advisorId'],
  rooms: ['id', 'name', 'type'],
  subjects: ['id', 'name', 'periods', 'roomType', 'category', 'fixedDay', 'fixedStart', 'combined', 'locationText']
};
function toDb(table, obj) {
  const m = MAPS[table];
  const out = {};
  FIELDS[table].forEach((k) => {
    let v = obj[k];
    if (v === undefined) v = null;
    out[m[k] || k] = v;
  });
  return out;
}
function fromDb(table, row) {
  const m = MAPS[table];
  const out = {};
  FIELDS[table].forEach((k) => {
    const v = row[m[k] || k];
    out[k] = v === undefined ? null : v;
  });
  if (table === 'teachers') {
    out.unavailable = out.unavailable || [];
    out.softUnavailable = out.softUnavailable || [];
    out.subjectIds = out.subjectIds || [];
  }
  return out;
}
const byId = (a, b) => String(a.id).localeCompare(String(b.id), 'th', { numeric: true });

export function cleanDataset(ds) {
  const out = {};
  Object.keys(FIELDS).forEach((t) => {
    out[t] = (ds[t] || []).map((r) => fromDb(t, toDb(t, r))).sort(byId);
  });
  return out;
}

async function fetchSeed() {
  const res = await fetch(new URL('../data/dataset.json', import.meta.url));
  if (!res.ok) throw new Error('โหลดข้อมูลตั้งต้นไม่สำเร็จ');
  return cleanDataset(await res.json());
}

// =====================================================================
// Supabase backend
// =====================================================================
async function createSupabaseBackend() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const emailOf = (username) => `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
  const fail = (error) => { if (error) throw new Error(translateError(error.message)); };

  return {
    mode: 'supabase',
    async signIn(username, password) {
      const { error } = await sb.auth.signInWithPassword({ email: emailOf(username), password });
      fail(error);
      return this.getSession();
    },
    async signUp({ username, password, fullName, groupId, inviteCode }) {
      const { data, error } = await sb.auth.signUp({
        email: emailOf(username),
        password,
        options: { data: { username: normalizeUsername(username), full_name: fullName, group_id: groupId || null, invite_code: inviteCode || '' } }
      });
      fail(error);
      if (!data.session) throw new Error('สมัครสำเร็จแต่ยังเข้าสู่ระบบไม่ได้: ให้ผู้ดูแลปิด "Confirm email" ใน Supabase');
      return this.getSession();
    },
    async signOut() { await sb.auth.signOut(); },
    async getSession() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      const { data: profile, error } = await sb.from('profiles').select('id, username, full_name, role, group_id').eq('id', data.session.user.id).maybeSingle();
      fail(error);
      if (!profile) return null;
      return { userId: profile.id, username: profile.username, fullName: profile.full_name, role: profile.role, groupId: profile.group_id };
    },
    async listGroupsPublic() {
      const { data, error } = await sb.from('groups').select('id, name').order('id');
      fail(error);
      return data;
    },
    async loadDataset() {
      const tables = Object.keys(FIELDS);
      const res = await Promise.all(tables.map((t) => sb.from(t).select('*').order('id')));
      const out = {};
      res.forEach((r, i) => { fail(r.error); out[tables[i]] = r.data.map((row) => fromDb(tables[i], row)); });
      return out;
    },
    async saveEntity(table, obj) {
      const { error } = await sb.from(table).upsert(toDb(table, obj));
      fail(error);
    },
    async deleteEntity(table, id) {
      const { error } = await sb.from(table).delete().eq('id', id);
      fail(error);
    },
    async replaceDataset(ds) {
      const payload = {};
      Object.keys(FIELDS).forEach((t) => { payload[t] = (ds[t] || []).map((r) => toDb(t, r)); });
      const { error } = await sb.rpc('replace_dataset', { payload });
      fail(error);
    },
    async saveSchedule(rec) {
      const { data, error } = await sb.from('schedules').insert({
        duration_ms: rec.durationMs, attempts: rec.attempts, score: rec.report.score, algorithm: rec.algorithm,
        assignments: rec.assignments, report: rec.report, data_snapshot: rec.dataSnapshot
      }).select('id, created_at').single();
      fail(error);
      return { ...rec, id: data.id, createdAt: data.created_at };
    },
    async listSchedules(limit = 20) {
      const { data, error } = await sb.from('schedules').select('id, created_at, duration_ms, attempts, score, algorithm').order('created_at', { ascending: false }).limit(limit);
      fail(error);
      return data.map((r) => ({ id: r.id, createdAt: r.created_at, durationMs: r.duration_ms, attempts: r.attempts, score: r.score, algorithm: r.algorithm }));
    },
    async getSchedule(id) {
      let q = sb.from('schedules').select('*');
      q = id && id !== 'latest' ? q.eq('id', id) : q.order('created_at', { ascending: false }).limit(1);
      const { data, error } = await q.maybeSingle();
      fail(error);
      if (!data) return null;
      return { id: data.id, createdAt: data.created_at, durationMs: data.duration_ms, attempts: data.attempts, algorithm: data.algorithm, assignments: data.assignments, report: data.report, dataSnapshot: data.data_snapshot };
    },
    async deleteSchedule(id) {
      const { error } = await sb.from('schedules').delete().eq('id', id);
      fail(error);
    },
    async listProfiles() {
      const { data, error } = await sb.from('profiles').select('id, username, full_name, role, group_id, created_at').order('username');
      fail(error);
      return data.map((p) => ({ id: p.id, username: p.username, fullName: p.full_name, role: p.role, groupId: p.group_id }));
    },
    async updateProfile(id, patch) {
      const { error } = await sb.from('profiles').update({ role: patch.role, group_id: patch.groupId || null }).eq('id', id);
      fail(error);
    }
  };
}

function translateError(msg = '') {
  if (/invalid login credentials/i.test(msg)) return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  if (/already registered|already exists/i.test(msg)) return 'ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น';
  if (/password should be at least/i.test(msg)) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
  if (/email address .* is invalid|invalid email/i.test(msg)) return 'ระบบปฏิเสธโดเมนอีเมลจำลอง: แก้ AUTH_EMAIL_DOMAIN ใน js/config.js';
  if (/forbidden|row-level security|permission denied/i.test(msg)) return 'ไม่มีสิทธิ์ทำรายการนี้ (เฉพาะครู)';
  if (/failed to fetch|network/i.test(msg)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง';
  if (/violates foreign key/i.test(msg)) return 'ลบไม่ได้ เพราะข้อมูลนี้ถูกใช้งานอยู่ในส่วนอื่น';
  return msg;
}

// =====================================================================
// Local backend (Demo mode) - for offline demo/testing only
// =====================================================================
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
const DEMO_INVITE = 'TEACHER-2569';
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createLocalBackend() {
  if (!LS.get('tt_data')) LS.set('tt_data', await fetchSeed());
  if (!LS.get('tt_users')) {
    LS.set('tt_users', [
      { id: 'u-teacher', username: 'teacher', fullName: 'ครูอภิชาต (ทดลอง)', role: 'teacher', groupId: null, pw: await sha256('teacher:teacher1234') },
      { id: 'u-std', username: 'student', fullName: 'นักศึกษาทดลอง', role: 'student', groupId: 'G1', pw: await sha256('student:student1234') }
    ]);
  }
  const users = () => LS.get('tt_users', []);
  const data = () => LS.get('tt_data', { teachers: [], groups: [], rooms: [], subjects: [] });
  const requireTeacher = () => {
    const s = LS.get('tt_session', null);
    const u = s && users().find((x) => x.id === s.userId);
    if (!u || u.role !== 'teacher') throw new Error('ไม่มีสิทธิ์ทำรายการนี้ (เฉพาะครู)');
  };
  const pub = (u) => ({ userId: u.id, username: u.username, fullName: u.fullName, role: u.role, groupId: u.groupId });

  return {
    mode: 'demo',
    async signIn(username, password) {
      const un = normalizeUsername(username);
      const u = users().find((x) => x.username === un);
      if (!u || u.pw !== (await sha256(`${un}:${password}`))) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      LS.set('tt_session', { userId: u.id });
      return pub(u);
    },
    async signUp({ username, password, fullName, groupId, inviteCode }) {
      const un = normalizeUsername(username);
      if (users().some((x) => x.username === un)) throw new Error('ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น');
      const role = inviteCode && inviteCode === DEMO_INVITE ? 'teacher' : 'student';
      const u = { id: 'u-' + Date.now(), username: un, fullName, role, groupId: role === 'student' ? groupId : null, pw: await sha256(`${un}:${password}`) };
      LS.set('tt_users', [...users(), u]);
      LS.set('tt_session', { userId: u.id });
      return pub(u);
    },
    async signOut() { localStorage.removeItem('tt_session'); },
    async getSession() {
      const s = LS.get('tt_session', null);
      const u = s && users().find((x) => x.id === s.userId);
      return u ? pub(u) : null;
    },
    async listGroupsPublic() { return data().groups.map((g) => ({ id: g.id, name: g.name })); },
    async loadDataset() { return cleanDataset(data()); },
    async saveEntity(table, obj) {
      requireTeacher();
      const d = data();
      const i = d[table].findIndex((r) => r.id === obj.id);
      const clean = fromDb(table, toDb(table, obj));
      if (i >= 0) d[table][i] = clean; else d[table].push(clean);
      LS.set('tt_data', d);
    },
    async deleteEntity(table, id) {
      requireTeacher();
      const d = data();
      d[table] = d[table].filter((r) => r.id !== id);
      if (table === 'teachers') d.groups.forEach((g) => { if (g.advisorId === id) g.advisorId = null; });
      LS.set('tt_data', d);
    },
    async replaceDataset(ds) { requireTeacher(); LS.set('tt_data', cleanDataset(ds)); },
    async saveSchedule(rec) {
      requireTeacher();
      const list = LS.get('tt_schedules', []);
      const id = (list[0]?.id || 0) + 1;
      const saved = { ...rec, id, createdAt: new Date().toISOString() };
      LS.set('tt_schedules', [saved, ...list].slice(0, 15));
      return saved;
    },
    async listSchedules() {
      return LS.get('tt_schedules', []).map(({ id, createdAt, durationMs, attempts, report, algorithm }) => ({ id, createdAt, durationMs, attempts, score: report?.score, algorithm }));
    },
    async getSchedule(id) {
      const list = LS.get('tt_schedules', []);
      if (!id || id === 'latest') return list[0] || null;
      return list.find((s) => String(s.id) === String(id)) || null;
    },
    async deleteSchedule(id) { requireTeacher(); LS.set('tt_schedules', LS.get('tt_schedules', []).filter((s) => String(s.id) !== String(id))); },
    async listProfiles() { requireTeacher(); return users().map((u) => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role, groupId: u.groupId })); },
    async updateProfile(id, patch) {
      requireTeacher();
      LS.set('tt_users', users().map((u) => (u.id === id ? { ...u, role: patch.role, groupId: patch.groupId || null } : u)));
    }
  };
}

let backendPromise = null;
export function getStore() {
  if (!backendPromise) backendPromise = IS_DEMO ? createLocalBackend() : createSupabaseBackend();
  return backendPromise;
}
export { fetchSeed, IS_DEMO };
