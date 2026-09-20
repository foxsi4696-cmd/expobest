const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const {
  initDb,
  readDb,
  writeDb,
  queryStudents,
  migratePasswords,
  hashPassword,
  verifyPassword
} = require('./db.js');
const IS_VERCEL = !!process.env.VERCEL;
const ROOT = __dirname;
let UPLOADS = path.join(ROOT, 'public', 'uploads');
if (IS_VERCEL) {
  UPLOADS = path.join(process.env.TMPDIR || os.tmpdir(), 'uploads');
}
try { fs.mkdirSync(UPLOADS, {recursive:true}); } catch {}
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
initDb().then(() => migratePasswords()).catch(console.error);
const json = (res, code, body) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); };
const MAX_BODY_BYTES=1024*1024, SESSION_TTL_MS=8*60*60*1000, loginAttempts=new Map();
const body = req => new Promise(resolve => { let raw='',size=0,tooLarge=false; req.on('data', c=>{size+=c.length;if(size>MAX_BODY_BYTES){tooLarge=true;return;}raw+=c;}); req.on('end',()=>{if(tooLarge)return resolve({_tooLarge:true});try { resolve(JSON.parse(raw||'{}')); } catch { resolve({}); }}); });
const tokenUser = (req, db) => { const token=(req.headers.authorization||'').replace('Bearer ',''); const user=db.users.find(u=>u.token===token&&!u.blocked); return user&&user.tokenExpiresAt&&Date.parse(user.tokenExpiresAt)>Date.now()?user:null; };
const requireRole = (req,res,db,roles) => { const user=tokenUser(req,db); if(!user || !roles.includes(user.role)){ json(res,403,{error:'Недостаточно прав'}); return null; } return user; };
const makeSlug = s => String(s||'').toLowerCase().trim().replace(/[^a-zа-яё0-9]+/gi,'-').replace(/^-|-$/g,'');
const collections = ['companies','products','services','students','universities','articles','pages','categories','cities','reviews','media','users','subscribers'];
const audit = (db,user,action,entity='') => { db.activity=(db.activity||[]); db.activity.unshift({id:Date.now(),date:new Date().toISOString(),user:user.name,action:`${action} ${entity}`.trim()}); db.activity=db.activity.slice(0,100); };
const localize = (item, lang) => {
  const translated=item?.translations?.[lang];
  return translated ? {...item,...translated} : item;
};
// A student availability status ("Looking for work", etc.) is not a moderation
// status.  Keep it separate from publication visibility so public profiles and
// universities do not disappear merely because they have no CMS status yet.
const visibleToPublic = (key, item) => {
  if (item.deletedAt) return false;
  if (key === 'reviews') return item.status === 'Approved';
  if (key === 'students') return !['Draft','Pending','Rejected','Hidden'].includes(item.publicationStatus || 'Published');
  if (key === 'universities') return !['Draft','Pending','Rejected','Hidden'].includes(item.status || 'Published');
  return item.status === 'Published';
};
const validUrl = value => !value || /^(https?:\/\/|mailto:|tel:)/i.test(value);
const sanitizeRichText = value => String(value || '')
  .replace(/<\/?(?:script|style|object|embed|form|input|button|svg|math)[^>]*>/gi, '')
  .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/\s(?:href|src)\s*=\s*["']\s*(?:javascript|data:text\/html):[^"']*["']/gi, '');
const sanitizePayload = payload => {
  if (payload.content !== undefined) payload.content = sanitizeRichText(payload.content);
  return payload;
};

