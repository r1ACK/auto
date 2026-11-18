// User guide: opened by any [data-guide] button on every page
import { openModal, $, $$ } from './ui.js';

const SECTIONS = {
  start: {
    label: 'เริ่มต้นใช้งาน',
    html: `
      <div class="guide-section"><h3>ระบบนี้ทำอะไร</h3>
        <p>ระบบจัดตารางสอนอัตโนมัติ สร้างตารางสอนครู ตารางเรียนนักศึกษา และตารางการใช้ห้องเรียน ให้ตรงเงื่อนไขทั้ง 18 ข้อของโจทย์ แล้ว Export เป็น PDF ได้ทันที</p></div>
      <div class="guide-section"><h3>เข้าสู่ระบบ</h3>
        <ol>
          <li>กรอกชื่อผู้ใช้ (นักศึกษาใช้รหัสนักศึกษา) และรหัสผ่าน แล้วกด "เข้าสู่ระบบ"</li>
          <li>ยังไม่มีบัญชี กด "สมัครสมาชิก" เลือกประเภท นักศึกษา หรือ ครู</li>
          <li>นักศึกษาต้องเลือกกลุ่มเรียนของตนเอง ส่วนครูต้องกรอก "รหัสเชิญครู" ที่ได้รับจากผู้ดูแลระบบ</li>
        </ol></div>
      <div class="guide-section"><h3>สิทธิ์การใช้งาน</h3>
        <ul>
          <li><strong>ครู</strong>: จัดการข้อมูล ประมวลผลจัดตาราง ดูทุกตาราง Export PDF และจัดการผู้ใช้</li>
          <li><strong>นักศึกษา</strong>: ดูตารางเรียนของกลุ่มตนเอง และพิมพ์ / บันทึกเป็น PDF</li>
        </ul></div>`
  },
  teacher: {
    label: 'สำหรับครู',
    html: `
      <div class="guide-section"><h3>1. ตรวจสอบข้อมูลนำเข้า</h3>
        <ol>
          <li>เมนู "ข้อมูลครู / กลุ่มเรียน / ห้องเรียน / รายวิชา" มีข้อมูลตามโจทย์ใส่ไว้แล้ว</li>
          <li>กด "เพิ่ม" หรือ "แก้ไข" เพื่อปรับข้อมูล เช่น เวลาไม่สะดวกของครู จำนวนคาบ ประเภทห้อง</li>
          <li>เมนู "นำเข้า / ส่งออก" ใช้นำเข้าไฟล์ JSON หรือ CSV ที่เจ้าภาพกำหนด ดาวน์โหลดแม่แบบ CSV ได้จากหน้านั้น</li>
        </ol></div>
      <div class="guide-section"><h3>2. ประมวลผลจัดตาราง (ต่อหน้ากรรมการ)</h3>
        <ol>
          <li>เปิดเมนู "จัดตารางสอน" รอให้กรรมการพร้อมจับเวลา</li>
          <li>กด "เริ่มประมวลผลจัดตาราง" ครั้งเดียว ระบบแสดงเวลาที่ใช้แบบวินาทีบนหน้าจอ</li>
          <li>ดูผล "ตรวจเงื่อนไข 18 ข้อ" ว่าผ่านทุกข้อหรือไม่</li>
        </ol></div>
      <div class="guide-section"><h3>3. ดูตารางและ Export PDF</h3>
        <ol>
          <li>กด "Export PDF ทั้งหมด (13 ตาราง)" ระบบเปิดหน้าพิมพ์ 1 ตารางต่อ 1 หน้า</li>
          <li>กด "พิมพ์ / บันทึก PDF" แล้วเลือกปลายทาง "Save as PDF" (แนวนอน A4)</li>
          <li>ทุกหน้ามีช่องลงลายมือชื่อกำกับตามข้อกำหนดการแข่งขัน</li>
          <li>เมนู "ดูตาราง" ใช้ดูทีละตาราง เลือก ครู / กลุ่มเรียน / ห้องเรียน</li>
        </ol></div>
      <div class="guide-section"><h3>4. จัดการผู้ใช้</h3>
        <p>เมนู "ผู้ใช้งาน" เปลี่ยนกลุ่มเรียนของนักศึกษา หรือเปลี่ยนสิทธิ์เป็นครูได้</p></div>`
  },
  student: {
    label: 'สำหรับนักศึกษา',
    html: `
      <div class="guide-section"><h3>ดูตารางเรียน</h3>
        <ol>
          <li>เข้าสู่ระบบด้วยรหัสนักศึกษา ระบบแสดงตารางเรียนของกลุ่มเรียนคุณทันที</li>
          <li>ในแต่ละช่องบอก วิชา ครูผู้สอน และห้องเรียน</li>
          <li>กด "พิมพ์ / บันทึก PDF" เพื่อเก็บตารางไว้ในเครื่อง</li>
        </ol></div>
      <div class="guide-section"><h3>ยังไม่เห็นตาราง</h3>
        <ul>
          <li>ครูยังไม่ได้ประมวลผลจัดตาราง ให้รอครูประกาศ</li>
          <li>บัญชียังไม่ได้ระบุกลุ่มเรียน ให้แจ้งครูแก้ไขที่เมนู "ผู้ใช้งาน"</li>
        </ul></div>`
  },
  algo: {
    label: 'หลักการจัดตาราง',
    html: `
      <div class="guide-section"><h3>อัลกอริทึมที่ใช้</h3>
        <ol>
          <li><strong>Simulated Annealing</strong> เลือกครูให้แต่ละวิชาของแต่ละกลุ่ม ให้ชั่วโมงสอนอยู่ในช่วงที่กำหนด เฉลี่ยครูประจำให้ใกล้กัน และให้วิชาเดียวกันใช้ครูคนเดียวกันมากที่สุด</li>
          <li><strong>Constraint Satisfaction (Backtracking + MRV)</strong> วางวิชาลงคาบและห้อง ห้ามชนทั้งกลุ่มเรียน ครู และห้อง ไม่คร่อมพักเที่ยง และวิชาคอมพิวเตอร์ต้องอยู่ห้องคอมพิวเตอร์</li>
          <li><strong>Random Restart</strong> ทำซ้ำหลายรอบภายในไม่กี่วินาที แล้วเลือกคำตอบที่ได้คะแนนดีที่สุด</li>
        </ol></div>
      <div class="guide-section"><h3>เงื่อนไขบังคับ / เงื่อนไขพึงประสงค์</h3>
        <p>เงื่อนไขบังคับ (เช่น ห้ามชน ลูกเสือวันพุธ 15.00-17.00) ต้องผ่าน 100% ส่วนเงื่อนไข "ถ้าเป็นไปได้" ระบบพยายามให้ได้มากที่สุดและรายงานจำนวนครั้งที่ละเมิด</p></div>`
  }
};

export function initGuide(defaultTab = 'start') {
  $$('[data-guide]').forEach((btn) => btn.addEventListener('click', () => openGuide(btn.dataset.guide || defaultTab)));
}

export function openGuide(tab = 'start') {
  const keys = Object.keys(SECTIONS);
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="seg-inline guide-tabs" role="tablist">
      ${keys.map((k) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${SECTIONS[k].label}</button>`).join('')}
    </div>
    <div class="guide-content"></div>`;
  const content = $('.guide-content', body);
  const show = (k) => {
    content.innerHTML = SECTIONS[k].html;
    $$('[data-tab]', body).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
  };
  $$('[data-tab]', body).forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  show(SECTIONS[tab] ? tab : 'start');
  openModal({ title: 'คู่มือการใช้งาน', body, wide: true });
}
