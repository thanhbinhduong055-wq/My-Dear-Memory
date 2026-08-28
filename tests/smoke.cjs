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
    libs: { localforage: {} },
  },
  toastr: {},
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
assert.equal(missingSongTitle.song.title, '未注明歌名');
assert.equal(missingSongTitle.song.isMissingTitle, true);

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

const legacyBook = vm.runInContext(`migrateBook({ pages: [{ type: 'first_impression' }] })`, sandbox);
assert.equal(legacyBook.version, 2);
assert.equal(legacyBook.pages[0].type, 'impression');

const separatedPages = vm.runInContext(`pagesForType({ pages: [
  { type: 'impression', title: '印象一' },
  { type: 'love_letter', title: '情书一' },
  { type: 'daily_note', title: '日记一' }
] }, 'daily_note')`, sandbox);
assert.equal(separatedPages.length, 1);
assert.equal(separatedPages[0].title, '日记一');

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

  contextValue.generateQuietPrompt = async () => '{"title":"Moon River","artist":"Audrey Hepburn","excerpt":"Wherever you are going","isParaphrase":false}';
  const repairedPage = await vm.runInContext(`completeMissingSong(normalizePage({ title: '一页', body: '安静的夜晚' }), 'daily_note')`, sandbox);
  assert.equal(repairedPage.song.title, 'Moon River');
  assert.equal(repairedPage.song.artist, 'Audrey Hepburn');
  console.log('Private Journal smoke tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

