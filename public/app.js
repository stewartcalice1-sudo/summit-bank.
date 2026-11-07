const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let token = localStorage.getItem('summit_token');
let me = null, accounts = [], dashboard = null, toastTimer;
const titles = {settings:'Settings',overview:'Overview',accounts:'My accounts',transfers:'Transfers',payments:'Send money',activity:'Activity',statements:'Statements',notifications:'Notifications',admin:'Administration'};
function api(path, options={}) {
  return fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(options.headers||{})}})
    .then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d;});
}
function money(v){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0));}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3000);}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setAuth(mode){$$('[data-auth]').forEach(b=>b.classList.toggle('active',b.dataset.auth===mode));$('#loginForm').classList.toggle('hidden',mode!=='login');$('#registerForm').classList.toggle('hidden',mode!=='register');}
$$('[data-auth]').forEach(b=>b.addEventListener('click',()=>setAuth(b.dataset.auth)));
function showApp(){ $('#authView').classList.add('hidden');$('#appView').classList.remove('hidden'); }
function showAuth(){ $('#appView').classList.add('hidden');$('#authView').classList.remove('hidden'); }
function logout(){localStorage.removeItem('summit_token');token=null;me=null;showAuth();}
$('#logoutBtn').addEventListener('click',logout);
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{const d=await api('/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});token=d.token;localStorage.setItem('summit_token',token);await boot();}catch(err){$('#loginMessage').textContent=err.message;}});
$('#registerForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{const d=await api('/auth/register',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});token=d.token;localStorage.setItem('summit_token',token);await boot();}catch(err){$('#registerMessage').textContent=err.message;}});
function navigate(page){if(page==='admin'&&me?.role!=='admin')return;$$('.page').forEach(p=>p.classList.add('hidden'));$(`#page-${page}`)?.classList.remove('hidden');$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#pageTitle').textContent=titles[page]||'Overview';if(page==='activity')loadActivity();if(page==='statements')loadStatements();if(page==='notifications')loadNotifications();if(page==='admin')loadAdmin();if(page==='settings')setupCustomerAddMoney();window.scrollTo(0,0);}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
function accountCard(a){return `<article class="account-card"><div class="account-top"><div class="account-icon">${a.type==='checking'?'▤':'◈'}</div><span class="account-type">${esc(a.type.toUpperCase())}</span></div><h3>${esc(a.nickname)}</h3><div class="account-number">${esc(a.accountNumber)}</div><div class="account-balance">${money(a.balance)}</div></article>`;}
function activityRow(t){const amount=Number(t.amount||0);const incoming=t.direction==='credit';return `<div class="activity-row"><div class="activity-icon">${t.type==='p2p_payment'?'↗':incoming?'↓':'↑'}</div><div class="activity-main"><b>${esc(t.description)}</b><small>${esc(t.createdAt||t.created_at||'')} · ${esc(t.reference)} · ${esc(t.status)}</small></div><div class="activity-amount ${incoming?'positive':'negative'}">${incoming?'+':'−'}${money(amount)}<small>${esc(t.nickname||t.account||'Account')}</small></div></div>`;}
async function refreshDashboard(){dashboard=await api('/dashboard');accounts=dashboard.accounts;$('#totalBalance').textContent=money(dashboard.totalBalance);$('#overviewAccounts').innerHTML=accounts.filter(a=>!['System Clearing','Payment Clearing'].includes(a.nickname)).map(accountCard).join('')||'<div class="empty-state">Your accounts will appear here.</div>';$('#allAccounts').innerHTML=accounts.filter(a=>!['System Clearing','Payment Clearing'].includes(a.nickname)).map(accountCard).join('');$('#recentActivity').innerHTML=dashboard.transactions.map(activityRow).join('')||'<div class="empty-state">No account activity yet.</div>';const unread=dashboard.notifications.some(n=>!n.read_at);$('#notificationDot').classList.toggle('hidden',!unread);fillAccountSelects();}
function fillAccountSelects(){const visible=accounts.filter(a=>!['System Clearing','Payment Clearing'].includes(a.nickname));const opts=visible.map(a=>`<option value="${a.id}">${esc(a.nickname)} · ${money(a.balance)}</option>`).join('');['#transferForm [name=fromAccountId]','#transferForm [name=toAccountId]','#paymentForm [name=fromAccountId]','#statementAccount'].forEach(s=>{const el=$(s);if(el){const old=el.value;el.innerHTML=opts;if([...el.options].some(o=>o.value===old))el.value=old;}});}
async function boot(){try{const d=await api('/me');me=d.user;$('#userName').textContent=me.name;$('#userEmail').textContent=me.email;$('#avatar').textContent=me.name[0].toUpperCase();$('#topAvatar').textContent=me.name[0].toUpperCase();$('#welcomeName').textContent=me.name.split(' ')[0];$$('.admin-only').forEach(e=>e.classList.toggle('hidden',me.role!=='admin'));showApp();await refreshDashboard();navigate('overview');}catch{logout();}}
$('#transferForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const body={fromAccountId:Number(f.get('fromAccountId')),toAccountId:Number(f.get('toAccountId')),amount:Number(f.get('amount')),note:f.get('note')};try{const d=await api('/transfer',{method:'POST',body:JSON.stringify(body)});e.target.reset();await refreshDashboard();toast(`Transfer complete · ${d.transaction.reference}`);}catch(err){e.target.querySelector('.form-message').textContent=err.message;}});
$('#paymentForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const body={fromAccountId:Number(f.get('fromAccountId')),recipientName:f.get('recipientName'),destination:f.get('destination'),destinationType:f.get('destinationType'),amount:Number(f.get('amount')),memo:f.get('memo')};try{const d=await api('/payments/send',{method:'POST',body:JSON.stringify(body)});await refreshDashboard();showConfirmation(d.confirmation);e.target.reset();}catch(err){e.target.querySelector('.form-message').textContent=err.message;}});
function showConfirmation(c){
  const rawDate = c.createdAt || new Date().toISOString();
  const timestamp = new Date(
    rawDate.includes('Z') || /[+-]\d\d:\d\d$/.test(rawDate)
      ? rawDate
      : rawDate.replace(' ','T') + 'Z'
  );

  const dateText = timestamp.toLocaleDateString('en-US',{
    year:'numeric',month:'long',day:'numeric'
  });

  const timeText = timestamp.toLocaleTimeString('en-US',{
    hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'
  });

  const detail = (label,value) =>
    `<div class="confirm-line"><span>${esc(label)}</span><b>${esc(value || '—')}</b></div>`;

  $('#modalContent').innerHTML = `
    <div class="zelle-confirm-brand" aria-label="Zelle branded payment confirmation">
      <span>Zelle</span><sup>®</sup>
    </div>

    <p class="eyebrow">PAYMENT CONFIRMATION</p>
    <h2>Your payment is complete.</h2>

    <div class="confirm-amount">${money(c.amount)}</div>

    <div class="confirm-details">
      ${detail('Recipient',c.recipient)}
      ${detail('Sender',c.sender)}
      ${detail('Recipient contact',c.destination)}
      ${detail('Transaction type',c.transactionType)}
      ${detail('Payment method',c.paymentMethod)}
      ${c.memo ? detail('Memo',c.memo) : ''}
      ${detail('Transaction date',dateText)}
      ${detail('Transaction time',timeText)}
      ${detail('Status','Completed')}
      ${detail('Confirmation reference',c.reference)}
    </div>

    <p class="confirm-disclaimer">
      Zelle® is a registered trademark of Early Warning Services, LLC.
      Summit Bank is not affiliated with the Zelle network. This is a simulated payment.
    </p>

    <button class="btn primary" id="confirmDone">Done</button>
  `;

  $('#modal').classList.remove('hidden');
  $('#confirmDone').addEventListener('click',()=>{
    $('#modal').classList.add('hidden');
  });
}
$('#modalClose').addEventListener('click',()=>$('#modal').classList.add('hidden'));$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')$('#modal').classList.add('hidden');});
$('#newAccountBtn').addEventListener('click',()=>{$('#modalContent').innerHTML=`<p class="eyebrow">ACCOUNT SERVICES</p><h2>Open an account</h2><form id="newAccountForm"><label>Account type<select name="type"><option value="checking">Checking</option><option value="savings">Savings</option></select></label><label>Account nickname<input name="nickname" required minlength="2" maxlength="40" value="New account"></label><button class="btn primary">Create account</button><p class="form-message"></p></form>`;$('#modal').classList.remove('hidden');$('#newAccountForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('/accounts',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});$('#modal').classList.add('hidden');await refreshDashboard();toast('Account created.');}catch(err){e.target.querySelector('.form-message').textContent=err.message;}});});
async function loadActivity(){const d=await api('/transactions');const rows=d.transactions.flatMap(t=>t.entries.map(e=>({...t,...e,amount:e.amount,createdAt:t.createdAt})));$('#allActivity').innerHTML=rows.map(activityRow).join('')||'<div class="empty-state">No transactions to display.</div>';}
async function loadStatements(){fillAccountSelects();$('#statementAccount').onchange=renderStatement;await renderStatement();}
let currentStatement=[];
async function renderStatement(){const id=$('#statementAccount').value;if(!id)return;const d=await api(`/statements?accountId=${id}`);currentStatement=d.statement;$('#statementRows').innerHTML=currentStatement.map(r=>activityRow({...r,amount:r.amount,createdAt:r.created_at,nickname:'Statement'})).join('')||'<div class="empty-state">No statement activity.</div>';}
$('#downloadStatement').addEventListener('click',()=>{const rows=[['Date','Reference','Type','Status','Description','Direction','Amount'],...currentStatement.map(r=>[r.created_at,r.reference,r.type,r.status,r.description,r.direction,r.amount])];const csv=rows.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='summit-statement.csv';a.click();URL.revokeObjectURL(url);});
async function loadNotifications(){const d=await api('/notifications');$('#notificationsList').innerHTML=d.notifications.map(n=>`<div class="activity-row"><div class="activity-icon">♧</div><div class="activity-main"><b>${esc(n.title)}</b><small>${esc(n.body)} · ${esc(n.created_at)}</small></div>${n.read_at?'':'<button class="text-btn" data-read="'+n.id+'">Mark read</button>'}</div>`).join('')||'<div class="empty-state">You are all caught up.</div>';$$('[data-read]').forEach(b=>b.addEventListener('click',async()=>{await api(`/notifications/${b.dataset.read}/read`,{method:'POST'});loadNotifications();}));}
async function loadAdmin(){const [o,c,t]=await Promise.all([api('/admin/overview'),api('/admin/customers'),api('/admin/transactions')]);$('#adminStats').innerHTML=[['Customers',o.customers],['Accounts',o.accounts],['Ledger transactions',o.transactions]].map(x=>`<div class="stat-card"><small>${x[0]}</small><b>${x[1]}</b></div>`).join('');$('#adminCustomers').innerHTML=`<table><thead><tr><th>Name</th><th>Email</th><th>Accounts</th><th>Status</th><th>Control</th></tr></thead><tbody>${c.customers.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.account_count}</td><td><span class="status-pill">${esc(u.status)}</span></td><td><select data-status="${u.id}"><option value="active" ${u.status==='active'?'selected':''}>Active</option><option value="restricted" ${u.status==='restricted'?'selected':''}>Restricted</option><option value="closed" ${u.status==='closed'?'selected':''}>Closed</option></select></td></tr>`).join('')}</tbody></table>`;$$('[data-status]').forEach(s=>s.addEventListener('change',async()=>{try{await api(`/admin/customers/${s.dataset.status}/status`,{method:'PATCH',body:JSON.stringify({status:s.value})});toast('Customer status updated.');}catch(e){toast(e.message);}}));$('#adminTransactions').innerHTML=`<table><thead><tr><th>Reference</th><th>Type</th><th>Status</th><th>Description</th><th>Created</th></tr></thead><tbody>${t.transactions.map(x=>`<tr><td>${esc(x.reference)}</td><td>${esc(x.type)}</td><td>${esc(x.status)}</td><td>${esc(x.description)}</td><td>${esc(x.created_at)}</td></tr>`).join('')}</tbody></table>`;$('#adminLogs').innerHTML=`<table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>${o.logs.map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.actor_id)}</td><td>${esc(x.action)}</td><td>${esc(x.entity_type)} ${esc(x.entity_id)}</td><td>${esc(x.details)}</td></tr>`).join('')}</tbody></table>`;}
if(token)boot();else showAuth();


function setupCustomerAddMoney() {
  const form = document.querySelector('#customerAddMoneyForm');
  if (!form) return;

  const select = document.querySelector('#customerDepositAccount');
  const amount = document.querySelector('#customerDepositAmount');
  const message = document.querySelector('#customerDepositMessage');

  const ownAccounts = (accounts || []).filter(a =>
    !['System Clearing','Payment Clearing','Opening Funding Clearing','Admin Funding Clearing'].includes(a.nickname)
  );

  select.innerHTML = ownAccounts.map(a =>
    `<option value="${a.id}">${esc(a.nickname || a.type || 'Account')}</option>`
  ).join('');

  if (!ownAccounts.length) {
    select.innerHTML = '<option value="">No eligible accounts found</option>';
  }

  form.onsubmit = async event => {
    event.preventDefault();
    message.textContent = '';
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
      const result = await api('/activity/deposit', {
        method: 'POST',
        body: JSON.stringify({
          accountId: Number(select.value),
          amount: Number(amount.value),
          description: 'Customer simulated deposit'
        })
      });
      message.textContent = 'Simulated deposit recorded successfully.';
      amount.value = '';
      await refreshDashboard();
      toast('Deposit recorded.');
    } catch (error) {
      message.textContent = error.message || 'Unable to record deposit.';
    } finally {
      button.disabled = false;
    }
  };
}
