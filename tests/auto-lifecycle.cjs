const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const source=fs.readFileSync(path.join(base,'index.js'),'utf8').replace(/^\(\(\) => \{\r?\n'use strict';\r?\n/,'').replace(/\r?\n\}\)\(\);\s*$/,'');
function fixture(){
 const timers=new Set();
 const c={chatId:'test',name1:'User',name2:'Char',chat:[{is_user:false,mes:'日期：2025-09-24'}],extensionSettings:{st_private_journal:{followMainGeneration:true}},chatMetadata:{}};
 const sandbox={console:{...console,info(){}},URL,TextEncoder,Uint8Array,DataView,Blob,AbortController,
 setTimeout:(f,ms)=>{const t=setTimeout(f,ms);timers.add(t);return t;},clearTimeout,
 window:{crypto:{}},document:{readyState:'loading',addEventListener(){},removeEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}},SillyTavern:{getContext:()=>c,libs:{}},toastr:{error(){},success(){},warning(){},info(){}}};
 vm.createContext(sandbox); const run=s=>vm.runInContext(s,sandbox);run(source);
 run('currentBook=blankBook(); currentBookStorageKey=storageKey(); observeStoryDay(currentBook,latestStoryExchangeInfo()); globalThis.calls=[]; globalThis.succeed=true; saveBook=async()=>true; saveSpecificBook=async()=>true; scheduleMailCheck=()=>{}; generateBatch=async options=>{calls.push(options);return succeed;};');
 return {c,run,close:()=>timers.forEach(clearTimeout),next:(text='日期：2025-09-25')=>c.chat.push({is_user:true,mes:'继续。'},{is_user:false,mes:text})};
}
const wait=()=>new Promise(r=>setTimeout(r,1100));
let failed=0;
async function test(name,fn){const f=fixture();try{await fn(f);console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}finally{f.close();}}
(async()=>{
 await test('screenshot-style bracket timestamps cross day',async f=>{
  f.c.chat=[{is_user:false,mes:'【2025年11月6日 21:45 星期四|北京市|初冬寒夜|静谧】\n他回家。'}];
  f.run('currentBook=blankBook();observeStoryDay(currentBook,latestStoryExchangeInfo());');
  f.next('看着那些金鱼争抢食物。\n明天烤鸭。\n【2025年11月7日 09:30 星期五|北京市|晴朗|忙碌】\n他走进办公室。');
  f.run('scheduleAutoGeneration()');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('new bracket status overrides old labeled user status',async f=>{
  f.c.chat.push({is_user:true,mes:'日期：2025-09-24\n继续。'},{is_user:false,mes:'【2025年9月25日 09:30 星期四|办公室|晴】\n他到了。'});
  f.run('scheduleAutoGeneration()');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('first observed reply contains two story days',async f=>{
  f.c.chat=[{is_user:false,mes:'【2025年11月6日 21:45 星期四|家中】\n他回家。\n【2025年11月7日 09:30 星期五|办公室】\n他工作。'}];
  f.run('currentBook=blankBook();scheduleAutoGeneration()');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('end event before message is stored',async f=>{
  f.run('mainGenerationCycleSeen=true;mainGenerationStartSignature=latestAssistantSignature();releaseMainGenerationLock("generation-ended");');
  f.next();await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('missing start event, final event still checks day',async f=>{
  f.next();f.run('releaseMainGenerationLock("generation-ended")');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('manual section capture does not suppress day batch',async f=>{
  f.next();f.run('currentBook.lastCapturedSignature=latestAssistantSignature();mainGenerationCycleSeen=true;scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('failed batch remains pending and retries on next reply without date',async f=>{
  f.next();f.run('succeed=false;mainGenerationCycleSeen=true;scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),1);
  f.run('mainGenerationCycleSeen=true;scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),1,'duplicate event must not retry paid request');
  f.next('他轻声应了一句。');f.run('succeed=true;mainGenerationCycleSeen=true;scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),2,'pending boundary must survive failure');
 });
 await test('bootstrap prior date from chat rather than discard first crossing',async f=>{
  f.run('currentBook=blankBook();');f.next();f.run('mainGenerationCycleSeen=true;scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('busy task defers, then completes exactly once',async f=>{
  f.next();f.run('journalGenerationActive=true;mainGenerationCycleSeen=true;scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),0);
  f.run('journalGenerationActive=false;scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),1);
  f.run('scheduleAutoGeneration();scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('chat switch invalidates queued callback',async f=>{
  f.next();f.run('mainGenerationCycleSeen=true;scheduleAutoGeneration();');f.c.chatId='other';await wait();assert.equal(f.run('calls.length'),0);
 });
 await test('historical anchor survives undated replies',async f=>{
  f.next('他点点头。');f.run('currentBook=blankBook();');f.next();f.run('scheduleAutoGeneration();');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('two callbacks waiting for load do not issue twice',async f=>{
  f.next();f.run('pendingBookLoad=new Promise(r=>{globalThis.finishLoad=r;});scheduleAutoGeneration();');await wait();
  f.run('scheduleAutoGeneration();');await wait();
  f.run('finishLoad();pendingBookLoad=null;');await wait();assert.equal(f.run('calls.length'),1);
 });
 await test('disabling while queued cancels generation',async f=>{
  f.next();f.run('scheduleAutoGeneration();');f.c.extensionSettings.st_private_journal.followMainGeneration=false;await wait();assert.equal(f.run('calls.length'),0);
 });
 if(failed)process.exitCode=1;
})();
