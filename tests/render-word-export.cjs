const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const outputPath = path.resolve(process.argv[2] || path.join('.qa', 'word-export-sample.docx'));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');
const executableSource = source
  .replace(/^\(\(\) => \{\r?\n'use strict';\r?\n/, '')
  .replace(/\r?\n\}\)\(\);\s*$/, '');
const sampleBook = {
  version: 7,
  userName: '姜藏',
  characterName: '陈砚',
  pages: [
    {
      id: 'quote-1', type: 'quote_note', title: '雨夜的一句话', dateLabel: '2025年1月18日',
      mood: '想留下来的话', body: '“下雨了，就向我这边走。”', quoteSpeaker: '陈砚',
      createdAt: '2025-01-18T23:12:00.000Z',
    },
    {
      id: 'daily-1', type: 'daily_note', title: '灯火落在你肩上', dateLabel: '冬夜', mood: '安静地心疼',
      body: '你把伞往我这边偏的时候，自己的右肩很快湿了一小片。\n回到家，我们一起等水沸腾。',
    },
    {
      id: 'letter-1', type: 'love_letter', title: '如果可以，我想一直偏向你', dateLabel: '此刻', mood: '坦白而炽热',
      body: '我想抱住的不是某个完美的人，是会疲惫、会逞强、会在深夜沉默的你。',
    },
  ],
};

const contextValue = {
  uuidv4: undefined,
  extensionSettings: {},
  characters: [],
  characterId: undefined,
  groupId: null,
  chatId: 'qa-chat',
  name1: sampleBook.userName,
  name2: sampleBook.characterName,
  chat: [],
  onlineStatus: 'connected',
};
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  window: { crypto: {} },
  document: { readyState: 'loading', addEventListener() {} },
  SillyTavern: {
    getContext: () => contextValue,
    libs: { localforage: { setItem: async () => {} } },
  },
  toastr: { success() {}, info() {}, warning() {}, error() {} },
  confirm: () => false,
  URL,
  Blob,
  TextEncoder,
  Uint8Array,
  DataView,
  ArrayBuffer,
  Math,
  Date,
  sampleBook,
};

vm.createContext(sandbox);
vm.runInContext(executableSource, sandbox, { filename: 'index.js' });
const bytes = vm.runInContext('createStoredZip(buildWordDocumentParts(sampleBook))', sandbox);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(bytes));
console.log(outputPath);