const requestHandler = async (req,res) => {
  const host = (req.headers && req.headers.host) || 'localhost';
  const url = new URL(req.url, 'http://' + host); const parts=url.pathname.split('/').filter(Boolean); const db=await readDb();
  if (url.pathname === '/api/login' && req.method === 'POST') { const p=await body(req);if(p._tooLarge)return json(res,413,{error:'Слишком большой запрос'});const key=String(req.socket.remoteAddress||'')+':'+String(p.login||'').toLowerCase(),attempt=loginAttempts.get(key)||{count:0,until:0};if(attempt.until>Date.now())return json(res,429,{error:'Слишком много попыток. Повторите позже.'});const user=db.users.find(u=>(u.email===p.login||u.login===p.login)&&!u.blocked);if(!user||!verifyPassword(p.password,user.passwordHash)){attempt.count++;if(attempt.count>=5)attempt.until=Date.now()+15*60*1000;loginAttempts.set(key,attempt);return json(res,401,{error:'Неверный логин или пароль'});}loginAttempts.delete(key);user.token=crypto.randomUUID();user.tokenExpiresAt=new Date(Date.now()+SESSION_TTL_MS).toISOString();await writeDb(db);return json(res,200,{token:user.token,user:{id:user.id,name:user.name,email:user.email,role:user.role}}); }
  if (url.pathname === '/api/dashboard') { if(!requireRole(req,res,db,['Admin','Editor']))return; const live=k=>db[k].filter(x=>!x.deletedAt); const stats={companies:live('companies').filter(x=>x.type!=='student').length,studentCompanies:live('companies').filter(x=>x.type==='student').length,products:live('products').filter(x=>x.type!=='student').length,studentProducts:live('products').filter(x=>x.type==='student').length,services:live('services').length,students:live('students').length,universities:live('universities').length,articles:live('articles').length,reviews:live('reviews').length}; const recent=[...live('companies').map(x=>({...x,_type:'companies'})),...live('products').map(x=>({...x,_type:'products'})),...live('students').map(x=>({...x,_type:'students'})),...live('articles').map(x=>({...x,_type:'articles'}))].sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))).slice(0,8); return json(res,200,{stats,recent}); }
  if (url.pathname === '/api/analytics') { if(!requireRole(req,res,db,['Admin','Editor']))return; const today=new Date().toISOString().slice(0,10), days=Array.from({length:30},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(29-i));return d.toISOString().slice(0,10)}); const byDay=db.viewsByDay||{}; const daily=days.map(date=>({date,views:Object.values(byDay[date]||{}).reduce((a,b)=>a+b,0)})); const sum=n=>daily.slice(-n).reduce((a,x)=>a+x.views,0); const top={}; Object.entries(db.views||{}).forEach(([type, entries])=>top[type]=Object.entries(entries).map(([id,views])=>({id,views,item:db[type]?.find(x=>String(x.id)===id)})).sort((a,b)=>b.views-a.views).slice(0,5)); return json(res,200,{today,viewsToday:sum(1),viewsWeek:sum(7),viewsMonth:sum(30),daily,top,activity:db.activity||[],newItems:{companies:db.companies.filter(x=>x.createdAt?.slice(0,10)===today).length,products:db.products.filter(x=>x.createdAt?.slice(0,10)===today).length,students:db.students.filter(x=>x.createdAt?.slice(0,10)===today).length}}); }
  if (url.pathname === '/api/settings') { const u=requireRole(req,res,db,['Admin']);if(!u)return; if(req.method==='GET')return json(res,200,db.settings); db.settings={...db.settings,...(await body(req))};audit(db,u,'изменил настройки');await writeDb(db);return json(res,200,db.settings); }
  if (parts[0]==='api'&&collections.includes(parts[1])&&parts[2]&&parts[3]==='translations') { const key=parts[1],translationRoles=['pages','categories','cities','reviews','users','subscribers'].includes(key)?['Admin']:['Admin','Editor'],u=requireRole(req,res,db,translationRoles);if(!u)return; const item=db[key].find(x=>String(x.id)===parts[2]);if(!item)return json(res,404,{error:'Не найдено'});if(req.method==='GET')return json(res,200,item.translations||{});if(req.method==='PUT'){const p=await body(req),language=['ru','kk','en'].includes(p.language)?p.language:null;if(!language)return json(res,422,{error:'Выберите язык'});const values=p.values&&typeof p.values==='object'?sanitizePayload(p.values):{};item.translations={...(item.translations||{}),[language]:values};audit(db,u,'обновил перевод',item.name||item.title||'запись');await writeDb(db);return json(res,200,item.translations)}}
  if (url.pathname === '/api/trash') { if(!requireRole(req,res,db,['Admin']))return; const trash={};collections.filter(k=>Array.isArray(db[k])).forEach(k=>trash[k]=db[k].filter(x=>x.deletedAt));return json(res,200,trash); }
  if (parts[0]==='api' && parts[1]==='trash' && parts[2] && parts[3]==='restore' && req.method==='POST') { const u=requireRole(req,res,db,['Admin']);if(!u)return; const key=parts[2], id=parts[4];if(!collections.includes(key))return json(res,404,{error:'Раздел не найден'});const item=db[key].find(x=>String(x.id)===id&&x.deletedAt);if(!item)return json(res,404,{error:'Запись не найдена в корзине'});delete item.deletedAt;item.status='Draft';audit(db,u,'восстановил',item.name||item.title||'запись');await writeDb(db);return json(res,200,item); }
  if (parts[0]==='api' && parts[1]==='trash' && parts[2] && parts[3]==='purge' && req.method==='DELETE') { const u=requireRole(req,res,db,['Admin']);if(!u)return; const key=parts[2], id=parts[4];if(!collections.includes(key))return json(res,404,{error:'Раздел не найден'});const index=db[key].findIndex(x=>String(x.id)===id&&x.deletedAt);if(index<0)return json(res,404,{error:'Запись не найдена в корзине'});const [item]=db[key].splice(index,1);audit(db,u,'удалил навсегда',item.name||item.title||'запись');await writeDb(db);return json(res,200,{message:'Запись удалена навсегда'}); }
  if (url.pathname === '/api/media/upload' && req.method==='POST') { const u=requireRole(req,res,db,['Admin','Editor']);if(!u)return; const p=await body(req), m=String(p.data||'').match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/i);if(!m)return json(res,422,{error:'Загрузите изображение PNG, JPEG, GIF или WebP'});const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>5*1024*1024)return json(res,422,{error:'Размер изображения не должен превышать 5 МБ'});const ext=m[1].split('/')[1].replace('jpeg','jpg'), filename=`${Date.now()}.${ext}`, file=path.join(UPLOADS,filename);fs.writeFileSync(file,bytes);const item={id:Date.now(),filename:String(p.filename||filename).slice(0,160),mimeType:m[1],url:'/uploads/'+filename,alt:String(p.alt||'').slice(0,250),author:u.name,createdAt:new Date().toISOString()};db.media.unshift(item);audit(db,u,'загрузил изображение',item.filename);await writeDb(db);return json(res,201,item); }
  if (url.pathname === '/api/search') { const q=(url.searchParams.get('q')||'').trim().toLowerCase(); const result={}; ['companies','products','services','students','articles'].forEach(k=>result[k]=db[k].filter(x=>visibleToPublic(k,x)&&(!q||JSON.stringify(x).toLowerCase().includes(q))).map(x=>localize(x,url.searchParams.get('lang')||'ru'))); return json(res,200,result); }
  if (url.pathname === '/api/reviews' && req.method === 'POST') { const p=await body(req); if(!p.name||!p.email||!p.text||!/^\S+@\S+\.\S+$/.test(p.email))return json(res,422,{error:'Заполните имя, корректный email и текст отзыва'}); db.reviews.unshift({id:Date.now(),...p,rating:Math.max(1,Math.min(5,+p.rating||5)),status:'Pending',createdAt:new Date().toISOString()});await writeDb(db);return json(res,201,{message:'Спасибо! Отзыв отправлен на модерацию.'}); }
  if (url.pathname === '/api/subscribers' && req.method === 'POST') { const p=await body(req),email=String(p.email||'').trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))return json(res,422,{error:'Введите корректный email'});if(db.subscribers.some(x=>x.email===email&&!x.deletedAt))return json(res,409,{error:'Этот email уже подписан'});db.subscribers.push({id:Date.now(),email,status:'Active',createdAt:new Date().toISOString()});await writeDb(db);return json(res,201,{message:'Вы подписались на новости'}); }
  if (parts[0]==='api' && collections.includes(parts[1])) { const key=parts[1], id=parts[2], isPrivate=['users','subscribers','media'].includes(key), adminPrivate=['users','subscribers'].includes(key);
    // Users and subscribers are administrative data: an Editor must not be
    // able to enumerate it by bypassing the hidden sidebar with a direct API call.
    if (req.method==='GET' && adminPrivate && tokenUser(req,db)?.role!=='Admin') return json(res,403,{error:'Недостаточно прав'});
    if(req.method==='GET'){ let items=db[key]; const user=tokenUser(req,db), privileged=['Admin','Editor'].includes(user?.role), lang=url.searchParams.get('lang')||'ru'; if(id){const item=items.find(x=>String(x.id)===id||x.slug===id);if(!item||item.deletedAt||(isPrivate&&!privileged)||(!privileged&&!isPrivate&&!visibleToPublic(key,item)))return json(res,404,{error:'Не найдено'});if(['companies','products','services','students','articles'].includes(key)&&!privileged){const date=new Date().toISOString().slice(0,10);db.views=db.views||{};db.views[key]=db.views[key]||{};db.views[key][item.id]=(db.views[key][item.id]||0)+1;db.viewsByDay=db.viewsByDay||{};db.viewsByDay[date]=db.viewsByDay[date]||{};db.viewsByDay[date][key]= (db.viewsByDay[date][key]||0)+1;await writeDb(db);}return json(res,200,key==='users'?{id:item.id,name:item.name,email:item.email,role:item.role,blocked:item.blocked}:localize(item,lang));}
    const q=(url.searchParams.get('q')||'').toLowerCase(), name=(url.searchParams.get('name')||'').toLowerCase(), city=url.searchParams.get('city'), category=url.searchParams.get('category'), type=url.searchParams.get('type'), university=url.searchParams.get('university'), specialty=(url.searchParams.get('specialty')||'').toLowerCase(), skills=(url.searchParams.get('skills')||'').toLowerCase(), status=url.searchParams.get('status'), trash=url.searchParams.get('trash')==='true', sort=url.searchParams.get('sort');
    if (key === 'students' && !trash) {
      let sqlQuery = `SELECT data FROM students WHERE (json_extract(data, '$.deletedAt') IS NULL)`;
      const sqlParams = [];
      if (!privileged) sqlQuery += ` AND (json_extract(data, '$.publicationStatus') IS NULL OR json_extract(data, '$.publicationStatus') = 'Published')`;
      if (name) { sqlQuery += ` AND (LOWER(name) LIKE ? OR LOWER(json_extract(data, '$.name')) LIKE ?)`; sqlParams.push(`%${name}%`, `%${name}%`); }
      if (q) { sqlQuery += ` AND (LOWER(data) LIKE ?)`; sqlParams.push(`%${q}%`); }
      if (city) { sqlQuery += ` AND (LOWER(city) = LOWER(?) OR LOWER(json_extract(data, '$.city')) = LOWER(?))`; sqlParams.push(city, city); }
      if (university) { sqlQuery += ` AND (LOWER(json_extract(data, '$.university')) = LOWER(?))`; sqlParams.push(university); }
      if (specialty) { sqlQuery += ` AND (LOWER(json_extract(data, '$.specialty')) LIKE ?)`; sqlParams.push(`%${specialty}%`); }
      if (skills) { sqlQuery += ` AND (LOWER(json_extract(data, '$.skills')) LIKE ?)`; sqlParams.push(`%${skills}%`); }
      if (status) { sqlQuery += ` AND (LOWER(status) = LOWER(?) OR LOWER(json_extract(data, '$.status')) = LOWER(?))`; sqlParams.push(status, status); }
      const countQuery = sqlQuery.replace('SELECT data FROM students', 'SELECT COUNT(*) as c FROM students');
      if (sort === 'name') sqlQuery += ` ORDER BY name ASC`;
      else if (sort === 'new') sqlQuery += ` ORDER BY id DESC`;
      else if (sort === 'status') sqlQuery += ` ORDER BY status ASC`;
      sqlQuery += ` LIMIT ? OFFSET ?`;
      const page=Math.max(1,+url.searchParams.get('page')||1), limit=Math.min(48,Math.max(1,+url.searchParams.get('limit')||12));
      const { rows, total } = await queryStudents({ query: sqlQuery, params: sqlParams, countQuery, limit, page });
      const studentItems = rows.map(r => localize(JSON.parse(r.data), lang));
      return json(res, 200, { items: studentItems, total, page, limit });
    }
    items=items.filter(x=>(trash?x.deletedAt:!x.deletedAt)&&(!q||JSON.stringify(x).toLowerCase().includes(q))&&(!name||String(x.name||x.title||x.email||'').toLowerCase().includes(name))&&(!city||x.city===city)&&(!category||x.category===category)&&(!type||x.type===type)&&(!university||x.university===university)&&(!specialty||String(x.specialty||'').toLowerCase().includes(specialty))&&(!skills||String(x.skills||'').toLowerCase().includes(skills))&&(!status||x.status===status)&&(isPrivate?privileged:(privileged||visibleToPublic(key,x))));
    if(sort==='price')items.sort((a,b)=>Number(a.price||0)-Number(b.price||0));
    if(sort==='new')items.sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
    if(sort==='status')items.sort((a,b)=>String(a.status||'').localeCompare(String(b.status||'')));
    if(sort==='name')items.sort((a,b)=>String(a.name||a.title||a.email||a.filename||'').localeCompare(String(b.name||b.title||b.email||b.filename||''),'ru'));
    const publicItems=key==='users'?items.map(x=>({id:x.id,name:x.name,email:x.email,role:x.role,blocked:x.blocked})):items.map(x=>localize(x,lang));
    const page=Math.max(1,+url.searchParams.get('page')||1), limit=Math.min(48,Math.max(1,+url.searchParams.get('limit')||12));
    return json(res,200,{items:publicItems.slice((page-1)*limit,page*limit),total:publicItems.length,page,limit}); }
    const user=requireRole(req,res,db,key==='pages'||key==='cities'||key==='categories'||key==='reviews'||key==='users'||key==='media'||key==='subscribers'?['Admin']:['Admin','Editor']); if(!user)return;
    if(req.method==='POST'){ const p=sanitizePayload(await body(req)); if(key==='users'){p.blocked=p.blocked===true||p.blocked==='true';if(!['Admin','Editor'].includes(p.role)||String(p.password||'').length<8)return json(res,422,{error:'Укажите роль Admin или Editor и пароль не короче 8 символов'});p.passwordHash=hashPassword(p.password);delete p.password;} if(!p.name&&!p.title&&!p.email)return json(res,422,{error:'Название обязательно'}); if(p.price!==undefined&&p.price!==''&&(!Number.isFinite(Number(p.price))||Number(p.price)<0))return json(res,422,{error:'Цена должна быть неотрицательным числом'}); if(p.email&&!/^\S+@\S+\.\S+$/.test(p.email))return json(res,422,{error:'Введите корректный email'}); if(['website','instagram','telegram','whatsapp','linkedin','github'].some(f=>!validUrl(p[f])))return json(res,422,{error:'Проверьте формат URL (https://...)'}); const slug=p.slug||makeSlug(p.name||p.title||p.email); if(slug&&db[key].some(x=>x.slug===slug&&!x.deletedAt))return json(res,409,{error:'Такой slug уже используется'}); const item={id:Date.now(),...p,slug,author:user.name,status:(user.role==='Editor'?'Pending':(p.status||'Published')),createdAt:new Date().toISOString()};db[key].unshift(item);audit(db,user,'создал',item.name||item.title||item.email);await writeDb(db);return json(res,201,item);}
    const index=db[key].findIndex(x=>String(x.id)===id);if(index<0)return json(res,404,{error:'Не найдено'}); if(req.method==='PUT'){const p=sanitizePayload(await body(req));if(key==='users'&&p.password){if(String(p.password).length<8)return json(res,422,{error:'Пароль должен содержать не менее 8 символов'});p.passwordHash=hashPassword(p.password);delete p.password;}if(key==='users'&&p.blocked!==undefined){p.blocked=p.blocked===true||p.blocked==='true';if(p.role!==undefined&&!['Admin','Editor'].includes(p.role))return json(res,422,{error:'Некорректная роль'});}if(p.price!==undefined&&p.price!==''&&(!Number.isFinite(Number(p.price))||Number(p.price)<0))return json(res,422,{error:'Цена должна быть неотрицательным числом'});if(['website','instagram','telegram','whatsapp','linkedin','github'].some(f=>!validUrl(p[f])))return json(res,422,{error:'Проверьте формат URL (https://...)'});if(p.slug&&db[key].some((x,i)=>i!==index&&x.slug===p.slug&&!x.deletedAt))return json(res,409,{error:'Такой slug уже используется'});if(user.role==='Editor'){delete p.role;delete p.blocked;delete p.author;if(p.status==='Published'||p.status==='Rejected')p.status='Pending';}db[key][index]={...db[key][index],...p,updatedAt:new Date().toISOString()};audit(db,user,'изменил',db[key][index].name||db[key][index].title||'запись');await writeDb(db);return json(res,200,db[key][index]);} if(req.method==='DELETE'){db[key][index].deletedAt=new Date().toISOString();db[key][index].status='Hidden';audit(db,user,'переместил в корзину',db[key][index].name||db[key][index].title||'запись');await writeDb(db);return json(res,200,{message:'Запись перемещена в корзину'});}
  }
  if (parts[0]==='api' && parts[1]==='reviews' && parts[2] && req.method==='PUT') {if(!requireRole(req,res,db,['Admin']))return; const r=db.reviews.find(x=>String(x.id)===parts[2]);if(!r)return json(res,404,{error:'Не найдено'});Object.assign(r,await body(req));await writeDb(db);return json(res,200,r);}
  if (url.pathname.startsWith('/uploads/')) {
    const uploadFile = path.resolve(UPLOADS, '.' + url.pathname.replace(/^\/uploads/, ''));
    if (uploadFile.startsWith(UPLOADS) && fs.existsSync(uploadFile) && fs.statSync(uploadFile).isFile()) {
      const ext = path.extname(uploadFile);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      return fs.createReadStream(uploadFile).pipe(res);
    }
  }
  const publicRoot = path.resolve(ROOT, 'public');
  const file = path.resolve(publicRoot, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (file.startsWith(publicRoot + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    return fs.createReadStream(file).pipe(res);
  }
  if (!url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(ROOT, 'public', 'index.html')).pipe(res);
  }
  json(res, 404, { error: 'Маршрут не найден' });
};
const server = http.createServer(requestHandler);
module.exports = requestHandler;
module.exports.server = server;
const PORT = Number(process.env.PORT) || 3001;
if (!process.env.VERCEL && require.main === module) {
  server.listen(PORT, () => console.log(`Expobest: http://localhost:${PORT}`));
}

