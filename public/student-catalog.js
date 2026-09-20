(() => {
  const originalList = window.list;
  let activeRender = 0;
  const STORAGE_KEY = 'expobest_student_filters';

  const getSavedFilters = () => {
    const hashQuery = location.hash.includes('?') ? new URLSearchParams(location.hash.split('?')[1]) : null;
    if (hashQuery && (hashQuery.has('name') || hashQuery.has('q') || hashQuery.has('city') || hashQuery.has('university') || hashQuery.has('specialty') || hashQuery.has('skills') || hashQuery.has('page'))) {
      return {
        q: hashQuery.get('name') || hashQuery.get('q') || '',
        city: hashQuery.get('city') || '',
        university: hashQuery.get('university') || '',
        specialty: hashQuery.get('specialty') || '',
        skills: hashQuery.get('skills') || '',
        page: Math.max(1, Number(hashQuery.get('page')) || 1)
      };
    }
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  };

  window.list = async (key, title, options = {}) => {
    if (key !== 'students') return originalList(key, title, options);
    const renderId = ++activeRender;
    app.innerHTML = nav() + `<main class="wrap"><h1 class="page-title">${title}</h1><div class="filter"><input id="q" placeholder="Поиск по имени"><select id="city"><option value="">Все города</option></select><select id="university"><option value="">Все университеты</option></select><input id="specialty" placeholder="Специальность"><input id="skills" placeholder="Навыки"><button id="resetFilters" class="btn secondary" type="button">Сбросить</button></div><div id="out" class="grid skeleton">Загрузка…</div><nav id="publicPager" class="cms-pager"></nav></main>` + foot();
    bindNav();

    const [cities, universities] = await Promise.all([get('/cities?limit=48'), get('/universities?limit=48')]);
    if (renderId !== activeRender) return;

    for (const [id, records] of [['city', cities.items], ['university', universities.items]]) {
      document.querySelector('#' + id).insertAdjacentHTML('beforeend', records.map(item => `<option value="${e(item.name)}">${e(item.name)}</option>`).join(''));
    }

    const inputs = {
      q: document.querySelector('#q'),
      city: document.querySelector('#city'),
      university: document.querySelector('#university'),
      specialty: document.querySelector('#specialty'),
      skills: document.querySelector('#skills')
    };
    const output = document.querySelector('#out'), pager = document.querySelector('#publicPager'), resetBtn = document.querySelector('#resetFilters');

    const saved = getSavedFilters();
    if (saved.q) inputs.q.value = saved.q;
    if (saved.city) inputs.city.value = saved.city;
    if (saved.university) inputs.university.value = saved.university;
    if (saved.specialty) inputs.specialty.value = saved.specialty;
    if (saved.skills) inputs.skills.value = saved.skills;
    let page = saved.page || 1;

    const saveState = () => {
      const state = {
        q: inputs.q.value.trim(),
        city: inputs.city.value,
        university: inputs.university.value,
        specialty: inputs.specialty.value.trim(),
        skills: inputs.skills.value.trim(),
        page
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const params = new URLSearchParams();
      if (state.q) { params.set('name', state.q); params.set('q', state.q); }
      if (state.city) params.set('city', state.city);
      if (state.university) params.set('university', state.university);
      if (state.specialty) params.set('specialty', state.specialty);
      if (state.skills) params.set('skills', state.skills);
      if (page > 1) params.set('page', String(page));
      const newHash = '#/students' + (params.toString() ? '?' + params.toString() : '');
      if (location.hash !== newHash) history.replaceState(null, '', newHash);
    };

    const load = async () => {
      saveState();
      output.classList.add('skeleton'); output.textContent = 'Загрузка…';
      const query = new URLSearchParams({page: String(page), limit: '12', lang});
      if (inputs.q.value.trim()) {
        query.set('name', inputs.q.value.trim());
        query.set('q', inputs.q.value.trim());
      }
      if (inputs.city.value) query.set('city', inputs.city.value);
      if (inputs.university.value) query.set('university', inputs.university.value);
      if (inputs.specialty.value.trim()) query.set('specialty', inputs.specialty.value.trim());
      if (inputs.skills.value.trim()) query.set('skills', inputs.skills.value.trim());

      const result = await get('/students?' + query.toString());
      if (renderId !== activeRender) return;

      const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
      if (page > totalPages && result.total > 0) { page = totalPages; return load(); }

      output.classList.remove('skeleton');
      output.innerHTML = result.items.length ? result.items.map(item => card(item, 'students')).join('') : empty();
      pager.innerHTML = `<span>${result.total ? `${(page - 1) * result.limit + 1}–${Math.min(page * result.limit, result.total)} из ${result.total}` : '0 результатов'} · Страница ${page}/${totalPages}</span><button class="btn secondary" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>←</button><button class="btn secondary" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>→</button>`;
      pager.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { page = Number(button.dataset.page); load(); window.scrollTo({top:0, behavior:'smooth'}); });
    };

    resetBtn.onclick = () => {
      inputs.q.value = '';
      inputs.city.value = '';
      inputs.university.value = '';
      inputs.specialty.value = '';
      inputs.skills.value = '';
      page = 1;
      sessionStorage.removeItem(STORAGE_KEY);
      history.replaceState(null, '', '#/students');
      load();
    };

    Object.values(inputs).forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => { page = 1; load(); }));
    load();
  };

  const renderStudentRoute = () => {
    if (location.hash.split('?')[0] === '#/students') window.list('students', t('students'));
  };
  const originalHashChange = window.onhashchange;
  window.onhashchange = event => {
    if (location.hash.split('?')[0] === '#/students') return renderStudentRoute();
    return originalHashChange?.call(window, event);
  };
})();

