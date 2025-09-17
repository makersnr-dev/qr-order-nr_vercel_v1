import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

let MENUS = [
  { id:'americano', name:'아메리카노', price:3000, active:true, soldout:false },
  { id:'latte', name:'라떼', price:4000, active:true, soldout:false },
  { id:'croissant', name:'크로와상', price:3500, active:true, soldout:false }
];
let ORDERS = [];

function authOk(req){
  const hdr = req.headers['authorization']||'';
  const tok = hdr.startsWith('Bearer ')? hdr.slice(7): hdr;
  return tok && tok === (process.env.ADMIN_PASSWORD||'admin');
}

app.get('/api/healthz', (_req,res)=> res.type('text/plain').send('ok'));

// Auth (simple)
app.post('/api/auth/login', (req,res)=>{
  const { password } = req.body||{};
  if(String(password)!==(process.env.ADMIN_PASSWORD||'admin')) return res.status(401).send('bad password');
  res.json({ token: process.env.ADMIN_PASSWORD||'admin' });
});

// Menu
app.get('/api/menu', (_req,res)=> res.json(MENUS.filter(m=> m.active)) );
app.post('/api/menu', (req,res)=>{
  if(!authOk(req)) return res.status(401).send('unauthorized');
  const { id,name,price,active=true,soldout=false }=req.body||{};
  if(!id||!name) return res.status(400).send('id/name required');
  MENUS = MENUS.filter(m=>m.id!==id).concat([{ id,name,price:Number(price||0),active, soldout }]);
  res.json({ ok:true });
});
app.patch('/api/menu/:id', (req,res)=>{
  if(!authOk(req)) return res.status(401).send('unauthorized');
  const id = req.params.id;
  MENUS = MENUS.map(m=> m.id===id? { ...m, ...req.body, price: req.body?.price!=null? Number(req.body.price): m.price }: m);
  res.json({ ok:true });
});

// Orders
app.get('/api/orders', (req,res)=>{
  const table = (req.query.table||'').trim();
  const include = String(req.query.includeCleared||'0')==='1';
  let arr = [...ORDERS];
  if(table) arr = arr.filter(o=> String(o.tableNo)===String(table));
  if(!include) arr = arr.filter(o=> !o.cleared);
  res.json(arr.sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt)));
});
app.post('/api/orders', async (req,res)=>{
  const { orderId, tableNo, items=[], amount=0, paymentKey='', status='접수' } = req.body||{};
  if(!tableNo) return res.status(400).send('tableNo required');
  if(!Array.isArray(items) || items.length===0) return res.status(400).send('items required');
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const obj = { id, orderId: orderId||`ORD-${Date.now()}`, tableNo:String(tableNo||''), items, amount:Number(amount||0), paymentKey, status, createdAt, cleared:false };
  ORDERS.push(obj);
  // Optional admin sync
  const adminBase = process.env.ADMIN_BASE||'';
  const syncOn = String(process.env.ADMIN_SYNC_ON_ORDER||'0')==='1';
  if(adminBase && syncOn){
    try{ await fetch(adminBase.replace(/\/$/,'') + '/api/adb/sync/orders', { method:'POST' }); }catch(_){}
  }
  res.json({ ok:true, id });
});
app.patch('/api/orders/:id', (req,res)=>{
  if(!authOk(req)) return res.status(401).send('unauthorized');
  const id = req.params.id;
  const { status, cleared } = req.body||{};
  ORDERS = ORDERS.map(o=> o.id===id? { ...o, ...(status!=null? {status}: {}), ...(cleared!=null? {cleared:!!cleared}: {}) }: o);
  res.json({ ok:true });
});

// Daily code
function dailyCode(dateStr){
  const seed = (process.env.CODE_SECRET||'secret')+'|'+dateStr;
  let h=0; for(let i=0;i<seed.length;i++){ h=(h*31 + seed.charCodeAt(i))>>>0; }
  const code = (h % 1000000).toString().padStart(6,'0');
  return code;
}
app.get('/api/daily-code', (req,res)=>{
  const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const dateStr = d.toISOString().slice(0,10);
  res.json({ date: dateStr, code: dailyCode(dateStr), override:false });
});
app.post('/api/verify-code', (req,res)=>{
  try{
    const { code } = req.body||{};
    const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
    const dateStr = d.toISOString().slice(0,10);
    const ok = String(code||'').trim()===dailyCode(dateStr);
    if(ok) return res.json({ ok:true });
    res.status(401).json({ ok:false, message:'코드 불일치' });
  }catch(e){ res.status(500).json({ ok:false }); }
});

// Toss
app.get('/api/toss/public-key', (_req,res)=>{ res.json({ key: process.env.TOSS_CLIENT_KEY || '' }); });
app.post('/api/toss/confirm', async (req,res)=>{
  try{
    const { paymentKey, orderId, amount } = req.body||{};
    if(!paymentKey || !orderId || !amount) return res.status(400).send('missing fields');
    const secretKey = process.env.TOSS_SECRET_KEY || '';
    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const r = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method:'POST', headers:{ 'Authorization': `Basic ${auth}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount })
    });
    if(!r.ok){ const t = await r.text(); return res.status(r.status).send(t || 'confirm fail'); }
    const json = await r.json();
    res.json(json);
  }catch(e){ res.status(500).send('confirm error'); }
});
app.post('/api/toss/refund', async (req,res)=>{
  try{
    const { paymentKey, cancelReason='고객 요청', cancelAmount } = req.body||{};
    if(!paymentKey) return res.status(400).send('paymentKey required');
    const secretKey = process.env.TOSS_SECRET_KEY || '';
    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const body = { cancelReason }; if(cancelAmount!=null) body.cancelAmount = Number(cancelAmount);
    const r = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      method:'POST', headers:{ 'Authorization': `Basic ${auth}`, 'Content-Type':'application/json' }, body: JSON.stringify(body)
    });
    if(!r.ok){ const t = await r.text(); return res.status(r.status).send(t || 'refund fail'); }
    const json = await r.json();
    res.json(json);
  }catch(e){ res.status(500).send('refund error'); }
});
app.post('/api/orders/:id/refund', async (req,res)=>{
  try{
    const id = req.params.id;
    const i = ORDERS.findIndex(o=> o.id===id);
    if(i<0) return res.status(404).send('not found');
    const ord = ORDERS[i];
    const r = await fetch('/api/toss/refund', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ paymentKey: ord.paymentKey, cancelAmount: ord.amount }) });
    if(!r.ok){ const t=await r.text(); return res.status(r.status).send(t); }
    ORDERS[i] = { ...ord, status:'환불', refundedAt: new Date().toISOString() };
    res.json({ ok:true, order: ORDERS[i] });
  }catch(e){ res.status(500).send('refund error'); }
});

export default app;
