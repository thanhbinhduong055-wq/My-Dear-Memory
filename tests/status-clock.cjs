const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(base, 'index.js'), 'utf8').replace(/^\(\(\) => \{\r?\n'use strict';\r?\n/, '').replace(/\r?\n\}\)\(\);\s*$/, '');
const context = {chat:[], chatId:'clock-test', name1:'User', name2:'Char', extensionSettings:{},chatMetadata:{}};
const sandbox = {console,setTimeout,clearTimeout,URL,TextEncoder,Uint8Array,DataView,Blob,AbortController,
 window:{crypto:{}},document:{readyState:'loading',addEventListener(){},removeEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}},
 SillyTavern:{getContext:()=>context,libs:{}},toastr:{error(){},success(){},warning(){},info(){}}};
vm.createContext(sandbox);vm.runInContext(source,sandbox);
const run=code=>vm.runInContext(code,sandbox);
const detect=text=>{sandbox.input=text;return run('detectStoryDayMarker(input)');};
for(const text of [
 '状态栏\n日期：2025年9月25日\n时间：07:45',
 '【时间：2025-09-25 07:45｜地点：公寓】',
 '| 日期 | 2025/09/25 |\n| 地点 | 公寓 |',
 '<table><tr><th>日期</th><td>2025.09.25</td></tr><tr><td>时间</td><td>07:45</td></tr></table>',
 '<details><summary>状态栏</summary><p><b>当前时间</b>：2025年9月25日 07:45</p></details>',
 '```yaml\nstatus:\n  date: 2025-09-25\n```',
 '<status>2025-09-25 07:45 | 公寓</status>',
 '🗓 日期：2025-09-25',
]) assert.equal(detect(text)?.key,'date:2025-09-25',text);
assert.equal(detect('日期：2025-09-25\n第二天，她会过来。')?.key,'date:2025-09-25','status date wins');
for(const text of ['第二天，阳光照进来。','次日清晨，他推开门。','一个月后，两人重逢。']) assert.equal(detect(text)?.type,'relative',text);
for(const text of [
 '<think>日期：2030-01-01\n第二天，他出门。</think>他坐着。',
 '<!-- Request: 日期：2030-01-01 -->他坐着。',
 '<script>const text="日期：2030-01-01";</script>他坐着。',
  '预约日期：2030-01-01', '生日：2030-01-01', '“日期：2030-01-01。”她念出预约单。',
 '<table><tr><td>预约日期</td><td>2030-01-01</td></tr></table>',
 '状态栏\n时间：00:10', '日期：2025-02-30', '日期：2025-13-01',
]) assert.equal(detect(text),null,text);
run('currentBook=blankBook()');let seq=0;
const observe=text=>{sandbox.info={signature:'turn-'+(++seq),content:text};return run('observeStoryDay(currentBook,info)');};
assert.equal(observe('日期：2025-09-24').shouldUpdate,false);
assert.equal(observe('日期：2025-09-24\n时间：23:59').shouldUpdate,false);
assert.equal(observe('日期：2025-09-25\n时间：00:01').shouldUpdate,true);
assert.equal(run('observeStoryDay(currentBook,info)').shouldUpdate,false,'same exchange idempotent');
assert.equal(observe('日期：2025-09-25').shouldUpdate,false,'same date no API');
assert.equal(observe('日期：2025-09-23').shouldUpdate,false,'backwards date does not auto generate');
assert.equal(run('currentBook.timeline.currentDayKey'),'date:2025-09-25');
assert.equal(observe('日期：2025-10-25').period.spanDays,30);
assert.equal(observe('第二天，他推开窗。').shouldUpdate,true);
assert.equal(observe('日期：2025-10-26').shouldUpdate,false,'date anchor after relative transition does not double count');
run('currentBook=blankBook()');
assert.equal(observe('他推开窗。').shouldUpdate,false);
assert.equal(observe('日期：2025-10-26').shouldUpdate,false,'first dated anchor establishes baseline');
context.chat=[{is_user:true,mes:'第二天，我来到门口。'},{is_user:false,mes:'状态栏\n日期：2025-10-26\n他迎上来。',extra:{reasoning:'日期：2099-01-01'}}];
assert.equal(run('detectStoryDayMarker(latestStoryExchangeInfo().content).key'),'date:2025-10-26');
console.log('PASS status labels / HTML / Markdown / YAML / status wrapper / emoji; relative fallback; reasoning, hidden requests, future labels, invalid dates excluded; forward-only, duplicate and month-span checks');
(async()=>{
  context.extensionSettings.st_private_journal={followMainGeneration:true};
  context.chat=[{is_user:true,mes:'一起回家吧。'},{is_user:false,mes:'日期：2025-10-26\n他送你回家。'}];
  run('currentBook=blankBook(); observeStoryDay(currentBook,latestStoryExchangeInfo()); saveBook=async()=>{}; saveSpecificBook=async()=>true; globalThis.batchCalls=[]; generateBatch=async options=>{batchCalls.push(options);return true;};');
  const trigger=async text=>{
    context.chat.push({is_user:true,mes:'继续。'},{is_user:false,mes:text});
    run('mainGenerationCycleSeen=true; mainGenerationStartSignature="previous"; scheduleAutoGeneration();');
    await new Promise(resolve=>setTimeout(resolve,650));
  };
  await trigger('<table><tr><td>日期</td><td>2025-10-27</td></tr></table>他整理好衣领。');
  assert.equal(run('batchCalls.length'),1,'status-only date change triggers automatic batch');
  await trigger('日期：2025-10-27\n时间：18:30\n他回到家中。');
  assert.equal(run('batchCalls.length'),1,'same status date does not repeat');
  await trigger('第二天，晨光照进来。');
  assert.equal(run('batchCalls.length'),2,'relative narrative fallback still triggers');
  console.log('PASS scheduler: status cross-day = one batch, same date = no extra batch, next-day narrative = one batch; no real model calls');
})().catch(error=>{console.error(error);process.exitCode=1;});
