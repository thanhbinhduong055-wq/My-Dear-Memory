const MODULE_ID = 'st_private_journal';
const STORAGE_PREFIX = `${MODULE_ID}:book:`;

const DEFAULTS = {
  language: 'zh-CN',
  lyricsMaxWords: 10,
  followMainGeneration: true,
};

let root;
let currentBook = null;
let activeType = 'impression';
let activeImpressionFocus = 'overall';
let customImpressionRequest = '';
let mainGenerationActive = false;
let journalGenerationActive = false;
let relationshipCheckActive = false;
let mainGenerationCycleSeen = false;
let mainGenerationStartSignature = null;
let queuedType = null;
let autoGenerationTimer = null;
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
};

const IMPRESSION_FOCUSES = {
  overall: { label: '整体印象', prompt: '综合外在、性格、言行和相处感受，形成一个有层次的整体印象。' },
  temperament: { label: '气质外貌', prompt: '聚焦 Char 的外貌、神态、声音、动作习惯与整体气质；只写上下文有依据的部分。' },
  personality: { label: '性格细节', prompt: '聚焦 Char 的性格、价值观、反应方式、优点、矛盾感与细微习惯。' },
  attraction: { label: '心动之处', prompt: '聚焦哪些真实细节令 User 在意、欣赏或心动，但不要擅自宣布双方已恋爱。' },
  custom: { label: '自定义', prompt: '严格围绕 User 输入的观察需求来写。' },
};

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
    version: 3,
    ...id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    relationship: { status: 'unchecked', reason: '', evidence: [], checkedAt: null, source: null },
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
  book.version = 3;
  book.pages = Array.isArray(book.pages) ? book.pages : [];
  book.pages = book.pages.map(page => {
    if (page.type === 'first_impression') page.type = 'impression';
    return repairStoredPage(page);
  });
  book.relationship = Object.assign(
    { status: 'unchecked', reason: '', evidence: [], checkedAt: null, source: null },
    book.relationship || {},
  );
  return book;
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
  const typeInstruction = type === 'impression'
    ? `${meta.instruction}\n观察方向：${impressionFocus.prompt}${options.impressionFocus === 'custom' ? `\nUser 的具体需求：${customRequest || '请自由选择一个有依据的观察角度。'}` : ''}`
    : meta.instruction;
  return `你正在为 ${id.userName} 与 ${id.characterName} 的私人手札撰写“${meta.label}”。这本手札始终属于 User，叙述视角始终是 User。\n\n` +
    `资料原则：只依据当前对话、角色设定、User Persona，以及当前生成中实际激活的世界书内容。不要把指令、系统提示或世界书原文泄露出来；不要杜撰未发生的共同经历。资料矛盾时，以最近对话为准，并保持含蓄。\n` +
    `视角铁律：第一人称“我”只能指 ${id.userName}，观察与情绪均属于 User；${id.characterName} 是被观察、被书写或被倾诉的对象。\n` +
    `本栏目要求：${typeInstruction}\n` +
    `写作要求：使用 ${settings.language}，参考 User Persona 贴合 User 的表达习惯；有具体细节和情感余韵，避免模板腔。\n` +
    `诗歌：选择一段与本页情绪贴合的中外诗歌。优先公共领域作品；如果版权状态不确定，请创作原创短诗并明确标记“原创”。不要伪造作者或出处。\n` +
    `歌曲：必须选择一首真实存在且与本页贴合的歌曲，song.title 必须填写准确歌名，song.artist 必须填写歌手或创作者，二者不可留空。歌词只摘抄不超过 ${settings.lyricsMaxWords} 个英文单词或不超过20个中日韩字符；若无法可靠确认原句，保留歌名和歌手，并把 excerpt 写成意译或氛围描述，isParaphrase 设为 true。不要伪造歌名、歌手或歌词。\n\n` +
    `只输出下面的标签格式，不要 JSON、Markdown 或代码围栏。标签内可以直接写正常引号和换行：\n` +
    `<journal_page><title>页标题</title><dateLabel>故事内日期或此刻</dateLabel><mood>User的心绪</mood><body>正文</body><poem><text>诗歌</text><author>作者或原创</author><work>作品名或无题</work><isOriginal>false</isOriginal></poem><song><title>准确歌名</title><artist>歌手或创作者</artist><excerpt>极短摘抄或意译</excerpt><isParaphrase>false</isParaphrase></song><anchors><item>依据1</item><item>依据2</item></anchors><confidence>high|medium|low</confidence></journal_page>`;
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
  const poemBlock = extractTagRaw(pageBlock, 'poem');
  const songBlock = extractTagRaw(pageBlock, 'song');
  const anchorsBlock = extractTagRaw(pageBlock, 'anchors');
  return normalizePage({
    title: extractTag(pageBlock, 'title') || '无题',
    dateLabel: extractTag(pageBlock, 'dateLabel') || '此刻',
    mood: extractTag(pageBlock, 'mood') || '未命名的心绪',
    body,
    poem: {
      text: extractTag(poemBlock, 'text'),
      author: extractTag(poemBlock, 'author'),
      work: extractTag(poemBlock, 'work'),
      isOriginal: extractTag(poemBlock, 'isOriginal').toLowerCase() === 'true',
    },
    song: {
      title: extractTag(songBlock, 'title'),
      artist: extractTag(songBlock, 'artist'),
      excerpt: extractTag(songBlock, 'excerpt'),
      isParaphrase: extractTag(songBlock, 'isParaphrase').toLowerCase() === 'true',
    },
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
  const poemMatch = /["']poem["']\s*:\s*\{([\s\S]*?)\}\s*,\s*["']song["']\s*:/i.exec(text);
  const songMatch = /["']song["']\s*:\s*\{([\s\S]*?)\}\s*,\s*["'](?:memoryAnchors|confidence)["']\s*:/i.exec(text);
  const poemBlock = poemMatch?.[1] || '';
  const songBlock = songMatch?.[1] || '';
  const meta = PAGE_TYPES[type] || PAGE_TYPES.daily_note;
  return normalizePage({
    title: extractLooseField(text, 'title', ['dateLabel', 'mood', 'perspective', 'body']) || meta.label,
    dateLabel: extractLooseField(text, 'dateLabel', ['mood', 'perspective', 'body']) || '此刻',
    mood: extractLooseField(text, 'mood', ['perspective', 'body']) || '未命名的心绪',
    body,
    poem: {
      text: extractLooseField(poemBlock, 'text', ['author', 'work', 'isOriginal']),
      author: extractLooseField(poemBlock, 'author', ['work', 'isOriginal']),
      work: extractLooseField(poemBlock, 'work', ['isOriginal']),
      isOriginal: /["']isOriginal["']\s*:\s*true/i.test(poemBlock),
    },
    song: {
      title: extractLooseField(songBlock, 'title', ['artist', 'excerpt', 'isParaphrase']),
      artist: extractLooseField(songBlock, 'artist', ['excerpt', 'isParaphrase']),
      excerpt: extractLooseField(songBlock, 'excerpt', ['isParaphrase']),
      isParaphrase: /["']isParaphrase["']\s*:\s*true/i.test(songBlock),
    },
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
  const rawSong = typeof page.song === 'string' ? { title: page.song } : (page.song || {});
  const songTitle = rawSong.title || rawSong.name || rawSong.songTitle || rawSong['歌名'] || page.songTitle || '';
  const songArtist = rawSong.artist || rawSong.singer || rawSong.author || rawSong['歌手'] || page.songArtist || '';
  const songExcerpt = rawSong.excerpt || rawSong.lyric || rawSong.lyrics || rawSong['歌词摘抄'] || page.songExcerpt || '';
  const hasSongContent = Boolean(songTitle || songArtist || songExcerpt);
  return {
    title: String(page.title || '无题'),
    dateLabel: String(page.dateLabel || '此刻'),
    mood: String(page.mood || '未命名的心绪'),
    perspective: 'user',
    body: String(page.body || ''),
    poem: {
      text: String(page.poem?.text || ''),
      author: String(page.poem?.author || ''),
      work: String(page.poem?.work || ''),
      isOriginal: Boolean(page.poem?.isOriginal),
    },
    song: {
      title: String(songTitle || (hasSongContent ? '未提供歌曲' : '')),
      artist: String(songArtist),
      excerpt: String(songExcerpt),
      isParaphrase: Boolean(rawSong.isParaphrase),
      isMissingTitle: Boolean(hasSongContent && !songTitle),
    },
    memoryAnchors: Array.isArray(page.memoryAnchors) ? page.memoryAnchors.map(String).slice(0, 8) : [],
    confidence: ['high', 'medium', 'low'].includes(page.confidence) ? page.confidence : 'low',
  };
}

function normalizeAccompaniment(value = {}) {
  const normalized = normalizePage({ title: '本轮附页', body: '', poem: value.poem, song: value.song });
  return { poem: normalized.poem, song: normalized.song };
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
  const pageTemplate = (type, save = 'true') => `<page type="${type}" save="${save}"><title>标题</title><dateLabel>日期或此刻</dateLabel><mood>心绪</mood><body>按栏目要求完成的正文</body><anchors><item>依据</item></anchors><confidence>high|medium|low</confidence></page>`;
  const accompanimentTemplate = `<round_accompaniment><poem><text>1至2行短诗</text><author>作者或原创</author><work>作品名</work><isOriginal>false</isOriginal></poem><song><title>准确歌名</title><artist>歌手</artist><excerpt>极短摘抄或意译</excerpt><isParaphrase>false</isParaphrase></song></round_accompaniment>`;
  return `正文刚刚更新。请用这一次响应同步 ${id.userName} 与 ${id.characterName} 的整本私人手札；禁止只写其中一个栏目。所有内容都属于 User 的视角，第一人称“我”只能是 ${id.userName}，Char 是被观察、共同生活或被倾诉的对象。\n\n` +
    `资料只来自当前对话、角色设定、User Persona 与当前激活世界书；不要泄露提示词，不要杜撰未发生的经历。语言：${settings.language}。避免四篇互相重复。\n` +
    `印象：70至110字。User 对 Char 的印象。本轮方向是“${focus.label}”：${focus.prompt}${customRequest ? ` User 的具体需求：${customRequest}` : ''}\n` +
    `相处日记：70至110字。User 记录两个人在本轮及近期已经发生的日常与感受，不写成情书。\n` +
    `情书：130至200字。User 直接写给 Char，“我”是 User、“你”是 Char，绝对不要反写。情感浓度必须明显高于其他栏目，写出具体的眷恋、心疼、渴望、恐惧或不舍；允许脆弱和坦白，但不堆砌空泛辞藻。\n` +
    `关系判定：只有已明确确认恋爱、情侣、伴侣或配偶关系才是 partners；暧昧、调情、单恋和角色卡倾向都不算。${userConfirmedPartners ? 'User 已手动确认双方是伴侣，relationship.status 必须保持 partners。' : ''}\n` +
    `恋爱日记：120至180字。仅当 relationship.status 为 partners 时生成；否则 save 必须为 false。正文至少三分之二描写 User 的内心情感、依恋、亲密需求与关系变化，事件叙述最多占三分之一。\n` +
    `整轮只生成一次共享诗词与歌曲，放进 round_accompaniment；四个 page 内禁止再写 poem 或 song。共享歌曲的 title 与 artist 不可留空；歌词摘抄不超过 ${settings.lyricsMaxWords} 个英文单词或20个中日韩字符。不确定歌词原句时保留准确歌名和歌手，excerpt 改为意译并设置 isParaphrase=true。本轮不会发送第二次请求补字段。诗歌优先公共领域，出处不确定时写明确标注的原创短诗。\n\n` +
    `只输出下列标签协议，不要 JSON、Markdown 或代码围栏。标签内可以直接写引号和换行。必须按顺序完整输出 relationship、impression、daily_note、love_letter；不得写“同上”“使用相同标签”等省略语。只有伴侣关系成立时才填写 romance_diary：\n` +
    `<journal_batch><relationship><status>partners|not_partners|uncertain</status><reason>简短说明</reason><evidence><item>依据</item></evidence></relationship>` + accompanimentTemplate +
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
  const allowedTypes = new Set(Object.keys(PAGE_TYPES));
  const seenTypes = new Set();
  const updates = rawUpdates
    .filter(item => {
      if (!item || !allowedTypes.has(item.type) || item.shouldSave === false || !item.page || seenTypes.has(item.type)) return false;
      seenTypes.add(item.type);
      return true;
    })
    .map(item => ({ type: item.type, page: normalizePage(item.page) }));
  const legacyCompanionPage = updates.find(item => item.page.poem?.text || item.page.song?.title)?.page;
  const accompaniment = normalizeAccompaniment(
    payload.round_accompaniment || payload.roundAccompaniment || payload.accompaniment || legacyCompanionPage || {},
  );
  return { relationship: normalizeRelationship(payload.relationship || {}), accompaniment, updates };
}

function parseTaggedBatch(text) {
  if (!/<journal_batch\b/i.test(String(text || '')) && !/<page\b[^>]*type=/i.test(String(text || ''))) return null;
  const relationshipBlock = extractTagRaw(text, 'relationship');
  const relationship = normalizeRelationship({
    status: extractTag(relationshipBlock, 'status'),
    reason: extractTag(relationshipBlock, 'reason'),
    evidence: extractTagItems(extractTagRaw(relationshipBlock, 'evidence')),
  });
  const accompanimentBlock = extractTagRaw(text, 'round_accompaniment') || extractTagRaw(text, 'accompaniment');
  const accompanimentPoem = extractTagRaw(accompanimentBlock, 'poem');
  const accompanimentSong = extractTagRaw(accompanimentBlock, 'song');
  const accompaniment = normalizeAccompaniment({
    poem: {
      text: extractTag(accompanimentPoem, 'text'),
      author: extractTag(accompanimentPoem, 'author'),
      work: extractTag(accompanimentPoem, 'work'),
      isOriginal: extractTag(accompanimentPoem, 'isOriginal').toLowerCase() === 'true',
    },
    song: {
      title: extractTag(accompanimentSong, 'title'),
      artist: extractTag(accompanimentSong, 'artist'),
      excerpt: extractTag(accompanimentSong, 'excerpt'),
      isParaphrase: extractTag(accompanimentSong, 'isParaphrase').toLowerCase() === 'true',
    },
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
    if (!PAGE_TYPES[type] || saveValue === 'false' || seenTypes.has(type)) continue;
    const contentStart = match.index + match[0].length;
    const contentEnd = starts[index + 1]?.index ?? source.indexOf('</journal_batch>', contentStart);
    const rawBlock = source.slice(contentStart, contentEnd >= 0 ? contentEnd : source.length).replace(/<\/page>\s*$/i, '');
    const page = parseTaggedPage(`<page>${rawBlock}</page>`);
    if (!page) continue;
    seenTypes.add(type);
    updates.push({ type, page });
  }
  return { relationship, accompaniment, updates };
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
  const context = ctx();
  const chat = Array.isArray(context.chat) ? context.chat : [];
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const message = chat[index];
    if (!message?.is_user && !message?.is_system && String(message?.mes || '').trim()) {
      const content = String(message.mes);
      let hash = 0;
      for (let i = 0; i < content.length; i += 1) hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
      return `${identity().chatId}:${index}:${message.swipe_id ?? 0}:${hash}`;
    }
  }
  return null;
}

function setStatus(message) {
  lastStatus = message;
  const status = root?.querySelector('.pj-status');
  if (status) status.textContent = message;
}

function setGeneratingUi(generating) {
  const button = root?.querySelector('[data-action="generate"]');
  if (!button) return;
  button.disabled = generating;
  button.textContent = generating ? '正在拾取回忆…' : `生成${PAGE_TYPES[activeType]?.label || '这一页'}`;
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
  if (!ctx().chatId && !ctx().getCurrentChatId?.()) return;
  if (journalGenerationActive || mainGenerationActive) return;

  const targetBook = currentBook;
  const targetStorageKey = storageKey();
  const signature = captureSignature || latestAssistantSignature();
  if (signature && targetBook?.lastCapturedSignature === signature) return;

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
    const roundId = createId();
    const accompaniment = batch.accompaniment || normalizeAccompaniment();
    const hasAccompaniment = Boolean(accompaniment.poem?.text || accompaniment.song?.title || accompaniment.song?.excerpt);
    const accompanimentOwner = pages.find(item => item.type === 'daily_note') || pages[0];
    for (const item of pages) {
      const page = item.page;
      page.id = createId();
      page.type = item.type;
      page.roundId = roundId;
      page.createdAt = createdAt;
      page.source = 'auto-batch';
      page.captureSignature = signature;
      page.poem = { text: '', author: '', work: '', isOriginal: false };
      page.song = { title: '', artist: '', excerpt: '', isParaphrase: false, isMissingTitle: false };
      page.hasRoundAccompaniment = false;
      if (hasAccompaniment && item === accompanimentOwner) {
        page.poem = accompaniment.poem;
        page.song = accompaniment.song;
        page.hasRoundAccompaniment = true;
      }
      if (item.type === 'impression') {
        page.impressionFocus = focusKey;
        page.impressionFocusLabel = focusKey === 'custom'
          ? customImpressionRequest.trim()
          : IMPRESSION_FOCUSES[focusKey]?.label;
      }
      targetBook.pages.unshift(page);
    }
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
  } catch (error) {
    console.error('[Private Journal]', error);
    const message = error?.message || String(error);
    setStatus(`批量更新失败：${message}`);
    toastr.error(`批量更新失败：${message}`, '私语手札', { timeOut: 10000 });
  } finally {
    journalGenerationActive = false;
    setGeneratingUi(false);
  }
}

function scheduleAutoGeneration() {
  if ((!getSettings().followMainGeneration && !queuedType) || journalGenerationActive || !mainGenerationCycleSeen) return;
  clearTimeout(autoGenerationTimer);
  autoGenerationTimer = setTimeout(async () => {
    const signature = latestAssistantSignature();
    const hasNewAssistantContent = signature && signature !== mainGenerationStartSignature;
    if (!signature || currentBook?.lastCapturedSignature === signature || (!hasNewAssistantContent && !queuedType)) {
      mainGenerationCycleSeen = false;
      return;
    }
    const requestedType = queuedType;
    queuedType = null;
    mainGenerationCycleSeen = false;
    if (getSettings().followMainGeneration) {
      await generateBatch({ captureSignature: signature });
    } else if (requestedType) {
      await generatePage({ type: requestedType, source: 'manual', captureSignature: signature });
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

function renderPage(page) {
  const type = PAGE_TYPES[page.type] || PAGE_TYPES.daily_note;
  const poem = page.poem?.text ? `<blockquote class="pj-poem">${escapeHtml(page.poem.text).replace(/\n/g, '<br>')}<cite>— ${escapeHtml(page.poem.author)}${page.poem.work ? `《${escapeHtml(page.poem.work)}》` : ''}</cite></blockquote>` : '';
  const song = page.song?.title || page.song?.excerpt
    ? `<div class="pj-song"><strong class="pj-song-title">♫ ${escapeHtml(page.song.title || '未提供歌曲')}</strong>${page.song.artist ? `<span class="pj-song-artist">${escapeHtml(page.song.artist)}</span>` : ''}${page.song.excerpt ? `<q>${escapeHtml(page.song.excerpt)}</q>` : ''}${page.song.isParaphrase ? '<small>意译 / 氛围描述</small>' : ''}${page.song.isMissingTitle ? '<small class="pj-song-warning">模型未提供可核验歌名；为保持单次 API，本轮未自动重试。</small>' : ''}</div>`
    : '';
  const focus = page.type === 'impression' && page.impressionFocusLabel
    ? `<span class="pj-focus-badge">观察：${escapeHtml(page.impressionFocusLabel)}</span>`
    : '';
  const anchors = page.memoryAnchors?.length
    ? `<div class="pj-anchors"><strong>记忆锚点</strong><ul>${page.memoryAnchors.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`
    : '';
  const accompanimentLabel = page.hasRoundAccompaniment && (poem || song)
    ? '<div class="pj-companion-label">本轮诗笺与配乐 · 全册仅此一份</div>'
    : '';
  return `<details class="pj-page">
    <summary><span class="pj-summary-copy"><span class="pj-kicker">${type.icon} ${escapeHtml(type.label)} ${focus}</span><span class="pj-page-title">${escapeHtml(page.title)}</span><span class="pj-meta">${escapeHtml(page.dateLabel)} · ${escapeHtml(page.mood)} · 依据可信度 ${escapeHtml(page.confidence)}</span></span><button class="pj-delete" data-delete="${escapeHtml(page.id)}" title="删除" aria-label="删除本页">×</button></summary>
    <div class="pj-page-content"><div class="pj-body">${escapeHtml(page.body).replace(/\n/g, '<br>')}</div>${accompanimentLabel}${poem}${song}${anchors}</div>
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

function renderControls() {
  const controls = root?.querySelector('.pj-controls');
  if (!controls || !currentBook) return;
  const type = PAGE_TYPES[activeType] || PAGE_TYPES.daily_note;
  if (activeType === 'impression') {
    const focusButtons = Object.entries(IMPRESSION_FOCUSES).map(([key, value]) =>
      `<button class="pj-choice ${key === activeImpressionFocus ? 'active' : ''}" data-impression-focus="${key}">${escapeHtml(value.label)}</button>`).join('');
    controls.innerHTML = `<div class="pj-control-copy"><strong>User 看见的 Char</strong><span>选择观察方向；每次生成都会作为一条独立印象保存。</span></div><div class="pj-choice-row">${focusButtons}</div>${activeImpressionFocus === 'custom' ? `<input class="pj-custom-request" data-impression-request value="${escapeHtml(customImpressionRequest)}" placeholder="例如：我想记录他在压力下仍然温柔的那一面">` : ''}`;
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
  controls.innerHTML = `<div class="pj-control-copy"><strong>${type.icon} ${escapeHtml(type.label)}</strong><span>${escapeHtml(type.instruction)}</span></div>`;
}

function render() {
  if (!root || !currentBook) return;
  const id = identity();
  root.querySelector('.pj-title').textContent = `${id.userName} × ${id.characterName}`;
  root.querySelector('.pj-tabs').innerHTML = Object.entries(PAGE_TYPES).map(([key, value]) =>
    `<button class="${key === activeType ? 'active' : ''}" data-type="${key}">${value.icon} ${value.label}${key === 'romance_diary' && !isRomanceUnlocked() ? ' · 锁定' : ''}</button>`).join('');
  renderControls();
  const visiblePages = pagesForType(currentBook, activeType);
  root.querySelector('.pj-pages').innerHTML = visiblePages.length
    ? visiblePages.map(renderPage).join('')
    : `<div class="pj-empty">${escapeHtml(PAGE_TYPES[activeType]?.empty || '纸页还是空白。')}<br><small>${activeType === 'romance_diary' && !isRomanceUnlocked() ? '先确认关系，再记录只属于恋人的篇章。' : '生成后会独立保存于当前栏目。'}</small></div>`;
  const follow = root.querySelector('[data-setting="followMainGeneration"]');
  if (follow) follow.checked = Boolean(getSettings().followMainGeneration);
  setGeneratingUi(journalGenerationActive);
  const generateButton = root.querySelector('[data-action="generate"]');
  if (generateButton && activeType === 'romance_diary' && !isRomanceUnlocked()) generateButton.disabled = true;
  setStatus(lastStatus);
}

function bind() {
  root.addEventListener('click', async event => {
    const type = event.target.closest('[data-type]')?.dataset.type;
    const impressionFocus = event.target.closest('[data-impression-focus]')?.dataset.impressionFocus;
    const action = event.target.closest('[data-action]')?.dataset.action;
    const deleteId = event.target.closest('[data-delete]')?.dataset.delete;
    if (type) { activeType = type; render(); }
    if (impressionFocus) { activeImpressionFocus = impressionFocus; render(); }
    if (action === 'close') root.classList.remove('open');
    if (action === 'generate') await generatePage({ type: activeType, source: 'manual' });
    if (action === 'check-relationship') await checkRelationship();
    if (action === 'confirm-relationship') await confirmRelationshipManually();
    if (action === 'reset-relationship') await resetRelationship();
    if (action === 'export') exportBook();
    if (deleteId) {
      event.preventDefault();
      event.stopPropagation();
      await deletePage(deleteId);
    }
  });
  root.addEventListener('input', event => {
    if (event.target.matches('[data-impression-request]')) customImpressionRequest = event.target.value;
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-setting="followMainGeneration"]')) {
      getSettings().followMainGeneration = event.target.checked;
      ctx().saveSettingsDebounced?.();
      setStatus(event.target.checked ? '已开启：正文后一次请求同步全部栏目' : '已关闭自动同步');
    }
  });
}

async function initialize() {
  getSettings();
  root = document.createElement('section');
  root.id = 'private-journal';
  root.innerHTML = `<div class="pj-backdrop" data-action="close"></div><div class="pj-book">
    <nav><div><div class="pj-overline">PRIVATE JOURNAL</div><h1 class="pj-title"></h1></div><button data-action="close" aria-label="关闭">×</button></nav>
    <div class="pj-tabs"></div><div class="pj-controls"></div><main class="pj-pages"></main>
    <footer><div class="pj-footer-state"><label><input type="checkbox" data-setting="followMainGeneration"> 跟随正文 · 单次同步</label><span class="pj-status">等待正文</span></div><div class="pj-footer-actions"><button class="pj-secondary" data-action="export">导出备份</button><button class="pj-primary" data-action="generate">立即写下这一页</button></div></footer>
  </div>`;
  document.body.append(root);
  bind();

  const launcher = document.createElement('button');
  launcher.id = 'private-journal-launcher';
  launcher.title = '打开私语手札';
  launcher.textContent = '❦';
  launcher.addEventListener('click', async () => { await loadBook(); root.classList.add('open'); });
  document.body.append(launcher);

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


