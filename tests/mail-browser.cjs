// Uses the existing ST harness with a real Chromium. No model requests or network services.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const repo = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  const relative = url.startsWith('/cand/') ? url.slice(6) : url.startsWith('/harness/') ? `tests/mobile/${url.slice(9)}` : `tests/mobile/${url.slice(1)}`;
  const file = path.resolve(repo, relative);
  if (!file.startsWith(`${repo}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.PJ_BROWSER ? { executablePath: process.env.PJ_BROWSER } : {}) });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/harness/st-shim.js', async route => {
        const shim = fs.readFileSync(path.join(repo, 'tests/mobile/st-shim.js'), 'utf8');
        await route.fulfill({ contentType: 'text/javascript', body: shim + `\n{
          const context = SillyTavern.getContext();
          window.__mailTest = { context, calls: 0, saves: 0 };
          context.chat = [{is_user:true,mes:'2025年5月1日，我们在一起。'},{is_user:false,mes:'他点了点头。'}];
          context.saveChat = async () => { window.__mailTest.saves++; };
          context.addOneMessage = message => { const div=document.createElement('div');div.className='test-delivered';div.textContent=message.mes;document.querySelector('#chat').append(div); };
          context.generateQuietPrompt = async () => { window.__mailTest.calls++; return '<journal_page><title>长长的恋爱日记</title><body>' + '我想把今天的温柔记下来。\\n\\n'.repeat(180) + '最后一句，仍然完整。</body></journal_page>'; };
          SillyTavern.getContext = () => context;
        }` });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/st-mobile.html?src=cand`);
      await page.waitForFunction(() => window.__stPrivateJournalRuntime && window.__mailTest);
      assert.equal(await page.evaluate(() => window.__stPrivateJournalRuntime.version), JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'))).version);
      await page.locator('#private-journal-launcher').click();
      await page.locator('.pj-cover').click();
      await page.locator('[data-type="romance_diary"]').click();
      await page.locator('[data-action="confirm-relationship"]').waitFor();
      page.on('dialog', dialog => dialog.accept());
      await page.locator('[data-action="confirm-relationship"]').click();
      await page.locator('[data-action="generate"]').click();
      await page.getByText('长长的恋爱日记', { exact: true }).click();
      const last = page.getByText('最后一句，仍然完整。', { exact: true });
      await last.scrollIntoViewIfNeeded();
      assert.ok(await last.isVisible(), 'long diary final paragraph visible');
      const geometry = await last.evaluate(node => { const r=node.getBoundingClientRect(); const pane=node.closest('.pj-pages').getBoundingClientRect(); return { top:r.top,bottom:r.bottom,paneTop:pane.top,paneBottom:pane.bottom }; });
      assert.ok(geometry.top >= geometry.paneTop && geometry.bottom <= geometry.paneBottom + 1, JSON.stringify(geometry));
      await page.locator('[data-type="calendar"]').click();
      await page.locator('[data-mail-date]').fill('2025-05-03');
      await page.locator('[data-mail-body]').fill('五月的贺卡，愿你平安。');
      await page.locator('[data-action="mail-schedule"]').click();
      await page.waitForFunction(() => window.__mailTest.context.chatMetadata.st_private_journal?.scheduledMail?.length === 1);
      assert.equal(await page.evaluate(() => window.__mailTest.saves), 0);
      await page.evaluate(() => window.__stPrivateJournalRuntime.initialize());
      await page.waitForTimeout(850);
      await page.locator('#private-journal-launcher').click();
      await page.locator('.pj-cover').click();
      await page.locator('[data-type="calendar"]').click();
      await page.locator('[data-mail-date]').fill('2025-05-03');
      await page.getByText('贺卡 · 待寄出', { exact: true }).waitFor();
      await page.evaluate(() => {
        const c = window.__mailTest.context;
        c.extensionSettings.st_private_journal.followMainGeneration = false;
        c.eventSource.emit('generation_started');
        c.chat.push({is_user:true,mes:'2025年5月4日，春天已到了尾声。'}, {is_user:false,mes:'他推开窗。'});
        c.eventSource.emit('generation_ended');
      });
      await page.waitForFunction(() => window.__mailTest.saves === 1);
      assert.ok(await page.evaluate(() => window.__mailTest.context.chat.at(-1).mes.includes('五月的贺卡，愿你平安。')));
      assert.equal(await page.evaluate(() => window.__mailTest.calls), 1, 'mailing does not request a model');
      await page.evaluate(() => window.__mailTest.context.eventSource.emit('generation_ended'));
      await page.waitForTimeout(900);
      assert.equal(await page.evaluate(() => window.__mailTest.saves), 1);
      await page.locator('[data-mail-date]').fill('2025-05-03');
      const pane = page.locator('.pj-pages');
      await pane.evaluate(node => { node.scrollTop = 0; });
      fs.mkdirSync(path.join(repo, 'output/playwright'), { recursive: true });
      await page.screenshot({ path: path.join(repo, `output/playwright/mail-${width}.png`) });
      await page.locator('[data-mail-body]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(repo, `output/playwright/mail-composer-${width}.png`) });
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: long diary scroll, calendar form, scheduled delivery, duplicate prevention, zero mail API calls`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
