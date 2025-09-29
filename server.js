import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import multer from 'multer';
import jwt from 'jsonwebtoken';
dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const SSE_CLIENTS = new Set();
function sseSendAll(payload){ const data = `data: ${JSON.stringify(payload)}\n\n`; for(const res of SSE_CLIENTS){ try{ res.write(data);}catch(_){ } } }
const PORT = process.env.PORT || 3001;

// CORS (whitelist)
const ALLOWED = (process.env.ALLOWED_ORIGINS||'*').split(',').map(s=>s.trim()).filter(Boolean);
app.use((req,res,next)=>{
  const origin = req.headers.origin;
  if(!origin || ALLOWED.includes('*') || ALLOWED.includes(origin)){
    res.setHeader('Access-Control-Allow-Origin', origin||'*'); res.setHeader('Vary','Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials','true');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  if(req.method==='OPTIONS'){ return res.sendStatus(204); } next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname,'public')));

// Config for client
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || 'test_ck_xxx';
app.get('/config', (_req,res)=> res.json({ clientKey: TOSS_CLIENT_KEY }));

// In-memory data
let MENU = [
  { id:'A1', name:'아메리카노', price:3000, cat:'커피', active:true },
  { id:'A2', name:'라떼', price:4000, cat:'커피', active:true },
  { id:'B1', name:'크로와상', price:3500, cat:'베이커리', active:true },
];
let ORDERS = [];

// Admin auth
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const TOKENS = new Set();
function makeToken(){ return crypto.randomBytes(24).toString('hex'); }
function isAuthed(req){
const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) return false;
  try {
    jwt.verify(t, JWT_SECRET);
    return true;
  } catch (e) {
    try { return (typeof TOKENS !== 'undefined') && TOKENS.has ? TOKENS.has(t) : false; } catch(_) { return false; }
  }
}
function requireAuth(req,res,next){ if(isAuthed(req)) return next(); return res.status(401).json({ ok:false, message:'Unauthorized' }); }
app.post('/auth/login',(req,res)=>{
  const { password } = req.body || {};
  if(String(password)===String(ADMIN_PASSWORD)){
    const token = jwt.sign({ role:'admin' }, JWT_SECRET, { expiresIn:'7d' });
    try { if (typeof TOKENS !== 'undefined') TOKENS.add(token); } catch(_) {}
    return res.json({ ok:true, token });
  }
  return res.status(401).json({ ok:false, message:'Invalid password' });
}););

// ===== Daily code (deterministic + override) =====
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function to4(n){ return String(n%10000).padStart(4,'0'); }
function digitsFromHex(hex){ let acc=0; for(let i=0;i<hex.length;i+=2){ acc=(acc*31 + parseInt(hex.slice(i,i+2),16))>>>0; } return to4(acc); }
const CODE_SECRET = process.env.CODE_SECRET || process.env.ADMIN_PASSWORD || 'qrorder_salt';
const CODE_OVERRIDE = {}; // { [date] : '1234' }
function defaultCodeFor(dateStr){ const h=crypto.createHmac('sha256', CODE_SECRET).update(String(dateStr)).digest('hex'); return digitsFromHex(h); }
async function getTodayCode(){ const t=todayStr(); if(CODE_OVERRIDE[t]) return { date:t, code:CODE_OVERRIDE[t], override:true }; return { date:t, code: defaultCodeFor(t), override:false }; }

app.get('/daily-code', requireAuth, async (_req,res)=>{ try{ res.json(await getTodayCode()); }catch(e){ console.error(e); res.status(500).send('code error'); } });
app.post('/daily-code/regen', requireAuth, async (_req,res)=>{ try{ const t=todayStr(); const rand=String(Math.floor(1000+Math.random()*9000)); CODE_OVERRIDE[t]=rand; res.json({ date:t, code:rand, override:true }); }catch(e){ console.error(e); res.status(500).send('regen error'); } });
app.post('/daily-code/clear', requireAuth, async (_req,res)=>{ try{ const t=todayStr(); delete CODE_OVERRIDE[t]; res.json(await getTodayCode()); }catch(e){ console.error(e); res.status(500).send('clear error'); } });

// Customer verify

// Staff call from customer
app.post('/call-staff', async (req,res)=>{
  try{
    const j = req.body || {};
    const tableNo = String(j.tableNo||'').trim();
    const reason = (j.reason||'').toString().slice(0,100);
    if(!tableNo){ return res.status(400).json({ok:false, error:'TABLE_REQUIRED'}); }
    const payload = { type:'staff_call', at: Date.now(), tableNo, reason };
    sseSendAll(payload);
    return res.json({ok:true});
  }catch(e){ console.error('call-staff error', e); return res.status(500).json({ok:false}); }
});
app.post('/verify-code', async (req,res)=>{
  try{ const provided=String((req.body||{}).code||'').trim(); const j=await getTodayCode(); if(provided && provided===j.code) return res.json({ ok:true }); res.status(401).json({ ok:false, message:'코드 불일치' }); }
  catch(e){ console.error(e); res.status(500).json({ ok:false, message:'server error' }); }
});

// Menu CRUD
app.get('/menu', (_req,res)=> res.json(MENU));
app.post('/menu', requireAuth, (req,res)=>{ const { id,name,price,cat,active=true } = req.body||{}; if(!id||!name||!price) return res.status(400).send('id/name/price required'); if(MENU.some(m=>m.id===id)) return res.status(409).send('duplicate id'); MENU.push({ id, name, price:Number(price), cat:cat||'', active:!!active }); res.json({ ok:true }); });
app.patch('/menu/:id', requireAuth, (req,res)=>{ const i=MENU.findIndex(m=>m.id===req.params.id); if(i<0) return res.status(404).send('not found'); MENU[i]={ ...MENU[i], ...req.body }; res.json({ ok:true }); });
app.delete('/menu/:id', requireAuth, (req,res)=>{ const i=MENU.findIndex(m=>m.id===req.params.id); if(i<0) return res.status(404).send('not found'); MENU.splice(i,1); res.json({ ok:true }); });

