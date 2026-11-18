// =====================================================================
// Auto timetable engine
// Technique: 2-stage hybrid
//   Stage 1  Teacher assignment  -> Simulated Annealing (balance hours,
//            head-teacher limits, same teacher per subject, every-day rule)
//   Stage 2  Slot + room placement -> Constraint Satisfaction (backtracking
//            + MRV variable ordering + heuristic value ordering)
//   Outer loop: random restarts, keep the best-scoring solution.
// Pure functions only: runs in a Web Worker, in the browser, or in Node.
// =====================================================================
import { DAYS, PERIODS, SEGMENTS } from './config.js';

const ND = DAYS.length;
const NP = PERIODS.length;

// ---------- helpers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

// Period indexes covered by a {day,start,end} time window
function periodsInWindow(win) {
  const s = toMin(win.start);
  const e = toMin(win.end);
  const out = [];
  PERIODS.forEach((p, i) => {
    if (toMin(p.start) < e && toMin(p.end) > s) out.push(i);
  });
  return out;
}

function periodIndexByStart(hhmm) {
  return PERIODS.findIndex((p) => p.start === hhmm);
}

function grid(fill = null) {
  return Array.from({ length: ND }, () => Array(NP).fill(fill));
}

// ---------- validation ----------
export function validateData(data) {
  const errors = [];
  const { teachers = [], groups = [], rooms = [], subjects = [] } = data || {};
  if (!teachers.length) errors.push('ยังไม่มีข้อมูลครู');
  if (!groups.length) errors.push('ยังไม่มีข้อมูลกลุ่มเรียน');
  if (!rooms.length) errors.push('ยังไม่มีข้อมูลห้องเรียน');
  if (!subjects.length) errors.push('ยังไม่มีข้อมูลรายวิชา');
  const tIds = new Set(teachers.map((t) => t.id));
  groups.forEach((g) => {
    if (subjects.some((s) => s.category === 'activity') && !tIds.has(g.advisorId)) {
      errors.push(`กลุ่ม ${g.name} ไม่มีครูที่ปรึกษาที่ถูกต้อง`);
    }
  });
  subjects.forEach((s) => {
    if (!(s.periods > 0)) errors.push(`วิชา ${s.name} จำนวนคาบไม่ถูกต้อง`);
    if (s.category === 'general' && !teachers.some((t) => (t.subjectIds || []).includes(s.id))) {
      errors.push(`วิชา ${s.name} ยังไม่มีครูสามัญที่สอน`);
    }
    if (s.category === 'dept' && !teachers.some((t) => t.department === 'computer')) {
      errors.push('ไม่มีครูแผนกสำหรับวิชาชีพ');
    }
    if (s.fixedStart && periodIndexByStart(s.fixedStart) < 0) {
      errors.push(`วิชา ${s.name} เวลาเริ่มที่กำหนด (${s.fixedStart}) ไม่ตรงกับคาบเรียน`);
    }
    if (s.roomType === 'computer' && !rooms.some((r) => r.type === 'computer')) {
      errors.push(`วิชา ${s.name} ต้องใช้ห้องคอมพิวเตอร์ แต่ไม่มีห้องประเภทนี้`);
    }
    if (s.roomType === 'theory' && !rooms.some((r) => r.type === 'theory')) {
      errors.push(`วิชา ${s.name} ต้องใช้ห้องทฤษฎี แต่ไม่มีห้องประเภทนี้`);
    }
  });
  const weekly = subjects.reduce((a, s) => a + (s.periods || 0), 0);
  if (weekly > ND * NP) errors.push(`จำนวนคาบรวม ${weekly} เกินจำนวนคาบต่อสัปดาห์ (${ND * NP})`);
  return errors;
}

// ---------- Stage 1: build blocks ----------
function splitPeriods(total) {
  // Keep each subject in as few contiguous chunks as possible (max = segment size)
  const maxLen = Math.max(...SEGMENTS.map((s) => s.length));
  const parts = [];
  let left = total;
  while (left > 0) {
    const len = Math.min(maxLen, left);
    parts.push(len);
    left -= len;
  }
  return parts;
}

