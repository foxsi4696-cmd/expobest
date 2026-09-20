(() => {
  const root = document.querySelector('#app');
  const activeSession = () => JSON.parse(localStorage.getItem('expobest_session') || sessionStorage.getItem('expobest_session') || 'null');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const request = async (path, options = {}) => {
    const session = activeSession();
    const response = await fetch('/api' + path, { ...options, headers: {'Content-Type':'application/json', ...(session?.token ? {Authorization:'Bearer ' + session.token} : {}), ...(options.headers || {})} });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Ошибка');
    return result;
  };
  const page = async () => {
    const media = await request('/media?limit=48');
    const isAdmin = activeSession()?.user?.role === 'Admin';
    root.innerHTML = `<div class="admin">${side()}<main class="adminmain"><div class="section-head"><h1>Медиа-библиотека</h1><button id="mediaAdd" class="btn">+ Загрузить</button></div><p class="muted">PNG, JPEG, GIF или WebP до 5 МБ. Используйте URL после загрузки в карточках и SEO-полях.</p><div class="grid">${media.items.map(item => `<article class="card"><img class="cardimg" src="${escape(item.url)}" alt="${escape(item.alt || item.filename)}"><h3>${escape(item.filename)}</h3><div style="display:flex;gap:6px;margin:8px 0;"><input readonly aria-label="URL файла" value="${escape(item.url)}" style="flex:1;font-size:12px;"><button type="button" class="btn secondary" data-copy-url="${escape(item.url)}" style="padding:6px 10px;font-size:12px;">Копировать</button></div>${isAdmin ? `<button class="btn danger" data-delete="${item.id}">Удалить</button>` : ''}</article>`).join('') || '<div class="empty">Изображений пока нет</div>'}</div></main></div>`;
    adminBind();
    document.querySelectorAll('[data-copy-url]').forEach(btn => {
      btn.onclick = () => {
        navigator.clipboard?.writeText(btn.dataset.copyUrl);
        const prev = btn.textContent;
        btn.textContent = 'Скопировано!';
        setTimeout(() => btn.textContent = prev, 1500);
      };
    });
    document.querySelector('#mediaAdd').onclick = () => {
      root.insertAdjacentHTML('beforeend', '<div class="modal"><form id="up" class="login form"><h2>Загрузить изображение</h2><input name="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required><input name="alt" maxlength="250" placeholder="Alt-текст"><button class="btn">Загрузить</button><button id="cancelUpload" class="btn secondary" type="button">Отмена</button><div id="uploadError" aria-live="polite"></div></form></div>');
      document.querySelector('#cancelUpload').onclick = () => document.querySelector('.modal')?.remove();
      document.querySelector('#up').onsubmit = event => {
        event.preventDefault();
        const form = event.currentTarget, file = form.file.files[0];
        if (!file || file.size > 5 * 1024 * 1024) { document.querySelector('#uploadError').textContent = 'Выберите изображение до 5 МБ.'; return; }
        const reader = new FileReader();
        reader.onload = async () => { try { await request('/media/upload', {method:'POST',body:JSON.stringify({data:reader.result,filename:file.name,alt:form.alt.value})}); page(); } catch (error) { document.querySelector('#uploadError').textContent = error.message; } };
        reader.readAsDataURL(file);
      };
    };
    document.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => { if (confirm('Переместить изображение в корзину?')) { await request('/media/' + button.dataset.delete, {method:'DELETE'}); page(); } });
  };

  window.openMediaPicker = (onSelect, allowUrl = true) => {
    const modal = document.createElement('div');
    modal.className = 'modal media-picker-modal';
    modal.innerHTML = `<div class="login form wide" style="max-width:760px;width:100%;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h2 style="margin:0;">Медиа-библиотека</h2><button id="pickerClose" type="button" class="btn secondary">✕</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;"><label class="btn" style="cursor:pointer;margin:0;">+ Загрузить файл<input id="pickerFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none;"></label>${allowUrl ? '<button id="pickerUrlBtn" type="button" class="btn secondary">Вставить по URL</button>' : ''}</div><div id="pickerStatus" class="muted" style="margin-bottom:8px;"></div><div id="pickerGrid" class="grid" style="grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:10px;max-height:360px;overflow-y:auto;padding:4px;"><div class="muted">Загрузка медиа…</div></div></div>`;
    document.body.append(modal);

    const close = () => modal.remove();
    modal.querySelector('#pickerClose').onclick = close;

    if (allowUrl) {
      modal.querySelector('#pickerUrlBtn').onclick = () => {
        const url = prompt('Введите прямой URL изображения:');
        if (url && url.trim()) {
          onSelect(url.trim(), '');
          close();
        }
      };
    }

    const grid = modal.querySelector('#pickerGrid');
    const status = modal.querySelector('#pickerStatus');

    const renderItems = (items) => {
      if (!items.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">Изображений пока нет. Загрузите первое изображение выше.</div>';
        return;
      }
      grid.innerHTML = items.map(item => `
        <div class="card" style="padding:8px;cursor:pointer;text-align:center;" data-pick-url="${escape(item.url)}" data-pick-alt="${escape(item.alt || item.filename)}">
          <img src="${escape(item.url)}" style="width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:6px;">
          <small style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;">${escape(item.filename)}</small>
          <button type="button" class="btn" style="padding:4px 8px;font-size:12px;margin-top:6px;width:100%;">Выбрать</button>
        </div>
      `).join('');

      grid.querySelectorAll('[data-pick-url]').forEach(card => {
        card.onclick = () => {
          onSelect(card.dataset.pickUrl, card.dataset.pickAlt);
          close();
        };
      });
    };

    const loadMedia = async () => {
      try {
        const res = await request('/media?limit=48');
        renderItems(res.items || []);
      } catch (e) {
        grid.innerHTML = `<div class="danger">${escape(e.message)}</div>`;
      }
    };

    const fileInput = modal.querySelector('#pickerFile');
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        status.textContent = 'Размер файла превышает 5 МБ.';
        return;
      }
      status.textContent = 'Загрузка…';
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const uploaded = await request('/media/upload', {
            method: 'POST',
            body: JSON.stringify({ data: reader.result, filename: file.name, alt: file.name })
          });
          status.textContent = 'Загружено успешно!';
          onSelect(uploaded.url, uploaded.alt || uploaded.filename);
          close();
        } catch (err) {
          status.textContent = err.message;
        }
      };
      reader.readAsDataURL(file);
    };

    loadMedia();
  };

  addEventListener('hashchange', () => { if (location.hash === '#/admin/media') setTimeout(page, 0); });
  if (location.hash === '#/admin/media') page();
})();

