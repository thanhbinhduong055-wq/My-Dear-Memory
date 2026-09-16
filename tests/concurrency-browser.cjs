// Run with an existing Playwright installation. No real model requests.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const candidate = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const fixture = path.join(__dirname, 'fixtures');
const version = JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json'))).version;
const inject = `
const c = SillyTavern.getContext();
c.eventTypes.MESSAGE_RECEIVED='message_received';
c.chat = [{is_user:true,mes:'2025年9月24日，我们初次相遇。'},{is_user:false,mes:'2025年9月24日，他陪你走回家。'}];
c.extensionSettings.st_private_journal = {followMainGeneration:false,generationApiMode:'secondary',secondaryProfileId:'test',secondaryModelId:'model-A'};
window.taskTest={c,calls:[],saved:[],writes:0,maxWrites:0};
const t=window.taskTest;
const request=(mode,prompt)=>new Promise((resolve,reject)=>t.calls.push({mode,prompt,resolve,reject}));
c.ConnectionManagerRequestService={getSupportedProfiles:()=>[{id:'test',name:'Test',api:'openai'}],sendRequest:(id,messages)=>request('secondary',messages)};
c.generateQuietPrompt=({quietPrompt})=>request('main',quietPrompt);
const memory=new Map();
localforage.getItem=async k=>memory.get(k)||null;
localforage.setItem=async (k,v)=>{const snapshot=JSON.parse(JSON.stringify(v)); t.writes++;t.maxWrites=Math.max(t.maxWrites,t.writes);await new Promise(r=>setTimeout(r,30));memory.set(k,snapshot);t.saved.push({k,v:snapshot});t.writes--;return snapshot;};
t.memory=memory;
t.complete=(i,body)=>t.calls[i].resolve(JSON.stringify({title:'测试手札',body,dateLabel:'2025-09-24',perspective:'user',mood:'温柔'}));
SillyTavern.getContext=()=>c;
`;
const server = http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost').pathname;
  const base=url.startsWith('/cand/')?candidate:fixture;
  const relative=url.startsWith('/cand/')?url.slice(6):url.replace(/^\/harness\//,'').replace(/^\//,'');
  const file=path.resolve(base,relative);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.webp':'image/webp','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');
  let data=fs.readFileSync(file);
  if(file.endsWith('st-shim.js')) data=data.toString()+inject;
  res.end(data);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PJ_BROWSER});
  try {
    for(const width of [390,1280]){
      const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const fontRequests=[];
      await page.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='127.0.0.1')return route.continue();
        fontRequests.push(url.href);return route.abort();
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/st-mobile.html?src=cand');
      await page.waitForFunction(v=>window.__stPrivateJournalRuntime?.version===v,version);
      await page.locator('#private-journal-launcher').click();
      await page.locator('.pj-cover').click();
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(()=>taskTest.calls.length),0,'opening costs no API calls');
      const generate=page.locator('[data-action="generate"]');
      await page.locator('[data-type="impression"]').click();
      await generate.click();
      await page.waitForFunction(()=>taskTest.calls.length===1);
      assert.equal(await generate.isDisabled(),true,'duplicate section disabled');
      await generate.dispatchEvent('click');
      assert.equal(await page.evaluate(()=>taskTest.calls.length),1,'handler also rejects duplicates');
      await page.locator('[data-type="daily_note"]').click();
      await page.waitForFunction(()=>document.querySelector('#private-journal').dataset.activeType==='daily_note');
      assert.equal(await generate.isEnabled(),true,'other section must stay enabled while first is pending');
      await generate.click();
      await page.waitForFunction(()=>taskTest.calls.length===2);
      await page.evaluate(()=>{
        taskTest.complete(1,'相处日记独立内容。');
        taskTest.complete(0,'初印象独立内容。');
      });
      await page.waitForFunction(()=>taskTest.c.chatMetadata.st_private_journal?.pages.length===2);
      assert.deepEqual(await page.evaluate(()=>taskTest.c.chatMetadata.st_private_journal.pages.map(p=>p.type).sort()),['daily_note','impression']);
      assert.equal(await page.evaluate(()=>taskTest.maxWrites),1,'persistence serialized per book');
      await page.locator('[data-type="love_letter"]').click();
      await page.waitForFunction(()=>document.querySelector('#private-journal').dataset.activeType==='love_letter');
      await generate.click();
      await page.waitForFunction(()=>taskTest.calls.length===3);
      await page.evaluate(()=>taskTest.calls[2].reject(new Error('test API rejected')));
      await page.waitForFunction(()=>!document.querySelector('[data-action="generate"]').disabled);
      // Main API accepts several section jobs without overlapping host state.
      await page.evaluate(()=>taskTest.c.extensionSettings.st_private_journal.generationApiMode='main');
      await generate.click();
      await page.waitForFunction(()=>taskTest.calls.length===4);
      await page.locator('[data-type="daily_note"]').click();
      await page.waitForFunction(()=>document.querySelector('#private-journal').dataset.activeType==='daily_note');
      assert.equal(await generate.isEnabled(),true);
      await generate.click();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>taskTest.calls.length),4,'main transport must serialize');
      await page.evaluate(()=>taskTest.complete(3,'情书的完整内容。'));
      await page.waitForFunction(()=>taskTest.calls.length===5);
      await page.evaluate(()=>taskTest.complete(4,'当天的又一段回忆。'));
      await page.waitForFunction(()=>taskTest.c.chatMetadata.st_private_journal?.pages.find(p=>p.type==='daily_note')?.body.includes('又一段'));
      await page.waitForFunction(()=>document.querySelector('[data-generation-tasks]')?.hidden);
      // Exactly five curated additions; online loading is lazy and failure safe.
      assert.equal(await page.locator('[data-setting="font"] option').count(),10);
      for(const key of ['masa','dymon','wenkai','yozai','zhuque']){
        await page.locator('[data-setting="font"]').evaluate((el,key)=>{el.value=key;el.dispatchEvent(new Event('change',{bubbles:true}));},key);
        await page.waitForFunction(()=>document.querySelector('[data-font-status]').textContent.includes('未加载'));
        assert.equal(await page.locator('#private-journal').isVisible(),true);
      }
      assert.equal(fontRequests.filter(url=>url.includes('fontsapi.zeoseven.com')).length,5);
      assert.equal(await page.evaluate(()=>taskTest.calls.length),5,'font changes cost no model requests');
      // Switching chats cannot redirect a response to the new diary.
      await page.evaluate(()=>taskTest.c.extensionSettings.st_private_journal.generationApiMode='secondary');
      await generate.click();
      await page.waitForFunction(()=>taskTest.calls.length===6);
      await page.evaluate(()=>{
        taskTest.c.chatId='chat-2';taskTest.c.chatMetadata={};
        taskTest.c.eventSource.emit('chat_changed');
        taskTest.complete(5,'仅属于旧聊天的内容。');
      });
      await page.waitForFunction(()=>taskTest.saved.some(item=>JSON.stringify(item.v).includes('仅属于旧聊天')));
      assert.equal(await page.evaluate(()=>JSON.stringify(taskTest.c.chatMetadata).includes('仅属于旧聊天')),false);
      await page.evaluate(()=>{taskTest.c.chatId='chat-1';taskTest.c.chatMetadata={};taskTest.c.eventSource.emit('chat_changed');});
      await page.waitForFunction(()=>document.querySelector('.pj-pages')?.textContent.includes('仅属于旧聊天'));
      // Reinitialization invalidates a late response from the disposed instance.
      await generate.click();
      await page.waitForFunction(()=>taskTest.calls.length===7);
      await page.evaluate(()=>window.__stPrivateJournalRuntime.initialize());
      await page.evaluate(()=>taskTest.complete(6,'旧实例不应保存此内容。'));
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>taskTest.saved.some(item=>JSON.stringify(item.v).includes('旧实例不应保存'))),false);
      assert.equal(await page.locator('#private-journal').count(),1);
      // Exercise installed host-event handlers and real batch parser/save path.
      await page.evaluate(()=>{
        taskTest.c.extensionSettings.st_private_journal.followMainGeneration=true;
        taskTest.c.eventSource.emit('generation_started');
        taskTest.c.eventSource.emit('generation_ended');
        taskTest.c.chat.push({is_user:true,mes:'继续。'},{is_user:false,mes:'日期：2025-09-25\n他走到窗前。'});
        taskTest.c.eventSource.emit('message_received');
        taskTest.c.eventSource.emit('character_message_rendered');
      });
      await page.waitForFunction(()=>taskTest.calls.length===8);
      await page.evaluate(()=>{
        taskTest.batch=i=>taskTest.calls[i].resolve(JSON.stringify({updates:['impression','daily_note','love_letter'].map(type=>({type,page:{title:'跨日整理',body:'自动整理已完成。',dateLabel:'2025-09-24'}}))}));
        taskTest.batch(7);
      });
      await page.waitForFunction(()=>window.__stPrivateJournalRuntime.autoDay().reason==='completed');
      assert.equal(await page.evaluate(()=>!!taskTest.c.chatMetadata.st_private_journal.timeline.pendingAutoUpdate),false);
      await page.evaluate(()=>{taskTest.c.eventSource.emit('message_received');taskTest.c.eventSource.emit('character_message_rendered');});
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(()=>taskTest.calls.length),8,'duplicate real events do not generate twice');
      await page.evaluate(()=>{
        taskTest.c.chat.push({is_user:false,mes:'日期：2025-09-26\n他回到家中。'});
        taskTest.c.eventSource.emit('message_received');
      });
      await page.waitForFunction(()=>taskTest.calls.length===9);
      await page.evaluate(()=>taskTest.calls[8].reject(new Error('temporary failure')));
      await page.waitForFunction(()=>window.__stPrivateJournalRuntime.autoDay().reason==='pending-retry');
      assert.equal(await page.evaluate(()=>!!taskTest.c.chatMetadata.st_private_journal.timeline.pendingAutoUpdate),true);
      await page.evaluate(()=>{
        taskTest.c.chat.push({is_user:false,mes:'他笑着应了一声。'});
        taskTest.c.eventSource.emit('character_message_rendered');
      });
      await page.waitForFunction(()=>taskTest.calls.length===10);
      await page.evaluate(()=>taskTest.batch(9));
      await page.waitForFunction(()=>window.__stPrivateJournalRuntime.autoDay().reason==='completed');
      assert.equal(await page.evaluate(()=>window.__stPrivateJournalRuntime.stylesheet().status),'ok');
      assert.deepEqual(errors,[]);
      console.log('PASS '+width+'px: concurrency/font regression + actual end-before-message handlers, batch save, duplicate events, persisted failure and next-reply recovery');
      await context.close();
    }
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
