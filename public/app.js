const API = '/api';

const els = {
  tableInput: document.getElementById('tableInput'),
  codeInput: document.getElementById('codeInput'),
  menuList: document.getElementById('menuList'),
  sumPrice: document.getElementById('sumPrice'),
  btnPay: document.getElementById('btnPay'),
  doneModal: document.getElementById('doneModal'),
  doneOk: document.getElementById('doneOk'),
};

const params = new URLSearchParams(location.search);
const TABLE = params.get('table') || '';
if(!TABLE){ alert('QR에 테이블번호가 없습니다. 관리자에게 문의해주세요.'); }
els.tableInput.value = TABLE;

// local cart per table
const CART_KEY = 'qr_cart_'+TABLE;
let cart = loadCart();

function loadCart(){
  try{ return JSON.parse(localStorage.getItem(CART_KEY)||'{}'); }catch(_){ return {}; }
}
function saveCart(){ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function sum(){ return Object.values(cart).reduce((s,it)=> s + it.price*it.qty, 0); }
function won(x){ return (x||0).toLocaleString('ko-KR')+'원'; }
async function j(url,opt){ const r=await fetch(url,opt); if(!r.ok) throw new Error(await r.text()); return r.json(); }

async function loadMenu(){
  const list = await j(API + '/menu');
  els.menuList.innerHTML = '';
  for(const m of list){
    if(!cart[m.id]) cart[m.id] = { id:m.id, name:m.name, price:m.price, qty:0 };
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="item-name">${m.name}</div>
      <div class="item-price">${won(m.price)}</div>
      <div class="item-ctrl">
        <button class="btn sub">-</button>
        <span class="qty">${cart[m.id].qty}</span>
        <button class="btn add">+</button>
      </div>
    `;
    const qtyEl = row.querySelector('.qty');
    row.querySelector('.add').onclick = ()=>{ cart[m.id].qty++; qtyEl.textContent = cart[m.id].qty; saveCart(); renderTotal(); };
    row.querySelector('.sub').onclick = ()=>{ cart[m.id].qty=Math.max(0,cart[m.id].qty-1); qtyEl.textContent = cart[m.id].qty; saveCart(); renderTotal(); };
    els.menuList.appendChild(row);
  }
  renderTotal();
}

function renderTotal(){
  const total = sum();
  els.sumPrice.textContent = won(total);
  els.btnPay.disabled = total<=0;
}

async function verifyCode(){
  const input = (els.codeInput.value||'').trim();
  if(!/^[0-9]{4,6}$/.test(input)){ alert('코드를 4~6자리 숫자로 입력해주세요.'); return false; }
  const d = await j(API + '/daily-code');
  return String(input)===String(d.code);
}

els.btnPay.addEventListener('click', async ()=>{
  try{
    if(Object.values(cart).every(it=> it.qty===0)) return;
    const ok = await verifyCode();
    if(!ok){ alert('코드가 올바르지 않습니다.'); return; }
    const items = Object.values(cart).filter(it=> it.qty>0).map(it=> [it.id, it.qty]);
    const payload = { tableNo: TABLE, items, amount: sum() };
    await j(API + '/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    // success
    els.doneModal.classList.remove('hidden');
  }catch(e){
    alert('주문 오류: ' + (e.message||e));
  }
});

els.doneOk.addEventListener('click', ()=>{
  // reset cart and reload
  cart = {}; saveCart();
  location.href = location.pathname + location.search;
});

await loadMenu();
