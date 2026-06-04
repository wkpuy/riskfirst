// ui.js — Toast notifications, confirmation dialog, and modal animation helpers

// ─── Toast ────────────────────────────────────────────────────────────────────

const TOAST_STYLES = {
  success: { bg: 'bg-green-100 text-green-800 border-green-200', icon: '✅' },
  error:   { bg: 'bg-red-100 text-red-800 border-red-200',       icon: '❌' },
  warning: { bg: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: '⚠️' },
  info:    { bg: 'bg-gray-800 text-white border-gray-700',        icon: 'ℹ️' },
};

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const { bg, icon } = TOAST_STYLES[type] ?? TOAST_STYLES.info;
  const toast = document.createElement('div');
  toast.className = `px-4 py-3 rounded-xl shadow-lg transform transition-all duration-300
    translate-y-[-100%] opacity-0 flex items-center gap-2 max-w-sm w-max border ${bg}`;
  toast.innerHTML = `<span>${icon}</span><span class="text-sm font-bold">${message}</span>`;
  container.appendChild(toast);

  // Slide in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-[-100%]', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });

  // Slide out after 3 s
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-[-100%]', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── iOS-safe Confirm dialog ──────────────────────────────────────────────────
// window.confirm is blocked in iOS PWA standalone mode.

export function showConfirm(message, onConfirm, onCancel) {
  document.getElementById('riskfirst-confirm')?.remove();

  const el = document.createElement('div');
  el.id = 'riskfirst-confirm';
  el.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] flex items-end justify-center';
  el.innerHTML = `
    <div class="bg-[var(--card-dark)] w-full rounded-t-3xl border-t border-[var(--border-dark)] p-5 pb-8">
      <p class="text-sm font-bold text-center mb-4">${message}</p>
      <div class="flex gap-3">
        <button id="confirm-cancel" class="flex-1 py-3 rounded-xl border border-white/10 text-gray-400 font-bold text-sm">ยกเลิก</button>
        <button id="confirm-ok"     class="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold text-sm">ยืนยัน</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  const close = () => el.remove();
  el.querySelector('#confirm-ok').onclick     = () => { close(); onConfirm?.(); };
  el.querySelector('#confirm-cancel').onclick = () => { close(); onCancel?.(); };
  el.onclick = e => { if (e.target === el) close(); };
}

// ─── Modal animation helpers ──────────────────────────────────────────────────
// Two patterns:
//   'slide-up'  — sheet slides up from bottom   (transform: translateY)
//   'scale'     — dialog scales up from center   (transform: scale)

export function openModal(modalId, sheetId, pattern = 'slide-up') {
  const modal = document.getElementById(modalId);
  const sheet = document.getElementById(sheetId);
  if (!modal || !sheet) return;

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    if (pattern === 'scale')    sheet.classList.remove('scale-95');
    if (pattern === 'slide-up') sheet.classList.remove('translate-y-full');
  }, 10);
}

export function closeModal(modalId, sheetId, pattern = 'slide-up') {
  const modal = document.getElementById(modalId);
  const sheet = document.getElementById(sheetId);
  if (!modal || !sheet) return;

  modal.classList.add('opacity-0');
  if (pattern === 'scale')    sheet.classList.add('scale-95');
  if (pattern === 'slide-up') sheet.classList.add('translate-y-full');
  setTimeout(() => modal.classList.add('hidden'), 300);
}
