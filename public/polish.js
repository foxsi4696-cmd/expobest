(() => {
  const session = () => JSON.parse(localStorage.getItem('expobest_session') || 'null');
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const api = async (path, options = {}) => {
    const active=session();
    const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(active?.token?{Authorization:'Bearer '+active.token}:{}),...(options.headers||{})}});
    const payload=await response.json();
    if(!response.ok) throw Error(payload.error||'Ошибка');
    return payload;
  };

  // Add review moderation actions after either the original table or its
  // paginated enhancement renders rows.  They update only their own row.
  const enhanceReviewRows = () => {
    if(location.hash.split('?')[0] !== '#/admin/reviews') return;
    document.querySelectorAll('#rows tr').forEach(row => {
      const edit=row.querySelector('[data-cms-edit],[data-e]');
      if(!edit || row.querySelector('.review-actions')) return;
      const id=edit.dataset.cmsEdit || edit.dataset.e;
      const target=row.querySelector('td:last-child'); if(!target) return;
      const actions=document.createElement('span'); actions.className='review-actions';
      actions.innerHTML='<button class="btn review-approve">✓ Одобрить</button><button class="btn secondary review-reject">× Отклонить</button>';
      const update=async status => {
        const buttons=actions.querySelectorAll('button'); buttons.forEach(button=>button.disabled=true);
        try {
          await api('/reviews/'+id,{method:'PUT',body:JSON.stringify({status})});
          row.children[2].textContent=status;
          actions.querySelector('.review-approve').disabled=status==='Approved';
          actions.querySelector('.review-reject').disabled=status==='Rejected';
          // Reload this table's data from the API so filtering and pagination
          // use the new status as well, without a browser refresh.
          setTimeout(()=>route(),0);
        } catch(error) { alert(error.message); buttons.forEach(button=>button.disabled=false); }
      };
      actions.querySelector('.review-approve').onclick=()=>update('Approved');
      actions.querySelector('.review-reject').onclick=()=>update('Rejected');
      target.prepend(actions);
    });
  };
  new MutationObserver(enhanceReviewRows).observe(document.body,{childList:true,subtree:true});

  const imagesFor = item => {
    const values=[item.image,item.logo,item.cover,item.ogImage];
    const gallery=Array.isArray(item.gallery)?item.gallery:String(item.gallery||'').split(/[\n,]/);
    return [...new Set([...values,...gallery].map(value=>String(value||'').trim()).filter(Boolean))];
  };
  const urlFor = (value, service) => {
    const source=String(value||'').trim(); if(!source) return '';
    if(/^https?:\/\//i.test(source)) return source;
    if(service==='whatsapp') return 'https://wa.me/'+source.replace(/\D/g,'');
    if(service==='telegram') return 'https://t.me/'+source.replace(/^@/,'');
    return source;
  };
  const contactLink = (label, value, kind) => {
    const href=kind==='phone'?'tel:'+String(value).replace(/\s/g,''):urlFor(value,kind);
    return value&&href?`<a class="btn secondary" href="${escape(href)}" ${kind==='phone'?'':'target="_blank" rel="noopener"'}>${label}</a>`:'';
  };

  // Keep every detail route resilient to incomplete CMS data and make gallery
  // items usable without introducing a second data source.
  const polishedDetail = async (kind,id) => {
    try {
      const item=await get('/'+kind+'/'+id);
      const related=(await get('/'+kind+'?limit=48')).items.filter(other=>other.id!==item.id&&(other.category===item.category||other.company===item.company)).slice(0,3);
      const images=imagesFor(item), main=images[0]||'';
      const priceNegotiable=item.priceNegotiable===true||String(item.price||'').toLowerCase().includes('договор');
      const price=item.price!==undefined&&item.price!==''?`<p class="detail-price">${priceNegotiable?'Цена договорная':'Цена: '+escape(item.price)+' ₸'}</p>`:'';
      const facts=[['Город',item.city],['Адрес',item.address],['Компания',item.company],['Университет',item.university],['Специальность',item.specialty],['Курс',item.course],['Возраст',item.age],['Навыки',item.skills],['Характеристики',item.characteristics],['Опыт',item.experience],['Проекты',item.projects],['Телефон',item.phone||item.contacts],['Email',item.email],['Сайт',item.website],['Instagram',item.instagram],['Telegram',item.telegram],['WhatsApp',item.whatsapp],['GitHub',item.github],['LinkedIn',item.linkedin]].filter(([,value])=>value!==undefined&&value!==null&&value!=='');
      const factsHtml=facts.map(([label,value])=>`<p><b>${label}:</b> ${/^(https?:\/\/)/i.test(String(value))?`<a href="${escape(value)}" target="_blank" rel="noopener">${escape(value)}</a>`:escape(value)}</p>`).join('');
      let extra='';
      if(kind==='companies'){
        const [products,services]=await Promise.all([get('/products?limit=48'),get('/services?limit=48')]);
        const compProducts=products.items.filter(y=>y.company===item.name);
        const compServices=services.items.filter(y=>y.company===item.name);
        extra=`<section class="section"><h2>Товары компании</h2><div class="grid">${compProducts.map(y=>card(y,'products')).join('')||empty()}</div></section><section class="section"><h2>Услуги компании</h2><div class="grid">${compServices.map(y=>card(y,'services')).join('')||empty()}</div></section>`;
      }
      if(kind==='universities'){
        const students=await get('/students?limit=48');
        const uniStudents=students.items.filter(y=>y.university===item.name);
        extra=`<section class="section"><h2>Студенты университета</h2><div class="grid">${uniStudents.map(y=>card(y,'students')).join('')||empty()}</div></section>`;
      }
      const contacts=[
        contactLink('Позвонить',item.phone,'phone'),
        contactLink('WhatsApp',item.whatsapp,'whatsapp'),
        contactLink('Telegram',item.telegram,'telegram'),
        item.company?`<a class="btn secondary" href="#/companies?q=${encodeURIComponent(item.company)}">Связаться с компанией</a>`:'',
        contactLink('Сайт',item.website,'site'),
        contactLink('Instagram',item.instagram,'site')
      ].filter(Boolean).join('');
      app.innerHTML=nav()+`<main class="wrap"><a class="tag" href="#/${kind==='articles'?'news':kind}">← Назад</a><article class="detail"><div class="detail-gallery">${main?`<img id="galleryMain" class="cover" src="${escape(main)}" alt="${escape(item.name||item.title||'')}">`:'<div class="image-placeholder">Изображение пока не добавлено</div>'}${images.length>1?`<div class="gallery-thumbs">${images.map((image,index)=>`<button class="gallery-thumb ${index===0?'active':''}" data-image="${escape(image)}"><img src="${escape(image)}" alt="${index+1}"></button>`).join('')}</div>`:''}</div><span class="badge">${escape(item.category||item.city||'Expobest')}</span><h1 class="page-title">${escape(item.name||item.title)}</h1><p class="muted">${escape(item.date||'')}</p>${price}<div class="prose">${String(item.content||escape(item.description||item.about||'')).replace(/<script[\s\S]*?<\/script>/gi,'')}</div>${factsHtml}${contacts?`<p class="detail-contacts">${contacts}</p>`:''}</article>${related.length?`<section class="section"><h2>Похожие материалы</h2><div class="grid">${related.map(other=>card(other,kind)).join('')}</div></section>`:''}${extra}</main>`+foot();
      document.querySelectorAll('.gallery-thumb').forEach(button=>button.onclick=()=>{const image=button.dataset.image,mainImage=document.querySelector('#galleryMain');if(mainImage)mainImage.src=image;document.querySelectorAll('.gallery-thumb').forEach(node=>node.classList.toggle('active',node===button));});
      bindNav(); seo(item);
    } catch { notFound(); }
  };
  window.detail=polishedDetail;
  // app.js is a classic script, so its function binding is writable.  Update
  // that binding as well, not only window.detail, for hash routing.
  detail=polishedDetail;
  const currentDetail = () => location.hash.match(/^#\/(companies|products|services|students|universities|articles|news)\/([^/?]+)/);
  const renderCurrentDetail = () => { const match=currentDetail(); if(match) polishedDetail(match[1]==='news'?'articles':match[1],match[2]); };
  // The base app's home request is asynchronous.  Own detail-route changes
  // here so a late home response cannot leave a detail URL showing the home.
  window.onhashchange=()=>{ const page=location.hash.match(/^#\/(about|contacts|career|partners|documents|support|faq|privacy|terms)$/); if(currentDetail()) setTimeout(renderCurrentDetail,120); else if(page) polishedDetail('pages',page[1]); else route(); };
  if(currentDetail()) setTimeout(renderCurrentDetail,120);
})();
