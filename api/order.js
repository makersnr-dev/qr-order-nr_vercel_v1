import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();
const app = express();

let MENUS = [
  { id:'americano', name:'아메리카노', price:3000, active:true, soldout:false },
  { id:'latte', name:'라떼', price:4000, active:true, soldout:false }
];
let ORDERS = [];

function authOk(req){
  const hdr = req.headers['authorization']||'';
  const tok = hdr.startsWith('Bearer ')? hdr.slice(7): hdr;
  return tok && tok === (process.env.ADMIN_PASSWORD||'admin');
}

app.use(cors({ origin:true, credentials:true }));
app.use(express.json({ limit:'2mb' }));

app.get('/api/healthz', (_req,res)=> res.type('text/plain').send('ok'));

app.post('/api/auth/login', (req,res)=>{
  const { password } = req.body||{};
  if(String(password)!==(process.env.ADMIN_PASSWORD||'admin')) return res.status(401).send('bad password');
  res.json({ token: process.env.ADMIN_PASSWORD||'admin' });
});

app.get('/api/menu', (_req,res)=>{ res.json(MENUS.filter(m=> m.active)); });
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

app.get('/api/orders', (req,res)=>{
  const table = (req.query.table||'').trim();
  const include = String(req.query.includeCleared||'0')==='1';
  let arr = [...ORDERS];
  if(table) arr = arr.filter(o=> String(o.tableNo)===String(table));
  if(!include) arr = arr.filter(o=> !o.cleared);
  res.json(arr.sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt)));
});
app.post('/api/orders', (req,res)=>{
  const { orderId, tableNo, items=[], amount=0, paymentKey='', status='접수' } = req.body||{};
  if(!tableNo) return res.status(400).send('tableNo required');
  if(!Array.isArray(items) || items.length===0) return res.status(400).send('items required');
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  ORDERS.push({ id, orderId: orderId||`ORD-${Date.now()}`, tableNo:String(tableNo||''), items, amount:Number(amount||0), paymentKey, status, createdAt, cleared:false });
  res.json({ ok:true, id });
});
app.patch('/api/orders/:id', (req,res)=>{
  if(!authOk(req)) return res.status(401).send('unauthorized');
  const id = req.params.id;
  const { status, cleared } = req.body||{};
  ORDERS = ORDERS.map(o=> o.id===id? { ...o, ...(status!=null? {status}: {}), ...(cleared!=null? {cleared:!!cleared}: {}) }: o);
  res.json({ ok:true });
});

app.get('/api/qr', async (req,res)=>{
  try{
    const data = req.query.data||'';
    const size = req.query.size||'220x220';
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=${encodeURIComponent(size)}&data=${encodeURIComponent(data)}`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).send('qr upstream error');
    res.setHeader('Content-Type','image/png');
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  }catch(e){ res.status(500).send('qr error'); }
});

function defaultDailyCode(dateStr){
  const h = crypto.createHash('sha256').update((process.env.CODE_SECRET||'secret')+'|'+dateStr).digest('hex');
  return (parseInt(h.slice(0,8),16)%1000000).toString().padStart(6,'0');
}
app.get('/api/daily-code', (req,res)=>{
  const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const dateStr = d.toISOString().slice(0,10);
  res.json({ date: dateStr, code: defaultDailyCode(dateStr), override:false });
});
app.post('/api/daily-code/regen', (req,res)=>{
  if(!authOk(req)) return res.status(401).send('unauthorized');
  res.json({ ok:true });
});
app.post('/api/daily-code/clear', (req,res)=>{
  if(!authOk(req)) return res.status(401).send('unauthorized');
  res.json({ ok:true });
});

export default app;
