// ui.js — Toast notifications, confirmation dialog, and modal animation helpers

export function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

// ─── Modals ───────────────────────────────────────────────────────────────────

export function openModal(modalId, sheetId) {
  const m = document.getElementById(modalId);
  const s = document.getElementById(sheetId);
  if (!m || !s) return;
  m.classList.remove('hidden');
  m.classList.add('flex');
  setTimeout(() => {
    m.classList.remove('opacity-0');
    s.classList.remove('translate-y-full');
  }, 10);
}

export function closeModal(modalId, sheetId) {
  const m = document.getElementById(modalId);
  const s = document.getElementById(sheetId);
  if (!m || !s) return;
  m.classList.add('opacity-0');
  s.classList.add('translate-y-full');
  setTimeout(() => {
    m.classList.add('hidden');
    m.classList.remove('flex');
  }, 300);
}

export function openNewsModal() {
  const container = document.getElementById('news-list-container');
  if (!container) return;
  
  const news = window.currentStockNews || [];
  if (news.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-500 py-8">ไม่พบข่าวล่าสุดใน 3 วันที่ผ่านมา</div>';
  } else {
    container.innerHTML = news.map(n => {
      const date = new Date(n.datetime * 1000).toLocaleString('th-TH', { 
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
      });
      const safeHeadline = escapeHtml(n.headline);
      const safeUrl = escapeHtml(n.url);
      const copyText = escapeHtml(`ช่วยวิเคราะห์ข่าวนี้ให้หน่อยว่ามีผลบวกหรือลบต่อราคาหุ้น:\n"${n.headline}"`);
      
      return `
      <div class="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-2 relative group">
        <div class="text-[10px] text-gray-400">${date} — <span class="text-blue-400">${escapeHtml(n.source)}</span></div>
        <a href="${safeUrl}" target="_blank" class="text-sm font-bold text-white hover:text-blue-300 transition-colors leading-snug block pr-8">
          ${safeHeadline}
        </a>
        <button onclick="copyNewsHeadline('${copyText}')" class="absolute top-3 right-3 w-7 h-7 bg-white/10 hover:bg-purple-500 rounded-lg flex items-center justify-center transition-colors text-white opacity-60 hover:opacity-100" title="Copy to ask AI">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>`;
    }).join('');
  }
  openModal('news-modal', 'news-sheet');
}

export function closeNewsModal() {
  closeModal('news-modal', 'news-sheet');
}

export function copyNewsHeadline(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('คัดลอกพาดหัวข่าวแล้ว! วางใน ChatGPT ได้เลย', 'success');
  }).catch(() => {
    showToast('คัดลอกไม่สำเร็จ', 'error');
  });
}