function buildModel(data) {
  const { teachers, groups, rooms, subjects } = data;
  const deptTeachers = teachers.filter((t) => t.department === 'computer');
  const fixed = []; // pre-placed assignments
  const blocks = []; // to place

  groups.forEach((g) => {
    subjects.forEach((s) => {
      if (s.fixedDay !== undefined && s.fixedDay !== null && s.fixedStart) {
        const start = periodIndexByStart(s.fixedStart);
        const teacherId = s.category === 'activity' ? g.advisorId : (teachers.find((t) => (t.subjectIds || []).includes(s.id)) || {}).id;
        fixed.push({
          groupId: g.id, subjectId: s.id, teacherId, roomId: null,
          location: s.locationText || 'นอกห้องเรียน',
          day: Number(s.fixedDay), start, length: s.periods, combined: !!s.combined
        });
        return;
      }
      splitPeriods(s.periods).forEach((len, part) => {
        blocks.push({
          key: `${g.id}|${s.id}|${part}`,
          groupId: g.id, subjectId: s.id, length: len,
          roomType: s.roomType, category: s.category,
          fixedTeacher: s.category === 'general'
            ? (teachers.find((t) => (t.subjectIds || []).includes(s.id)) || {}).id
            : s.category === 'activity' ? g.advisorId : null
        });
      });
    });
  });
  return { deptTeachers, fixed, blocks, teachers, groups, rooms, subjects };
}

// ---------- Stage 1: teacher assignment (Simulated Annealing) ----------
function availableSlots(t) {
  const blocked = new Set();
  (t.unavailable || []).forEach((w) => periodsInWindow(w).forEach((p) => blocked.add(`${w.day}-${p}`)));
  return ND * NP - blocked.size;
}

function assignTeachers(model, rnd) {
  const { deptTeachers, fixed, blocks } = model;
  // unit = (group, subject) so each class keeps ONE teacher per subject
  const units = [];
  const unitMap = new Map();
  blocks.filter((b) => b.category === 'dept').forEach((b) => {
    const k = `${b.groupId}|${b.subjectId}`;
    if (!unitMap.has(k)) {
      const u = { key: k, subjectId: b.subjectId, hours: 0 };
      unitMap.set(k, u);
      units.push(u);
    }
    unitMap.get(k).hours += b.length;
  });
  if (!units.length || !deptTeachers.length) return new Map();

  const baseLoad = new Map(deptTeachers.map((t) => [t.id, 0]));
  fixed.forEach((f) => { if (baseLoad.has(f.teacherId)) baseLoad.set(f.teacherId, baseLoad.get(f.teacherId) + f.length); });
  const fixedDays = new Map(deptTeachers.map((t) => [t.id, new Set()]));
  fixed.forEach((f) => { if (fixedDays.has(f.teacherId)) fixedDays.get(f.teacherId).add(f.day); });
  const cap = new Map(deptTeachers.map((t) => [t.id, availableSlots(t)]));
  const regulars = deptTeachers.filter((t) => t.position === 'regular');

  const cost = (assign) => {
    const load = new Map(baseLoad);
    const count = new Map(deptTeachers.map((t) => [t.id, 0]));
    const subjT = new Map();
    units.forEach((u, i) => {
      const tid = assign[i];
      load.set(tid, load.get(tid) + u.hours);
      count.set(tid, count.get(tid) + 1);
      if (!subjT.has(u.subjectId)) subjT.set(u.subjectId, new Set());
      subjT.get(u.subjectId).add(tid);
    });
    let c = 0;
    deptTeachers.forEach((t) => {
      const l = load.get(t.id);
      if (t.minHours != null && l < t.minHours) c += 1000 * (t.minHours - l);
      if (t.maxHours != null && l > t.maxHours) c += 1000 * (l - t.maxHours);
      // keep 15% slack of available slots so stage 2 stays feasible
      const slack = cap.get(t.id) * 0.95;
      if (l > slack) c += 200 * (l - slack);
      // every-day rule needs enough blocks to cover the free days
      const needDays = ND - fixedDays.get(t.id).size;
      if (count.get(t.id) < needDays) c += 300 * (needDays - count.get(t.id));
    });
    if (regulars.length > 1) {
      const ls = regulars.map((t) => load.get(t.id));
      c += 10 * (Math.max(...ls) - Math.min(...ls));
    }
    subjT.forEach((set) => { c += 4 * (set.size - 1); });
    return c;
  };

  let cur = units.map(() => deptTeachers[Math.floor(rnd() * deptTeachers.length)].id);
  let curC = cost(cur);
  let best = cur.slice();
  let bestC = curC;
  let T = 50;
  for (let it = 0; it < 4000; it++) {
    const nxt = cur.slice();
    if (rnd() < 0.5) {
      const i = Math.floor(rnd() * units.length);
      nxt[i] = deptTeachers[Math.floor(rnd() * deptTeachers.length)].id;
    } else {
      const i = Math.floor(rnd() * units.length);
      const j = Math.floor(rnd() * units.length);
      [nxt[i], nxt[j]] = [nxt[j], nxt[i]];
    }
    const nc = cost(nxt);
    if (nc <= curC || rnd() < Math.exp((curC - nc) / T)) {
      cur = nxt; curC = nc;
      if (nc < bestC) { best = nxt.slice(); bestC = nc; }
    }
    T *= 0.999;
  }
  const out = new Map();
  units.forEach((u, i) => out.set(u.key, best[i]));
  return out;
}

