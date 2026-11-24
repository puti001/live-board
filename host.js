(() => {
  const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
  const COLOR_MAP = {
    yellow: { bg: '#fef08a', top: '#fef9c3', tape: 'rgba(234, 179, 8, 0.45)' },
    pink: { bg: '#fbcfe8', top: '#fce7f3', tape: 'rgba(236, 72, 153, 0.36)' },
    blue: { bg: '#bae6fd', top: '#e0f2fe', tape: 'rgba(14, 165, 233, 0.36)' },
    green: { bg: '#bbf7d0', top: '#dcfce7', tape: 'rgba(34, 197, 94, 0.36)' },
    purple: { bg: '#e9d5ff', top: '#f3e8ff', tape: 'rgba(168, 85, 247, 0.36)' },
    orange: { bg: '#fed7aa', top: '#ffedd5', tape: 'rgba(249, 115, 22, 0.4)' },
  };

  function makeRoomId() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  const params = new URLSearchParams(window.location.search);
  let roomId = (params.get('room') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!roomId) {
    roomId = makeRoomId();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('room', roomId);
    window.history.replaceState(null, '', nextUrl.toString());
  }

  function getJoinUrl() {
    const u = new URL('./join.html', window.location.href);
    u.searchParams.set('room', roomId);
    return u.toString();
  }

  let joinUrl = getJoinUrl();
  let notes = [];
  try {
    const cached = localStorage.getItem(`liveboard-pages-notes-${roomId}`);
    if (cached) notes = JSON.parse(cached) || [];
  } catch {
    notes = [];
  }

  const onlineStudents = new Set();
  let roomQrSvg = '';
  let clearConfirmTimer = null;
  let clearArmed = false;
  let mqttClient = null;

  // DOM Elements
  const qrMiniBtn = document.getElementById('qrMiniBtn');
  const qrMiniBox = document.getElementById('qrMiniBox');
  const emptyZoomQrBtn = document.getElementById('emptyZoomQrBtn');
  const connLabelEl = document.getElementById('connLabel');
  const studentCountEl = document.getElementById('studentCount');
  const noteCountEl = document.getElementById('noteCount');
  const roomBadgeEl = document.getElementById('roomBadge');
  const topicInput = document.getElementById('topicInput');
  const copyJoinUrlBtn = document.getElementById('copyJoinUrlBtn');
  const toggleBroadcastBtn = document.getElementById('toggleBroadcastBtn');
  const broadcastDrawer = document.getElementById('broadcastDrawer');
  const broadcastInput = document.getElementById('broadcastInput');
  const sendBroadcastBtn = document.getElementById('sendBroadcastBtn');
  const textQrZoomBtn = document.getElementById('textQrZoomBtn');
  const clearBroadcastBtn = document.getElementById('clearBroadcastBtn');
  const broadcastStatusText = document.getElementById('broadcastStatusText');
  const activePushPill = document.getElementById('activePushPill');
  const activePushPreview = document.getElementById('activePushPreview');
  const editPushBtn = document.getElementById('editPushBtn');
  const downloadPngBtn = document.getElementById('downloadPngBtn');
  const copyTextBtn = document.getElementById('copyTextBtn');
  const downloadTxtBtn = document.getElementById('downloadTxtBtn');
  const clearNotesBtn = document.getElementById('clearNotesBtn');
  const newRoomBtn = document.getElementById('newRoomBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const emptyState = document.getElementById('emptyState');
  const notesGrid = document.getElementById('notesGrid');

  const qrModal = document.getElementById('qrModal');
  const qrModalClose = document.getElementById('qrModalClose');
  const qrModalBadge = document.getElementById('qrModalBadge');
  const qrModalTitle = document.getElementById('qrModalTitle');
  const qrModalSvgWrap = document.getElementById('qrModalSvgWrap');
  const qrModalUrl = document.getElementById('qrModalUrl');

  const noteSpotlight = document.getElementById('noteSpotlight');
  const spotlightCard = document.getElementById('spotlightCard');
  const spotlightText = document.getElementById('spotlightText');
  const spotlightAuthor = document.getElementById('spotlightAuthor');
  const spotlightTime = document.getElementById('spotlightTime');

  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  roomBadgeEl.textContent = roomId;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2400);
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function saveNotesLocal() {
    try {
      localStorage.setItem(`liveboard-pages-notes-${roomId}`, JSON.stringify(notes));
    } catch {
      // Ignore storage quota errors
    }
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  // Theme initialization
  const savedTheme = localStorage.getItem('liveboard-theme') || 'light';
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('liveboard-theme', next);
    showToast(next === 'dark' ? '已切換為深色投影模式' : '已切換為亮色紙張模式');
  });

  // Generate SVG QR Code locally in browser (zero external API)
  async function makeQrSvg(text) {
    return window.QRCodeLib.toString(text, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#14171A', light: '#FFFFFF' },
    });
  }

  async function refreshRoomQr() {
    joinUrl = getJoinUrl();
    roomBadgeEl.textContent = roomId;
    try {
      roomQrSvg = await makeQrSvg(joinUrl);
      qrMiniBox.innerHTML = roomQrSvg;
    } catch {
      qrMiniBox.textContent = 'QR';
    }
  }

  // Fullscreen QR Modal Controls
  function enterQrFullscreen() {
    qrModal.classList.add('open');
    try {
      if (!document.fullscreenElement && qrModal.requestFullscreen) {
        qrModal.requestFullscreen().catch(() => {});
      }
    } catch {}
  }

  async function openRoomQrModal() {
    if (!roomQrSvg) await refreshRoomQr();
    qrModalBadge.textContent = '雙向互動房間';
    qrModalTitle.textContent = '請用手機掃描加入互動';
    qrModalSvgWrap.innerHTML = roomQrSvg;
    qrModalUrl.textContent = joinUrl;
    enterQrFullscreen();
  }

  async function openCustomTextQrModal(text) {
    try {
      const svg = await makeQrSvg(text);
      qrModalBadge.textContent = '純文字 / 網址 QR Code';
      qrModalTitle.textContent = '手機相機掃描即可讀取內容';
      qrModalSvgWrap.innerHTML = svg;
      qrModalUrl.textContent = text.length > 180 ? `${text.slice(0, 180)}…` : text;
      enterQrFullscreen();
    } catch {
      showToast('內容過長或無法產生 QR Code');
    }
  }

  function closeQrModal() {
    qrModal.classList.remove('open');
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch {}
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && qrModal.classList.contains('open')) {
      qrModal.classList.remove('open');
    }
  });

  qrMiniBtn.addEventListener('click', openRoomQrModal);
  emptyZoomQrBtn.addEventListener('click', openRoomQrModal);
  qrModalClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeQrModal();
  });
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModalUrl) return;
    closeQrModal();
  });

  // Single Note Spotlight
  function openSpotlight(note) {
    spotlightCard.className = `note-spotlight-card color-${note.color || 'yellow'}`;
    spotlightText.textContent = note.text;
    spotlightAuthor.textContent = `— ${note.author || '現場學員'}`;
    spotlightTime.textContent = formatTime(note.createdAt);
    noteSpotlight.classList.add('open');
  }
  noteSpotlight.addEventListener('click', () => noteSpotlight.classList.remove('open'));

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
    if (e.key === 'Escape') {
      closeQrModal();
      noteSpotlight.classList.remove('open');
      return;
    }
    if (!isTyping && (e.key === 'q' || e.key === 'Q')) {
      e.preventDefault();
      if (qrModal.classList.contains('open')) closeQrModal();
      else openRoomQrModal();
    }
  });

  // Sticky Note Rendering
  function createNoteElement(note, animateFlyIn) {
    const card = document.createElement('article');
    card.className = `sticky-note color-${note.color || 'yellow'}${animateFlyIn ? ' fly-in' : ''}`;
    card.dataset.id = note.id;
    card.style.setProperty('--tilt', `${note.tilt ?? 0}deg`);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sticky-note-del';
    delBtn.title = '移除這張便利貼';
    delBtn.setAttribute('aria-label', '移除便利貼');
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notes = notes.filter((n) => n.id !== note.id);
      saveNotesLocal();
      card.remove();
      syncEmptyAndCounter();
    });

    const body = document.createElement('div');
    body.className = 'sticky-note-text';
    body.textContent = note.text;

    const footer = document.createElement('div');
    footer.className = 'sticky-note-footer';
    const authorSpan = document.createElement('span');
    authorSpan.textContent = `— ${note.author || '現場學員'}`;
    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTime(note.createdAt);
    footer.append(authorSpan, timeSpan);

    card.append(delBtn, body, footer);
    card.addEventListener('click', () => openSpotlight(note));
    return card;
  }

  function syncEmptyAndCounter() {
    noteCountEl.textContent = String(notes.length);
    emptyState.style.display = notes.length === 0 ? 'block' : 'none';
  }

  function renderAllNotes() {
    notesGrid.innerHTML = '';
    const ordered = [...notes].reverse();
    for (const note of ordered) {
      notesGrid.appendChild(createNoteElement(note, false));
    }
    syncEmptyAndCounter();
  }

  function addNoteWithFlyIn(note) {
    if (!note || !note.id || notes.some((n) => n.id === note.id)) return;
    notes.push(note);
    if (notes.length > 200) notes.shift();
    saveNotesLocal();
    const el = createNoteElement(note, true);
    notesGrid.prepend(el);
    syncEmptyAndCounter();
  }

  function updateBroadcastUI(broadcast) {
    const text = broadcast?.text || '';
    if (text) {
      broadcastStatusText.textContent = `目前推播中（更新於 ${formatTime(broadcast.updatedAt)}）：共 ${text.length} 字`;
      activePushPreview.textContent = text.replace(/\s+/g, ' ');
      activePushPill.hidden = false;
    } else {
      broadcastStatusText.textContent = '目前尚未推播任何資料給學員';
      activePushPreview.textContent = '';
      activePushPill.hidden = true;
    }
  }

  // MQTT Pub/Sub for Static GitHub Pages
  function topicPrefix() {
    return `liveboard/v1/${roomId}`;
  }

  function publishTopic(val) {
    if (!mqttClient?.connected) return;
    mqttClient.publish(`${topicPrefix()}/topic`, JSON.stringify({ topic: val }), { qos: 1, retain: true });
  }

  function publishBroadcast(text) {
    if (!mqttClient?.connected) {
      showToast('連線中，請稍候再試');
      return false;
    }
    const payload = text
      ? { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, updatedAt: new Date().toISOString() }
      : { id: null, text: '', updatedAt: null };
    mqttClient.publish(`${topicPrefix()}/broadcast`, JSON.stringify(payload), { qos: 1, retain: true });
    updateBroadcastUI(payload);
    return true;
  }

  function connectMqtt() {
    if (mqttClient) {
      try { mqttClient.end(true); } catch {}
    }
    onlineStudents.clear();
    studentCountEl.textContent = '0';
    connLabelEl.textContent = '連線中';

    const clientId = `host-${Math.random().toString(36).slice(2, 10)}`;
    mqttClient = window.mqtt.connect(BROKER_URL, {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
    });

    mqttClient.on('connect', () => {
      connLabelEl.textContent = '已連線';
      const prefix = topicPrefix();
      mqttClient.subscribe([`${prefix}/notes/add`, `${prefix}/presence/+`], { qos: 1 });
      publishTopic(topicInput.value.trim() || '歡迎分享你的想法或提問！');
    });

    mqttClient.on('reconnect', () => {
      connLabelEl.textContent = '重連中';
    });

    mqttClient.on('offline', () => {
      connLabelEl.textContent = '離線';
    });

    mqttClient.on('message', (topic, message) => {
      const prefix = topicPrefix();
      const raw = message.toString();
      if (topic === `${prefix}/notes/add`) {
        try {
          const note = JSON.parse(raw);
          addNoteWithFlyIn(note);
        } catch {}
      } else if (topic.startsWith(`${prefix}/presence/`)) {
        const studentId = topic.slice(`${prefix}/presence/`.length);
        if (raw) onlineStudents.add(studentId);
        else onlineStudents.delete(studentId);
        studentCountEl.textContent = String(onlineStudents.size);
      }
    });
  }

  // Topic sync
  let lastSyncedTopic = topicInput.value;
  function saveTopic() {
    const val = topicInput.value.trim() || '歡迎分享你的想法或提問！';
    topicInput.value = val;
    if (val === lastSyncedTopic) return;
    lastSyncedTopic = val;
    publishTopic(val);
    showToast('討論主題已同步到學員手機');
  }
  topicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      topicInput.blur();
    }
  });
  topicInput.addEventListener('blur', saveTopic);

  copyJoinUrlBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(joinUrl);
    showToast(ok ? '已複製學員加入網址' : `請手動複製網址：${joinUrl}`);
  });

  function setDrawerOpen(open) {
    broadcastDrawer.classList.toggle('open', open);
    toggleBroadcastBtn.setAttribute('aria-expanded', String(open));
    if (open) broadcastInput.focus();
  }
  toggleBroadcastBtn.addEventListener('click', () => setDrawerOpen(!broadcastDrawer.classList.contains('open')));
  editPushBtn.addEventListener('click', () => setDrawerOpen(true));

  sendBroadcastBtn.addEventListener('click', () => {
    const text = broadcastInput.value.trim();
    if (!text) {
      showToast('請先輸入要傳給學員的文字或網址');
      broadcastInput.focus();
      return;
    }
    if (publishBroadcast(text)) {
      showToast('🚀 已即時推播到所有學員手機！');
    }
  });

  textQrZoomBtn.addEventListener('click', () => {
    const text = broadcastInput.value.trim();
    if (!text) {
      showToast('請先輸入要轉成 QR Code 的文字或網址');
      broadcastInput.focus();
      return;
    }
    openCustomTextQrModal(text);
  });

  clearBroadcastBtn.addEventListener('click', () => {
    broadcastInput.value = '';
    if (publishBroadcast('')) {
      showToast('已清除學員手機上的推播資料');
    }
  });

  // New Room button
  newRoomBtn.addEventListener('click', () => {
    roomId = makeRoomId();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('room', roomId);
    window.history.replaceState(null, '', nextUrl.toString());
    notes = [];
    saveNotesLocal();
    renderAllNotes();
    updateBroadcastUI(null);
    refreshRoomQr();
    connectMqtt();
    showToast(`已開啟全新房間（${roomId}）並更新 QR Code`);
  });

  // Plain Text Export
  function buildPlainTextReport() {
    const topic = topicInput.value.trim();
    const now = new Date().toLocaleString('zh-TW', { hour12: false });
    return [
      `主題：${topic}`,
      `匯出時間：${now}`,
      `便利貼總數：${notes.length}`,
      '----------------------------------------',
      ...notes.map((n, idx) => `${idx + 1}. ${n.text}  （${n.author || '現場學員'}，${formatTime(n.createdAt)}）`),
    ].join('\n');
  }

  copyTextBtn.addEventListener('click', async () => {
    if (notes.length === 0) return showToast('目前還沒有便利貼可以複製');
    const ok = await copyToClipboard(buildPlainTextReport());
    showToast(ok ? `已複製 ${notes.length} 則純文字內容，可直接貼給 AI 分析！` : '自動複製受限，請改用「下載 .txt」');
  });

  downloadTxtBtn.addEventListener('click', () => {
    if (notes.length === 0) return showToast('目前還沒有便利貼可以下載');
    const blob = new Blob([buildPlainTextReport()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `workshop-notes-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已下載純文字檔 (.txt)');
  });

  // High-DPI Canvas PNG Export
  function wrapCanvasText(ctx, text, maxWidth) {
    const paragraphs = String(text).split('\n');
    const lines = [];
    for (const para of paragraphs) {
      if (!para) { lines.push(''); continue; }
      let current = '';
      for (const char of Array.from(para)) {
        const test = current + char;
        if (ctx.measureText(test).width > maxWidth && current.length > 0) {
          lines.push(current);
          current = char;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  downloadPngBtn.addEventListener('click', () => {
    if (notes.length === 0) return showToast('目前還沒有便利貼可以匯出圖片');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const ordered = [...notes].reverse();
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(ordered.length))));
    const cardW = 300;
    const gap = 28;
    const padX = 48;
    const headerH = 112;
    const footerPad = 48;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontFamily = '"Noto Sans TC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    ctx.font = `600 20px ${fontFamily}`;
    const cardMeta = ordered.map((note) => {
      const lines = wrapCanvasText(ctx, note.text, cardW - 44);
      const height = Math.max(195, 52 + lines.length * 30 + 46);
      return { note, lines, height };
    });

    const rows = [];
    for (let i = 0; i < cardMeta.length; i += cols) {
      const slice = cardMeta.slice(i, i + cols);
      rows.push({ slice, maxH: Math.max(...slice.map((item) => item.height)) });
    }

    const totalW = padX * 2 + cols * cardW + (cols - 1) * gap;
    const totalH = headerH + rows.reduce((s, r) => s + r.maxH, 0) + Math.max(0, rows.length - 1) * gap + footerPad;
    const dpr = 2;
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = isDark ? '#121417' : '#f6f4ef';
    ctx.fillRect(0, 0, totalW, totalH);

    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(24,24,27,0.06)';
    for (let x = 22; x < totalW; x += 26) {
      for (let y = 22; y < totalH; y += 26) {
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = isDark ? '#f4f4f5' : '#18181b';
    ctx.font = `700 28px ${fontFamily}`;
    ctx.fillText(topicInput.value.trim(), padX, 54);
    ctx.fillStyle = isDark ? '#a1a1aa' : '#52525b';
    ctx.font = `500 15px ${fontFamily}`;
    ctx.fillText(`${new Date().toLocaleString('zh-TW', { hour12: false })}  ·  共 ${ordered.length} 張便利貼`, padX, 84);

    let cursorY = headerH;
    for (const row of rows) {
      row.slice.forEach((item, colIdx) => {
        const x = padX + colIdx * (cardW + gap);
        const y = cursorY;
        const h = item.height;
        const palette = COLOR_MAP[item.note.color] || COLOR_MAP.yellow;

        ctx.save();
        ctx.translate(x + cardW / 2, y + h / 2);
        ctx.rotate(((item.note.tilt || 0) * Math.PI) / 180);
        ctx.translate(-(x + cardW / 2), -(y + h / 2));

        ctx.shadowColor = 'rgba(0, 0, 0, 0.16)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 8;

        ctx.fillStyle = palette.bg;
        drawRoundedRect(ctx, x, y, cardW, h, 10);
        ctx.fill();
        ctx.shadowColor = 'transparent';

        ctx.fillStyle = palette.tape;
        drawRoundedRect(ctx, x + cardW / 2 - 34, y - 9, 68, 18, 3);
        ctx.fill();

        ctx.fillStyle = '#18181b';
        ctx.font = `600 20px ${fontFamily}`;
        item.lines.forEach((line, lineIdx) => {
          ctx.fillText(line, x + 22, y + 48 + lineIdx * 30);
        });

        ctx.fillStyle = 'rgba(24, 24, 27, 0.65)';
        ctx.font = `500 13px ${fontFamily}`;
        ctx.fillText(`— ${item.note.author || '現場學員'}`, x + 22, y + h - 20);
        const t = formatTime(item.note.createdAt);
        const tw = ctx.measureText(t).width;
        ctx.fillText(t, x + cardW - 22 - tw, y + h - 20);
        ctx.restore();
      });
      cursorY += row.maxH + gap;
    }

    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    link.download = `workshop-board-${stamp}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('已下載便利貼牆高畫質圖片 (.png)');
  });

  clearNotesBtn.addEventListener('click', () => {
    if (notes.length === 0) return showToast('目前看板已經是空的');
    if (!clearArmed) {
      clearArmed = true;
      clearNotesBtn.textContent = '⚠️ 再按一次確定清空';
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = setTimeout(() => {
        clearArmed = false;
        clearNotesBtn.textContent = '🗑️ 清空';
      }, 3200);
      return;
    }
    clearArmed = false;
    clearTimeout(clearConfirmTimer);
    clearNotesBtn.textContent = '🗑️ 清空';
    notes = [];
    saveNotesLocal();
    renderAllNotes();
    showToast('已清空所有便利貼');
  });

  renderAllNotes();
  refreshRoomQr();
  connectMqtt();
})();
