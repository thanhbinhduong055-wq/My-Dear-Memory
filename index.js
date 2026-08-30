const MODULE_ID = 'st_private_journal';
const STORAGE_PREFIX = `${MODULE_ID}:book:`;
const EXTENSION_SCRIPT_URL = document.currentScript?.src || '';

const DEFAULTS = {
  language: 'zh-CN',
  followMainGeneration: true,
  theme: 'botanical-noir',
  launcherPosition: null,
};

let root;
let currentBook = null;
let activeType = 'impression';
let activeImpressionFocus = 'overall';
let customImpressionRequest = '';
let quoteDraft = '';
let quoteSpeakerDraft = '';
let pendingQuoteSelection = null;
let bookOpen = false;
let mainGenerationActive = false;
let journalGenerationActive = false;
let relationshipCheckActive = false;
let mainGenerationCycleSeen = false;
let mainGenerationStartSignature = null;
let queuedType = null;
let autoGenerationTimer = null;
let pageTurnTimer = null;
let lastStatus = '等待正文';

const PAGE_TYPES = {
  impression: {
    label: '印象',
    icon: '✦',
    empty: '还没有留下关于对方的印象。',
    instruction: '以 User 的第一人称观察 Char，写 User 对 Char 的印象。重点服从 User 选择的观察方向；不是 Char 对 User 的评价，也不是情书。',
  },
  daily_note: {
    label: '相处日记',
    icon: '☕',
    empty: '还没有记录两个人的日常。',
    instruction: '以 User 的第一人称记录 User 与 Char 已经发生的日常相处、对话细节、共同事件与 User 当时的感受。不要写成告白信。',
  },
  love_letter: {
    label: '情书',
    icon: '✉',
    empty: '还没有写给对方的情书。',
    instruction: '这是 User 写给 Char 的高情感浓度情书。以 User 的第一人称直接对 Char 说话，正文中的“我”是 User、“你”是 Char。写出具体的眷恋、心疼、渴望、恐惧或不舍，允许脆弱与坦白，但必须落在真实细节上，不能只堆砌华丽形容词。绝对不要反写成 Char 给 User。',
  },
  romance_diary: {
    label: '恋爱日记',
    icon: '♡',
    empty: '恋爱日记还没有落笔。',
    instruction: '以 User 的第一人称记录 User 与 Char 作为伴侣之后的恋爱日常。正文至少三分之二用于 User 的内心感受、依恋、安心、不安、占有欲、亲密需求或关系变化，事件只作为情绪的锚点。只能使用已发生或上下文明示的内容。',
  },
  quote_note: {
    label: '小纸条',
    icon: '❝',
    empty: '还没有收起想一直记得的对白。',
    instruction: '这一栏只保存 User 亲手收录的对白，不调用模型生成。',
  },
};

const IMPRESSION_FOCUSES = {
  overall: { label: '整体印象', prompt: '综合外在、性格、言行和相处感受，形成一个有层次的整体印象。' },
  temperament: { label: '气质外貌', prompt: '聚焦 Char 的外貌、神态、声音、动作习惯与整体气质；只写上下文有依据的部分。' },
  personality: { label: '性格细节', prompt: '聚焦 Char 的性格、价值观、反应方式、优点、矛盾感与细微习惯。' },
  attraction: { label: '心动之处', prompt: '聚焦哪些真实细节令 User 在意、欣赏或心动，但不要擅自宣布双方已恋爱。' },
  custom: { label: '自定义', prompt: '严格围绕 User 输入的观察需求来写。' },
};

const THEMES = {
  'botanical-noir': { label: '暮色蔷薇', shortLabel: '蔷薇', asset: './assets/themes/cutouts/botanical-noir.png' },
  'rococo-garden': { label: '洛可可花园', shortLabel: '花园', asset: './assets/themes/cutouts/rococo-garden.png' },
  'indigo-reed': { label: '蓝染芒影', shortLabel: '蓝染', asset: './assets/themes/cutouts/indigo-reed.png' },
  'italian-marble': { label: '托斯卡纳纹理', shortLabel: '纹理', asset: './assets/themes/cutouts/italian-marble.png' },
  'magnolia-swallow': { label: '玉兰燕影', shortLabel: '玉兰', asset: './assets/themes/cutouts/magnolia-swallow.png' },
};

function themeAssetUrl(themeKey) {
  const asset = THEMES[themeKey]?.asset || THEMES[DEFAULTS.theme].asset;
  let baseUrl = EXTENSION_SCRIPT_URL;
  if (!baseUrl && document.styleSheets) {
    for (const sheet of document.styleSheets) {
      if (!sheet.href) continue;
      try {
        const ownsJournalStyles = [...(sheet.cssRules || [])].some(rule => String(rule.selectorText || '').includes('#private-journal'));
        if (ownsJournalStyles) { baseUrl = sheet.href; break; }
      } catch (error) { /* Cross-origin stylesheets cannot expose cssRules. */ }
    }
  }
  if (!baseUrl) return asset;
  try { return new URL(asset, baseUrl).href; } catch (error) { return asset; }
}

function ctx() {
  return SillyTavern.getContext();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function getSettings() {
  const context = ctx();
  context.extensionSettings[MODULE_ID] = Object.assign({}, DEFAULTS, context.extensionSettings[MODULE_ID] || {});
  return context.extensionSettings[MODULE_ID];
}

function identity() {
  const context = ctx();
  const character = context.characters?.[context.characterId];
  return {
    chatId: context.chatId || context.getCurrentChatId?.() || 'no-chat',
    characterId: context.groupId ? `group-${context.groupId}` : (character?.avatar || character?.name || context.name2 || 'no-character'),
    userName: context.name1 || 'User',
    characterName: context.groupId ? '群聊中的角色们' : (character?.name || context.name2 || 'Character'),
  };
}

function storageKey() {
  const id = identity();
  return `${STORAGE_PREFIX}${id.characterId}:${id.chatId}`;
}

function blankBook() {
  const id = identity();
  return {
    version: 7,
    ...id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    relationship: { status: 'unchecked', reason: '', evidence: [], checkedAt: null, source: null },
    timeline: { currentDayKey: null, currentDayLabel: '', daySequence: 0, lastObservedSignature: null, lastUpdatedDayKey: null },
    pages: [],
  };
}

async function loadBook() {
  currentBook = await SillyTavern.libs.localforage.getItem(storageKey()) || blankBook();
  migrateBook(currentBook);
  await SillyTavern.libs.localforage.setItem(storageKey(), currentBook);
  render();
}

function migrateBook(book) {
  book.version = 7;
  book.pages = Array.isArray(book.pages) ? book.pages : [];
  book.pages = book.pages.map(page => {
    if (page.type === 'first_impression') {
      page.type = 'impression';
      page.impressionStage = 'initial';
    }
    const repaired = repairStoredPage(page);
    delete repaired.poem;
    delete repaired.song;
    delete repaired.hasRoundAccompaniment;
    return repaired;
  });
  const impressions = book.pages.filter(page => page.type === 'impression');
  if (impressions.length && !impressions.some(page => page.impressionStage === 'initial')) {
    const oldest = [...impressions].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];
    oldest.impressionStage = 'initial';
  }
  book.relationship = Object.assign(
    { status: 'unchecked', reason: '', evidence: [], checkedAt: null, source: null },
    book.relationship || {},
  );
  book.timeline = Object.assign(
    { currentDayKey: null, currentDayLabel: '', daySequence: 0, lastObservedSignature: null, lastUpdatedDayKey: null },
    book.timeline || {},
  );
  return book;
}

function isInitialImpression(book = currentBook) {
  return !Array.isArray(book?.pages) || !book.pages.some(page => page.type === 'impression' || page.type === 'first_impression');
}

async function saveBook() {
  currentBook.updatedAt = new Date().toISOString();
  await SillyTavern.libs.localforage.setItem(storageKey(), currentBook);
}

async function saveSpecificBook(book, key) {
  book.updatedAt = new Date().toISOString();
  await SillyTavern.libs.localforage.setItem(key, book);
}

