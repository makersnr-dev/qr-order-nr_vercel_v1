export const API = '/api';

const els = {
  menuList: document.getElementById('menuList'),
  cartItems: document.getElementById('cartItems'),
  cartTotal: document.getElementById('cartTotal'),
  btnCheckout: document.getElementById('btnCheckout'),
  tableLabel: document.getElementById('tableLabel'),
  recentOrders: document.getElementById('recentOrders'),
  codeModal: document.getElementById('codeModal'),
  codeInput: document.getElementById('codeInput'),
  codeCancel: document.getElementById('codeCancel'),
  codeOk: document.getElementById('codeOk'),
  doneModal: document.getElementById('doneModal'),
  doneOk: document.getElementById('doneOk'),
};

const params = new URLSearchParams(location.search);
const TABLE = params.get('table') || '';
if(!TABLE){ alert('QR에 테이블번호가 없습니다. 관리자에게 문의해주세요.'); }
els.tableLabel.textContent = '테이블 ' + (TABLE || '-');

const CART_KEY = 'qr_cart_'+TABLE;
let cart = loadCart();

function loadCart(){
  try{ return JSON.parse(localStorage.getItem(CART_KEY)||'[]'); }catch(_){ return []; }
}
function saveCart(){ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function format(x){ return (x||0).toLocaleString('ko-KR')+'원'; }
async function fetchJSON(url, opt){ const r = await fetch(url, opt); if(!r.ok) throw new Error(await r.text()); return r.json(); }

async function loadMenu(){
  const list = await fetchJSON(API + '/menu');
  els.menuList.innerHTML = '';
  for(const m of list){
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${m.name} ${m.soldout? '<span class="badge">품절</span>':''}</h3>
      <div class="price">${format(m.price)}</div>
      <button class="btn add" ${m.soldout? 'disabled':''}>담기</button>
    `;
    card.querySelector('.add')?.addEventListener('click', ()=> addToCart(m));
    els.menuList.appendChild(card);
  }
}
function addToCart(m){
  const idx = cart.findIndex(x=> x.id===m.id);
  if(idx>=0) cart[idx].qty++;
  else cart.push({ id:m.id, name:m.name, price:m.price, qty:1 });
  saveCart(); renderCart();
}
function renderCart(){
  els.cartItems.innerHTML = '';
  let total = 0;
  for(const item of cart){
    total += item.price * item.qty;
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <div class="name">${item.name}</div>
      <div class="controls">
        <button class="btn sm dec">-</button>
        <span>${item.qty}</span>
        <button class="btn sm inc">+</button>
        <button class="btn sm rm">삭제</button>
      </div>
    `;
    row.querySelector('.dec').onclick = ()=>{ item.qty=Math.max(1, item.qty-1); saveCart(); renderCart(); };
    row.querySelector('.inc').onclick = ()=>{ item.qty++; saveCart(); renderCart(); };
    row.querySelector('.rm').onclick  = ()=>{ cart = cart.filter(x=> x!==item); saveCart(); renderCart(); };
    els.cartItems.appendChild(row);
  }
  els.cartTotal.textContent = format(total);
}
async function loadRecent(){
  try{
    const arr = await fetchJSON(API + '/orders?table=' + encodeURIComponent(TABLE));
    els.recentOrders.innerHTML = '';
    if(arr.length===0){ els.recentOrders.innerHTML = '<div class="muted">최근 주문이 없습니다.</div>'; return; }
    for(const o of arr.slice().reverse()){
      const di = document.createElement('div');
      const total = (o.amount||0).toLocaleString('ko-KR');
      di.innerHTML = `<div class="line"><span>${new Date(o.createdAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</span><span class="badge">${o.status}</span></div>
      <div class="muted">${(o.items||[]).map(it=> it[0]+' x '+it[1]).join(', ')}</div>
      <div class="line"><span></span><strong>${total}원</strong></div>`;
      els.recentOrders.appendChild(di);
    }
  }catch(e){ els.recentOrders.innerHTML = '<div class="muted">주문 목록을 불러오지 못했습니다.</div>'; }
}
async function verifyDailyCode(inputCode){
  const j = await fetchJSON(API + '/daily-code');
  return String(inputCode||'').trim() === String(j.code||'').trim();
}
function openModal(el){ el.classList.remove('hidden'); }
function closeModal(el){ el.classList.add('hidden'); }
els.btnCheckout.addEventListener('click', ()=>{
  if(cart.length===0){ alert('장바구니가 비어 있습니다.'); return; }
  els.codeInput.value=''; openModal(els.codeModal);
});
els.codeCancel.addEventListener('click', ()=> closeModal(els.codeModal));
els.codeOk.addEventListener('click', async ()=>{
  const ok = await verifyDailyCode(els.codeInput.value);
  if(!ok){ alert('코드가 올바르지 않습니다.'); return; }
  closeModal(els.codeModal); await placeOrder();
});
els.doneOk.addEventListener('click', ()=>{ closeModal(els.doneModal); location.href = location.pathname + location.search; });
async function placeOrder(){
  const amount = cart.reduce((s,x)=> s + x.price*x.qty, 0);
  const items = cart.map(x=> [x.id, x.qty]);
  const payload = { tableNo: TABLE, items, amount };
  try{
    await fetchJSON(API + '/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    openModal(els.doneModal); cart = []; saveCart(); renderCart(); loadRecent();
  }catch(e){ alert('주문 중 오류: ' + (e.message||e)); }
}
await loadMenu(); renderCart(); await loadRecent();
