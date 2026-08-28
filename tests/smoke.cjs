const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const contextValue = {
  uuidv4: undefined,
  extensionSettings: {},
  characters: [],
  characterId: undefined,
  groupId: null,
  chatId: 'test-chat',
  name1: 'User',
  name2: 'Character',
  chat: [],
  onlineStatus: 'connected',
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  window: { crypto: {} },
  document: {
    readyState: 'loading',
    addEventListener() {},
  },
  SillyTavern: {
    getContext: () => contextValue,
    libs: { localforage: { setItem: async () => {} } },
  },
  toastr: { success() {}, info() {}, warning() {}, error() {} },
  confirm: () => false,
  URL,
  Blob,
  Math,
  Date,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'index.js' });

const strictPage = vm.runInContext(`parseJson('{"title":"雨后","body":"我们回到了屋檐下。"}', 'daily_note')`, sandbox);
assert.equal(strictPage.title, '雨后');
assert.equal(strictPage.body, '我们回到了屋檐下。');
assert.deepEqual(Array.from(strictPage.memoryAnchors), []);

const fallbackPage = vm.runInContext(`parseJson('模型返回了普通文本，而不是 JSON。', 'love_letter')`, sandbox);
assert.equal(fallbackPage.title, '情书');
assert.match(fallbackPage.body, /普通文本/);

const aliasedSong = vm.runInContext(`normalizePage({
  title: '一页',
  body: '正文',
  song: { name: '夜曲', singer: '周杰伦', lyric: '为你弹奏肖邦的夜曲' }
})`, sandbox);
assert.equal(aliasedSong.song.title, '夜曲');
assert.equal(aliasedSong.song.artist, '周杰伦');

const missingSongTitle = vm.runInContext(`normalizePage({ title: '一页', body: '正文', song: { excerpt: '一小段歌词' } })`, sandbox);
assert.equal(missingSongTitle.song.title, '未提供歌曲');
assert.equal(missingSongTitle.song.isMissingTitle, true);

const taggedPage = vm.runInContext(`parseJson('<journal_page><title>雨夜</title><dateLabel>此刻</dateLabel><mood>担心</mood><body>我希望你平安回来。</body><poem><text>一行短诗</text><author>原创</author><work>无题</work><isOriginal>true</isOriginal></poem><song><title>Moon River</title><artist>Audrey Hepburn</artist><excerpt>Two drifters</excerpt><isParaphrase>false</isParaphrase></song><anchors><item>他受伤了</item></anchors><confidence>high</confidence></journal_page>', 'love_letter')`, sandbox);
assert.equal(taggedPage.title, '雨夜');
assert.equal(taggedPage.body, '我希望你平安回来。');
assert.equal(taggedPage.song.title, 'Moon River');