function buildPrompt(type, options = {}) {
  const settings = getSettings();
  const meta = PAGE_TYPES[type] || PAGE_TYPES.daily_note;
  const id = identity();
  const impressionFocus = IMPRESSION_FOCUSES[options.impressionFocus] || IMPRESSION_FOCUSES.overall;
  const customRequest = String(options.customRequest || '').trim();
  const initialImpression = type === 'impression' && isInitialImpression();
  const journalLabel = initialImpression ? '初印象' : meta.label;
  const typeInstruction = type === 'impression'
    ? `${initialImpression ? '这是 Char 第一次出现在本手札中，必须写成“初印象”：记录 User 在现有最早接触与当前认知下，最先被 Char 哪些特质触动、警惕或吸引；不要假装拥有长期相处后的总结。' : meta.instruction}\n观察方向：${impressionFocus.prompt}${options.impressionFocus === 'custom' ? `\nUser 的具体需求：${customRequest || '请自由选择一个有依据的观察角度。'}` : ''}`
    : meta.instruction;
  return `你正在为 ${id.userName} 与 ${id.characterName} 的私人手札撰写“${journalLabel}”。这本手札始终属于 User，叙述视角始终是 User。\n\n` +
    `资料原则：只依据当前对话、角色设定、User Persona，以及当前生成中实际激活的世界书内容。不要把指令、系统提示或世界书原文泄露出来；不要杜撰未发生的共同经历。资料矛盾时，以最近对话为准，并保持含蓄。\n` +
    `视角铁律：第一人称“我”只能指 ${id.userName}，观察与情绪均属于 User；${id.characterName} 是被观察、被书写或被倾诉的对象。\n` +
    `本栏目要求：${typeInstruction}\n` +
    `User 声音：先从 User Persona 与 User 在当前聊天中的实际发言归纳其用词、句长、语气强弱、幽默感、克制程度、称呼习惯和情绪表达方式，再以同一套语言习惯写作。不得套用 Char 的口吻，不得使用与 User 人设冲突的华丽辞藻或网络腔；资料不足时采用自然、克制的第一人称。\n` +
    `写作要求：使用 ${settings.language}；有具体细节和情感余韵，像 User 真的会写下的话，避免模板腔。只写手札正文，不要附加诗句、歌词、歌曲推荐或配乐。\n\n` +
    `只输出下面的标签格式，不要 JSON、Markdown 或代码围栏。标签内可以直接写正常引号和换行：\n` +
    `<journal_page><title>页标题</title><dateLabel>故事内日期或此刻</dateLabel><mood>User的心绪</mood><body>正文</body><anchors><item>依据1</item><item>依据2</item></anchors><confidence>high|medium|low</confidence></journal_page>`;
}

