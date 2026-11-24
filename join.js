(() => {
  const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
  const params = new URLSearchParams(window.location.search);
  const roomId = (params.get('room') || 'default').replace(/[^a-zA-Z0-9_-]/g, '');

  const connStatusEl = document.getElementById('connStatus');
  const studentTopicEl = document.getElementById('studentTopic');
  const receivedCard = document.getElementById('receivedCard');
  const receivedBox = document.getElementById('receivedBox');
  const receivedTime = document.getElementById('receivedTime');
  const receivedActions = document.getElementById('receivedActions');
  const copyReceivedBtn = document.getElementById('copyReceivedBtn');
  const openLinkBtn = document.getElementById('openLinkBtn');

  const colorPicker = document.getElementById('colorPicker');
  const noteForm = document.getElementById('noteForm');
  const authorInput = document.getElementById('authorInput');
  const noteInput = document.getElementById('noteInput');
  const charCounter = document.getElementById('charCounter');
  const submitNoteBtn = document.getElementById('submitNoteBtn');
  const toastEl = document.getElementById('toast');

  let selectedColor = 'yellow';
  let currentBroadcastText = '';
  let lastBroadcastId = null;
  let toastTimer = null;
  let mqttClient = null;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
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

  const savedAuthor = localStorage.getItem('liveboard-author');
  if (savedAuthor) authorInput.value = savedAuthor;
  authorInput.addEventListener('input', () => {
    localStorage.setItem('liveboard-author', authorInput.value.trim());
  });

  colorPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch');
    if (!btn) return;
    selectedColor = btn.dataset.color || 'yellow';
    for (const swatch of colorPicker.querySelectorAll('.color-swatch')) {
      const active = swatch === btn;
      swatch.classList.toggle('active', active);
      swatch.setAttribute('aria-checked', String(active));
    }
    noteInput.className = `student-textarea tint-${selectedColor}`;
  });

  noteInput.addEventListener('input', () => {
    charCounter.textContent = `${noteInput.value.length} / 280`;
  });

  function renderBroadcast(broadcast) {
    const text = broadcast?.text || '';
    currentBroadcastText = text;
    if (!text) {
      receivedBox.textContent = '講師傳送 Prompt、重點或連結時，會即時顯示在這裡給你複製';
      receivedBox.classList.add('empty');
      receivedTime.textContent = '';
      receivedActions.hidden = true;
      openLinkBtn.hidden = true;
      lastBroadcastId = null;
      return;
    }

    receivedBox.textContent = text;
    receivedBox.classList.remove('empty');
    receivedTime.textContent = broadcast.updatedAt ? `更新於 ${formatTime(broadcast.updatedAt)}` : '';
    receivedActions.hidden = false;

    const urlMatch = text.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      openLinkBtn.href = urlMatch[0];
      openLinkBtn.hidden = false;
    } else {
      openLinkBtn.hidden = true;
    }

    if (broadcast.id && broadcast.id !== lastBroadcastId) {
      const isUpdate = lastBroadcastId !== null;
      lastBroadcastId = broadcast.id;
      if (isUpdate) {
        receivedCard.classList.remove('received-flash');
        void receivedCard.offsetWidth;
        receivedCard.classList.add('received-flash');
        showToast('📩 收到講師傳送的新資料！');
      }
    }
  }

  copyReceivedBtn.addEventListener('click', async () => {
    if (!currentBroadcastText) return;
    const ok = await copyToClipboard(currentBroadcastText);
    if (ok) {
      const original = copyReceivedBtn.textContent;
      copyReceivedBtn.textContent = '✅ 已複製！';
      showToast('已複製到剪貼簿，可直接貼上使用');
      setTimeout(() => {
        copyReceivedBtn.textContent = original;
      }, 1800);
    } else {
      const range = document.createRange();
      range.selectNodeContents(receivedBox);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      showToast('已選取文字，請長按複製');
    }
  });

  const prefix = `liveboard/v1/${roomId}`;
  const studentClientId = `stu-${Math.random().toString(36).slice(2, 10)}`;
  const presenceTopic = `${prefix}/presence/${studentClientId}`;

  function connectMqtt() {
    mqttClient = window.mqtt.connect(BROKER_URL, {
      clientId: studentClientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
      will: {
        topic: presenceTopic,
        payload: '',
        qos: 0,
        retain: true,
      },
    });

    mqttClient.on('connect', () => {
      connStatusEl.textContent = '已即時連線';
      mqttClient.subscribe([`${prefix}/topic`, `${prefix}/broadcast`], { qos: 1 });
      mqttClient.publish(presenceTopic, '1', { qos: 0, retain: true });
    });

    mqttClient.on('reconnect', () => {
      connStatusEl.textContent = '重新連線中…';
    });

    mqttClient.on('offline', () => {
      connStatusEl.textContent = '連線中斷…';
    });

    mqttClient.on('message', (topic, message) => {
      const raw = message.toString();
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        if (topic === `${prefix}/topic` && data.topic) {
          studentTopicEl.textContent = data.topic;
        } else if (topic === `${prefix}/broadcast`) {
          renderBroadcast(data);
        }
      } catch {}
    });

    window.addEventListener('beforeunload', () => {
      try {
        mqttClient.publish(presenceTopic, '', { qos: 0, retain: true });
      } catch {}
    });
  }

  noteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = noteInput.value.trim();
    if (!text) {
      showToast('請先輸入內容');
      noteInput.focus();
      return;
    }
    if (!mqttClient?.connected) {
      showToast('正在連線中，請稍候 1 秒再送出');
      return;
    }

    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: text.slice(0, 280),
      author: authorInput.value.trim().slice(0, 24) || '現場學員',
      color: selectedColor,
      tilt: Number(((Math.random() - 0.5) * 3.6).toFixed(2)),
      createdAt: new Date().toISOString(),
    };

    submitNoteBtn.disabled = true;
    mqttClient.publish(`${prefix}/notes/add`, JSON.stringify(note), { qos: 1 }, (err) => {
      submitNoteBtn.disabled = false;
      if (err) {
        showToast('送出失敗，請再試一次');
        return;
      }
      noteInput.value = '';
      charCounter.textContent = '0 / 280';
      submitNoteBtn.classList.remove('launching');
      void submitNoteBtn.offsetWidth;
      submitNoteBtn.classList.add('launching');
      showToast('🚀 已飛上講師大螢幕！');
    });
  });

  connectMqtt();
})();