const leakedPayload = '{"title":"你别受伤","dateLabel":"此刻","mood":"担心","body":"姜藏：\\n\\n我写的是"晚饭想吃铜锅涮肉"，也是真的怕你疼。","poem":{"text":"一行诗","author":"原创","work":"无题","isOriginal":true},"song":{"title":"一路生花","artist":"温奕心","excerpt":"我希望许过的愿望一路生花","isParaphrase":false},"memoryAnchors":[],"confidence":"low"}';
sandbox.leakedPayload = leakedPayload;
const recoveredLeakedPage = vm.runInContext(`parseJson(leakedPayload, 'love_letter')`, sandbox);
assert.equal(recoveredLeakedPage.title, '你别受伤');
assert.match(recoveredLeakedPage.body, /铜锅涮肉/);
assert.doesNotMatch(recoveredLeakedPage.body, /^\{/);
const repairedStoredPage = vm.runInContext(`repairStoredPage({ id: 'legacy-1', type: 'love_letter', body: leakedPayload, createdAt: 'then' })`, sandbox);
assert.equal(repairedStoredPage.id, 'legacy-1');
assert.equal(repairedStoredPage.type, 'love_letter');
assert.match(repairedStoredPage.body, /铜锅涮肉/);

const impressionPrompt = vm.runInContext(`buildPrompt('impression', { impressionFocus: 'custom', customRequest: '观察他的克制与温柔' })`, sandbox);
assert.match(impressionPrompt, /叙述视角始终是 User/);
assert.match(impressionPrompt, /观察他的克制与温柔/);
assert.match(impressionPrompt, /song\.title 必须填写准确歌名/);

const dailyPrompt = vm.runInContext(`buildPrompt('daily_note')`, sandbox);
assert.match(dailyPrompt, /User 与 Char 已经发生的日常相处/);

const letterPrompt = vm.runInContext(`buildPrompt('love_letter')`, sandbox);
assert.match(letterPrompt, /User 写给 Char 的情书/);
assert.match(letterPrompt, /绝对不要反写成 Char 给 User/);

const romancePrompt = vm.runInContext(`buildPrompt('romance_diary')`, sandbox);
assert.match(romancePrompt, /作为伴侣之后的恋爱日常/);

const relationship = vm.runInContext(`parseRelationship('{"status":"partners","reason":"双方明确确认关系","evidence":["互称伴侣"]}')`, sandbox);
assert.equal(relationship.status, 'partners');
assert.equal(relationship.source, 'model');

const batchPrompt = vm.runInContext(`buildBatchPrompt({ impressionFocus: 'personality' })`, sandbox);
assert.match(batchPrompt, /禁止只写其中一个栏目/);
assert.match(batchPrompt, /必须按顺序完整输出/);
assert.match(batchPrompt, /本轮不会发送第二次请求补字段/);

const taggedBatch = vm.runInContext(`parseBatch('<journal_batch><relationship><status>uncertain</status><reason>证据不足</reason><evidence><item>尚未确认</item></evidence></relationship><page type="impression"><title>印象</title><body>他很克制。</body><song><title>夜曲</title><artist>周杰伦</artist><excerpt>一小段</excerpt></song></page><page type="daily_note"><title>日常</title><body>我们一起吃饭。</body><song><title>稻香</title><artist>周杰伦</artist><excerpt>还记得你说家是唯一的城堡</excerpt></song></page><page type="love_letter"><title>给你</title><body>我想你平安。</body><song><title>Moon River</title><artist>Audrey Hepburn</artist><excerpt>Two drifters</excerpt></song></page><page type="romance_diary" save="false"></page></journal_batch>')`, sandbox);
assert.equal(taggedBatch.updates.length, 3);
assert.deepEqual(Array.from(taggedBatch.updates, item => item.type), ['impression', 'daily_note', 'love_letter']);

const batchResult = vm.runInContext(`parseBatch(JSON.stringify({
  relationship: { status: 'uncertain', reason: '证据不足', evidence: [] },
  updates: [
    { type: 'impression', shouldSave: true, page: { title: '印象', body: '他很安静。' } },
    { type: 'daily_note', shouldSave: true, page: { title: '日常', body: '我们聊了很久。' } },
    { type: 'love_letter', shouldSave: true, page: { title: '信', body: '我想对你说。' } },
    { type: 'romance_diary', shouldSave: false, page: null }
  ]
}))`, sandbox);
assert.equal(batchResult.updates.length, 3);
assert.equal(batchResult.relationship.status, 'uncertain');

const legacyBook = vm.runInContext(`migrateBook({ pages: [{ type: 'first_impression' }] })`, sandbox);
assert.equal(legacyBook.version, 3);
assert.equal(legacyBook.pages[0].type, 'impression');

const separatedPages = vm.runInContext(`pagesForType({ pages: [
  { type: 'impression', title: '印象一' },
  { type: 'love_letter', title: '情书一' },
  { type: 'daily_note', title: '日记一' }
] }, 'daily_note')`, sandbox);
assert.equal(separatedPages.length, 1);
assert.equal(separatedPages[0].title, '日记一');

const foldedPageHtml = vm.runInContext(`renderPage({
  id: 'page-1', type: 'daily_note', title: '折叠标题', dateLabel: '此刻', mood: '安静',
  body: '折叠正文', confidence: 'high', memoryAnchors: [],
  poem: { text: '', author: '', work: '' }, song: { title: 'Moon River', artist: 'Audrey Hepburn', excerpt: 'Two drifters' }
})`, sandbox);
assert.match(foldedPageHtml, /^<details class="pj-page">/);
assert.doesNotMatch(foldedPageHtml, /<details class="pj-page" open>/);
assert.match(foldedPageHtml, /<summary>/);

const fallbackId = vm.runInContext('createId()', sandbox);
assert.match(fallbackId, /^[a-z0-9]+-[a-z0-9]+$/);

contextValue.uuidv4 = () => 'context-uuid';
assert.equal(vm.runInContext('createId()', sandbox), 'context-uuid');

contextValue.chat = [
  { is_user: true, is_system: false, mes: '你好' },
  { is_user: false, is_system: false, mes: '第一次回复', swipe_id: 0 },
];
const firstSignature = vm.runInContext('latestAssistantSignature()', sandbox);
contextValue.chat[1].mes = '重新生成后的回复';
const secondSignature = vm.runInContext('latestAssistantSignature()', sandbox);
assert.notEqual(firstSignature, secondSignature);

(async () => {
  let receivedOptions;
  contextValue.generateQuietPrompt = async options => {
    receivedOptions = options;
    return '正文 API 的返回内容';
  };
  const result = await vm.runInContext(`callCurrentMainApi('写一页日记')`, sandbox);
  assert.equal(result, '正文 API 的返回内容');
  assert.equal(receivedOptions.quietPrompt, '写一页日记');
  assert.equal(receivedOptions.skipWIAN, false);

  let batchApiCalls = 0;
  contextValue.generateQuietPrompt = async () => {
    batchApiCalls += 1;
    return JSON.stringify({
      relationship: { status: 'uncertain', reason: '证据不足', evidence: [] },
      updates: [
        { type: 'impression', shouldSave: true, page: { title: '印象', body: '他的语气很轻。', song: { title: 'Moon River', artist: 'Audrey Hepburn', excerpt: 'Wherever you are going' } } },
        { type: 'daily_note', shouldSave: true, page: { title: '日常', body: '我们聊到深夜。', song: { title: '夜空中最亮的星', artist: '逃跑计划', excerpt: '夜空中最亮的星' } } },
        { type: 'love_letter', shouldSave: true, page: { title: '给你', body: '我想让你知道。', song: { title: '告白气球', artist: '周杰伦', excerpt: '亲爱的爱上你' } } },
        { type: 'romance_diary', shouldSave: false, page: null },
      ],
    });
  };
  vm.runInContext('currentBook = blankBook()', sandbox);
  await vm.runInContext(`generateBatch({ captureSignature: 'one-main-message' })`, sandbox);
  assert.equal(batchApiCalls, 1);
  assert.equal(vm.runInContext('currentBook.pages.length', sandbox), 3);
  console.log('Private Journal smoke tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