// Orders + SSE
const clients = new Set();
app.get('/events/orders', (req,res)=>{ res.setHeader('Content-Type','text/event-stream');
  SSE_CLIENTS.add(res);
  req.on('close',()=>{ try{ SSE_CLIENTS.delete(res); res.end(); }catch(_){}}); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.flushHeaders?.(); const client={res}; clients.add(client); req.on('close', ()=> clients.delete(client)); });
function broadcastOrder(o){ const data=JSON.stringify({ type:'order', id:o.id, tableNo:o.tableNo, amount:o.amount, createdAt:o.createdAt }); for(const c of clients){ try{ c.res.write(`event: order\n`); c.res.write(`data: ${data}\n\n`); }catch(_){} } }
app.get('/orders', (_req,res)=> res.json(ORDERS));
app.post('/orders', (req,res)=>{ const { tableNo, items, amount, paymentKey, orderId } = req.body||{}; const o={ id:crypto.randomUUID(), orderId: orderId||`ORD-${Date.now()}`, tableNo, items:items||[], amount:Number(amount)||0, paymentKey:paymentKey||'', status:'접수', createdAt:new Date().toISOString() }; ORDERS.push(o); try{ broadcastOrder(o);}catch(_){} res.json({ ok:true, order:o }); });
app.patch('/orders/:id', requireAuth, (req,res)=>{ const i=ORDERS.findIndex(o=>o.id===req.params.id); if(i<0) return res.status(404).send('not found'); ORDERS[i]={ ...ORDERS[i], ...req.body }; res.json({ ok:true }); });
app.delete('/orders/:id', requireAuth, (req,res)=>{ const i=ORDERS.findIndex(o=>o.id===req.params.id); if(i<0) return res.status(404).send('not found'); ORDERS.splice(i,1); res.json({ ok:true }); });

// Excel export/import
app.get('/export/orders.xlsx', requireAuth, async (_req,res)=>{ try{ const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('orders'); ws.columns=[{header:'createdAt',key:'createdAt',width:22},{header:'orderId',key:'orderId',width:24},{header:'tableNo',key:'tableNo',width:10},{header:'items',key:'items',width:40},{header:'amount',key:'amount',width:12},{header:'status',key:'status',width:10},{header:'paymentKey',key:'paymentKey',width:32},]; const toTxt=(items)=>(items||[]).map(([id,q])=>`${id} x ${q}`).join(', '); ([...ORDERS]).forEach(o=> ws.addRow({ ...o, items: toTxt(o.items) })); res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition','attachment; filename="orders.xlsx"'); await wb.xlsx.write(res); res.end(); }catch(e){ console.error(e); res.status(500).send('엑셀 생성 실패'); } });
const upload = multer({ storage: multer.memoryStorage(), limits:{ fileSize: 5*1024*1024 } });
app.post('/import/menu', requireAuth, upload.single('file'), async (req,res)=>{ try{ if(!req.file) return res.status(400).send('파일이 필요합니다.'); const wb=new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer); const ws=wb.worksheets[0]; if(!ws) return res.status(400).send('시트를 찾을 수 없습니다.'); const headers={}; ws.getRow(1).eachCell((cell,col)=> headers[String(cell.value).toLowerCase()]=col); const need=['id','name','price']; for(const h of need){ if(!headers[h]) return res.status(400).send('헤더 누락: '+h); } const next=[]; ws.eachRow((row,i)=>{ if(i===1) return; const id=String(row.getCell(headers['id']).value||'').trim(); if(!id) return; const name=String(row.getCell(headers['name']).value||'').trim(); const price=Number(row.getCell(headers['price']).value||0); const cat=headers['cat']?String(row.getCell(headers['cat']).value||'').trim():''; const active=headers['active']?!!row.getCell(headers['active']).value:true; if(!name||!price) return; next.push({ id,name,price,cat,active }); }); if(next.length===0) return res.status(400).send('유효한 행이 없습니다.'); MENU=next; res.json({ ok:true, count: next.length }); }catch(e){ console.error(e); res.status(500).send('업로드 실패'); } });

// QR proxy for download
app.get('/qr', async (req,res)=>{
  try{ const data=String(req.query.data||'').trim(); const size=String(req.query.size||'220x220'); if(!data) return res.status(400).send('data required'); const url='https://api.qrserver.com/v1/create-qr-code/?size='+encodeURIComponent(size)+'&data='+encodeURIComponent(data); const r=await fetch(url); if(!r.ok) return res.status(500).send('QR service error'); res.setHeader('Content-Type','image/png'); const buf=Buffer.from(await r.arrayBuffer()); res.send(buf); }catch(e){ console.error(e); res.status(500).send('QR proxy error'); }
});

// Health & routes
app.get('/healthz', (_req,res)=> res.send('ok'));
app.get('/payment/success', (_req,res)=> res.sendFile(path.join(__dirname,'public','success.html')));
app.get('/payment/fail', (_req,res)=> res.sendFile(path.join(__dirname,'public','fail.html')));
app.get('/', (_req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
if (process.env.VERCEL !== '1') app.listen(PORT, ()=> console.log('API on :'+PORT));

app.post('/confirm', async (req,res)=>{ res.json({ ok:true }); });


export default app;
