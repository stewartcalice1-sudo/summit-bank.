require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { db, balanceCents, createAccount, audit } = require('./db');
const { post, transfer, reference } = require('./ledger');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  console.warn('WARNING: Set SESSION_SECRET in .env before deployment.');
}
const secret = SECRET || 'local-development-secret-change-before-deployment-000';
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static('public'));
app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false }));

function money(cents) { return (cents/100).toFixed(2); }
function cents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000000) throw new Error('Enter an amount greater than $0 and no more than $10,000.');
  const n = Math.round(value*100);
  if (Math.abs(n/100-value) > 0.000001) throw new Error('Use no more than two decimal places.');
  return n;
}
function tokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '8h', issuer: 'summit-bank' });
}
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  try {
    const payload = jwt.verify(token, secret, { issuer: 'summit-bank' });
    const user = db.prepare('SELECT id,name,email,role,status FROM users WHERE id=?').get(payload.sub);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account unavailable.' });
    req.user = user; next();
  } catch { return res.status(401).json({ error: 'Please sign in again.' }); }
}
function admin(req,res,next) { if (req.user.role !== 'admin') return res.status(403).json({error:'Administrator access required.'}); next(); }
function fail(res,err) { return res.status(400).json({ error: err.message || 'Request could not be completed.' }); }
function ownAccount(userId, accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(accountId,userId);
}
function notify(userId,title,body) {
  db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(userId,title,body);
}
function accountView(a) {
  const balance = balanceCents(a.id);
  return { id:a.id, type:a.type, nickname:a.nickname, accountNumber:`•••• ${a.account_number.slice(-4)}`, status:a.status, currency:a.currency, balance:money(balance), balanceCents:balance };
}


// Investor demonstration opening balances. These are simulated funds.
function seedOpeningBalances(userId) {
  const checking = db.prepare(
    "SELECT * FROM accounts WHERE user_id=? AND type='checking' ORDER BY id LIMIT 1"
  ).get(userId);
  const savings = db.prepare(
    "SELECT * FROM accounts WHERE user_id=? AND type='savings' AND nickname!='Opening Funding Clearing' ORDER BY id LIMIT 1"
  ).get(userId);

  if (!checking || !savings) return;

  const hasCheckingEntries = db.prepare(
    "SELECT COUNT(*) n FROM ledger_entries WHERE account_id=?"
  ).get(checking.id).n;
  const hasSavingsEntries = db.prepare(
    "SELECT COUNT(*) n FROM ledger_entries WHERE account_id=?"
  ).get(savings.id).n;

  if (hasCheckingEntries || hasSavingsEntries) return;

  let clearing = db.prepare(
    "SELECT * FROM accounts WHERE user_id=? AND nickname='Opening Funding Clearing' LIMIT 1"
  ).get(userId);

  if (!clearing) {
    clearing = { id: createAccount(userId, 'savings', 'Opening Funding Clearing') };
  }

  const fund = db.transaction(() => {
    post({
      type: 'opening_demo_funding',
      description: 'Simulated opening checking balance',
      actorId: userId,
      metadata: { simulation: true, purpose: 'investor demonstration' },
      entries: [
        { accountId: clearing.id, direction: 'debit', amountCents: 10000000 },
        { accountId: checking.id, direction: 'credit', amountCents: 10000000 }
      ]
    });

    post({
      type: 'opening_demo_funding',
      description: 'Simulated opening savings balance',
      actorId: userId,
      metadata: { simulation: true, purpose: 'investor demonstration' },
      entries: [
        { accountId: clearing.id, direction: 'debit', amountCents: 5000000 },
        { accountId: savings.id, direction: 'credit', amountCents: 5000000 }
      ]
    });
  });

  fund();
  notify(userId, 'Opening balances recorded',
    'Your simulated checking and savings opening balances total $150,000.00.');
  audit(userId, 'demo.opening_balances.seeded', 'user', userId,
    { checking: 100000, savings: 50000 });
}

