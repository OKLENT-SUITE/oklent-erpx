// 2FA (TOTP) + password policy unit tests: NO database.   node tests/totp-unit.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = await import(pathToFileURL(path.join(root, 'api/src/totp.js')).href);
const SEC = await import(pathToFileURL(path.join(root, 'api/src/security.js')).href);
let f=0; const ok=(n,c)=>{console.log((c?'ok  ':'FAIL ')+n); if(!c) f++;};
// RFC 4226 Appendix D: secret "12345678901234567890", counters 0..9
const s=T.base32Encode(Buffer.from('12345678901234567890'));
const exp=['755224','287082','359152','969429','338314','254676','287922','162583','399871','520489'];
ok('RFC4226 vectors',exp.every((e,i)=>T.hotp(s,i)===e));
// RFC 6238 Appendix B SHA1 8-digit: T=59 -> 94287082
ok('RFC6238 T=59 sha1',T.hotp(s,Math.floor(59/30),{digits:8})===  '94287082');
ok('RFC6238 T=1111111109',T.hotp(s,Math.floor(1111111109/30),{digits:8})==='07081804');
ok('RFC6238 T=20000000000',T.hotp(s,Math.floor(20000000000/30),{digits:8})==='65353130');
ok('base32 roundtrip',T.base32Decode(T.base32Encode(Buffer.from('hello!'))).toString()==='hello!');
const sec=T.newSecret(); const now=1_700_000_000_000; const code=T.totp(sec,now);
ok('verify current',T.verifyTotp(sec,code,{nowMs:now})===T.stepOf(now));
ok('verify drift -1 step',T.verifyTotp(sec,T.totp(sec,now-30000),{nowMs:now})===T.stepOf(now)-1);
ok('reject drift -3 steps',T.verifyTotp(sec,T.totp(sec,now-90000),{nowMs:now})===null);
ok('replay refused',T.verifyTotp(sec,code,{nowMs:now,lastStep:T.stepOf(now)})===null);
ok('older step refused after newer used',T.verifyTotp(sec,T.totp(sec,now-30000),{nowMs:now,lastStep:T.stepOf(now)})===null);
ok('garbage refused',T.verifyTotp(sec,'abcdef',{nowMs:now})===null&&T.verifyTotp(sec,'',{nowMs:now})===null&&T.verifyTotp(sec,'12345',{nowMs:now})===null);
const env={JWT_SECRET:'x'.repeat(40)}; const sealed=T.sealSecret(sec,env);
ok('seal/open',T.openSecret(sealed,env)===sec && !sealed.includes(sec));
let bad=false; try{T.openSecret(sealed,{JWT_SECRET:'y'.repeat(40)})}catch{bad=true}; ok('wrong key fails',bad);
const t2=sealed.slice(0,-3)+(sealed.endsWith('AAA')?'BBB':'AAA'); let tam=false; try{T.openSecret(t2,env)}catch{tam=true}; ok('tamper fails',tam);
const r=T.newRecoveryCodes(); ok('10 unique recovery codes',r.plain.length===10&&new Set(r.plain).size===10&&/^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(r.plain[0]));
ok('recovery hash matches typed (lowercase, no dash)',T.hashRecovery(r.plain[0].toLowerCase().replace('-',''))===r.hashes[0]);
ok('looksLikeRecovery',T.looksLikeRecovery(r.plain[0])&&!T.looksLikeRecovery('123456'));
ok('otpauth uri',T.otpauthUri({secret:sec,account:'acme:admin'}).startsWith('otpauth://totp/OKLENT%20BUSINESS:acme%3Aadmin?secret='));
ok('policy: strong password accepted',SEC.passwordProblems('Tr0ub4dor&Horse-77','sara').length===0);
ok('policy: short / weak / contains username / no digit refused',SEC.passwordProblems('Ab1').length>0&&SEC.passwordProblems('ChangeMe!2026').length>0&&SEC.passwordProblems('sara-Password-99','sara').length>0&&SEC.passwordProblems('onlyletterslong').length>0);
ok('policy: enforced in production or PASSWORD_POLICY=strict only',SEC.passwordPolicyOn({NODE_ENV:'production'})&&SEC.passwordPolicyOn({PASSWORD_POLICY:'strict'})&&!SEC.passwordPolicyOn({NODE_ENV:'development'}));
let thr=false; try{SEC.assertPasswordPolicy('abc',null,{NODE_ENV:'production'})}catch(e){thr=e.statusCode===422}; ok('policy: assert throws 422 in production',thr);
ok('policy: assert is a no-op in development',(()=>{SEC.assertPasswordPolicy('abc','x',{NODE_ENV:'development'});return true})());
console.log(f?`\n${f} FAILED`:'\nALL 2FA CHECKS PASSED'); process.exit(f?1:0);
