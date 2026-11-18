// Runs the scheduler off the UI thread so the page never freezes during processing
import { generateSchedule } from './scheduler.js';

self.onmessage = (e) => {
  const { data, options } = e.data;
  try {
    const result = generateSchedule(data, {
      ...options,
      onProgress: (p) => self.postMessage({ type: 'progress', ...p })
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'done', result: { ok: false, errors: [err.message || String(err)] } });
  }
};
