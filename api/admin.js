import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import { migrate, withClient } from '../db.js';

dotenv.config();
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const API_BASE = (process.env.API_BASE||'').replace(/\/$/,'');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD||'admin';

function auth(req,res,next){
  const hdr = req.headers['authorization']||'';
  const tok = hdr.startsWith('Bearer ')? hdr.slice(7): hdr;
  if(tok===ADMIN_PASSWORD) return next();
  res.status(401).send('unauthorized');
}

app.get('/api/healthz', (_req,res)=> res.type('text/plain').send('ok'));
app.post('/api/auth/login', (req,res)=>{
  const { password } = req.body||{};
  if(String(password)!==ADMIN_PASSWORD) return res.status(401).send('bad password');
  res.json({ token: ADMIN_PASSWORD });
});

await migrate();

app.post('/api/adb/sync/orders', async (_req,res)=>{
  try{
    const r = await fetch(API_BASE + '/api/orders?includeCleared=1');
    if(!r.ok) return res.status(502).send('order api fail');
    const arr = await r.json();
    for(const o of arr){
      await withClient(c=> c.query(`
        insert into admin_orders(id, order_id, table_no, amount, status, created_at, cleared, payment_key, items, refunded_at)
        values($1,$2,$3,$4,$5,coalesce($6,now()),$7,$8,$9,$10)
        on conflict (id) do update set order_id=excluded.order_id, table_no=excluded.table_no, amount=excluded.amount, status=excluded.status, created_at=excluded.created_at, cleared=excluded.cleared, payment_key=excluded.payment_key, items=excluded.items, refunded_at=excluded.refunded_at
      `, [o.id, o.orderId||null, String(o.tableNo||''), Number(o.amount||0), String(o.status||'접수'), o.createdAt? new Date(o.createdAt): null, !!o.cleared, o.paymentKey||'', JSON.stringify(o.items||[]), o.refundedAt? new Date(o.refundedAt): null ]));
    }
    res.json({ ok:true, count: arr.length });
  }catch(e){ console.error(e); res.status(500).json({ ok:false, error:String(e) }); }
});

app.get('/api/adb/orders', async (_req,res)=>{
  try{ const rows = await withClient(c=> c.query('select * from admin_orders order by created_at desc')); res.json(rows.rows); }
  catch(e){ res.status(500).json([]); }
});

app.patch('/api/adb/orders/:id', auth, async (req,res)=>{
  try{
    const id = req.params.id;
    const { status, cleared } = req.body||{};
    await withClient(c=> c.query('update admin_orders set status=coalesce($2,status), cleared=coalesce($3,cleared) where id=$1',[id, status, cleared]));
    await fetch(API_BASE + '/api/orders/'+encodeURIComponent(id), { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+ADMIN_PASSWORD }, body: JSON.stringify({ status, cleared }) });
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.post('/api/adb/refund', auth, async (req,res)=>{
  try{
    const { paymentKey, amount, reason='관리자 환불' } = req.body||{};
    if(!paymentKey) return res.status(400).send('paymentKey required');
    const r = await fetch(API_BASE + '/api/toss/refund', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ paymentKey, cancelAmount: amount, cancelReason: reason }) });
    if(!r.ok){ const t=await r.text(); return res.status(r.status).send(t); }
    const json = await r.json();
    res.json({ ok:true, payload: json });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.get('/api/adb/menu', async (_req,res)=>{
  try{
    const r = await fetch(API_BASE + '/api/menu');
    if(!r.ok) return res.status(502).send('order api fail');
    const arr = await r.json();
    for(const m of arr){
      await withClient(c=> c.query(`
        insert into admin_menus(id,name,price,active,soldout,updated_at)
        values($1,$2,$3,$4,$5,now())
        on conflict (id) do update set name=excluded.name, price=excluded.price, active=excluded.active, soldout=excluded.soldout, updated_at=now()
      `, [m.id, m.name, Number(m.price||0), !!m.active, !!m.soldout]));
    }
    const out = await withClient(c=> c.query('select * from admin_menus order by name'));
    res.json(out.rows);
  }catch(e){ res.status(500).json([]); }
});

app.post('/api/adb/menu', auth, async (req,res)=>{
  try{
    const r = await fetch(API_BASE + '/api/menu', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+ADMIN_PASSWORD }, body: JSON.stringify(req.body||{})
    });
    if(!r.ok){ const t = await r.text(); return res.status(r.status).send(t); }
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.patch('/api/adb/menu/:id', auth, async (req,res)=>{
  try{
    const id = req.params.id;
    const r = await fetch(API_BASE + '/api/menu/'+encodeURIComponent(id), {
      method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+ADMIN_PASSWORD }, body: JSON.stringify(req.body||{})
    });
    if(!r.ok){ const t = await r.text(); return res.status(r.status).send(t); }
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.post('/api/adb/qr-history', auth, async (req,res)=>{
  try{
    const { url, tableNo } = req.body||{};
    if(!url) return res.status(400).send('url required');
    const t = tableNo || (new URL(url).searchParams.get('table')||null);
    await withClient(c=> c.query('insert into admin_qr_history(url, table_no) values($1,$2)', [url, t]));
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.get('/api/adb/daily-code', async (_req,res)=>{
  try{
    const r = await fetch(API_BASE + '/api/daily-code');
    if(!r.ok) return res.status(502).send('order api fail');
    const j = await r.json();
    await withClient(c=> c.query('insert into admin_daily_codes(code_date,code,override,saved_at) values($1,$2,$3,now()) on conflict (code_date) do update set code=$2, override=$3, saved_at=now()', [j.date, j.code, !!j.override]));
    res.json(j);
  }catch(e){ res.status(500).json({}); }
});

app.get('/api/adb/export/orders.xlsx', async (_req,res)=>{
  try{
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('orders');
    ws.addRow(['createdAt','table','status','amount','items','paymentKey']);
    const rows = await withClient(c=> c.query('select * from admin_orders order by created_at desc'));
    for(const o of rows.rows){
      const items = (o.items||[]).map(it=> `${it[0]} x ${it[1]}`).join(', ');
      ws.addRow([o.created_at, o.table_no, o.status, o.amount, items, o.payment_key]);
    }
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="orders.xlsx"');
    await wb.xlsx.write(res); res.end();
  }catch(e){ res.status(500).send('export error'); }
});

app.get('/api/adb/stats/sales', async (req,res)=>{
  try{
    const period = (req.query.period||'daily');
    let grp = "date_trunc('day', created_at)"; 
    if(period==='weekly') grp = "date_trunc('week', created_at)";
    if(period==='monthly') grp = "date_trunc('month', created_at)";
    if(period==='yearly') grp = "date_trunc('year', created_at)";
    const sql = `select ${grp} as bucket, sum(amount) as total, count(*) as orders from admin_orders where status not in ('환불','취소') group by 1 order by 1 desc limit 120`;
    const rows = await withClient(c=> c.query(sql));
    res.json(rows.rows);
  }catch(e){ res.status(500).json([]); }
});

export default app;
