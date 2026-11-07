const fs=require('node:fs');
const path=require('node:path');
const p=process.env.DATABASE_PATH||'./data/summit-bank.sqlite';
for(const suffix of ['', '-shm','-wal']) { const f=path.resolve(p)+suffix; if(fs.existsSync(f)) fs.unlinkSync(f); }
console.log('Database files removed. The application will recreate the schema on next start.');
