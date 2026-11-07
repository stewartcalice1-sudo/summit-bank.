const crypto = require('node:crypto');
const { db, balanceCents, audit } = require('./db');

function reference(prefix='SB') {
  return `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
function post({ type, description, actorId, entries, status='completed', metadata={} }) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('A ledger transaction requires at least two entries.');
  const totalDebits = entries.filter(x => x.direction === 'debit').reduce((s,x) => s+x.amountCents,0);
  const totalCredits = entries.filter(x => x.direction === 'credit').reduce((s,x) => s+x.amountCents,0);
  if (totalDebits !== totalCredits || totalDebits <= 0) throw new Error('Ledger entries must balance.');
  for (const e of entries) {
    if (!Number.isSafeInteger(e.amountCents) || e.amountCents <= 0) throw new Error('Invalid ledger amount.');
    const account = db.prepare('SELECT status FROM accounts WHERE id=?').get(e.accountId);
    if (!account || account.status !== 'active') throw new Error('An account is unavailable.');
  }
  const tx = db.transaction(() => {
    const ref = reference();
    const id = db.prepare(`INSERT INTO ledger_transactions(reference,type,status,description,initiated_by,metadata)
      VALUES(?,?,?,?,?,?)`).run(ref,type,status,description,actorId || null,JSON.stringify(metadata)).lastInsertRowid;
    const insert = db.prepare('INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents) VALUES(?,?,?,?)');
    for (const e of entries) insert.run(id,e.accountId,e.direction,e.amountCents);
    audit(actorId, 'ledger.transaction.posted', 'transaction', id, { reference: ref, type, status });
    return { id, reference: ref };
  });
  return tx();
}
function transfer({ fromAccountId, toAccountId, amountCents, actorId, type='transfer', description='Account transfer', metadata={} }) {
  if (fromAccountId === toAccountId) throw new Error('Choose two different accounts.');
  const run = db.transaction(() => {
    const from = db.prepare('SELECT * FROM accounts WHERE id=?').get(fromAccountId);
    const to = db.prepare('SELECT * FROM accounts WHERE id=?').get(toAccountId);
    if (!from || !to || from.status !== 'active' || to.status !== 'active') throw new Error('An account is unavailable.');
    if (balanceCents(fromAccountId) < amountCents) throw new Error('Insufficient available balance.');
    return post({
      type, description, actorId, metadata,
      entries: [
        { accountId: fromAccountId, direction: 'debit', amountCents },
        { accountId: toAccountId, direction: 'credit', amountCents }
      ]
    });
  });
  return run();
}
module.exports = { post, transfer, reference };
