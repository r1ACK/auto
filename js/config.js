// ===== App configuration =====
// 1) Put your Supabase project URL + anon (public) key here.
//    Leave both empty to run in "Demo mode" (data stored in this browser only).
export const SUPABASE_URL = 'https://weeneebypupstplwkytb.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlZW5lZWJ5cHVwc3RwbHdreXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5ODc4MDIsImV4cCI6MjExMDU2MzgwMn0.5e-PcB49-Ma-mcixQK7u5vhsxUj16Biyg5dM5aiWCio';

// 2) Username login is mapped to a hidden email: <username>@<AUTH_EMAIL_DOMAIN>
//    Must look like a real domain. Change it if Supabase rejects the address.
export const AUTH_EMAIL_DOMAIN = 'timetable-app.com';

export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

// ===== Time grid (from the competition brief) =====
export const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];

// Periods 1-4 morning, lunch 12:00-13:00 (no period), periods 5-8 afternoon
export const PERIODS = [
  { no: 1, start: '08:00', end: '09:00' },
  { no: 2, start: '09:00', end: '10:00' },
  { no: 3, start: '10:00', end: '11:00' },
  { no: 4, start: '11:00', end: '12:00' },
  { no: 5, start: '13:00', end: '14:00' },
  { no: 6, start: '14:00', end: '15:00' },
  { no: 7, start: '15:00', end: '16:00' },
  { no: 8, start: '16:00', end: '17:00' }
];

// Continuous teaching segments (period indexes). A subject block never crosses lunch.
export const SEGMENTS = [[0, 1, 2, 3], [4, 5, 6, 7]];
export const LUNCH = { start: '12:00', end: '13:00', afterIndex: 3 };

export const ROOM_TYPES = { computer: 'ห้องคอมพิวเตอร์', theory: 'ห้องทฤษฎี' };
export const SUBJECT_ROOM_TYPES = { computer: 'ห้องคอมพิวเตอร์', theory: 'ห้องทฤษฎี', any: 'ห้องใดก็ได้ (ทฤษฎีก่อน)', field: 'สนาม / นอกห้อง' };
export const SUBJECT_CATEGORIES = { dept: 'วิชาชีพ (ครูแผนก)', general: 'สามัญ (ครูสามัญ)', activity: 'กิจกรรม (ครูที่ปรึกษา)' };
export const POSITIONS = { head: 'หัวหน้าแผนก', regular: 'ครูประจำ', general: 'ครูสามัญ' };
export const DEPARTMENTS = { computer: 'แผนกคอมพิวเตอร์', general: 'แผนกสามัญ' };
