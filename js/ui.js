// Shared UI helpers: escaping, toast, modal, confirm, busy buttons, auth guard
import { getStore, IS_DEMO } from './store.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, type = 'info') {
  let host = $('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

// Opens a modal. Returns { root, body, close }. onSubmit(form) may return false to keep it open.
export function openModal({ title, body, submitText, onSubmit, wide = false, cancelText = 'ยกเลิก' }) {
  const prevFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <form novalidate>
        <div class="modal-head">
          <h2 id="modal-title">${esc(title)}</h2>
          <button type="button" class="btn btn-ghost btn-sm" data-close aria-label="ปิด">ปิด</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>${esc(onSubmit ? cancelText : 'ปิด')}</button>
          ${onSubmit ? `<button type="submit" class="btn btn-primary">${esc(submitText || 'บันทึก')}</button>` : ''}
        </div>
      </form>
    </div>`;
  const bodyEl = $('.modal-body', backdrop);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const close = () => {
    backdrop.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', close));

  const form = $('form', backdrop);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = $('button[type=submit]', form);
    const restore = busy(btn, 'กำลังบันทึก...');
    try {
      const keep = await onSubmit(form);
      if (keep !== false) close();
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      restore();
    }
  });
  setTimeout(() => { const f = $('input, select, textarea', bodyEl) || $('[data-close]', backdrop); if (f) f.focus(); }, 30);
  return { root: backdrop, body: bodyEl, form, close };
}

export function confirmDialog({ title, message, confirmText = 'ยืนยัน', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      body: `<p>${esc(message)}</p>`,
      submitText: confirmText,
      onSubmit: () => { done = true; resolve(true); }
    });
    if (danger) $('button[type=submit]', m.root).className = 'btn btn-danger';
    const obs = new MutationObserver(() => { if (!document.body.contains(m.root)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export function busy(btn, text = 'กำลังดำเนินการ...') {
  if (!btn) return () => {};
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(text)}`;
  return () => { btn.disabled = false; btn.innerHTML = html; };
}

export function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

export function demoBanner() {
  if (!IS_DEMO) return;
  const b = document.createElement('div');
  b.className = 'demo-banner';
  b.textContent = 'โหมดทดลอง (Demo): ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ใส่ค่า Supabase ใน js/config.js เพื่อใช้งานจริง';
  document.body.prepend(b);
}

// Redirect to login (or the right home) if the role doesn't match. Returns session.
export async function guard(role) {
  const store = await getStore();
  const s = await store.getSession();
  if (!s) { location.replace('index.html'); return null; }
  if (role && s.role !== role) { location.replace(s.role === 'teacher' ? 'teacher.html' : 'student.html'); return null; }
  return s;
}

export function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}
export const fmtSec = (ms) => (ms / 1000).toFixed(3);