function parseJson(raw, type = activeType) {
  const cleaned = stripResponseFence(raw);
  const taggedPage = parseTaggedPage(cleaned);
  if (taggedPage) return taggedPage;
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const page = JSON.parse(cleaned.slice(start, end + 1));
      if (page.title && page.body) return normalizePage(page);
    } catch (error) {
      console.warn('[Private Journal] Strict JSON parse failed; trying local recovery.');
    }
  }
  const recoveredPage = parseLooseJsonPage(cleaned, type);
  if (recoveredPage) return recoveredPage;
  if (!cleaned) throw new Error('正文 API 返回了空内容');
  if (/^[\s\S]*\{\s*["'](?:title|body)["']\s*:/i.test(cleaned)) {
    throw new Error('模型返回的结构化内容不完整，已阻止代码样式文本写入手札');
  }
  const meta = PAGE_TYPES[type] || PAGE_TYPES.daily_note;
  return normalizePage({
    title: meta.label,
    dateLabel: '此刻',
    mood: '未命名的心绪',
    body: cleaned,
    confidence: 'low',
    memoryAnchors: [],
  });
}

function stripResponseFence(raw) {
  return String(raw || '').trim().replace(/^```(?:json|xml|html)?\s*/i, '').replace(/\s*```$/, '');
}

function decodeLooseText(value = '') {
  return String(value)
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function extractTagRaw(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(String(block || ''));
  return match ? match[1] : '';
}

function extractTag(block, tag) {
  return decodeLooseText(extractTagRaw(block, tag));
}

function extractTagItems(block) {
  return [...String(block || '').matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map(match => decodeLooseText(match[1]))
    .filter(Boolean)
    .slice(0, 8);
}

function parseTaggedPage(block) {
  if (!/<(?:journal_page|page)\b/i.test(String(block || ''))) return null;
  const pageBlock = extractTagRaw(block, 'journal_page') || String(block || '');
  const body = extractTag(pageBlock, 'body');
  if (!body) return null;
  const anchorsBlock = extractTagRaw(pageBlock, 'anchors');
  return normalizePage({
    title: extractTag(pageBlock, 'title') || '无题',
    dateLabel: extractTag(pageBlock, 'dateLabel') || '此刻',
    mood: extractTag(pageBlock, 'mood') || '未命名的心绪',
    body,
    memoryAnchors: extractTagItems(anchorsBlock),
    confidence: extractTag(pageBlock, 'confidence') || 'low',
  });
}

function extractLooseField(text, field, nextFields = []) {
  const startMatch = new RegExp(`["']${field}["']\\s*:\\s*["']`, 'i').exec(String(text || ''));
  if (!startMatch) return '';
  const tail = String(text).slice(startMatch.index + startMatch[0].length);
  if (nextFields.length) {
    const boundary = new RegExp(`["']\\s*,\\s*["'](?:${nextFields.join('|')})["']\\s*:`, 'i').exec(tail);
    if (boundary) return decodeLooseText(tail.slice(0, boundary.index));
  }
  const finalQuote = /["']\s*(?:,|}|$)/.exec(tail);
  return decodeLooseText(finalQuote ? tail.slice(0, finalQuote.index) : tail);
}

function parseLooseJsonPage(text, type = activeType) {
  const body = extractLooseField(text, 'body', ['poem', 'song', 'memoryAnchors', 'confidence']);
  if (!body) return null;
  const meta = PAGE_TYPES[type] || PAGE_TYPES.daily_note;
  return normalizePage({
    title: extractLooseField(text, 'title', ['dateLabel', 'mood', 'perspective', 'body']) || meta.label,
    dateLabel: extractLooseField(text, 'dateLabel', ['mood', 'perspective', 'body']) || '此刻',
    mood: extractLooseField(text, 'mood', ['perspective', 'body']) || '未命名的心绪',
    body,
    confidence: /["']confidence["']\s*:\s*["'](high|medium|low)["']/i.exec(text)?.[1] || 'low',
  });
}

function repairStoredPage(page) {
  const rawBody = String(page?.body || '').trim();
  if (!rawBody || !/^\{\s*["']title["']\s*:/i.test(rawBody) || !/["']body["']\s*:/.test(rawBody)) return page;
  try {
    const repaired = parseLooseJsonPage(rawBody, page.type);
    if (!repaired || repaired.body === rawBody) return page;
    return { ...page, ...repaired, id: page.id, type: page.type, createdAt: page.createdAt, source: page.source };
  } catch (error) {
    console.warn('[Private Journal] Could not repair a legacy leaked payload.', error);
    return page;
  }
}

function normalizePage(page) {
  return {
    title: String(page.title || '无题'),
    dateLabel: String(page.dateLabel || '此刻'),
    mood: String(page.mood || '未命名的心绪'),
    perspective: 'user',
    body: String(page.body || ''),
    memoryAnchors: Array.isArray(page.memoryAnchors) ? page.memoryAnchors.map(String).slice(0, 8) : [],
    confidence: ['high', 'medium', 'low'].includes(page.confidence) ? page.confidence : 'low',
  };
}

function buildRelationshipPrompt() {
  const id = identity();
  return `请只依据当前对话、角色设定、User Persona 与当前激活的世界书，判断 ${id.userName} 和 ${id.characterName} 在当前故事进度中是否已经明确建立伴侣/恋爱关系。\n\n` +
    `判定标准：只有双方已明确确认恋爱、情侣、伴侣、配偶关系，或上下文清楚表明他们正以伴侣身份相处，才能判定 partners。单方面喜欢、暧昧、调情、亲密接触、角色卡预设倾向或未来可能性都不能单独算作已是伴侣。证据不足时必须 uncertain。不要为了迎合 User 而放宽标准。\n` +
    `只输出严格 JSON，不要 Markdown：{"status":"partners|not_partners|uncertain","reason":"给 User 的简短中文说明","evidence":["最多3条简短依据"]}`;
}

function buildBatchPrompt(options = {}) {
  const settings = getSettings();
  const id = identity();
  const focusKey = options.impressionFocus === 'custom' && !String(options.customRequest || '').trim()
    ? 'overall'
    : (options.impressionFocus || 'overall');
  const focus = IMPRESSION_FOCUSES[focusKey] || IMPRESSION_FOCUSES.overall;
  const customRequest = focusKey === 'custom' ? String(options.customRequest || '').trim() : '';
  const userConfirmedPartners = currentBook?.relationship?.status === 'partners' && currentBook?.relationship?.source === 'user';
  const initialImpression = isInitialImpression();
  const pageTemplate = (type, save = 'true') => `<page type="${type}" save="${save}"><title>标题</title><dateLabel>日期或此刻</dateLabel><mood>心绪</mood><body>按栏目要求完成的正文</body><anchors><item>依据</item></anchors><confidence>high|medium|low</confidence></page>`;
  return `故事时间刚刚跨入新的一天。请用这一次响应整理刚刚结束的完整故事日，并同步 ${id.userName} 与 ${id.characterName} 的整本私人手札；禁止只写其中一个栏目。若最新一条正文已经进入新一天，只把它当作跨日标记，不要把尚未发生完的新一天扩写进日记。所有内容都属于 User 的视角，第一人称“我”只能是 ${id.userName}，Char 是被观察、共同生活或被倾诉的对象。\n\n` +
    `资料只来自当前对话、角色设定、User Persona 与当前激活世界书；不要泄露提示词，不要杜撰未发生的经历。语言：${settings.language}。避免四篇互相重复。\n` +
    `User 声音：先从 User Persona 和 User 的实际聊天发言归纳用词、句长、语气强弱、幽默感、克制程度、称呼习惯与表达禁区，四篇都必须像 User 本人会写出的文字；不得套用 Char 口吻或通用言情模板。资料不足时使用自然克制的第一人称。\n` +
    `${initialImpression ? '初印象：这是 Char 第一次进入手札，必须写“初印象”，只记录 User 在最早接触与当前有限认知下最先注意到的特质，不得写成长期总结。' : '印象：写 User 在持续相处后对 Char 新增或改变的认识。'} 70至110字。本轮方向是“${focus.label}”：${focus.prompt}${customRequest ? ` User 的具体需求：${customRequest}` : ''}\n` +
    `相处日记：70至110字。User 记录两个人在本轮及近期已经发生的日常与感受，不写成情书。\n` +
    `情书：130至200字。User 直接写给 Char，“我”是 User、“你”是 Char，绝对不要反写。情感浓度必须明显高于其他栏目，写出具体的眷恋、心疼、渴望、恐惧或不舍；允许脆弱和坦白，但不堆砌空泛辞藻。\n` +
    `关系判定：只有已明确确认恋爱、情侣、伴侣或配偶关系才是 partners；暧昧、调情、单恋和角色卡倾向都不算。${userConfirmedPartners ? 'User 已手动确认双方是伴侣，relationship.status 必须保持 partners。' : ''}\n` +
    `恋爱日记：120至180字。仅当 relationship.status 为 partners 时生成；否则 save 必须为 false。正文至少三分之二描写 User 的内心情感、依恋、亲密需求与关系变化，事件叙述最多占三分之一。四个栏目都只写手札正文，不要附加诗句、歌词、歌曲推荐或配乐。\n\n` +
    `只输出下列标签协议，不要 JSON、Markdown 或代码围栏。标签内可以直接写引号和换行。必须按顺序完整输出 relationship、impression、daily_note、love_letter；不得写“同上”“使用相同标签”等省略语。只有伴侣关系成立时才填写 romance_diary：\n` +
    `<journal_batch><relationship><status>partners|not_partners|uncertain</status><reason>简短说明</reason><evidence><item>依据</item></evidence></relationship>` +
    pageTemplate('impression') + pageTemplate('daily_note') + pageTemplate('love_letter') +
    `${pageTemplate('romance_diary', userConfirmedPartners ? 'true' : 'true或false')}</journal_batch>`;
}

function parseRelationship(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('关系判定没有返回有效 JSON');
  const result = JSON.parse(cleaned.slice(start, end + 1));
  return normalizeRelationship(result);
}

function normalizeRelationship(result = {}) {
  const status = ['partners', 'not_partners', 'uncertain'].includes(result.status) ? result.status : 'uncertain';
  return {
    status,
    reason: String(result.reason || '没有提供判定说明。'),
    evidence: Array.isArray(result.evidence) ? result.evidence.map(String).slice(0, 3) : [],
    checkedAt: new Date().toISOString(),
    source: 'model',
  };
}

function parseBatch(raw) {
  const cleaned = stripResponseFence(raw);
  const taggedBatch = parseTaggedBatch(cleaned);
  if (taggedBatch) return taggedBatch;
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('批量手札没有返回有效 JSON');
  let payload;
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new Error('批量手札格式损坏，已阻止代码样式文本写入页面');
  }
  const rawUpdates = Array.isArray(payload.updates)
    ? payload.updates
    : Object.entries(payload.updates || {}).map(([type, value]) => ({ type, ...(value || {}) }));
  const allowedTypes = new Set(['impression', 'daily_note', 'love_letter', 'romance_diary']);
  const seenTypes = new Set();
  const updates = rawUpdates
    .filter(item => {
      if (!item || !allowedTypes.has(item.type) || item.shouldSave === false || !item.page || seenTypes.has(item.type)) return false;
      seenTypes.add(item.type);
      return true;
    })
    .map(item => ({ type: item.type, page: normalizePage(item.page) }));
  return { relationship: normalizeRelationship(payload.relationship || {}), updates };
}

function parseTaggedBatch(text) {
  if (!/<journal_batch\b/i.test(String(text || '')) && !/<page\b[^>]*type=/i.test(String(text || ''))) return null;
  const relationshipBlock = extractTagRaw(text, 'relationship');
  const relationship = normalizeRelationship({
    status: extractTag(relationshipBlock, 'status'),
    reason: extractTag(relationshipBlock, 'reason'),
    evidence: extractTagItems(extractTagRaw(relationshipBlock, 'evidence')),
  });
  const source = String(text || '');
  const starts = [...source.matchAll(/<page\b([^>]*)>/gi)];
  const updates = [];
  const seenTypes = new Set();
  for (let index = 0; index < starts.length; index += 1) {
    const match = starts[index];
    const attrs = match[1] || '';
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const saveValue = /\bsave\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase();
    if (!['impression', 'daily_note', 'love_letter', 'romance_diary'].includes(type) || saveValue === 'false' || seenTypes.has(type)) continue;
    const contentStart = match.index + match[0].length;
    const contentEnd = starts[index + 1]?.index ?? source.indexOf('</journal_batch>', contentStart);
    const rawBlock = source.slice(contentStart, contentEnd >= 0 ? contentEnd : source.length).replace(/<\/page>\s*$/i, '');
    const page = parseTaggedPage(`<page>${rawBlock}</page>`);
    if (!page) continue;
    seenTypes.add(type);
    updates.push({ type, page });
  }
  return { relationship, updates };
}

function isRomanceUnlocked() {
  return currentBook?.relationship?.status === 'partners';
}

function createId() {
  const context = ctx();
  if (typeof context.uuidv4 === 'function') return context.uuidv4();
  if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function latestAssistantSignature() {
  return latestAssistantInfo()?.signature || null;
}

function latestAssistantInfo() {
  const context = ctx();
  const chat = Array.isArray(context.chat) ? context.chat : [];
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const message = chat[index];
    if (!message?.is_user && !message?.is_system && String(message?.mes || '').trim()) {
      const content = String(message.mes);
      let hash = 0;
      for (let i = 0; i < content.length; i += 1) hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
      return {
        signature: `${identity().chatId}:${index}:${message.swipe_id ?? 0}:${hash}`,
        content,
        index,
      };
    }
  }
  return null;
}

function detectStoryDayMarker(content = '') {
  const head = String(content)
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[\s\u3000*_#>`「」『』“”'"【】\[\]（）()—-]+/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
  if (!head) return null;

  const fullDate = /(?:^|[【\[(（\s])((?:19|20)\d{2})[年\/.\-](\d{1,2})[月\/.\-](\d{1,2})日?/.exec(head);
  if (fullDate && fullDate.index <= 36) {
    const year = fullDate[1];
    const month = fullDate[2].padStart(2, '0');
    const day = fullDate[3].padStart(2, '0');
    return { type: 'absolute', key: `date:${year}-${month}-${day}`, label: `${year}年${Number(month)}月${Number(day)}日` };
  }

  const monthDay = /(?:^|[【\[(（\s])(\d{1,2})月(\d{1,2})日/.exec(head);
  if (monthDay && monthDay.index <= 36) {
    const month = monthDay[1].padStart(2, '0');
    const day = monthDay[2].padStart(2, '0');
    return { type: 'absolute', key: `date:unknown-${month}-${day}`, label: `${Number(month)}月${Number(day)}日` };
  }

  const relative = /^(?:[【\[(（][^】\])）]{0,24}[】\])）]\s*)?(次日|翌日|第二天|隔天|又过了一天|新的一天|第二日|次晨|翌晨)(?:[】\])）]\s*)?(?:清晨|早晨|早上|上午|中午|午后|傍晚|晚上|夜里)?(?:[】\])）]\s*)?(?:[，。,:：\s]|$)/.exec(head);
  if (relative) return { type: 'relative', key: null, label: relative[1] };
  return null;
}

function observeStoryDay(book, assistantInfo) {
  book.timeline = Object.assign(
    { currentDayKey: null, currentDayLabel: '', daySequence: 0, lastObservedSignature: null, lastUpdatedDayKey: null },
    book.timeline || {},
  );
  const timeline = book.timeline;
  const signature = assistantInfo?.signature || null;
  if (!signature || timeline.lastObservedSignature === signature) {
    return { shouldUpdate: false, reason: 'duplicate', marker: null };
  }

  const marker = detectStoryDayMarker(assistantInfo.content);
  timeline.lastObservedSignature = signature;
  if (!timeline.currentDayKey) {
    timeline.currentDayKey = marker?.type === 'absolute' ? marker.key : 'story-day:0';
    timeline.currentDayLabel = marker?.label || '当前故事日';
    return { shouldUpdate: false, reason: 'baseline', marker };
  }

  if (!marker) return { shouldUpdate: false, reason: 'same-day', marker: null };
  if (marker.type === 'absolute') {
    if (timeline.currentDayKey === marker.key) return { shouldUpdate: false, reason: 'same-day', marker };
    if (timeline.currentDayKey === 'story-day:0') {
      timeline.currentDayKey = marker.key;
      timeline.currentDayLabel = marker.label;
      return { shouldUpdate: false, reason: 'dated-baseline', marker };
    }
    const completedDayLabel = timeline.currentDayLabel || '上一故事日';
    timeline.currentDayKey = marker.key;
    timeline.currentDayLabel = marker.label;
    return { shouldUpdate: true, reason: 'absolute-boundary', marker, completedDayLabel };
  }

  const completedDayLabel = timeline.currentDayLabel || '上一故事日';
  timeline.daySequence = Number(timeline.daySequence || 0) + 1;
  timeline.currentDayKey = `story-day:${timeline.daySequence}`;
  timeline.currentDayLabel = marker.label;
  return { shouldUpdate: true, reason: 'relative-boundary', marker, completedDayLabel };
}

function setStatus(message) {
  lastStatus = message;
  const status = root?.querySelector('.pj-status');
  if (status) {
    status.textContent = message === '等待正文' ? '' : message;
    status.hidden = !status.textContent;
  }
}

function setGeneratingUi(generating) {
  const button = root?.querySelector('[data-action="generate"]');
  if (!button) return;
  const isQuote = activeType === 'quote_note';
  button.disabled = generating || (isQuote && !quoteDraft.trim());
  button.textContent = generating ? '正在拾取回忆…' : (isQuote ? '保存小纸条' : `生成${PAGE_TYPES[activeType]?.label || '这一页'}`);
}

async function callCurrentMainApi(prompt) {
  const context = ctx();
  if (typeof context.generateQuietPrompt !== 'function') {
    throw new Error('当前 SillyTavern 没有提供 generateQuietPrompt，请升级到最新版');
  }
  if (context.onlineStatus === 'no_connection') {
    throw new Error('正文 API 尚未连接，请先确认普通角色回复可以生成');
  }
  const result = await context.generateQuietPrompt({
    quietPrompt: prompt,
    quietToLoud: false,
    skipWIAN: false,
    removeReasoning: true,
  });
  if (typeof result !== 'string' || !result.trim()) throw new Error('正文 API 返回了空内容');
  return result;
}

async function checkRelationship() {
  if (mainGenerationActive || journalGenerationActive || relationshipCheckActive) {
    toastr.info('请等待当前生成结束后再判定关系。', '私语手札');
    return;
  }
  relationshipCheckActive = true;
  setStatus('正在依据当前故事判定关系…');
  renderControls();
  try {
    const result = await callCurrentMainApi(buildRelationshipPrompt());
    currentBook.relationship = parseRelationship(result);
    await saveBook();
    setStatus(isRomanceUnlocked() ? '已确认伴侣关系，恋爱日记已解锁' : '尚未确认伴侣关系');
    toastr[isRomanceUnlocked() ? 'success' : 'info'](
      isRomanceUnlocked() ? '关系成立，恋爱日记已解锁。' : '当前依据不足，恋爱日记仍保持锁定。',
      '私语手札',
    );
  } catch (error) {
    console.error('[Private Journal]', error);
    setStatus(`关系判定失败：${error?.message || error}`);
    toastr.error(`关系判定失败：${error?.message || error}`, '私语手札');
  } finally {
    relationshipCheckActive = false;
    render();
  }
}

async function confirmRelationshipManually() {
  currentBook.relationship = {
    status: 'partners',
    reason: '由 User 确认当前故事中双方已经是伴侣。',
    evidence: [],
    checkedAt: new Date().toISOString(),
    source: 'user',
  };
  await saveBook();
  setStatus('User 已确认伴侣关系，恋爱日记已解锁');
  render();
}

async function resetRelationship() {
  currentBook.relationship = { status: 'unchecked', reason: '', evidence: [], checkedAt: null, source: null };
  await saveBook();
  setStatus('伴侣关系已重置，恋爱日记已锁定');
  render();
}

async function generatePage({ type = activeType, source = 'manual', captureSignature = null } = {}) {
  if (!ctx().chatId && !ctx().getCurrentChatId?.()) {
    toastr.warning('请先打开一个角色聊天。', '私语手札');
    return;
  }
  if (type === 'romance_diary' && !isRomanceUnlocked()) {
    setStatus('恋爱日记尚未解锁');
    if (source === 'manual') toastr.warning('请先判定或确认双方已经是伴侣。', '私语手札');
    return;
  }
  if (type === 'impression' && activeImpressionFocus === 'custom' && !customImpressionRequest.trim()) {
    toastr.warning('请先写下你希望观察 Char 的哪个方面。', '私语手札');
    return;
  }
  if (journalGenerationActive) {
    if (source === 'manual') toastr.info('已有一页正在生成。', '私语手札');
    return;
  }
  if (mainGenerationActive) {
    queuedType = type;
    setStatus(`已排队：正文结束后生成${PAGE_TYPES[type]?.label || '日记'}`);
    if (source === 'manual') toastr.info('已排队，将在正文回复完成后生成。', '私语手札');
    return;
  }

  const targetBook = currentBook;
  const targetStorageKey = storageKey();
  const signature = captureSignature || latestAssistantSignature();
  if (source === 'auto' && signature && targetBook?.lastCapturedSignature === signature) return;

  journalGenerationActive = true;
  setGeneratingUi(true);
  setStatus(source === 'auto' ? '正文完成，正在生成手札…' : '正在调用当前正文 API…');
  try {
    const generationOptions = type === 'impression'
      ? { impressionFocus: activeImpressionFocus, customRequest: customImpressionRequest }
      : {};
    const result = await callCurrentMainApi(buildPrompt(type, generationOptions));
    const page = parseJson(result, type);
    page.id = createId();
    page.type = type;
    page.createdAt = new Date().toISOString();
    page.source = source;
    page.captureSignature = signature;
    if (type === 'impression') {
      page.impressionStage = isInitialImpression(targetBook) ? 'initial' : 'evolving';
      page.impressionFocus = activeImpressionFocus;
      page.impressionFocusLabel = activeImpressionFocus === 'custom'
        ? customImpressionRequest.trim()
        : IMPRESSION_FOCUSES[activeImpressionFocus]?.label;
    }
    targetBook.pages.unshift(page);
    if (signature) targetBook.lastCapturedSignature = signature;
    await saveSpecificBook(targetBook, targetStorageKey);
    if (currentBook === targetBook) render();
    setStatus('本页已写入');
    toastr.success('新的一页已经写好。', '私语手札');
  } catch (error) {
    console.error('[Private Journal]', error);
    const message = error?.message || String(error);
    setStatus(`生成失败：${message}`);
    const hint = message === 'OK' ? '（API 返回了无说明错误，请检查正文 API 控制台）' : '';
    toastr.error(`生成失败：${message}${hint}`, '私语手札', { timeOut: 10000 });
  } finally {
    journalGenerationActive = false;
    setGeneratingUi(false);
  }
}

async function generateBatch({ captureSignature = null } = {}) {
  if (!ctx().chatId && !ctx().getCurrentChatId?.()) return false;
  if (journalGenerationActive || mainGenerationActive) return false;

  const targetBook = currentBook;
  const targetStorageKey = storageKey();
  const signature = captureSignature || latestAssistantSignature();
  if (signature && targetBook?.lastCapturedSignature === signature) return false;

  const focusKey = activeImpressionFocus === 'custom' && !customImpressionRequest.trim()
    ? 'overall'
    : activeImpressionFocus;
  const batchOptions = { impressionFocus: focusKey, customRequest: customImpressionRequest };
  journalGenerationActive = true;
  setGeneratingUi(true);
  setStatus('正文完成，正在用一次 API 同步全部手札…');
  try {
    const result = await callCurrentMainApi(buildBatchPrompt(batchOptions));
    const batch = parseBatch(result);
    const manualRelationship = targetBook.relationship?.source === 'user' && targetBook.relationship?.status === 'partners';
    if (!manualRelationship) targetBook.relationship = batch.relationship;
    const romanceAllowed = targetBook.relationship?.status === 'partners';
    const pages = batch.updates.filter(item => item.type !== 'romance_diary' || romanceAllowed);
    if (!pages.length) throw new Error('本轮批量响应没有可保存的手札内容');
    const expectedTypes = ['impression', 'daily_note', 'love_letter', ...(romanceAllowed ? ['romance_diary'] : [])];
    const receivedTypes = new Set(pages.map(item => item.type));
    const missingTypes = expectedTypes.filter(type => !receivedTypes.has(type));

    const createdAt = new Date().toISOString();
    const initialImpression = isInitialImpression(targetBook);
    const roundId = createId();
    for (const item of pages) {
      const page = item.page;
      page.id = createId();
      page.type = item.type;
      page.roundId = roundId;
      page.createdAt = createdAt;
      page.source = 'auto-batch';
      page.captureSignature = signature;
      if (item.type === 'impression') {
        page.impressionStage = initialImpression ? 'initial' : 'evolving';
        page.impressionFocus = focusKey;
        page.impressionFocusLabel = focusKey === 'custom'
          ? customImpressionRequest.trim()
          : IMPRESSION_FOCUSES[focusKey]?.label;
      }
      targetBook.pages.unshift(page);
    }
    if (targetBook.timeline?.currentDayKey) targetBook.timeline.lastUpdatedDayKey = targetBook.timeline.currentDayKey;
    if (signature) targetBook.lastCapturedSignature = signature;
    await saveSpecificBook(targetBook, targetStorageKey);
    if (currentBook === targetBook) render();
    if (missingTypes.length) {
      const missingLabels = missingTypes.map(type => PAGE_TYPES[type].label).join('、');
      setStatus(`已保存 ${pages.length} 个板块；响应缺少：${missingLabels}`);
      toastr.warning(`本轮只解析到 ${pages.length} 个板块，缺少：${missingLabels}。未追加 API 请求。`, '私语手札', { timeOut: 10000 });
    } else {
      setStatus(`本轮一次 API 已同步 ${pages.length} 个板块`);
      toastr.success(`本轮手札已更新 ${pages.length} 个板块。`, '私语手札');
    }
    return true;
  } catch (error) {
    console.error('[Private Journal]', error);
    const message = error?.message || String(error);
    setStatus(`批量更新失败：${message}`);
    toastr.error(`批量更新失败：${message}`, '私语手札', { timeOut: 10000 });
    return false;
  } finally {
    journalGenerationActive = false;
    setGeneratingUi(false);
  }
}

function scheduleAutoGeneration() {
  if ((!getSettings().followMainGeneration && !queuedType) || journalGenerationActive || !mainGenerationCycleSeen) return;
  clearTimeout(autoGenerationTimer);
  autoGenerationTimer = setTimeout(async () => {
    const assistantInfo = latestAssistantInfo();
    const signature = assistantInfo?.signature || null;
    const hasNewAssistantContent = signature && signature !== mainGenerationStartSignature;
    if (!signature || currentBook?.lastCapturedSignature === signature || (!hasNewAssistantContent && !queuedType)) {
      mainGenerationCycleSeen = false;
      return;
    }
    const requestedType = queuedType;
    queuedType = null;
    mainGenerationCycleSeen = false;
    if (requestedType) {
      await generatePage({ type: requestedType, source: 'manual', captureSignature: signature });
      return;
    }
    if (getSettings().followMainGeneration) {
      const decision = observeStoryDay(currentBook, assistantInfo);
      await saveBook();
      if (decision.shouldUpdate) {
        setStatus(`已跨日，正在整理${decision.completedDayLabel || '上一故事日'}…`);
        await generateBatch({ captureSignature: signature });
      } else if (decision.reason === 'baseline' || decision.reason === 'dated-baseline') {
        setStatus('已建立故事日基线；跨日后自动整理');
      } else {
        setStatus('正在收集当天故事；跨日后再更新');
      }
    }
  }, 500);
}

async function deletePage(id) {
  if (!confirm('要撕掉这一页吗？此操作无法撤销。')) return;
  currentBook.pages = currentBook.pages.filter(page => page.id !== id);
  await saveBook();
  render();
}

function exportBook() {
  const blob = new Blob([JSON.stringify(currentBook, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `private-journal-${currentBook.characterName}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function createQuotePage({ text, speaker, sourceMessageIndex = null, dateLabel = '', source = 'manual-quote' } = {}) {
  const body = String(text || '').trim().slice(0, 1500);
  if (!body) throw new Error('请先写下或选中想收藏的对白');
  const plainTitle = body.replace(/[\r\n]+/g, ' ').replace(/^[“”「」『』"']+|[“”「」『』"']+$/g, '').trim();
  return {
    id: createId(),
    type: 'quote_note',
    title: `${plainTitle.slice(0, 18) || '未命名对白'}${plainTitle.length > 18 ? '…' : ''}`,
    dateLabel: String(dateLabel || currentBook?.timeline?.currentDayLabel || '此刻'),
    mood: '想留下来的话',
    perspective: 'user',
    body,
    quoteSpeaker: String(speaker || identity().characterName || 'Char').trim(),
    sourceMessageIndex: sourceMessageIndex !== null && sourceMessageIndex !== '' && Number.isFinite(Number(sourceMessageIndex)) ? Number(sourceMessageIndex) : null,
    source,
    createdAt: new Date().toISOString(),
    memoryAnchors: [],
    confidence: 'high',
  };
}

async function saveQuoteNote(input = {}) {
  try {
    if (!currentBook) throw new Error('手札还在加载，请稍后再收录');
    const page = createQuotePage({
      text: input.text ?? quoteDraft,
      speaker: input.speaker ?? quoteSpeakerDraft,
      sourceMessageIndex: input.sourceMessageIndex,
      dateLabel: input.dateLabel,
      source: input.source || 'manual-quote',
    });
    currentBook.pages.unshift(page);
    await saveBook();
    quoteDraft = '';
    quoteSpeakerDraft = '';
    pendingQuoteSelection = null;
    hideQuoteCapture();
    if (root?.classList.contains('open')) render();
    setStatus('已收进小纸条');
    toastr.success('这句话已经收好了。', '私语手札');
    return page;
  } catch (error) {
    toastr.warning(error?.message || String(error), '私语手札');
    return null;
  }
}

function selectionElement(selection) {
  const node = selection?.anchorNode || selection?.focusNode;
  return node?.nodeType === 1 ? node : node?.parentElement;
}

function readChatSelection() {
  const selection = window.getSelection?.();
  const text = String(selection?.toString() || '').trim();
  if (!selection || selection.isCollapsed || !text || text.length > 1500) return null;
  const element = selectionElement(selection);
  if (!element || root?.contains(element)) return null;
  const messageElement = element.closest?.('.mes, [mesid], [data-message-id]');
  if (!messageElement) return null;
  const rawIndex = messageElement.getAttribute?.('mesid') ?? messageElement.dataset?.messageId;
  const sourceMessageIndex = /^\d+$/.test(String(rawIndex ?? '')) ? Number(rawIndex) : null;
  const message = sourceMessageIndex === null ? null : ctx().chat?.[sourceMessageIndex];
  const id = identity();
  const domSpeaker = messageElement.querySelector?.('.name_text, .ch_name, [data-name]')?.textContent?.trim();
  const speaker = message ? (message.is_user ? id.userName : id.characterName) : (domSpeaker || id.characterName);
  let rect;
  try { rect = selection.getRangeAt(0).getBoundingClientRect(); } catch (error) { rect = null; }
  return { text, speaker, sourceMessageIndex, rect };
}

function hideQuoteCapture() {
  const capture = document.querySelector?.('#private-journal-quote-capture');
  if (capture) capture.hidden = true;
}

function positionQuoteCapture(selectionInfo) {
  const capture = document.querySelector?.('#private-journal-quote-capture');
  if (!capture || !selectionInfo?.rect) return;
  const rect = selectionInfo.rect;
  capture.hidden = false;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2), window.innerWidth - 92);
  const top = Math.min(Math.max(12, rect.bottom + 9), window.innerHeight - 52);
  capture.style.left = `${left}px`;
  capture.style.top = `${top}px`;
}

function installQuoteCapture() {
  if (document.querySelector('#private-journal-quote-capture')) return;
  const capture = document.createElement('button');
  capture.id = 'private-journal-quote-capture';
  capture.type = 'button';
  capture.hidden = true;
  capture.textContent = '收进小纸条';
  capture.setAttribute('aria-label', '把选中的对白收进小纸条');
  capture.addEventListener('pointerdown', event => event.preventDefault());
  capture.addEventListener('click', async event => {
    event.preventDefault();
    const selected = pendingQuoteSelection;
    if (selected) await saveQuoteNote({ ...selected, source: 'chat-selection' });
  });
  document.body.append(capture);
  document.addEventListener('pointerup', event => {
    if (capture.contains(event.target)) return;
    setTimeout(() => {
      const selected = readChatSelection();
      pendingQuoteSelection = selected;
      if (selected) positionQuoteCapture(selected);
      else hideQuoteCapture();
    }, 0);
  });
  document.addEventListener('selectionchange', () => {
    if (!window.getSelection?.()?.toString().trim()) {
      pendingQuoteSelection = null;
      hideQuoteCapture();
    }
  });
}

function xmlEscape(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character]));
}

function wordParagraph(text, style = 'Normal', { pageBreakBefore = false, align = '' } = {}) {
  const paragraphProperties = [
    style ? `<w:pStyle w:val="${xmlEscape(style)}"/>` : '',
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${paragraphProperties}</w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function wordBodyParagraphs(text, style = 'Normal') {
  return String(text || '').split(/\r?\n/).map(line => wordParagraph(line || ' ', style)).join('');
}

function buildWordDocumentParts(book = currentBook) {
  const safeBook = book || { pages: [] };
  const userName = String(safeBook.userName || identity().userName);
  const characterName = String(safeBook.characterName || identity().characterName);
  const pages = Array.isArray(safeBook.pages) ? safeBook.pages : [];
  const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const sections = [];
  for (const [type, meta] of Object.entries(PAGE_TYPES)) {
    const entries = pagesForType({ pages }, type).slice().reverse();
    if (!entries.length) continue;
    sections.push(wordParagraph(meta.label, 'Heading1'));
    for (const page of entries) {
      sections.push(wordParagraph(page.title || meta.label, 'Heading2'));
      if (type === 'quote_note') {
        sections.push(wordBodyParagraphs(page.body, 'Quote'));
        sections.push(wordParagraph(`${page.quoteSpeaker || characterName}  ·  ${page.dateLabel || '此刻'}`, 'Meta'));
        continue;
      }
      sections.push(wordParagraph(`${page.dateLabel || '此刻'}  ·  ${page.mood || '未命名的心绪'}`, 'Meta'));
      sections.push(wordBodyParagraphs(page.body));
    }
  }
  if (!sections.length) sections.push(wordParagraph('还没有写下任何一页。'));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${wordParagraph(`${userName} × ${characterName}的私语手札`, 'Title')}${wordParagraph(`PRIVATE JOURNAL  ·  导出于 ${exportedAt}`, 'Meta', { align: 'center' })}${sections.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="342821"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160" w:line="320" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="方正小标宋简体"/><w:b/><w:color w:val="713C46"/><w:sz w:val="60"/><w:szCs w:val="60"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="200"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="713C46"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="5A3F43"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720"/><w:spacing w:before="80" w:after="160" w:line="320" w:lineRule="auto"/><w:pBdr><w:left w:val="single" w:sz="14" w:space="12" w:color="B98B88"/></w:pBdr></w:pPr><w:rPr><w:color w:val="584548"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="160" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="887365"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style></w:styles>`;
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'word/document.xml': documentXml,
    'word/styles.xml': stylesXml,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(`${userName} × ${characterName}的私语手札`)}</dc:title><dc:creator>私语手札</dc:creator><cp:lastModifiedBy>私语手札</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>私语手札</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>`,
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function zipHeader(size) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  return { bytes, view };
}

function createStoredZip(files) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((Math.floor(now.getSeconds() / 2)) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = content instanceof Uint8Array ? content : encoder.encode(String(content));
    const checksum = crc32(data);
    const local = zipHeader(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, dosTime, true);
    local.view.setUint16(12, dosDate, true);
    local.view.setUint32(14, checksum, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, nameBytes.length, true);
    local.view.setUint16(28, 0, true);
    localChunks.push(local.bytes, nameBytes, data);

    const central = zipHeader(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, dosTime, true);
    central.view.setUint16(14, dosDate, true);
    central.view.setUint32(16, checksum, true);
    central.view.setUint32(20, data.length, true);
    central.view.setUint32(24, data.length, true);
    central.view.setUint16(28, nameBytes.length, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, localOffset, true);
    centralChunks.push(central.bytes, nameBytes);
    localOffset += local.bytes.length + nameBytes.length + data.length;
  }
  const centralDirectory = concatBytes(centralChunks);
  const end = zipHeader(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, Object.keys(files).length, true);
  end.view.setUint16(10, Object.keys(files).length, true);
  end.view.setUint32(12, centralDirectory.length, true);
  end.view.setUint32(16, localOffset, true);
  end.view.setUint16(20, 0, true);
  return concatBytes([...localChunks, centralDirectory, end.bytes]);
}

function exportWordDocument() {
  const bytes = createStoredZip(buildWordDocumentParts(currentBook));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const safeCharacterName = String(currentBook.characterName || '手札').replace(/[\\/:*?"<>|]/g, '-').slice(0, 48);
  anchor.download = `private-journal-${safeCharacterName}-${new Date().toISOString().slice(0, 10)}.docx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderProse(text, className = 'pj-body') {
  const paragraphs = String(text || '')
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  const content = (paragraphs.length ? paragraphs : [''])
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
  return `<div class="${className}">${content}</div>`;
}

function renderPage(page) {
  const type = PAGE_TYPES[page.type] || PAGE_TYPES.daily_note;
  const pageLabel = page.type === 'impression' && page.impressionStage === 'initial' ? '初印象' : type.label;
  if (page.type === 'quote_note') {
    return `<details class="pj-page pj-quote-page">
      <summary><span class="pj-summary-copy"><span class="pj-kicker">${type.icon} ${escapeHtml(pageLabel)}</span><span class="pj-page-title">${escapeHtml(page.title)}</span><span class="pj-meta">${escapeHtml(page.dateLabel || '此刻')}</span></span><button class="pj-delete" data-delete="${escapeHtml(page.id)}" title="删除" aria-label="删除本页">×</button></summary>
      <div class="pj-page-content">${renderProse(page.body, 'pj-quote-body')}<div class="pj-quote-source">— ${escapeHtml(page.quoteSpeaker || identity().characterName)}</div></div>
    </details>`;
  }
  return `<details class="pj-page">
    <summary><span class="pj-summary-copy"><span class="pj-kicker">${type.icon} ${escapeHtml(pageLabel)}</span><span class="pj-page-title">${escapeHtml(page.title)}</span><span class="pj-meta">${escapeHtml(page.dateLabel)} · ${escapeHtml(page.mood)}</span></span><button class="pj-delete" data-delete="${escapeHtml(page.id)}" title="删除" aria-label="删除本页">×</button></summary>
    <div class="pj-page-content">${renderProse(page.body)}</div>
  </details>`;
}

function relationshipLabel(status) {
  return ({
    unchecked: '尚未判定',
    partners: '已确认是伴侣',
    not_partners: '目前不是伴侣',
    uncertain: '依据不足',
  })[status] || '尚未判定';
}

function pagesForType(book, type) {
  const pages = Array.isArray(book?.pages) ? book.pages : [];
  return pages.filter(page => page.type === type || (type === 'impression' && page.type === 'first_impression'));
}

function renderAccessories() {
  if (!root) return;
  const id = identity();
  const settings = getSettings();
  const themeKey = THEMES[settings.theme] ? settings.theme : DEFAULTS.theme;
  settings.theme = themeKey;
  root.dataset.theme = themeKey;
  root.classList.toggle('book-open', bookOpen);

  const coverArt = root.querySelector('.pj-cover-art');
  if (coverArt) {
    const nextSource = themeAssetUrl(themeKey);
    if (coverArt.getAttribute('src') !== nextSource) coverArt.setAttribute('src', nextSource);
  }

  const coverUser = root.querySelector('.pj-cover-user');
  const coverCharacter = root.querySelector('.pj-cover-character');
  if (coverUser) coverUser.textContent = id.userName;
  if (coverCharacter) coverCharacter.textContent = id.characterName;
  const coverHint = root.querySelector('.pj-cover-hint');
  if (coverHint) coverHint.textContent = bookOpen ? '轻触封面 · 合上手札' : '轻触封面 · 翻开手札';

  const switcher = root.querySelector('.pj-theme-switcher');
  if (switcher) {
    switcher.innerHTML = Object.entries(THEMES).map(([key, theme]) =>
      `<button class="${key === themeKey ? 'active' : ''}" data-theme-option="${key}" title="${escapeHtml(theme.label)}"><i></i><span>${escapeHtml(theme.shortLabel)}</span></button>`).join('');
  }

}

function renderControls() {
  const controls = root?.querySelector('.pj-controls');
  if (!controls || !currentBook) return;
  controls.hidden = false;
  if (activeType === 'impression') {
    const focusButtons = Object.entries(IMPRESSION_FOCUSES).map(([key, value]) =>
      `<button class="pj-choice ${key === activeImpressionFocus ? 'active' : ''}" data-impression-focus="${key}">${escapeHtml(value.label)}</button>`).join('');
    controls.innerHTML = `<div class="pj-choice-row">${focusButtons}</div>${activeImpressionFocus === 'custom' ? `<input class="pj-custom-request" data-impression-request value="${escapeHtml(customImpressionRequest)}" placeholder="想记住他的哪一面？">` : ''}`;
    return;
  }
  if (activeType === 'romance_diary') {
    const relationship = currentBook.relationship || {};
    const unlocked = isRomanceUnlocked();
    const evidence = relationship.evidence?.length
      ? `<ul>${relationship.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';
    controls.innerHTML = `<div class="pj-relationship ${unlocked ? 'unlocked' : 'locked'}"><div><span class="pj-lock-mark">${unlocked ? '♡' : '♢'}</span><strong>${relationshipLabel(relationship.status)}</strong><p>${escapeHtml(relationship.reason || '跟随正文时会在同一次批量请求里判定关系；也可以在这里单独判定。')}</p>${evidence}</div><div class="pj-relationship-actions"><button class="pj-secondary" data-action="check-relationship" ${relationshipCheckActive ? 'disabled' : ''}>${relationshipCheckActive ? '判定中…' : relationship.status === 'unchecked' ? '单独判定 · 1次API' : '重新判定 · 1次API'}</button>${unlocked ? '<button class="pj-text-button" data-action="reset-relationship">重新锁定</button>' : '<button class="pj-text-button" data-action="confirm-relationship">由我确认已是伴侣</button>'}</div></div>`;
    return;
  }
  if (activeType === 'quote_note') {
    controls.innerHTML = `<div class="pj-quote-editor"><div class="pj-quote-editor-copy"><strong>收下一句舍不得忘记的话</strong><span>可在正文中选中对白，点击浮出的“收进小纸条”；也可以在这里手动粘贴。保存不会调用 API。</span></div><textarea class="pj-quote-input" data-quote-input maxlength="1500" placeholder="把想珍藏的对白放在这里…">${escapeHtml(quoteDraft)}</textarea><label class="pj-quote-speaker"><span>说话的人</span><input data-quote-speaker value="${escapeHtml(quoteSpeakerDraft)}" placeholder="${escapeHtml(identity().characterName)}"></label></div>`;
    return;
  }
  controls.innerHTML = '';
  controls.hidden = true;
}

function render() {
  if (!root || !currentBook) return;
  const id = identity();
  root.querySelector('.pj-title').textContent = `${id.userName} × ${id.characterName}`;
  root.querySelector('.pj-tabs').innerHTML = Object.entries(PAGE_TYPES).map(([key, value]) =>
    `<button class="${key === activeType ? 'active' : ''}" data-type="${key}" role="tab" aria-selected="${key === activeType}"><span>${value.icon}</span>${value.label}${key === 'romance_diary' && !isRomanceUnlocked() ? '<small>锁</small>' : ''}</button>`).join('');
  const bookmarkLabel = root.querySelector('.pj-bookmark-label');
  if (bookmarkLabel) bookmarkLabel.textContent = PAGE_TYPES[activeType]?.label || '手札';
  renderControls();
  const visiblePages = pagesForType(currentBook, activeType);
  root.querySelector('.pj-pages').innerHTML = visiblePages.length
    ? visiblePages.map(renderPage).join('')
    : `<div class="pj-empty">${escapeHtml(PAGE_TYPES[activeType]?.empty || '纸页还是空白。')}<br><small>${activeType === 'romance_diary' && !isRomanceUnlocked() ? '先确认关系，再记录只属于恋人的篇章。' : activeType === 'quote_note' ? '在正文里选中对白即可收藏，不会消耗 API。' : '生成后会独立保存于当前栏目。'}</small></div>`;
  const follow = root.querySelector('[data-setting="followMainGeneration"]');
  if (follow) follow.checked = Boolean(getSettings().followMainGeneration);
  setGeneratingUi(journalGenerationActive);
  const generateButton = root.querySelector('[data-action="generate"]');
  if (generateButton && activeType === 'romance_diary' && !isRomanceUnlocked()) generateButton.disabled = true;
  renderAccessories();
  setStatus(lastStatus);
}

function turnToType(type) {
  if (!PAGE_TYPES[type] || type === activeType || !root) return;
  clearTimeout(pageTurnTimer);
  root.classList.remove('page-turning');
  void root.offsetWidth;
  root.classList.add('page-turning');
  pageTurnTimer = setTimeout(() => {
    activeType = type;
    render();
    setTimeout(() => root?.classList.remove('page-turning'), 390);
  }, 250);
}

function bind() {
  root.addEventListener('click', async event => {
    const type = event.target.closest('[data-type]')?.dataset.type;
    const impressionFocus = event.target.closest('[data-impression-focus]')?.dataset.impressionFocus;
    const themeOption = event.target.closest('[data-theme-option]')?.dataset.themeOption;
    const action = event.target.closest('[data-action]')?.dataset.action;
    const deleteId = event.target.closest('[data-delete]')?.dataset.delete;
    if (type) turnToType(type);
    if (impressionFocus) { activeImpressionFocus = impressionFocus; render(); }
    if (themeOption && THEMES[themeOption]) {
      getSettings().theme = themeOption;
      ctx().saveSettingsDebounced?.();
      renderAccessories();
    }
    if (action === 'toggle-book') {
      bookOpen = !bookOpen;
      renderAccessories();
    }
    if (action === 'close') {
      root.classList.remove('open');
      bookOpen = false;
      renderAccessories();
    }
    if (action === 'generate') {
      if (activeType === 'quote_note') await saveQuoteNote();
      else await generatePage({ type: activeType, source: 'manual' });
    }
    if (action === 'check-relationship') await checkRelationship();
    if (action === 'confirm-relationship') await confirmRelationshipManually();
    if (action === 'reset-relationship') await resetRelationship();
    if (action === 'export') exportBook();
    if (action === 'export-word') exportWordDocument();
    if (deleteId) {
      event.preventDefault();
      event.stopPropagation();
      await deletePage(deleteId);
    }
  });
  root.addEventListener('input', event => {
    if (event.target.matches('[data-impression-request]')) customImpressionRequest = event.target.value;
    if (event.target.matches('[data-quote-input]')) {
      quoteDraft = event.target.value;
      setGeneratingUi(false);
    }
    if (event.target.matches('[data-quote-speaker]')) quoteSpeakerDraft = event.target.value;
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-setting="followMainGeneration"]')) {
      getSettings().followMainGeneration = event.target.checked;
      ctx().saveSettingsDebounced?.();
      setStatus(event.target.checked ? '已开启：故事跨日后一次整理全部栏目' : '已关闭自动整理');
    }
  });
}

async function openJournal() {
  bookOpen = false;
  await loadBook();
  root.classList.add('open');
  renderAccessories();
}

function applyLauncherPosition(launcher) {
  const saved = getSettings().launcherPosition;
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return;
  const size = launcher.getBoundingClientRect();
  const x = Math.min(Math.max(8, saved.x), Math.max(8, window.innerWidth - size.width - 8));
  const y = Math.min(Math.max(8, saved.y), Math.max(8, window.innerHeight - size.height - 8));
  launcher.style.left = `${x}px`;
  launcher.style.top = `${y}px`;
  launcher.style.right = 'auto';
  launcher.style.bottom = 'auto';
}

function makeLauncherDraggable(launcher) {
  let drag = null;
  let suppressClickUntil = 0;
  launcher.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
    launcher.setPointerCapture?.(event.pointerId);
  });
  launcher.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    event.preventDefault();
    const rect = launcher.getBoundingClientRect();
    const x = Math.min(Math.max(8, drag.left + dx), Math.max(8, window.innerWidth - rect.width - 8));
    const y = Math.min(Math.max(8, drag.top + dy), Math.max(8, window.innerHeight - rect.height - 8));
    launcher.style.left = `${x}px`;
    launcher.style.top = `${y}px`;
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
  });
  const finishDrag = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      suppressClickUntil = Date.now() + 350;
      const rect = launcher.getBoundingClientRect();
      getSettings().launcherPosition = { x: Math.round(rect.left), y: Math.round(rect.top) };
      ctx().saveSettingsDebounced?.();
    }
    launcher.releasePointerCapture?.(event.pointerId);
    drag = null;
  };
  launcher.addEventListener('pointerup', finishDrag);
  launcher.addEventListener('pointercancel', finishDrag);
  launcher.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('resize', () => applyLauncherPosition(launcher));
  requestAnimationFrame(() => applyLauncherPosition(launcher));
}

function installWandMenuEntry() {
  if (document.querySelector('#private-journal-wand-entry')) return true;
  const menu = document.querySelector('#extensionsMenu');
  if (!menu) return false;
  const entry = document.createElement('div');
  entry.id = 'private-journal-wand-entry';
  entry.className = 'list-group-item flex-container flexGap5';
  entry.innerHTML = '<div class="fa-solid fa-book-open extensionsMenuExtensionButton"></div><span>私语手札</span>';
  entry.addEventListener('click', openJournal);
  menu.append(entry);
  const wand = document.querySelector('#extensionsMenuButton');
  if (wand) wand.style.display = '';
  return true;
}

async function initialize() {
  getSettings();
  root = document.createElement('section');
  root.id = 'private-journal';
  root.lang = getSettings().language || 'zh-CN';
  root.innerHTML = `<div class="pj-backdrop" data-action="close"></div><div class="pj-scene">
    <button class="pj-scene-close" data-action="close" aria-label="关闭私语手札" title="关闭">×</button>
    <div class="pj-book-stage">
      <button class="pj-cover" data-action="toggle-book" aria-label="翻开或合上手札">
        <span class="pj-cover-face pj-cover-front"><img class="pj-cover-art" src="${escapeHtml(themeAssetUrl(getSettings().theme))}" alt="" draggable="false"><span class="pj-cover-shade"></span><span class="pj-cover-names"><span class="pj-cover-user"></span><i>×</i><span class="pj-cover-character"></span></span><span class="pj-cover-hint">轻触封面 · 翻开手札</span></span>
        <span class="pj-cover-face pj-cover-back"></span>
      </button>
      <div class="pj-book">
        <button class="pj-bookmark" data-action="toggle-book" aria-label="合上手札" title="合上手札"><span class="pj-bookmark-label">印象</span><i></i></button>
        <div class="pj-page-turner" aria-hidden="true"></div>
        <nav><h1 class="pj-title"></h1><button class="pj-inner-close" data-action="close" aria-label="关闭">×</button></nav>
        <div class="pj-tabs" role="tablist" aria-label="书签目录"></div><div class="pj-controls"></div><main class="pj-pages"></main>
        <footer><div class="pj-footer-state"><label title="只在正文时间线跨入新的一天时，用一次 API 整理上一故事日"><input type="checkbox" data-setting="followMainGeneration"> 按故事日自动整理</label><span class="pj-status"></span></div><div class="pj-footer-actions"><button class="pj-secondary" data-action="export">备份 JSON</button><button class="pj-secondary" data-action="export-word">导出 Word</button><button class="pj-primary" data-action="generate">写下这一页</button></div></footer>
      </div>
    </div>
    <div class="pj-theme-switcher" role="group" aria-label="选择手札主题"></div>
  </div>`;
  document.body.append(root);
  bind();
  installQuoteCapture();

  const launcher = document.createElement('button');
  launcher.id = 'private-journal-launcher';
  launcher.title = '打开私语手札';
  launcher.textContent = '❦';
  makeLauncherDraggable(launcher);
  launcher.addEventListener('click', openJournal);
  document.body.append(launcher);
  if (!installWandMenuEntry()) {
    const wandTimer = setInterval(() => {
      if (installWandMenuEntry()) clearInterval(wandTimer);
    }, 750);
    setTimeout(() => clearInterval(wandTimer), 20000);
  }

  const context = ctx();
  const chatChanged = context.eventTypes?.CHAT_CHANGED;
  if (chatChanged) context.eventSource.on(chatChanged, loadBook);
  const generationStarted = context.eventTypes?.GENERATION_STARTED;
  const generationEnded = context.eventTypes?.GENERATION_ENDED;
  const characterRendered = context.eventTypes?.CHARACTER_MESSAGE_RENDERED;
  if (generationStarted) context.eventSource.on(generationStarted, () => {
    if (!journalGenerationActive && !relationshipCheckActive) {
      mainGenerationActive = true;
      mainGenerationCycleSeen = true;
      mainGenerationStartSignature = latestAssistantSignature();
      setStatus('正文生成中…');
    }
  });
  if (generationEnded) context.eventSource.on(generationEnded, () => {
    if (!journalGenerationActive && !relationshipCheckActive) {
      mainGenerationActive = false;
      scheduleAutoGeneration();
    }
  });
  if (characterRendered) context.eventSource.on(characterRendered, () => {
    if (mainGenerationCycleSeen) scheduleAutoGeneration();
  });
  await loadBook();
  console.log('[Private Journal] loaded');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();

