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
  console.log('Private Journal smoke tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

