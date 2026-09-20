(() => {
  const supported = new Set(['pages','companies','products','services','students','universities','articles']);
  const token = () => JSON.parse(localStorage.getItem('expobest_session') || 'null')?.token;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const request = async (url, options = {}) => {
    const response = await fetch('/api' + url, {headers:{'Content-Type':'application/json', ...(token()?{Authorization:'Bearer '+token()}:{}), ...(options.headers||{})}, ...options});
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'Ошибка'); return result;
  };
  const adminKey = () => (location.hash.match(/^#\/admin\/([^/?]+)/) || [])[1];

  // Remember the precise record that opened a modal, including modals created
  // by the original table and the enhanced paginated table.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-e]'); if (!button) return;
    window.__expobestEditing = {key:adminKey(), id:button.dataset.e};
  }, true);

  const formValues = form => {
    const values = {};
    form.querySelectorAll('[name]').forEach(input => {
      if (!['status','contentLanguage'].includes(input.name)) values[input.name] = input.value;
    });
    const rich=form.querySelector('.rich'); if (rich) values.content=rich.innerHTML;
    return values;
  };
  const fillForm = (form, values) => {
    form.querySelectorAll('[name]').forEach(input => {
      if (input.name in values && input.name !== 'contentLanguage') input.value=values[input.name] ?? '';
    });
    const rich=form.querySelector('.rich'); if (rich && 'content' in values) rich.innerHTML=values.content || '';
  };
  const enhanceTranslationForm = form => {
    if (form.dataset.i18nReady || !window.__expobestEditing?.id || !supported.has(window.__expobestEditing.key)) return;
    const context={...window.__expobestEditing}; form.dataset.i18nReady='1';
    const language=document.createElement('select'); language.name='contentLanguage'; language.className='cms-language';
    language.innerHTML='<option value="ru">RU — Русский</option><option value="kk">KZ — Қазақша</option><option value="en">EN — English</option>';
    const label=document.createElement('label'); label.textContent='Язык локализованного контента'; label.append(language);
    const status=form.querySelector('[name="status"]'); status?.before(label);
    const note=document.createElement('p'); note.className='cms-note'; label.after(note);
    language.addEventListener('change', async () => {
      if (language.value==='ru') { note.textContent='Основная версия'; return; }
      note.textContent='Загрузка перевода…';
      try { const translations=await request(`/${context.key}/${context.id}/translations`); fillForm(form,translations[language.value] || {}); note.textContent=translations[language.value]?'Сохранённый перевод загружен.':'Новая локализованная версия.'; } catch(error) { note.textContent=error.message; }
    });
    form.addEventListener('submit', async event => {
      if (language.value==='ru') return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { await request(`/${context.key}/${context.id}/translations`,{method:'PUT',body:JSON.stringify({language:language.value,values:formValues(form)})}); note.textContent='Перевод сохранён в базе данных.'; }
      catch(error) { note.textContent=error.message; }
    }, true);
  };

  const labels={pages:'Страницы',articles:'Журнал',companies:'Компании',products:'Товары',services:'Услуги',students:'Студенты',universities:'Университеты',categories:'Категории',cities:'Города',reviews:'Отзывы',subscribers:'Подписчики',users:'Пользователи'};
  const publicPath = (key,item) => ({articles:'news',pages:item.slug,companies:'companies',products:'products',services:'services',students:'students',universities:'universities'}[key] || key);
  const setupPager = async table => {
    if (table.dataset.cmsPager || !adminKey() || adminKey()==='media') return;
    const key=adminKey(); table.dataset.cmsPager='1';
    const main=table.closest('.adminmain'), oldSearch=main.querySelector('#aq'); if (!main || !oldSearch) return;
    oldSearch.placeholder='🔍 Поиск по таблице';
    const toolbar=document.createElement('div'); toolbar.className='cms-toolbar';
    toolbar.innerHTML='<select class="cms-status"><option value="">Все статусы</option><option>Draft</option><option>Pending</option><option>Published</option><option>Rejected</option><option>Hidden</option><option>Approved</option><option>Active</option></select><select class="cms-sort"><option value="name">Сортировка: А–Я</option><option value="new">Сначала новые</option><option value="status">По статусу</option></select>';
    oldSearch.after(toolbar); const status=toolbar.querySelector('.cms-status'), sort=toolbar.querySelector('.cms-sort');
    const pager=document.createElement('nav'); pager.className='cms-pager'; table.closest('.tablewrap').after(pager);
    let page=1; const perPage=10;
    let currentRecords = [];

    const loadServer = async () => {
      const query = oldSearch.value.trim();
      const params = new URLSearchParams({
        page: String(page),
        limit: String(perPage),
        sort: sort.value
      });
      if (query) { params.set('q', query); params.set('name', query); }
      if (status.value) params.set('status', status.value);

      const rows = table.querySelector('#rows');
      if (rows) rows.innerHTML = '<tr><td colspan="4" class="muted">Загрузка данных…</td></tr>';

      try {
        const result = await request(`/${key}?${params.toString()}`);
        currentRecords = result.items || [];
        const total = result.total || 0;
        const totalPages = Math.max(1, Math.ceil(total / perPage));
        if (page > totalPages && total > 0) { page = totalPages; return loadServer(); }

        rows.innerHTML = currentRecords.map(item => `<tr><td>${esc(item.name||item.title||item.email||item.filename)}</td><td>${esc(item.category||item.city||'—')}</td><td>${esc(item.status||'Published')}</td><td><button data-cms-edit="${item.id}" class="btn secondary">Edit</button><button data-cms-copy="${item.id}" class="btn secondary">Copy</button><button data-cms-preview="${item.id}" class="btn secondary">Preview</button><button data-cms-delete="${item.id}" class="btn danger">🗑</button></td></tr>`).join('') || '<tr><td colspan="4">Ничего не найдено</td></tr>';

        pager.innerHTML = `<span>Показано ${total ? ((page-1)*perPage+1) : 0}–${Math.min(page*perPage, total)} из ${total}; страница ${page} из ${totalPages}</span><button class="btn secondary" data-page="${page-1}" ${page===1?'disabled':''}>←</button><button class="btn secondary" data-page="${page+1}" ${page===totalPages?'disabled':''}>→</button>`;

        rows.querySelectorAll('[data-cms-edit]').forEach(button => button.onclick = () => {
          const item = currentRecords.find(x => String(x.id) === button.dataset.cmsEdit);
          window.__expobestEditing = {key, id: item.id};
          window.modal?.(key, item);
        });
        rows.querySelectorAll('[data-cms-copy]').forEach(button => {
          button.onclick = () => {
            const item = structuredClone(currentRecords.find(x => String(x.id) === button.dataset.cmsCopy));
            delete item.id;
            delete item.slug;
            window.__expobestEditing = null;
            window.modal?.(key, item);
          };
        });
        rows.querySelectorAll('[data-cms-preview]').forEach(button => {
          button.onclick = () => {
            const item = currentRecords.find(x => String(x.id) === button.dataset.cmsPreview);
            location.hash = '#/' + publicPath(key, item) + '/' + (item.slug || item.id);
          };
        });
        rows.querySelectorAll('[data-cms-delete]').forEach(button => {
          button.onclick = async () => {
            const item = currentRecords.find(x => String(x.id) === button.dataset.cmsDelete);
            const title = item?.name || item?.title || item?.email || item?.filename || 'запись';
            if (!confirm(`Вы действительно хотите удалить ${title}?`)) return;
            await request(`/${key}/${button.dataset.cmsDelete}`, {method: 'DELETE'});
            loadServer();
          };
        });
        pager.querySelectorAll('[data-page]').forEach(button => {
          button.onclick = () => {
            page = Number(button.dataset.page);
            loadServer();
          };
        });
      } catch (err) {
        if (rows) rows.innerHTML = `<tr><td colspan="4" class="danger">${esc(err.message)}</td></tr>`;
      }
    };

    let searchTimer;
    oldSearch.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { page = 1; loadServer(); }, 250);
    };
    status.onchange = () => { page = 1; loadServer(); };
    sort.onchange = () => { page = 1; loadServer(); };
    loadServer();
  };
  new MutationObserver(() => {
    document.querySelectorAll('#editform').forEach(enhanceTranslationForm);
    document.querySelectorAll('#close').forEach(button=>{if(!button.dataset.cmsClose){button.dataset.cmsClose='1';button.addEventListener('click',()=>button.closest('.modal')?.remove());}});
    document.querySelectorAll('.adminmain table .table, table.table').forEach(setupPager);
  }).observe(document.body,{childList:true,subtree:true});
})();
