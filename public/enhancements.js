// Route-aware document metadata.  Content stays client-rendered, while the
// document head now follows every public detail route and active language.
(() => {
  const endpointForRoute = () => {
    const path = location.hash.slice(2).split('?')[0].split('/');
    const aliases = {news:'articles','student-companies':'companies','student-products':'products'};
    const section = aliases[path[0]] || path[0];
    const pageAliases = ['about','contacts','career','partners','documents','support','faq','privacy','terms'];
    if (pageAliases.includes(path[0])) return `/api/pages/${path[0]}`;
    return path[1] && ['companies','products','services','students','universities','articles','pages'].includes(section) ? `/api/${section}/${encodeURIComponent(path[1])}` : null;
  };
  const setMeta = (name, value, property=false) => {
    let el = document.head.querySelector(`meta[${property?'property':'name'}="${name}"]`);
    if (!el) { el=document.createElement('meta'); el.setAttribute(property?'property':'name',name); document.head.append(el); }
    el.content=value || '';
  };
  const updateHead = async () => {
    const endpoint=endpointForRoute(); if (!endpoint) return;
    try {
      const lang=localStorage.getItem('expobest_lang') || 'ru';
      const item=await fetch(`${endpoint}?lang=${lang}`).then(r=>r.ok?r.json():Promise.reject());
      const title=item.seoTitle || item.title || item.name || 'Expobest';
      const description=item.seoDescription || item.description || item.excerpt || '';
      document.title=`${title} — Expobest`;
      setMeta('description',description); setMeta('og:title',title,true); setMeta('og:description',description,true); setMeta('og:image',item.ogImage || item.image || item.cover || item.logo || '',true);
    } catch {}
  };
  addEventListener('hashchange', updateHead); addEventListener('storage', updateHead); updateHead();
})();