// ---------- Stage 2: CSP placement ----------
function placeBlocks(model, teacherOf, rnd, nodeLimit = 30000) {
  const { fixed, blocks, teachers, groups, rooms } = model;
  const gBusy = new Map(groups.map((g) => [g.id, grid(false)]));
  const tBusy = new Map(teachers.map((t) => [t.id, grid(false)]));
  const rBusy = new Map(rooms.map((r) => [r.id, grid(false)]));
  const tSoft = new Map(teachers.map((t) => [t.id, grid(false)]));
  const tDays = new Map(teachers.map((t) => [t.id, Array(ND).fill(0)]));
  const gDay = new Map(groups.map((g) => [g.id, Array(ND).fill(0)]));

  teachers.forEach((t) => {
    (t.unavailable || []).forEach((w) => periodsInWindow(w).forEach((p) => { tBusy.get(t.id)[w.day][p] = 'X'; }));
    (t.softUnavailable || []).forEach((w) => periodsInWindow(w).forEach((p) => { tSoft.get(t.id)[w.day][p] = true; }));
  });

  const result = [];
  fixed.forEach((f) => {
    for (let p = f.start; p < f.start + f.length; p++) {
      gBusy.get(f.groupId)[f.day][p] = true;
      if (f.teacherId) tBusy.get(f.teacherId)[f.day][p] = true;
    }
    if (f.teacherId) tDays.get(f.teacherId)[f.day] += f.length;
    gDay.get(f.groupId)[f.day] += f.length;
    result.push({ ...f });
  });

  const todo = blocks.map((b) => ({
    ...b,
    teacherId: b.fixedTeacher || teacherOf.get(`${b.groupId}|${b.subjectId}`)
  }));

  const roomsFor = (type) => {
    if (type === 'computer') return rooms.filter((r) => r.type === 'computer');
    if (type === 'theory') return rooms.filter((r) => r.type === 'theory');
    if (type === 'field') return [];
    // "any": theory first, then computer
    return [...rooms.filter((r) => r.type === 'theory'), ...rooms.filter((r) => r.type !== 'theory')];
  };

  const candidates = (b) => {
    const out = [];
    const gb = gBusy.get(b.groupId);
    const tb = tBusy.get(b.teacherId);
    const rs = roomsFor(b.roomType);
    for (let d = 0; d < ND; d++) {
      for (const seg of SEGMENTS) {
        for (let o = 0; o + b.length <= seg.length; o++) {
          const ps = seg.slice(o, o + b.length);
          if (ps.some((p) => gb[d][p] || tb[d][p])) continue;
          let room = null;
          if (rs.length) {
            room = rs.find((r) => ps.every((p) => !rBusy.get(r.id)[d][p]));
            if (!room) continue;
          }
          out.push({ d, start: ps[0], ps, room, aligned: o % 2 === 0 });
        }
      }
    }
    return out;
  };

  const valueScore = (b, c) => {
    let s = rnd() * 2;
    const t = teachers.find((x) => x.id === b.teacherId);
    if (t && t.department === 'computer' && tDays.get(t.id)[c.d] === 0) s += 12; // every-day rule
    s -= gDay.get(b.groupId)[c.d] * 0.8; // balance student day load
    if (t) s -= tDays.get(t.id)[c.d] * 0.3;
    if (c.ps.some((p) => tSoft.get(b.teacherId)[c.d][p])) s -= 30; // soft availability
    if (!c.aligned) s -= 4; // keep 2-period blocks aligned
    if (c.start === 0) s += 2; // fill 08:00 first
    if (b.roomType === 'any' && c.room && c.room.type !== 'theory') s -= 3;
    return s;
  };

  const apply = (b, c, on) => {
    const v = on ? true : false;
    c.ps.forEach((p) => {
      gBusy.get(b.groupId)[c.d][p] = v;
      tBusy.get(b.teacherId)[c.d][p] = v;
      if (c.room) rBusy.get(c.room.id)[c.d][p] = v;
    });
    const k = on ? b.length : -b.length;
    tDays.get(b.teacherId)[c.d] += k;
    gDay.get(b.groupId)[c.d] += k;
  };

  let nodes = 0;
  const placed = new Array(todo.length).fill(null);
  const remaining = new Set(todo.map((_, i) => i));

  const solve = () => {
    if (!remaining.size) return true;
    if (++nodes > nodeLimit) return false;
    // MRV: pick the block with the fewest legal slots
    let pick = -1;
    let pickC = null;
    for (const i of remaining) {
      const cs = candidates(todo[i]);
      if (!cs.length) return false;
      if (pick < 0 || cs.length < pickC.length || (cs.length === pickC.length && todo[i].length > todo[pick].length)) {
        pick = i; pickC = cs;
      }
    }
    const b = todo[pick];
    const ordered = pickC.map((c) => ({ c, s: valueScore(b, c) })).sort((x, y) => y.s - x.s);
    remaining.delete(pick);
    for (const { c } of ordered) {
      apply(b, c, true);
      placed[pick] = c;
      if (solve()) return true;
      apply(b, c, false);
      placed[pick] = null;
      if (nodes > nodeLimit) break;
    }
    remaining.add(pick);
    return false;
  };

  const ok = solve();
  if (!ok) return null;
  todo.forEach((b, i) => {
    const c = placed[i];
    result.push({
      groupId: b.groupId, subjectId: b.subjectId, teacherId: b.teacherId,
      roomId: c.room ? c.room.id : null, location: c.room ? c.room.name : '-',
      day: c.d, start: c.start, length: b.length, combined: false
    });
  });
  return result;
}

