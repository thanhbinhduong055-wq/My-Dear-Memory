const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const candidate = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(candidate, 'index.js'), 'utf8')
  .replace(/^\(\(\) => \{\r?\n'use strict';\r?\n/, '').replace(/\r?\n\}\)\(\);\s*$/, '');
let saves = 0, modelCalls = 0;
const context = { chat: [], chatId: 'hidden-mail-test', name1: '小夏', name2: '阿远', extensionSettings: {}, chatMetadata: {},
  saveMetadata: async () => {}, saveChat: async () => { saves++; }, addOneMessage() {},
  generateQuietPrompt: async () => { modelCalls++; throw new Error('Unexpected model call'); } };
const sandbox = { console, setTimeout, clearTimeout, URL, TextEncoder, Uint8Array, DataView, Blob, AbortController,
  window: { crypto: {} }, document: { readyState: 'loading', addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
  SillyTavern: { getContext: () => context, libs: {} }, toastr: { error() {}, success() {}, warning() {}, info() {} } };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const run = code => vm.runInContext(code, sandbox);
function reset() {
  context.chat = [{is_user: true, mes: '2025年9月24日，晚安。'}, {is_user: false, mes: '【2025年9月25日 07:45 星期四|公寓一层|晴朗】他打开信箱。'}];
  run("currentBook = blankBook(); currentBookStorageKey = storageKey(); saveSpecificBook = async () => true; render = () => {};");
}
(async () => {
  reset();
  run("createScheduledMail(currentBook,{date:'2026-09-25',kind:'letter',body:'明年再见'})");
  await run('checkScheduledMail()');
  assert.equal(run('currentBook.mailClock.date'), '2025-09-25');
  assert.equal(run('currentBook.scheduledMail[0].status'), 'pending');
  assert.equal(saves, 0, '截图中的跨年预约不能提前寄出');
  console.log('PASS screenshot: 2025 story / 2026 reservation stays pending');

  sandbox.letterBody = '我想你。\n\n-->突破注释<!--嵌套--!><script>window.bad=1</script>\n<3 & -- 爱你';
  run("createScheduledMail(currentBook,{date:'2025-09-25',kind:'letter',body:letterBody})");
  await Promise.all([run('checkScheduledMail()'), run('checkScheduledMail()')]);
  assert.equal(saves, 1);
  const message = context.chat.at(-1);
  assert.equal(message.is_user, true);
  assert.equal(message.is_system, false);
  assert.ok(message.mes.includes('<!-- Request:'), '新信件正文必须置于标准 HTML 注释中');
  assert.equal((message.mes.match(/<!--/g) || []).length, 1);
  assert.equal((message.mes.match(/-->/g) || []).length, 1);
  assert.ok(!message.mes.includes('--!>'));
  assert.equal(message.mes.replace(/<!--[\s\S]*?-->/g, '').trim(), '✉ 一封情书已寄出。');
  assert.equal(run('currentBook.scheduledMail[1].body'), sandbox.letterBody, '信箱中原信件不能改写');
  const decoded = message.mes.slice(message.mes.indexOf('<!-- Request:') + 13, -3)
    .replace(/&#45;/g, '-').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.ok(decoded.includes(sandbox.letterBody), '模型侧请求必须包含可还原的完整信件');
  await run('checkScheduledMail()');
  assert.equal(saves, 1, '重复检查不重寄');
  assert.equal(modelCalls, 0, '寄信不触发模型请求');
  console.log('PASS hidden request, comment breakout protection, original text, no duplicates/API');

  run('syncCalendarDateWithStory(currentBook)');
  assert.equal(run('selectedCalendarDate'), '2025-09-25');
  assert.equal(run('calendarMonthCursor'), '2025-09');
  run("calendarDateManuallySelected = true; selectedCalendarDate = '2026-09-25'; currentBook.mailClock.date = '2025-09-26'; syncCalendarDateWithStory(currentBook)");
  assert.equal(run('selectedCalendarDate'), '2026-09-25', '不能覆盖用户主动选择的未来年份');
  assert.match(run("mailDateWarning('2026-09-25','2025-09-25')"), /年份/);
  assert.equal(run("mailDateWarning('2025-09-25','2025-09-25')"), '');
  run("activeType = 'mail'");
  assert.match(run('renderMailComposer()'), /2026.*年份|年份.*2026/s);
  context.chatId = 'another-chat';
  run("currentBook = blankBook(); currentBook.mailClock.date = '2024-02-29'; syncCalendarDateWithStory(currentBook)");
  assert.equal(run('selectedCalendarDate'), '2024-02-29', '切换聊天后重新匹配故事日期');
  console.log('PASS story-date defaults, manual selection protection, year warning, chat isolation');

  reset();
  run("createScheduledMail(currentBook,{date:'2025-09-24',kind:'card',body:'平安喜乐'})");
  context.saveChat = async () => { throw new Error('offline'); };
  await assert.rejects(run('deliverScheduledMail(currentBook,currentBook.scheduledMail[0])'), /offline/);
  const insertedCount = context.chat.length;
  context.saveChat = async () => { saves++; };
  await run('deliverScheduledMail(currentBook,currentBook.scheduledMail[0])');
  assert.equal(context.chat.length, insertedCount);
  assert.equal(context.chat.at(-1).mes.replace(/<!--[\s\S]*?-->/g, '').trim(), '✉ 一张贺卡已寄出。');
  assert.equal(run('currentBook.scheduledMail[0].status'), 'sent');
  assert.equal(modelCalls, 0);
  console.log('PASS failed-save retry reuses existing hidden message; greeting card supported');
})().catch(error => { console.error(error); process.exitCode = 1; });