// Bootstrap administrator from environment on first run.
const adminEmail = process.env.ADMIN_EMAIL || 'admin@summit.local';
const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeThisAdminPassword123!';
if (!db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES('Summit Administrator',?,?, 'admin')").run(adminEmail,hash);
  console.log(`Initial administrator created: ${adminEmail}. Change its password after first login.`);
}


// One-time seed for existing, previously unfunded customer accounts.
for (const customer of db.prepare("SELECT id FROM users WHERE role='customer' AND status='active'").all()) {
  seedOpeningBalances(customer.id);
}

app.get('/api/health', (_req,res) => res.json({ status:'ok', service:'Summit Bank', mode:'simulated-ledger' }));

app.post('/api/auth/register', (req,res) => {
  try {
    const schema = z.object({ name:z.string().trim().min(2).max(80), email:z.string().email().max(160), phone:z.string().trim().max(30).optional().default(''), password:z.string().min(10).max(100) });
    const input = schema.parse(req.body);
    if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) return res.status(409).json({error:'An account with this email already exists.'});
    const hash = bcrypt.hashSync(input.password,12);
    const create = db.transaction(() => {
      const userId = db.prepare('INSERT INTO users(name,email,phone,password_hash) VALUES(?,?,?,?)').run(input.name,input.email,input.phone,hash).lastInsertRowid;
      createAccount(userId,'checking','Everyday Checking');
      createAccount(userId,'savings','Summit Savings');
      seedOpeningBalances(userId);
      audit(userId,'customer.registered','user',userId);
      notify(userId,'Welcome to Summit Bank','Your account workspace is ready.');
      return db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(userId);
    });
    const user = create();
    res.status(201).json({ token:tokenFor(user), user });
  } catch(e) { fail(res,e); }
});
app.post('/api/auth/login', (req,res) => {
  try {
    const input = z.object({ email:z.string().email(), password:z.string().min(1) }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(input.email);
    if (!user || !bcrypt.compareSync(input.password,user.password_hash)) return res.status(401).json({error:'Email or password is incorrect.'});
    if (user.status !== 'active') return res.status(403).json({error:'This account is currently unavailable.'});
    audit(user.id,'auth.login','user',user.id);
    const safe = {id:user.id,name:user.name,email:user.email,role:user.role};
    res.json({token:tokenFor(user),user:safe});
  } catch(e) { fail(res,e); }
});
app.get('/api/me',auth,(req,res) => res.json({user:req.user}));

app.get('/api/dashboard',auth,(req,res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY id').all(req.user.id).map(accountView);
  const transactions = db.prepare(`
    SELECT t.id,t.reference,t.type,t.status,t.description,t.created_at,
      e.direction,e.amount_cents,a.nickname
    FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
    JOIN accounts a ON a.id=e.account_id
    WHERE a.user_id=? ORDER BY t.id DESC LIMIT 8
  `).all(req.user.id).map(t => ({...t,amount:money(t.amount_cents),createdAt:t.created_at}));
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 5').all(req.user.id);
  res.json({ accounts, transactions, notifications, totalBalance:money(accounts.filter(a=>!['System Clearing','Payment Clearing'].includes(a.nickname)).reduce((s,a)=>s+a.balanceCents,0)) });
});
app.get('/api/accounts',auth,(req,res) => res.json({accounts:db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY id').all(req.user.id).map(accountView)}));
app.post('/api/accounts',auth,(req,res) => {
  try {
    const input=z.object({type:z.enum(['checking','savings']),nickname:z.string().trim().min(2).max(40)}).parse(req.body);
    const id=createAccount(req.user.id,input.type,input.nickname);
    audit(req.user.id,'account.created','account',id,{type:input.type});
    res.status(201).json({account:accountView(db.prepare('SELECT * FROM accounts WHERE id=?').get(id))});
  } catch(e) { fail(res,e); }
});
app.get('/api/transactions',auth,(req,res) => {
  const rows=db.prepare(`
    SELECT t.id,t.reference,t.type,t.status,t.description,t.created_at,e.direction,e.amount_cents,a.nickname
    FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
    JOIN accounts a ON a.id=e.account_id WHERE a.user_id=? ORDER BY t.id DESC LIMIT 200
  `).all(req.user.id);
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.id)) grouped.set(r.id,{id:r.id,reference:r.reference,type:r.type,status:r.status,description:r.description,createdAt:r.created_at,entries:[]});
    grouped.get(r.id).entries.push({account:r.nickname,direction:r.direction,amount:money(r.amount_cents)});
  }
  res.json({transactions:[...grouped.values()]});
});
app.post('/api/transfer',auth,(req,res) => {
  try {
    const input=z.object({fromAccountId:z.number().int(),toAccountId:z.number().int(),amount:z.number().positive(),note:z.string().max(120).optional().default('')}).parse(req.body);
    const from=ownAccount(req.user.id,input.fromAccountId);
    if (!from) throw new Error('Source account not found.');
    const to=ownAccount(req.user.id,input.toAccountId);
    if (!to) throw new Error('Destination account not found.');
    const amountCents=cents(input.amount);
    const result=transfer({fromAccountId:from.id,toAccountId:to.id,amountCents,actorId:req.user.id,type:'internal_transfer',description:input.note || `Transfer to ${to.nickname}`,metadata:{kind:'internal'}});
    notify(req.user.id,'Transfer completed',`$${money(amountCents)} was transferred between your accounts. Reference ${result.reference}.`);
    res.status(201).json({transaction:result});
  } catch(e) { fail(res,e); }
});
app.post('/api/activity/deposit',auth,(req,res) => {
  try {
    const input=z.object({accountId:z.number().int(),amount:z.number().positive(),description:z.string().max(100).optional().default('Simulated deposit')}).parse(req.body);
    const account=ownAccount(req.user.id,input.accountId); if(!account) throw new Error('Account not found.');
    const amountCents=cents(input.amount);
    const clearing=db.prepare("SELECT id FROM accounts WHERE user_id=? AND nickname='System Clearing'").get(req.user.id);
    let clearingId=clearing?.id;
    if(!clearingId) clearingId=createAccount(req.user.id,'savings','System Clearing');
    const result=post({type:'simulated_deposit',description:input.description,actorId:req.user.id,metadata:{simulation:true},entries:[
      {accountId:clearingId,direction:'debit',amountCents},{accountId:account.id,direction:'credit',amountCents}
    ]});
    notify(req.user.id,'Deposit recorded',`$${money(amountCents)} was added to ${account.nickname}.`);
    res.status(201).json({transaction:result});
  } catch(e) { fail(res,e); }
});
app.post('/api/payments/send',auth,(req,res) => {
  try {
    const input=z.object({fromAccountId:z.number().int(),recipientName:z.string().trim().min(2).max(80),destination:z.string().trim().min(5).max(160),destinationType:z.enum(['email','phone']),amount:z.number().positive(),memo:z.string().max(100).optional().default('')}).parse(req.body);
    const from=ownAccount(req.user.id,input.fromAccountId); if(!from) throw new Error('Source account not found.');
    if(input.destinationType==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.destination)) throw new Error('Enter a valid recipient email.');
    const amountCents=cents(input.amount);
    if(balanceCents(from.id)<amountCents) throw new Error('Insufficient available balance.');
    const clearingId = (() => {
      let a=db.prepare("SELECT id FROM accounts WHERE user_id=? AND nickname='Payment Clearing'").get(req.user.id);
      if(!a) a={id:createAccount(req.user.id,'savings','Payment Clearing')};
      return a.id;
    })();
    const result=post({type:'p2p_payment',description:`Person-to-person payment to ${input.recipientName}`,actorId:req.user.id,metadata:{simulation:true,network:'simulated-p2p',recipient:input.destination,memo:input.memo},entries:[
      {accountId:from.id,direction:'debit',amountCents},{accountId:clearingId,direction:'credit',amountCents}
    ]});
    db.prepare('INSERT OR IGNORE INTO recipients(user_id,display_name,destination,destination_type) VALUES(?,?,?,?)').run(req.user.id,input.recipientName,input.destination,input.destinationType);
    notify(req.user.id,'Payment sent',`Your simulated payment of $${money(amountCents)} to ${input.recipientName} is complete. Reference ${result.reference}.`);
    res.status(201).json({transaction:result,confirmation:{reference:result.reference,recipient:input.recipientName,amount:money(amountCents),status:'completed'}});
  } catch(e) { fail(res,e); }
});
app.get('/api/recipients',auth,(req,res) => res.json({recipients:db.prepare('SELECT id,display_name AS name,destination,destination_type AS type FROM recipients WHERE user_id=? ORDER BY id DESC').all(req.user.id)}));
app.get('/api/notifications',auth,(req,res) => res.json({notifications:db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)}));
app.post('/api/notifications/:id/read',auth,(req,res) => {
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(Number(req.params.id),req.user.id);
  res.json({ok:true});
});
app.get('/api/statements',auth,(req,res) => {
  const accountId=Number(req.query.accountId);
  if(!ownAccount(req.user.id,accountId)) return res.status(404).json({error:'Account not found.'});
  const rows=db.prepare(`
    SELECT t.reference,t.type,t.status,t.description,t.created_at,e.direction,e.amount_cents
    FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
    WHERE e.account_id=? ORDER BY t.id DESC LIMIT 500
  `).all(accountId);
  res.json({statement:rows.map(r=>({...r,amount:money(r.amount_cents)}))});
});