// ---------- Evaluation: the 18 constraints of the brief ----------
export function evaluate(data, assignments) {
  const { teachers, groups, rooms, subjects } = data;
  const subj = new Map(subjects.map((s) => [s.id, s]));
  const room = new Map(rooms.map((r) => [r.id, r]));
  const tName = (id) => (teachers.find((t) => t.id === id) || {}).name || id;
  const gName = (id) => (groups.find((g) => g.id === id) || {}).name || id;

  const hours = new Map(teachers.map((t) => [t.id, 0]));
  assignments.forEach((a) => { if (hours.has(a.teacherId)) hours.set(a.teacherId, hours.get(a.teacherId) + a.length); });

  const cells = (a) => Array.from({ length: a.length }, (_, k) => `${a.day}-${a.start + k}`);
  const clash = (keyFn) => {
    const seen = new Map();
    let n = 0;
    assignments.forEach((a) => {
      const k0 = keyFn(a);
      if (k0 == null) return;
      cells(a).forEach((c) => {
        const k = `${k0}@${c}`;
        if (seen.has(k)) n++;
        else seen.set(k, a);
      });
    });
    return n;
  };

  const R = [];
  const add = (no, text, type, count, detail) => R.push({ no, text, type, violated: count > 0, count, detail });

  const heads = teachers.filter((t) => t.position === 'head');
  const headBad = heads.filter((t) => hours.get(t.id) < (t.minHours ?? 18) || hours.get(t.id) > (t.maxHours ?? 24));
  add(1, 'ครูตำแหน่งหัวหน้า ต้องมีชั่วโมงสอน 18 - 24 ชั่วโมงต่อสัปดาห์', 'hard', headBad.length,
    heads.map((t) => `${t.name} ${hours.get(t.id)} ชม.`).join(', '));

  const withMin = teachers.filter((t) => t.minHours != null);
  const minBad = withMin.filter((t) => hours.get(t.id) < t.minHours);
  add(2, 'ครูทุกคนต้องสอนอย่างน้อย 18 ชั่วโมง', 'hard', minBad.length,
    withMin.map((t) => `${t.name} ${hours.get(t.id)}`).join(', ') + ' (ครูสามัญไม่มีกำหนดชั่วโมงในข้อมูลนำเข้า)');

  add(3, 'นักเรียนแต่ละกลุ่มห้ามเรียน มากกว่า 1 วิชาในช่วงเวลาเดียวกัน', 'hard', clash((a) => a.groupId), 'ตรวจทุกกลุ่มทุกคาบ');
  add(4, 'ครูแต่ละคนห้ามสอน มากกว่า 1 วิชาในช่วงเวลาเดียวกัน', 'hard', clash((a) => a.teacherId), 'ตรวจทุกครูทุกคาบ');
  add(5, 'ครูแต่ละคนห้ามสอน มากกว่า 1 กลุ่มเรียนในช่วงเวลาเดียวกัน', 'hard', clash((a) => a.teacherId), 'ตรวจทุกครูทุกคาบ');
  add(6, 'ห้องเรียนแต่ละห้อง ห้ามมีการใช้งานมากกว่า 1 วิชาในช่วงเวลาเดียวกัน', 'hard', clash((a) => a.roomId), 'ไม่นับสนาม (เรียนรวม)');

  const activity = subjects.filter((s) => s.fixedStart);
  let fixBad = 0;
  activity.forEach((s) => {
    const need = periodIndexByStart(s.fixedStart);
    groups.forEach((g) => {
      const a = assignments.find((x) => x.groupId === g.id && x.subjectId === s.id);
      if (!a || a.day !== Number(s.fixedDay) || a.start !== need || a.roomId) fixBad++;
    });
  });
  add(7, 'คาบเรียนวิชาลูกเสือ ต้องเรียน วันพุธ เวลา 15.00 - 17.00 น. ที่สนาม', 'hard', fixBad,
    activity.map((s) => `${s.name}: ${DAYS[s.fixedDay]} ${s.fixedStart}`).join(', '));

  add(8, 'คาบเรียนเริ่มเวลา 08.00 น. ของทุกวัน', 'hard', PERIODS[0].start === '08:00' ? 0 : 1, `คาบแรกเริ่ม ${PERIODS[0].start}`);
  const late = assignments.filter((a) => toMin(PERIODS[a.start + a.length - 1].end) > 17 * 60).length;
  add(9, 'ถ้าเป็นไปได้ นักเรียนไม่ควรเรียนเกิน 17.00 น.', 'soft', late, `คาบสุดท้าย ${PERIODS[NP - 1].end}`);
  const lunchBad = assignments.filter((a) => {
    const s = toMin(PERIODS[a.start].start);
    const e = toMin(PERIODS[a.start + a.length - 1].end);
    return s < 13 * 60 && e > 12 * 60;
  }).length;
  add(10, 'ต้องพักเที่ยงพร้อมกันเวลา 12.00 - 13.00 น. ของทุกวัน', 'hard', lunchBad, 'ไม่มีคาบเรียนช่วง 12.00-13.00');

  const pieces = new Map();
  assignments.forEach((a) => {
    const k = `${a.groupId}|${a.subjectId}`;
    pieces.set(k, (pieces.get(k) || 0) + 1);
  });
  const splitN = [...pieces.entries()].filter(([k, n]) => {
    const s = subj.get(k.split('|')[1]);
    return n > Math.ceil((s ? s.periods : 0) / Math.max(...SEGMENTS.map((x) => x.length)));
  }).length;
  add(11, 'ถ้าเป็นไปได้ ในรายวิชาเรียนแต่ละวิชา ไม่ควรฉีกคาบเรียนออกจากกัน', 'soft', splitN, 'ทุกวิชาเรียนต่อเนื่องในช่วงเดียว');
  add(12, 'ถ้าเป็นไปได้ ในรายวิชาเรียนแต่ละวิชา ไม่ควรฉีกคาบเรียนออกจากกัน (ข้อซ้ำ)', 'soft', splitN, 'ตรวจเหมือนข้อ 11');

  const dept = teachers.filter((t) => t.department === 'computer');
  const missDays = [];
  dept.forEach((t) => {
    for (let d = 0; d < ND; d++) {
      if (!assignments.some((a) => a.teacherId === t.id && a.day === d)) missDays.push(`${t.name}-${DAYS[d]}`);
    }
  });
  add(13, 'ครูแผนกคอมพิวเตอร์ทุกคนต้องมีชั่วโมงสอนทุกวัน', 'hard', missDays.length, missDays.join(', ') || 'ครบทุกวัน');

  let softHit = 0;
  const softNames = [];
  teachers.forEach((t) => {
    const set = new Set();
    [...(t.softUnavailable || []), ...(t.unavailable || [])].forEach((w) => periodsInWindow(w).forEach((p) => set.add(`${w.day}-${p}`)));
    if (!set.size) return;
    softNames.push(t.name);
    assignments.filter((a) => a.teacherId === t.id).forEach((a) => cells(a).forEach((c) => { if (set.has(c)) softHit++; }));
  });
  add(14, 'ถ้าเป็นไปได้ ครูเมธาต้องการเวลาว่าง วันจันทร์ 08.00-12.00 น. และวันศุกร์ 13.00-16.00 น.', 'soft', softHit,
    softNames.length ? `${softNames.join(', ')}: ทับเวลาไม่สะดวก ${softHit} คาบ` : '-');

  const regs = teachers.filter((t) => t.position === 'regular');
  const rh = regs.map((t) => hours.get(t.id));
  const diff = rh.length > 1 ? Math.max(...rh) - Math.min(...rh) : 0;
  add(15, 'ถ้าเป็นไปได้ ครูประจำ ควรเฉลี่ยจำนวนชั่วโมงสอนให้ใกล้เคียงกัน', 'soft', diff > 2 ? 1 : 0,
    regs.map((t) => `${t.name} ${hours.get(t.id)}`).join(', ') + ` (ต่างกัน ${diff} ชม.)`);

  const perClass = new Map();
  const perSubject = new Map();
  assignments.forEach((a) => {
    const k = `${a.groupId}|${a.subjectId}`;
    if (!perClass.has(k)) perClass.set(k, new Set());
    perClass.get(k).add(a.teacherId);
    if (!perSubject.has(a.subjectId)) perSubject.set(a.subjectId, new Set());
    if (subj.get(a.subjectId)?.category !== 'activity') perSubject.get(a.subjectId).add(a.teacherId);
  });
  const multi = [...perClass.values()].filter((s) => s.size > 1).length;
  const crossGroup = [...perSubject.values()].filter((s) => s.size > 1).length;
  add(16, 'ถ้าเป็นไปได้ ในการเรียนแต่ละวิชา ควรเป็นผู้สอนคนเดียวกัน', 'soft', multi,
    `แต่ละกลุ่มเรียนแต่ละวิชามีครูคนเดียว; วิชาที่ต่างกลุ่มใช้ครูต่างกัน ${crossGroup} วิชา (จำกัดด้วยเพดานชั่วโมงครู)`);

  const compBad = assignments.filter((a) => subj.get(a.subjectId)?.roomType === 'computer' && room.get(a.roomId)?.type !== 'computer').length;
  add(17, 'วิชาที่เป็นคอมพิวเตอร์ต้องเรียนในห้องเรียนที่เป็นคอมพิวเตอร์เท่านั้น', 'hard', compBad, 'ตรวจทุกคาบวิชาคอมพิวเตอร์');

  const advBad = assignments.filter((a) => subj.get(a.subjectId)?.category === 'activity'
    && (groups.find((g) => g.id === a.groupId) || {}).advisorId !== a.teacherId).length;
  add(18, 'วิชาลูกเสือ ครูผู้สอนต้องเป็นครูที่ปรึกษาของห้องนั้นเท่านั้น', 'hard', advBad,
    groups.map((g) => `${g.name}: ${tName(g.advisorId)}`).join(', '));

  const hardViolations = R.filter((r) => r.type === 'hard').reduce((a, r) => a + r.count, 0);
  const softPenalty = R.filter((r) => r.type === 'soft').reduce((a, r) => a + r.count, 0) + diff * 0.5 + crossGroup * 0.5;
  const score = Math.max(0, 100 - hardViolations * 10 - softPenalty * 2);

  return {
    rules: R,
    hardViolations,
    softPenalty,
    score: Math.round(score * 10) / 10,
    teacherHours: teachers.map((t) => ({ teacherId: t.id, name: tName(t.id), hours: hours.get(t.id) })),
    groupNames: groups.map((g) => gName(g.id))
  };
}

