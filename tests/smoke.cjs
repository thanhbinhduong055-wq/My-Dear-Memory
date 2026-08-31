const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const styleSource = fs.readFileSync(require.resolve('../style.css'), 'utf8');
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
  TextEncoder,
  Uint8Array,
  DataView,
  ArrayBuffer,
  Math,
  Date,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'index.js' });

assert.equal(vm.runInContext('Object.keys(THEMES).length', sandbox), 5);
assert.equal(vm.runInContext('Object.keys(DESKS).length', sandbox), 5);
assert.equal(vm.runInContext('DEFAULTS.theme', sandbox), 'botanical-noir');
assert.equal(vm.runInContext('DEFAULTS.desk', sandbox), 'pearl-cream');
assert.equal(vm.runInContext('DEFAULTS.generationApiMode', sandbox), 'main');
assert.equal(vm.runInContext('DEFAULTS.secondaryProfileId', sandbox), '');
assert.equal(vm.runInContext('DEFAULTS.secondaryModelId', sandbox), '');
assert.equal(vm.runInContext('BOOK_VERSION', sandbox), 10);
assert.equal(vm.runInContext("PAGE_TYPES.calendar.label", sandbox), '心情月历');
for (const theme of ['botanical-noir', 'rococo-garden', 'indigo-reed', 'italian-marble', 'magnolia-swallow']) {
  assert.match(styleSource, new RegExp(`assets/themes/cutouts/${theme}\\.webp`));
  assert.equal(fs.existsSync(require.resolve(`../assets/themes/cutouts/${theme}.webp`)), true);
}
for (const desk of ['forest-walnut.webp', 'light-ash.webp', 'olive-warmwood.webp', 'magnolia-inkstone.webp']) {
  assert.equal(fs.existsSync(require.resolve(`../assets/backgrounds/${desk}`)), true);
}
assert.doesNotMatch(styleSource, /assets\/(?:themes\/cutouts|backgrounds)\/[^)'\"]+\.png/);
assert.match(styleSource, /--pj-spread-ratio/);
assert.match(source, /class="pj-scene-close"/);
assert.match(source, /class="pj-cover-art"/);
assert.match(source, /class="pj-desk-art"/);
assert.match(source, /class="pj-desk-switcher"/);
assert.match(source, /data-desk-option/);
assert.match(styleSource, /\.pj-style-palette/);
assert.match(styleSource, /#private-journal\[data-desk="forest-walnut"\]/);
assert.match(styleSource, /#private-journal \.pj-cover-art\s*\{/);
assert.match(styleSource, /object-fit:fill!important/);
assert.match(styleSource, /--pj-font-cover:/);
assert.match(styleSource, /font-family:var\(--pj-font-cover\)/);
assert.match(styleSource, /--pj-name-y:23\.5%/);
assert.match(source, /class="pj-api-router-host"/);
assert.match(source, /ConnectionManagerRequestService/);
assert.match(source, /aria-label="书签目录"/);
assert.match(source, /按故事日自动整理/);
assert.match(styleSource, /\.pj-tabs\s*\{[\s\S]*?position:absolute/);
assert.match(source, /#extensions_settings2,#extensions_settings/);
assert.match(source, /private-journal-extension-entry/);
assert.match(source, /pj-quote-capture-preview/);
assert.match(styleSource, /\.pj-extension-open-button/);
assert.match(styleSource, /@media\(max-width:860px\)[\s\S]*?width:calc\(100vw - 20px\)/);
assert.doesNotMatch(styleSource, /@media\(max-width:860px\)[\s\S]*?width:980px/);
assert.match(styleSource, /#private-journal-launcher[^}]*touch-action:none/);
assert.match(styleSource, /pj-reader-out-forward/);
assert.match(styleSource, /pj-reader-in-forward/);
const openJournalStart = source.indexOf('async function openJournal()');
const openJournalEnd = source.indexOf('\n}', openJournalStart);
const openJournalSource = source.slice(openJournalStart, openJournalEnd);
assert.ok(
  openJournalSource.indexOf("root.classList.add('open')") < openJournalSource.indexOf('await loadBook()'),
  '移动端点击后必须先显示手札，再等待 IndexedDB 加载',
);
assert.equal(vm.runInContext("launcherDragThreshold('touch')", sandbox), 14);
assert.equal(vm.runInContext("launcherDragThreshold('mouse')", sandbox), 5);

const strictPage = vm.runInContext(`parseJson('{"title":"雨后","body":"我们回到了屋檐下。"}', 'daily_note')`, sandbox);
assert.equal(strictPage.title, '雨后');
assert.equal(strictPage.body, '我们回到了屋檐下。');
assert.deepEqual(Array.from(strictPage.memoryAnchors), []);

const fallbackPage = vm.runInContext(`parseJson('模型返回了普通文本，而不是 JSON。', 'love_letter')`, sandbox);
assert.equal(fallbackPage.title, '情书');
assert.match(fallbackPage.body, /普通文本/);

const strippedLegacyMedia = vm.runInContext(`normalizePage({
  title: '一页', body: '正文', poem: { text: '旧诗句' }, song: { title: '旧歌曲', excerpt: '旧歌词' }
})`, sandbox);
assert.equal(strippedLegacyMedia.poem, undefined);
assert.equal(strippedLegacyMedia.song, undefined);

const taggedPage = vm.runInContext(`parseJson('<journal_page><title>雨夜</title><dateLabel>此刻</dateLabel><mood>担心</mood><body>我希望你平安回来。</body><anchors><item>他受伤了</item></anchors><confidence>high</confidence></journal_page>', 'love_letter')`, sandbox);
assert.equal(taggedPage.title, '雨夜');
assert.equal(taggedPage.body, '我希望你平安回来。');
assert.equal(taggedPage.song, undefined);

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
assert.match(impressionPrompt, /必须写成“初印象”/);
assert.match(impressionPrompt, /User Persona/);
assert.match(impressionPrompt, /不要附加诗句、歌词、歌曲推荐或配乐/);
assert.doesNotMatch(impressionPrompt, /<poem>|<song>|lyricsMaxWords/);
assert.match(impressionPrompt, /220至320字/);

const personalityPrompt = vm.runInContext(`buildPrompt('impression', { impressionFocus: 'personality' })`, sandbox);
assert.match(personalityPrompt, /触发情境/);
assert.match(personalityPrompt, /至少写出三个/);
assert.match(personalityPrompt, /不要用外貌描写代替性格判断/);

const dailyPrompt = vm.runInContext(`buildPrompt('daily_note')`, sandbox);
assert.match(dailyPrompt, /User 与 Char 已经发生的日常相处/);
assert.match(dailyPrompt, /320至500字/);

const letterPrompt = vm.runInContext(`buildPrompt('love_letter')`, sandbox);
assert.match(letterPrompt, /User 写给 Char 的高情感浓度情书/);
assert.match(letterPrompt, /绝对不要反写成 Char 给 User/);
assert.match(letterPrompt, /高情感浓度/);
assert.match(letterPrompt, /420至620字/);

const romancePrompt = vm.runInContext(`buildPrompt('romance_diary')`, sandbox);
assert.match(romancePrompt, /作为伴侣之后的恋爱日常/);
assert.match(romancePrompt, /至少三分之二/);
assert.match(romancePrompt, /420至650字/);

const relationship = vm.runInContext(`parseRelationship('{"status":"partners","reason":"双方明确确认关系","evidence":["互称伴侣"]}')`, sandbox);
assert.equal(relationship.status, 'partners');
assert.equal(relationship.source, 'model');

const batchPrompt = vm.runInContext(`buildBatchPrompt({ impressionFocus: 'personality' })`, sandbox);
assert.match(batchPrompt, /禁止只写其中一个栏目/);
assert.match(batchPrompt, /必须按顺序完整输出/);
assert.match(batchPrompt, /情感浓度必须明显高于其他栏目/);
assert.match(batchPrompt, /正文至少三分之二描写 User 的内心情感/);
assert.match(batchPrompt, /必须写“初印象”/);
assert.match(batchPrompt, /User Persona/);
assert.match(batchPrompt, /不要附加诗句、歌词、歌曲推荐或配乐/);
assert.equal((batchPrompt.match(/<round_accompaniment>/g) || []).length, 0);
assert.equal((batchPrompt.match(/<song>/g) || []).length, 0);
assert.match(batchPrompt, /220至320字/);
assert.match(batchPrompt, /320至500字/);
assert.match(batchPrompt, /420至620字/);

const rangedBatchPrompt = vm.runInContext(`buildBatchPrompt({
  impressionFocus: 'personality',
  period: { fromLabel: '1月1日', toLabel: '一个月后', label: '1月1日至一个月后', spanDays: 30, isExtended: true }
})`, sandbox);
assert.match(rangedBatchPrompt, /1月1日至一个月后/);
assert.match(rangedBatchPrompt, /约30天/);
assert.match(rangedBatchPrompt, /覆盖整个时间范围/);

const taggedBatch = vm.runInContext(`parseBatch('<journal_batch><relationship><status>uncertain</status><reason>证据不足</reason><evidence><item>尚未确认</item></evidence></relationship><page type="impression"><title>印象</title><body>他很克制。</body></page><page type="daily_note"><title>日常</title><body>我们一起吃饭。</body></page><page type="love_letter"><title>给你</title><body>我想你平安。</body></page><page type="romance_diary" save="false"></page></journal_batch>')`, sandbox);
assert.equal(taggedBatch.updates.length, 3);
assert.deepEqual(Array.from(taggedBatch.updates, item => item.type), ['impression', 'daily_note', 'love_letter']);
assert.equal(taggedBatch.accompaniment, undefined);

const repeatedBatch = vm.runInContext(`parseBatch('<journal_batch><page type="daily_note"><title>上旬</title><body>我们在雨里走。</body></page><page type="daily_note"><title>下旬</title><body>我们一起等花开。</body></page></journal_batch>')`, sandbox);
assert.equal(repeatedBatch.updates.length, 2);
assert.deepEqual(Array.from(repeatedBatch.updates, item => item.page.title), ['上旬', '下旬']);

const truncatedBatch = vm.runInContext(`parseBatch('<journal_batch><page type="impression"><title>仍然留下</title><body>即使最后一个标签被截断，这段完整正文也应保存')`, sandbox);
assert.equal(truncatedBatch.updates.length, 1);
assert.match(truncatedBatch.updates[0].page.body, /最后一个标签被截断/);

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
assert.equal(batchResult.accompaniment, undefined);

const legacyBook = vm.runInContext(`migrateBook({ pages: [{ type: 'first_impression', poem: { text: '旧诗' }, song: { title: '旧歌' }, hasRoundAccompaniment: true }] })`, sandbox);
assert.equal(legacyBook.version, 10);
assert.equal(legacyBook.pages[0].type, 'impression');
assert.equal(legacyBook.pages[0].impressionStage, 'initial');
assert.equal(legacyBook.pages[0].poem, undefined);
assert.equal(legacyBook.pages[0].song, undefined);
assert.equal(legacyBook.pages[0].hasRoundAccompaniment, undefined);
assert.deepEqual(Object.keys(legacyBook.calendar.entries), []);

const calendarBook = vm.runInContext(`migrateBook({ pages: [], calendar: { entries: {
  '2026-09-01': { emoji: '🌷', updatedAt: '2026-09-01T08:00:00.000Z' }
} } })`, sandbox);
sandbox.calendarBook = calendarBook;
const september = vm.runInContext(`calendarMonthModel('2026-09', calendarBook.calendar)`, sandbox);
assert.equal(september.label, '2026年9月');
assert.equal(september.cells.length, 42);
assert.equal(september.cells[1].dateKey, '2026-09-01');
assert.equal(september.cells[1].emoji, '🌷');
assert.equal(vm.runInContext(`setCalendarEntry(calendarBook, '2026-09-02', '🌙')`, sandbox), true);
assert.equal(calendarBook.calendar.entries['2026-09-02'].emoji, '🌙');
assert.equal(vm.runInContext(`setCalendarEntry(calendarBook, '2026-09-02', '')`, sandbox), true);
assert.equal(calendarBook.calendar.entries['2026-09-02'].deleted, true);

const cloudSnapshot = vm.runInContext(`createSyncedBookSnapshot({
  version: 10,
  pages: [{ id: 'with-sticker', type: 'daily_note', body: '正文里的 Emoji 🫶', stickers: [{ id: 'large', dataUrl: 'data:image/png;base64,AAAA' }] }],
  calendar: { entries: { '2026-09-03': { emoji: '☕', updatedAt: 'now' } } }
})`, sandbox);
assert.equal(cloudSnapshot.pages[0].body, '正文里的 Emoji 🫶');
assert.equal(cloudSnapshot.pages[0].stickers, undefined, '聊天元数据不得塞入本机表情包二进制');
assert.equal(cloudSnapshot.calendar.entries['2026-09-03'].emoji, '☕');

const crossDeviceMerge = vm.runInContext(`mergeStoredBooks(
  { updatedAt: '2026-08-01T00:00:00.000Z', persistenceRevision: 99, relationship: { status: 'unchecked' }, pages: [{ id: 'old-local', body: '旧设备本地页' }] },
  { updatedAt: '2026-09-01T00:00:00.000Z', persistenceRevision: 2, relationship: { status: 'partners' }, pages: [{ id: 'new-remote', body: '新设备同步页' }] }
)`, sandbox);
assert.equal(crossDeviceMerge.relationship.status, 'partners', '跨设备合并应优先采用更新时间更晚的状态，而不是单机修订次数');
assert.deepEqual(Array.from(crossDeviceMerge.pages, page => page.id).sort(), ['new-remote', 'old-local']);

const separatedPages = vm.runInContext(`pagesForType({ pages: [
  { type: 'impression', title: '印象一' },
  { type: 'love_letter', title: '情书一' },
  { type: 'daily_note', title: '日记一' }
] }, 'daily_note')`, sandbox);
assert.equal(separatedPages.length, 1);
assert.equal(separatedPages[0].title, '日记一');

const foldedPageHtml = vm.runInContext(`renderPage({
  id: 'page-1', type: 'daily_note', title: '折叠标题', dateLabel: '此刻', mood: '安静',
  body: '第一段。\\n\\n第二段。', confidence: 'high', memoryAnchors: []
})`, sandbox);
assert.match(foldedPageHtml, /^<details class="pj-page"/);
assert.doesNotMatch(foldedPageHtml, /<details class="pj-page" open>/);
assert.match(foldedPageHtml, /<summary>/);
assert.doesNotMatch(foldedPageHtml, /confidence|记忆锚点|本轮诗句与配乐/);
assert.match(foldedPageHtml, /<div class="pj-body"><p>第一段。<\/p><p>第二段。<\/p><\/div>/);

const initialImpressionHtml = vm.runInContext(`renderPage({
  id: 'impression-1', type: 'impression', impressionStage: 'initial', title: '第一次看见你',
  dateLabel: '最初', mood: '好奇', body: '我先记住了你的沉默。'
})`, sandbox);
assert.match(initialImpressionHtml, /初印象/);

const quotePage = vm.runInContext(`createQuotePage({
  text: '“下雨了，就向我这边走。”',
  speaker: 'Character',
  sourceMessageIndex: 7,
  dateLabel: '雨夜'
})`, sandbox);
assert.equal(quotePage.type, 'quote_note');
assert.equal(quotePage.body, '“下雨了，就向我这边走。”');
assert.equal(quotePage.quoteSpeaker, 'Character');
assert.equal(quotePage.sourceMessageIndex, 7);

const quotePageHtml = vm.runInContext(`renderPage({
  id: 'quote-1', type: 'quote_note', title: '下雨了，就向我这边走', dateLabel: '雨夜', mood: '想留下来的话',
  body: '“下雨了，就向我这边走。”', quoteSpeaker: 'Character'
})`, sandbox);
assert.match(quotePageHtml, /pj-quote-page/);
assert.match(quotePageHtml, /Character/);

const wordParts = vm.runInContext(`buildWordDocumentParts({
  userName: '姜藏', characterName: '陈砚', pages: [
    { id: 'quote-1', type: 'quote_note', title: '雨夜对白', dateLabel: '雨夜', mood: '想留下来的话', body: '你 & 我 <一起>', quoteSpeaker: '陈砚', createdAt: '2025-01-18T00:00:00.000Z' },
    { id: 'daily-1', type: 'daily_note', title: '旧数据迁移', dateLabel: '从前', mood: '安静', body: '只保留这一段正文。', poem: { text: '不应导出的旧诗句' }, song: { title: '不应导出的旧歌曲', excerpt: '不应导出的旧歌词' } }
  ],
  calendar: { entries: { '2026-09-02': { emoji: '🌷', updatedAt: '2026-09-02T09:00:00.000Z' } } }
})`, sandbox);
assert.equal(typeof wordParts['[Content_Types].xml'], 'string');
assert.match(wordParts['word/document.xml'], /姜藏 × 陈砚的私语手札/);
assert.match(wordParts['word/document.xml'], /你 &amp; 我 &lt;一起&gt;/);
assert.match(wordParts['word/document.xml'], /只保留这一段正文/);
assert.doesNotMatch(wordParts['word/document.xml'], /不应导出的旧诗句|不应导出的旧歌曲|不应导出的旧歌词/);
assert.match(wordParts['word/document.xml'], /心情月历/);
assert.match(wordParts['word/document.xml'], /2026-09-02　🌷/);
assert.match(wordParts['word/styles.xml'], /w:styleId="Quote"/);
const wordZip = vm.runInContext(`createStoredZip(buildWordDocumentParts({ userName: '姜藏', characterName: '陈砚', pages: [] }))`, sandbox);
assert.deepEqual(Array.from(wordZip.slice(0, 4)), [80, 75, 3, 4]);

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

const relativeDayMarker = vm.runInContext(`detectStoryDayMarker('次日清晨，窗外的雨已经停了。')`, sandbox);
assert.equal(relativeDayMarker.type, 'relative');
assert.equal(relativeDayMarker.label, '次日');
assert.equal(vm.runInContext(`detectStoryDayMarker('【翌日】\\n晨光落进房间。').type`, sandbox), 'relative');
const absoluteDayMarker = vm.runInContext(`detectStoryDayMarker('【2025年1月19日 · 清晨】\\n她推开了窗。')`, sandbox);
assert.equal(absoluteDayMarker.type, 'absolute');
assert.equal(absoluteDayMarker.key, 'date:2025-01-19');
assert.equal(vm.runInContext(`detectStoryDayMarker('我想起第二天要去买花。')`, sandbox), null);
const monthMarker = vm.runInContext(`detectStoryDayMarker('一个月后，院子里的花已经开了。')`, sandbox);
assert.equal(monthMarker.type, 'relative');
assert.equal(monthMarker.spanDays, 30);
assert.equal(monthMarker.isExtended, true);
const weeksMarker = vm.runInContext(`detectStoryDayMarker('数周后，他们终于回到了旧宅。')`, sandbox);
assert.equal(weeksMarker.spanDays >= 21, true);

const timelineBook = vm.runInContext(`({ timeline: {} })`, sandbox);
sandbox.timelineBook = timelineBook;
const baselineDecision = vm.runInContext(`observeStoryDay(timelineBook, { signature: 's1', content: '夜色很安静。' })`, sandbox);
assert.equal(baselineDecision.shouldUpdate, false);
assert.equal(baselineDecision.reason, 'baseline');
const sameDayDecision = vm.runInContext(`observeStoryDay(timelineBook, { signature: 's2', content: '他们继续聊了一会儿。' })`, sandbox);
assert.equal(sameDayDecision.shouldUpdate, false);
assert.equal(sameDayDecision.reason, 'same-day');
const nextDayDecision = vm.runInContext(`observeStoryDay(timelineBook, { signature: 's3', content: '第二天早上，他先醒了。' })`, sandbox);
assert.equal(nextDayDecision.shouldUpdate, true);
assert.equal(nextDayDecision.reason, 'relative-boundary');
const duplicateDecision = vm.runInContext(`observeStoryDay(timelineBook, { signature: 's3', content: '第二天早上，他先醒了。' })`, sandbox);
assert.equal(duplicateDecision.shouldUpdate, false);
assert.equal(duplicateDecision.reason, 'duplicate');

const datedTimelineBook = vm.runInContext(`({ timeline: {} })`, sandbox);
sandbox.datedTimelineBook = datedTimelineBook;
assert.equal(vm.runInContext(`observeStoryDay(datedTimelineBook, { signature: 'd1', content: '2025年1月18日，雪落下来。' }).shouldUpdate`, sandbox), false);
assert.equal(vm.runInContext(`observeStoryDay(datedTimelineBook, { signature: 'd2', content: '2025年1月18日晚，他们回到家。' }).shouldUpdate`, sandbox), false);
assert.equal(vm.runInContext(`observeStoryDay(datedTimelineBook, { signature: 'd3', content: '2025年1月19日清晨，炉火熄了。' }).shouldUpdate`, sandbox), true);

const longTimelineBook = vm.runInContext(`({ timeline: {} })`, sandbox);
sandbox.longTimelineBook = longTimelineBook;
vm.runInContext(`observeStoryDay(longTimelineBook, { signature: 'm1', content: '2025年1月1日，雪还没有化。' })`, sandbox);
const monthDecision = vm.runInContext(`observeStoryDay(longTimelineBook, { signature: 'm2', content: '2025年2月1日，第一枝梅花开了。' })`, sandbox);
assert.equal(monthDecision.shouldUpdate, true);
assert.equal(monthDecision.period.spanDays, 31);
assert.equal(monthDecision.period.isExtended, true);
assert.match(monthDecision.period.label, /2025年1月1日/);

(async () => {
  let metadataSaveCalls = 0;
  const remoteOnlyBook = JSON.parse(JSON.stringify(vm.runInContext('blankBook()', sandbox)));
  remoteOnlyBook.pages = [{ id: 'remote-diary', type: 'daily_note', title: '另一台设备的日记', body: '应该随聊天回来。' }];
  contextValue.chatMetadata = { st_private_journal: remoteOnlyBook };
  contextValue.saveMetadata = async () => { metadataSaveCalls += 1; };
  const cloudLocalStore = new Map();
  sandbox.SillyTavern.libs.localforage = {
    getItem: async key => cloudLocalStore.get(key) || null,
    setItem: async (key, value) => { cloudLocalStore.set(key, JSON.parse(JSON.stringify(value))); return value; },
  };
  await vm.runInContext('loadBook()', sandbox);
  assert.equal(vm.runInContext('currentBook.pages[0].id', sandbox), 'remote-diary', '新设备应从聊天元数据恢复手札');
  await vm.runInContext('saveBook()', sandbox);
  assert.ok(metadataSaveCalls >= 1, '保存手札时必须调用 SillyTavern 的服务端聊天元数据保存');
  assert.equal(contextValue.chatMetadata.st_private_journal.pages[0].id, 'remote-diary');

  let receivedOptions;
  contextValue.generateQuietPrompt = async options => {
    receivedOptions = options;
    return '正文 API 的返回内容';
  };
  const result = await vm.runInContext(`callCurrentMainApi('写一页日记')`, sandbox);
  assert.equal(result, '正文 API 的返回内容');
  assert.equal(receivedOptions.quietPrompt, '写一页日记');
  assert.equal(receivedOptions.skipWIAN, false);

  const realSetTimeout = sandbox.setTimeout;
  const realClearTimeout = sandbox.clearTimeout;
  const scheduledCallbacks = [];
  sandbox.setTimeout = callback => {
    scheduledCallbacks.push(callback);
    return scheduledCallbacks.length;
  };
  sandbox.clearTimeout = () => {};
  contextValue.chat = [{ is_user: false, is_system: false, mes: '正文生成前的旧回复。' }];
  Object.assign(contextValue.extensionSettings.st_private_journal, { followMainGeneration: true });
  vm.runInContext(`
    currentBook = blankBook();
    mainGenerationCycleSeen = true;
    mainGenerationStartSignature = latestAssistantSignature();
    autoGenerationRetries = 0;
    scheduleAutoGeneration();
  `, sandbox);
  assert.equal(scheduledCallbacks.length, 1);
  await scheduledCallbacks.shift()();
  assert.equal(vm.runInContext('autoGenerationRetries', sandbox), 1);
  assert.equal(vm.runInContext('mainGenerationCycleSeen', sandbox), true);
  assert.equal(scheduledCallbacks.length, 1);
  contextValue.chat[0].mes = '第二天清晨，新的正文终于渲染完成。';
  await scheduledCallbacks.shift()();
  assert.equal(vm.runInContext('autoGenerationRetries', sandbox), 0);
  assert.equal(vm.runInContext('mainGenerationCycleSeen', sandbox), false);
  sandbox.setTimeout = realSetTimeout;
  sandbox.clearTimeout = realClearTimeout;

  let secondaryRequest;
  contextValue.characters = [{
    name: '陈砚',
    avatar: 'chenyan.png',
    data: {
      description: '陈砚是沉静克制的人。',
      personality: '温柔，但不轻易表达。',
      scenario: '两个人住在临江的旧宅。',
    },
  }];
  contextValue.characterId = 0;
  contextValue.name1 = '姜藏';
  contextValue.name2 = '陈砚';
  contextValue.powerUserSettings = { persona_description: '姜藏写字克制，句子很短。' };
  contextValue.maxContext = 8192;
  contextValue.extensionPrompts = { note: { value: '作者注释：只写已经发生的事。' } };
  contextValue.substituteParams = text => text;
  contextValue.getWorldInfoPrompt = async (chat, maxContext, dryRun, globalScanData) => {
    assert.equal(chat[0].includes('陈砚'), true);
    assert.equal(maxContext, 8192);
    assert.equal(dryRun, true);
    assert.match(globalScanData.personaDescription, /姜藏写字克制/);
    return { worldInfoBefore: '世界书：旧宅临江。', worldInfoAfter: '', worldInfoDepth: [] };
  };
  contextValue.ConnectionManagerRequestService = {
    getSupportedProfiles: () => [{ id: 'secondary-1', name: '手札副模型', model: 'diary-model' }],
    validateProfile: () => ({ selected: 'openai', source: 'custom' }),
    sendRequest: async (profileId, messages, maxTokens, options, overridePayload) => {
      secondaryRequest = { profileId, messages, maxTokens, options, overridePayload };
      return { content: '副 API 的返回内容' };
    },
  };
  Object.assign(contextValue.extensionSettings.st_private_journal, {
    generationApiMode: 'secondary',
    secondaryProfileId: 'secondary-1',
    secondaryModelId: 'diary-model',
  });
  contextValue.chat = [
    { is_user: true, is_system: false, mes: '今晚雨很大。' },
    { is_user: false, is_system: false, mes: '那就向我这边走。' },
  ];
  const secondaryResult = await vm.runInContext(`callJournalApi('整理今天的相处日记')`, sandbox);
  assert.equal(secondaryResult, '副 API 的返回内容');
  assert.equal(secondaryRequest.profileId, 'secondary-1');
  assert.equal(secondaryRequest.maxTokens, 5200);
  assert.equal(secondaryRequest.options.stream, false);
  assert.equal(secondaryRequest.overridePayload.model, 'diary-model');
  assert.match(secondaryRequest.messages[0].content, /陈砚是沉静克制的人/);
  assert.match(secondaryRequest.messages[0].content, /姜藏写字克制/);
  assert.match(secondaryRequest.messages[0].content, /世界书：旧宅临江/);
  assert.equal(secondaryRequest.messages.at(-1).content, '整理今天的相处日记');
  contextValue.getRequestHeaders = () => ({ 'Content-Type': 'application/json', 'X-Test': 'yes' });
  sandbox.fetch = async (endpoint, options) => {
    assert.equal(endpoint, '/api/backends/chat-completions/status');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Test'], 'yes');
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { data: [{ id: 'diary-model' }, { id: 'diary-model-pro' }] } }),
    };
  };
  const fetchedModels = await vm.runInContext(`fetchSecondaryModels('secondary-1')`, sandbox);
  assert.deepEqual(Array.from(fetchedModels), ['diary-model', 'diary-model-pro']);
  contextValue.extensionSettings.st_private_journal.generationApiMode = 'main';

  let batchApiCalls = 0;
  contextValue.generateQuietPrompt = async () => {
    batchApiCalls += 1;
    return JSON.stringify({
      relationship: { status: 'uncertain', reason: '证据不足', evidence: [] },
      updates: [
        { type: 'impression', shouldSave: true, page: { title: '印象', body: '他的语气很轻。' } },
        { type: 'daily_note', shouldSave: true, page: { title: '日常', body: '我们聊到深夜。' } },
        { type: 'love_letter', shouldSave: true, page: { title: '给你', body: '我想让你知道。' } },
        { type: 'romance_diary', shouldSave: false, page: null },
      ],
    });
  };
  vm.runInContext('currentBook = blankBook()', sandbox);
  await vm.runInContext(`generateBatch({ captureSignature: 'one-main-message' })`, sandbox);
  assert.equal(batchApiCalls, 1);
  assert.equal(vm.runInContext('currentBook.pages.length', sandbox), 3);
  assert.equal(vm.runInContext(`currentBook.pages.some(page => 'song' in page || 'poem' in page || 'hasRoundAccompaniment' in page)`, sandbox), false);

  const keyA = 'st_private_journal:book:chenyan.png:chat-a';
  const keyB = 'st_private_journal:book:chenyan.png:chat-b';
  const storedBooks = new Map([
    [keyA, { ...JSON.parse(JSON.stringify(vm.runInContext('blankBook()', sandbox))), chatId: 'chat-a', pages: [{ id: 'a-impression', type: 'impression', title: 'A的印象', body: 'A的内容' }] }],
    [keyB, { ...JSON.parse(JSON.stringify(vm.runInContext('blankBook()', sandbox))), chatId: 'chat-b', pages: [{ id: 'b-daily', type: 'daily_note', title: 'B的日记', body: 'B的内容' }] }],
  ]);
  let releaseChatA;
  const chatAGate = new Promise(resolve => { releaseChatA = resolve; });
  sandbox.SillyTavern.libs.localforage = {
    getItem: async key => {
      if (key === keyA) await chatAGate;
      return storedBooks.has(key) ? JSON.parse(JSON.stringify(storedBooks.get(key))) : null;
    },
    setItem: async (key, value) => {
      storedBooks.set(key, JSON.parse(JSON.stringify(value)));
      return value;
    },
  };
  contextValue.chatMetadata = {};
  contextValue.chatId = 'chat-a';
  const staleLoad = vm.runInContext('loadBook()', sandbox);
  contextValue.chatId = 'chat-b';
  releaseChatA();
  await staleLoad;
  assert.equal(storedBooks.get(keyB).chatId, 'chat-b', '旧聊天的异步加载不能覆盖新聊天的手札');
  assert.equal(storedBooks.get(keyB).pages[0].id, 'b-daily', '新聊天已经保存的日记必须保留');

  const recoveryKey = 'st_private_journal:book:chenyan.png:chat-recovery';
  storedBooks.set(recoveryKey, {
    ...JSON.parse(JSON.stringify(vm.runInContext('blankBook()', sandbox))),
    chatId: 'chat-recovery',
    pages: [{ id: 'saved-daily', type: 'daily_note', title: '已经保存的日记', body: '日记正文' }],
  });
  storedBooks.set(`${recoveryKey}:backup`, {
    ...JSON.parse(JSON.stringify(vm.runInContext('blankBook()', sandbox))),
    chatId: 'chat-recovery',
    pages: [{ id: 'saved-impression', type: 'impression', title: '快照里的印象', body: '印象正文' }],
  });
  contextValue.chatMetadata = {};
  contextValue.chatId = 'chat-recovery';
  await vm.runInContext('loadBook()', sandbox);
  assert.deepEqual(
    Array.from(vm.runInContext('currentBook.pages', sandbox), page => page.id).sort(),
    ['saved-daily', 'saved-impression'],
    '加载时必须合并主存储和恢复快照中的历史页面',
  );
  assert.deepEqual(
    storedBooks.get(recoveryKey).pages.map(page => page.id).sort(),
    ['saved-daily', 'saved-impression'],
    '合并后的历史页面必须重新写回主存储',
  );
  assert.deepEqual(
    storedBooks.get(`${recoveryKey}:backup`).pages.map(page => page.id).sort(),
    ['saved-daily', 'saved-impression'],
    '合并后的历史页面必须同步到恢复快照',
  );
  vm.runInContext('currentBook = null', sandbox);
  await vm.runInContext('loadBook()', sandbox);
  assert.equal(vm.runInContext('currentBook.pages.length', sandbox), 2, '重新打开手札后页面仍需存在');

  const concurrentKey = 'st_private_journal:book:chenyan.png:chat-concurrent';
  const oldConcurrentBook = {
    ...JSON.parse(JSON.stringify(vm.runInContext('blankBook()', sandbox))),
    chatId: 'chat-concurrent',
    pages: [{ id: 'old-page', type: 'daily_note', title: '旧页', body: '旧内容' }],
  };
  storedBooks.set(concurrentKey, oldConcurrentBook);
  let releaseConcurrentLoad;
  const concurrentLoadGate = new Promise(resolve => { releaseConcurrentLoad = resolve; });
  sandbox.SillyTavern.libs.localforage.getItem = async key => {
    const snapshot = storedBooks.has(key) ? JSON.parse(JSON.stringify(storedBooks.get(key))) : null;
    if (key === concurrentKey) await concurrentLoadGate;
    return snapshot;
  };
  contextValue.chatMetadata = {};
  contextValue.chatId = 'chat-concurrent';
  const pendingConcurrentLoad = vm.runInContext('loadBook()', sandbox);
  sandbox.concurrentKey = concurrentKey;
  sandbox.concurrentBook = {
    ...oldConcurrentBook,
    pages: [{ id: 'new-impression', type: 'impression', title: '刚生成的印象', body: '不能丢失的新内容' }],
  };
  await vm.runInContext('currentBook = concurrentBook; currentBookStorageKey = concurrentKey; saveBook()', sandbox);
  releaseConcurrentLoad();
  await pendingConcurrentLoad;
  assert.equal(storedBooks.get(concurrentKey).pages[0].id, 'new-impression', '加载中的旧快照不能覆盖刚生成并保存的新页面');
  console.log('Private Journal smoke tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
