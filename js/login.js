import { getStore, IS_DEMO, isValidUsername } from './store.js';
import { $, busy, demoBanner } from './ui.js';
import { initGuide } from './guide.js';

demoBanner();
initGuide('start');
if (IS_DEMO) $('#demo-accounts').classList.remove('hidden');

const home = (role) => (role === 'teacher' ? 'teacher.html' : 'student.html');
const errBox = $('#login-error');
const showError = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); };

(async () => {
  try {
    const store = await getStore();
    const s = await store.getSession();
    if (s) location.replace(home(s.role));
  } catch (e) {
    showError(`เชื่อมต่อระบบไม่สำเร็จ: ${e.message} ลองโหลดหน้าใหม่อีกครั้ง`);
  }
})();

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.classList.add('hidden');
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (!username || !password) return showError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  if (!isValidUsername(username)) return showError('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด และยาว 3-30 ตัวอักษร');
  const restore = busy(e.submitter || $('button[type=submit]', e.target), 'กำลังเข้าสู่ระบบ...');
  try {
    const store = await getStore();
    const s = await store.signIn(username, password);
    if (!s) throw new Error('ไม่พบโปรไฟล์ผู้ใช้ กรุณาติดต่อครูผู้ดูแล');
    location.replace(home(s.role));
  } catch (err) {
    showError(err.message);
    restore();
  }
});