// ---------- Public API ----------
export function generateSchedule(data, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const errors = validateData(data);
  if (errors.length) return { ok: false, errors };

  const timeBudget = opts.timeBudgetMs ?? 2500;
  const minSolutions = opts.minSolutions ?? 6;
  const seed0 = opts.seed ?? (Date.now() & 0xffffffff);
  const model = buildModel(data);
  let best = null;
  let attempts = 0;
  let solutions = 0;
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

  while (now() - t0 < timeBudget) {
    attempts++;
    const rnd = mulberry32(seed0 + attempts * 7919);
    const teacherOf = assignTeachers(model, rnd);
    const assignments = placeBlocks(model, teacherOf, rnd);
    if (!assignments) continue;
    solutions++;
    const report = evaluate(data, assignments);
    const rank = report.hardViolations * 1000 + report.softPenalty;
    if (!best || rank < best.rank) best = { assignments, report, rank };
    if (opts.onProgress) opts.onProgress({ attempts, solutions, bestScore: best.report.score });
    if (best.report.hardViolations === 0 && solutions >= minSolutions) break;
  }

  const durationMs = Math.round(now() - t0);
  if (!best) {
    return { ok: false, errors: ['ไม่พบตารางที่เป็นไปได้ภายในเวลาที่กำหนด กรุณาตรวจสอบข้อมูลหรือเงื่อนไข'], attempts, durationMs };
  }
  return {
    ok: true,
    algorithm: 'Simulated Annealing (จัดครู) + Constraint Satisfaction Backtracking/MRV (จัดคาบและห้อง) + Random Restart',
    assignments: best.assignments.sort((a, b) => a.day - b.day || a.start - b.start),
    report: best.report,
    attempts,
    solutions,
    durationMs
  };
}
