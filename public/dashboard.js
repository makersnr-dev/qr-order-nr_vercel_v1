const tok = localStorage.getItem('adm_tok'); if(!tok){ location.href='/login.html'; }
const H = { 'Authorization':'Bearer '+tok, 'Content-Type':'application/json' };
const tabs = ['orders','menu','qr','stats','settings'];
document.querySelectorAll('.nav button').forEach(btn=>{ btn.onclick=()=>{ document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('primary')); btn.classList.add('primary'); tabs.forEach(t=> document.getElementById('tab-'+t).style.display=(btn.dataset.tab===t)?'block':'none'); }; });
document.getElementById('btnLogout').onclick=()=>{ localStorage.removeItem('adm_tok'); location.href='/login.html'; };

// ORDERS
const tb = document.querySelector('#ordersTable tbody');
async function loadOrders(){ const r=await fetch('/api/adb/orders'); const arr=await r.json(); document.getElementById('ordersCount').textContent=arr.length; tb.innerHTML=''; for(const o of arr){ const tr=document.createElement('tr'); const items=(o.items||[]).map(it=>`${it[0]} x ${it[1]}`).join(', '); tr.innerHTML=`
  <td>${new Date(o.created_at||o.createdAt).toLocaleString()}</td>
  <td>${o.table_no||o.tableNo}</td>
  <td>${items}</td>
  <td>${(o.amount||0).toLocaleString('ko-KR')}원</td>
  <td><select class="status">${['접수','준비중','완료','취소','환불'].map(s=>`<option ${s===(o.status||'')?'selected':''}>${s}</option>`).join('')}</select></td>
  <td><input type="checkbox" class="clear" ${o.cleared?'checked':''}></td>
  <td><button class="btn danger refund">환불</button></td>`;
  tr.querySelector('.status').onchange=async(e)=>{ await fetch('/api/adb/orders/'+encodeURIComponent(o.id),{method:'PATCH',headers:H,body:JSON.stringify({status:e.target.value})}); await loadOrders(); };
  tr.querySelector('.clear').onchange=async(e)=>{ await fetch('/api/adb/orders/'+encodeURIComponent(o.id),{method:'PATCH',headers:H,body:JSON.stringify({cleared:e.target.checked})}); };
  tr.querySelector('.refund').onclick=async()=>{ const amount=prompt('환불 금액(전체 환불은 비우기)'); const body=amount?{paymentKey:o.payment_key,amount:Number(amount)||undefined}:{paymentKey:o.payment_key}; const r=await fetch('/api/adb/refund',{method:'POST',headers:H,body:JSON.stringify(body)}); if(!r.ok){alert('환불 실패: '+await r.text());} else {alert('환불 완료'); await loadOrders();}};
  tb.appendChild(tr);} }
document.getElementById('refreshOrders').onclick=loadOrders;
document.getElementById('btnSync').onclick=async()=>{ await fetch('/api/adb/sync/orders',{method:'POST'}); await loadOrders(); };

// MENU
const mtb = document.querySelector('#menuTable tbody');
async function loadMenu(){ const r=await fetch('/api/adb/menu'); const arr=await r.json(); mtb.innerHTML=''; for(const m of arr){ const tr=document.createElement('tr'); tr.innerHTML=`
  <td>${m.id}</td>
  <td><input value="${m.name}"/></td>
  <td><input type="number" value="${m.price}"/></td>
  <td><input type="checkbox" ${m.soldout?'checked':''}/></td>
  <td><input type="checkbox" ${m.active?'checked':''}/></td>
  <td><button class="btn accent">저장</button></td>`;
  tr.querySelector('button').onclick=async()=>{ const name=tr.children[1].querySelector('input').value; const price=Number(tr.children[2].querySelector('input').value); const soldout=tr.children[3].querySelector('input').checked; const active=tr.children[4].querySelector('input').checked; const r=await fetch('/api/adb/menu/'+encodeURIComponent(m.id),{method:'PATCH',headers:H,body:JSON.stringify({name,price,soldout,active})}); if(!r.ok){alert('저장 실패: '+await r.text());} else {alert('저장됨');} }; mtb.appendChild(tr);} }
document.getElementById('refreshMenu').onclick=loadMenu;

// Add menu
document.getElementById('btnAddMenu').onclick=async()=>{
  const id=(document.getElementById('addMenuId').value||'').trim();
  const name=(document.getElementById('addMenuName').value||'').trim();
  const price=Number(document.getElementById('addMenuPrice').value||0);
  const soldout=document.getElementById('addMenuSoldout').checked;
  const active=document.getElementById('addMenuActive').checked;
  if(!id||!name||!price){ alert('ID/이름/가격을 입력해주세요.'); return; }
  const r=await fetch('/api/adb/menu',{method:'POST',headers:H,body:JSON.stringify({id,name,price,soldout,active})});
  if(!r.ok){ alert('추가 실패: '+await r.text()); } else { alert('추가됨'); document.getElementById('addMenuId').value=''; document.getElementById('addMenuName').value=''; document.getElementById('addMenuPrice').value=''; document.getElementById('addMenuSoldout').checked=false; document.getElementById('addMenuActive').checked=true; await loadMenu(); }
};

// QR
const orderDomain=document.getElementById('orderDomain'); const tableNo=document.getElementById('tableNo');
document.getElementById('genQR').onclick=()=>{ const url=`${(orderDomain.value||'').replace(/\/$/,'')}/?table=${encodeURIComponent(tableNo.value||'')}`; const img=new Image(); img.src=`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`; const wrap=document.getElementById('qrWrap'); wrap.innerHTML=''; wrap.appendChild(img); };
document.getElementById('saveQR').onclick=async()=>{ const url=`${(orderDomain.value||'').replace(/\/$/,'')}/?table=${encodeURIComponent(tableNo.value||'')}`; const r=await fetch('/api/adb/qr-history',{method:'POST',headers:H,body:JSON.stringify({url,tableNo:tableNo.value||''})}); if(!r.ok){alert('저장 실패: '+await r.text());} else {alert('저장됨');}};

// Code cache
document.getElementById('cacheCode').onclick=async()=>{ const r=await fetch('/api/adb/daily-code'); const j=await r.json(); document.getElementById('codeMsg').textContent=`저장됨 - ${j.date} : ${j.code}`; };

// Stats
const ctx=document.getElementById('chart').getContext('2d');
function drawChart(rows){ const w=ctx.canvas.width=ctx.canvas.clientWidth; const h=ctx.canvas.height=ctx.canvas.clientHeight; ctx.clearRect(0,0,w,h); if(!rows.length)return; const max=Math.max(...rows.map(r=>Number(r.total||0))); const pad=20, iw=w-pad*2, ih=h-pad*2; const step=iw/Math.max(1,rows.length-1); ctx.strokeStyle='#5b8cff'; ctx.lineWidth=2; ctx.beginPath(); rows.forEach((r,i)=>{ const x=pad+i*step; const y=pad+ih-(Number(r.total||0)/max)*ih; if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.stroke(); }
async function loadStats(){ const period=document.getElementById('period').value; const r=await fetch('/api/adb/stats/sales?period='+encodeURIComponent(period)); const rows=await r.json(); const tb=document.querySelector('#statsTable tbody'); tb.innerHTML=''; rows.forEach(row=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${new Date(row.bucket).toLocaleDateString()}</td><td>${row.orders}</td><td>${Number(row.total||0).toLocaleString('ko-KR')}원</td>`; tb.appendChild(tr); }); drawChart(rows.slice().reverse()); }
document.getElementById('loadStats').onclick=loadStats;

// init
loadOrders(); loadMenu(); loadStats();
