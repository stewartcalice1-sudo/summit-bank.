const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || './data/summit-bank.sqlite';
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','restricted','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  account_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('checking','savings')),
  nickname TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','restricted','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','pending','failed','cancelled')),
  description TEXT NOT NULL,
  initiated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES ledger_transactions(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('debit','credit')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_type TEXT NOT NULL CHECK(destination_type IN ('email','phone')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, destination)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_account ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON ledger_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`);

function balanceCents(accountId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0) AS balance
    FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
    WHERE e.account_id=? AND t.status='completed'
  `).get(accountId);
  return row.balance;
}
function createAccount(userId, type, nickname) {
  const accountNumber = String(Math.floor(1000000000 + Math.random() * 8999999999));
  return db.prepare('INSERT INTO accounts(user_id,account_number,type,nickname) VALUES(?,?,?,?)')
    .run(userId, accountNumber, type, nickname).lastInsertRowid;
}
function audit(actorId, action, entityType, entityId, details={}) {
  db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)')
    .run(actorId || null, action, entityType, String(entityId ?? ''), JSON.stringify(details));
}
module.exports = { db, balanceCents, createAccount, audit };
