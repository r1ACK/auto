import { getStore, isValidUsername } from './store.js';
import { $, $$, busy, esc, demoBanner } from './ui.js';
import { initGuide } from './guide.js';

demoBanner();
initGuide('start');

let role = 'student';
const errBox = $('#reg-error');
const showError = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); };

$$('[data-role]').forEach((btn) => btn.addEventListener('click', () => {
  role = btn.dataset.role;
  $$('[data-role]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  $('#group-field').classList.toggle('hidden', role !== 'student');
  $('#invite-field').classList.toggle('hidden', role !== 'teacher');
  $('#username-label').textContent = role === 'student' ? 'รหัสนักศึกษา' : 'ชื่อผู้ใช้';
}));

(async () => {
  const sel = $('#group');
  try {
    const store = await getStore();
    const groups = await store.listGroupsPublic();
    sel.innerHTML = groups.length
      ? '<option value="">เลือกกลุ่มเรียน</option>' + groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')
      : '<option value="">ยังไม่มีกลุ่มเรียน ให้ครูเพิ่มก่อน</option>';
  } catch (e) {
    sel.innerHTML = '<option value="">โหลดกลุ่มเรียนไม่สำเร็จ</option>';
    showError(`โหลดกลุ่มเรียนไม่สำเร็จ: ${e.message} ลองโหลดหน้าใหม่`);
  }
})();

$('#reg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.classList.add('hidden');
  const username = $('#username').value.trim().toLowerCase();
  const fullName = $('#fullname').value.trim();
  const groupId = $('#group').value;
  const inviteCode = $('#invite').value.trim();
  const pw = $('#password').value;
  const pw2 = $('#password2').value;

  if (!isValidUsername(username)) return showError('ชื่อผู้ใช้ไม่ถูกต้อง: ใช้ a-z, 0-9, จุด, ขีด ยาว 3-30 ตัวอักษร');
  if (!fullName) return showError('กรุณากรอกชื่อ-นามสกุล');
  if (role === 'student' && !groupId) return showError('กรุณาเลือกกลุ่มเรียน');
  if (role === 'teacher' && !inviteCode) return showError('กรุณากรอกรหัสเชิญครู');
  if (pw.length < 6) return showError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  if (pw !== pw2) return showError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');

  const restore = busy($('button[type=submit]', e.target), 'กำลังสร้างบัญชี...');
  try {
    const store = await getStore();
    const s = await store.signUp({ username, password: pw, fullName, groupId: role === 'student' ? groupId : null, inviteCode: role === 'teacher' ? inviteCode : '' });
    if (role === 'teacher' && s.role !== 'teacher') {
      sessionStorage.setItem('tt_notice', 'รหัสเชิญครูไม่ถูกต้อง บัญชีนี้จึงเป็นบัญชีนักศึกษา ให้ครูผู้ดูแลเปลี่ยนสิทธิ์ที่เมนู "ผู้ใช้งาน"');
    }
    location.replace(s.role === 'teacher' ? 'teacher.html' : 'student.html');
  } catch (err) {
    showError(err.message);
    restore();
  }
});
