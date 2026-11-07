const test=require('node:test');
const assert=require('node:assert/strict');
process.env.DATABASE_PATH=':memory:';
process.env.SESSION_SECRET='test-secret-that-is-long-enough-for-automated-tests';
const {db,balanceCents,createAccount}=require('../src/db');
const {post,transfer}=require('../src/ledger');
const user=db.prepare("INSERT INTO users(name,email,password_hash) VALUES('Test User','test@example.com','x')").run().lastInsertRowid;
const a=createAccount(user,'checking','Checking');
const b=createAccount(user,'savings','Savings');
test('ledger posts balanced entries and calculates balances',()=>{
  post({type:'seed',description:'Opening test funds',actorId:user,entries:[
    {accountId:b,direction:'debit',amountCents:10000},
    {accountId:a,direction:'credit',amountCents:10000}
  ]});
  assert.equal(balanceCents(a),10000);
  assert.equal(balanceCents(b),-10000);
});
test('transfer is atomic and rejects insufficient funds',()=>{
  assert.throws(()=>transfer({fromAccountId:b,toAccountId:a,amountCents:100,actorId:user}),/Insufficient/);
  assert.equal(balanceCents(a),10000);
});
test('unbalanced ledger entries are rejected',()=>{
  assert.throws(()=>post({type:'bad',description:'bad',entries:[
    {accountId:a,direction:'debit',amountCents:100},
    {accountId:b,direction:'credit',amountCents:99}
  ]}),/must balance/);
});