// Admin endpoints
app.get('/api/admin/overview',auth,admin,(_req,res) => {
  const customers=db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n;
  const accounts=db.prepare('SELECT COUNT(*) n FROM accounts').get().n;
  const transactions=db.prepare('SELECT COUNT(*) n FROM ledger_transactions').get().n;
  const logs=db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 30').all();
  res.json({customers,accounts,transactions,logs});
});
app.get('/api/admin/customers',auth,admin,(_req,res) => {
  res.json({customers:db.prepare(`SELECT u.id,u.name,u.email,u.status,u.created_at,
    (SELECT COUNT(*) FROM accounts a WHERE a.user_id=u.id) account_count
    FROM users u WHERE u.role='customer' ORDER BY u.id DESC`).all()});
});
app.get('/api/admin/transactions',auth,admin,(_req,res) => {
  res.json({transactions:db.prepare(`SELECT t.*,u.email actor_email FROM ledger_transactions t
    LEFT JOIN users u ON u.id=t.initiated_by ORDER BY t.id DESC LIMIT 250`).all()});
});
app.patch('/api/admin/customers/:id/status',auth,admin,(req,res) => {
  try {
    const status=z.enum(['active','restricted','closed']).parse(req.body.status);
    const result=db.prepare("UPDATE users SET status=? WHERE id=? AND role='customer'").run(status,Number(req.params.id));
    if(!result.changes) return res.status(404).json({error:'Customer not found.'});
    audit(req.user.id,'customer.status.updated','user',req.params.id,{status});
    res.json({ok:true});
  } catch(e) { fail(res,e); }
});
app.get('/api/admin/audit',auth,admin,(_req,res) => res.json({logs:db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all()}));

app.get('*',(req,res) => res.sendFile(require('node:path').resolve('public/index.html')));
app.use((err,_req,res,_next) => { console.error(err); res.status(500).json({error:'An unexpected server error occurred.'}); });

if (require.main === module) app.listen(PORT,'0.0.0.0',()=>console.log(`Summit Bank listening on port ${PORT}`));
module.exports = app;
