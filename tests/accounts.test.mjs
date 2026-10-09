import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAccounts, validPassword } from '../worker/accounts.ts';
function database() {
  const sqlite=new DatabaseSync(':memory:'); sqlite.exec(readFileSync(new URL('../drizzle/0000_pale_bulldozer.sql',import.meta.url),'utf8'));
  const prepare=(sql)=>{let args=[]; const statement={bind(...values){args=values;return statement;},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}};return statement;};
  return {sqlite,prepare,batch:async statements=>Promise.all(statements.map(s=>s.run()))};
}
function client(db,ip='1') { let cookie='';return async (action,body,options={})=>{
  const response=await handleAccounts(new Request(`https://example.com/api/account/${action}`,{method:body===undefined?'GET':'POST',headers:{origin:'https://example.com','content-type':'application/json','cf-connecting-ip':ip,...(cookie?{cookie}:{}),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),db);
  if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,data:await response.json(),headers:response.headers};
};}
const signup=(name)=>({name,username:name,email:`${name}@example.com`,password:'Secret123'});
const profile={name:'Alice',headline:'Engineer',experienceYears:'9',targetTitles:'Product manager',skills:'Cloud',locations:'New York',sponsorship:'needed',resumeHighlights:'Built systems'};
test('password rules require six characters with letters and numbers',()=>{for(const p of ['short','123456','abcdef','a12',''])assert.equal(validPassword(p),false);assert.equal(validPassword('abc123'),true);assert.equal(validPassword('Abc123!'),true);});
test('registration, persistence, isolation, logout, and cross-device login',async()=>{
 const db=database(),alice=client(db),bob=client(db,'2');
 assert.equal((await alice('profile',{profile})).status,401);
 assert.equal((await alice('register',{...signup('alice'),password:'abcdef'})).status,400);
 const registered=await alice('register',signup('alice'));assert.equal(registered.status,201);assert.equal(registered.data.recoveryCode.length,64);assert.match(registered.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 const row=db.sqlite.prepare('SELECT * FROM accounts').get();assert.notEqual(row.password_hash,'Secret123');assert.notEqual(row.recovery_hash,registered.data.recoveryCode);assert.equal(registered.data.account.password_hash,undefined);
 assert.equal((await alice('profile',{profile})).status,200);
 assert.equal((await alice('decision',{id:'job:1',value:'saved'})).status,200);
 assert.equal((await alice('me')).data.account.profile.skills,'Cloud');
 await bob('register',signup('bobby'));assert.deepEqual((await bob('me')).data.account.profile,{});assert.deepEqual((await bob('me')).data.account.decisions,{});
 await bob('profile',{profile:{...profile,name:'Bob'},accountId:row.id});assert.equal((await alice('me')).data.account.profile.name,'Alice');
 assert.equal((await alice('profile',{profile},{headers:{origin:'https://attacker.example'}})).status,403);
 await alice('logout',{});assert.equal((await alice('me')).data.account,null);assert.equal((await alice('decision',{id:'job:2',value:'saved'})).status,401);
 const another=client(db,'3');assert.equal((await another('login',{username:'ALICE',password:'Secret123'})).status,200);assert.equal((await another('me')).data.account.decisions['job:1'],'saved');
 await another('clear-profile',{});assert.deepEqual((await another('me')).data.account.profile,{});
});
test('recovery validates ownership, rotates code, and revokes old sessions',async()=>{
 const db=database(),alice=client(db),recovery=client(db,'2');const r=await alice('register',signup('alice'));const code=r.data.recoveryCode;
 assert.equal((await recovery('username',{email:'alice@example.com',recoveryCode:'0'.repeat(64)})).status,401);
 assert.equal((await recovery('username',{email:'alice@example.com',recoveryCode:code})).data.username,'alice');
 const reset=await recovery('reset',{email:'alice@example.com',recoveryCode:code,password:'New123!'});assert.equal(reset.status,200);assert.notEqual(reset.data.recoveryCode,code);
 assert.equal((await alice('me')).data.account,null);
 assert.equal((await recovery('reset',{email:'alice@example.com',recoveryCode:code,password:'Other123'})).status,401);
 assert.equal((await alice('login',{username:'alice',password:'Secret123'})).status,401);
 assert.equal((await alice('login',{username:'alice',password:'New123!'})).status,200);
});
test('failed sign-ins are rate limited and duplicate identities rejected',async()=>{
 const db=database(),alice=client(db);await alice('register',signup('alice'));
 assert.equal((await alice('register',signup('alice'))).status,409);
 for(let i=0;i<10;i++)await alice('login',{username:'alice',password:'wrong'});
 assert.equal((await alice('login',{username:'alice',password:'wrong'})).status,429);
});
