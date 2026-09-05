from playwright.sync_api import sync_playwright
import json, sys

BASE='http://127.0.0.1:8899/st-mobile.html?src=cand'
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
SIZES=[(320,568),(375,667),(390,844),(393,852),(430,932)]
fails=[]
ENGINE=(sys.argv[1] if len(sys.argv)>1 else 'chromium').strip().lower()
if ENGINE not in ('chromium','webkit'):
    raise SystemExit('usage: python verify.py [chromium|webkit]')
def check(name, cond, detail=''):
    print(('  PASS  ' if cond else '  FAIL  ')+name+(f'  <- {detail}' if detail and not cond else ''))
    if not cond: fails.append(name)

def ctx(b,w=390,h=844):
    return b.new_context(viewport={'width':w,'height':h},device_scale_factor=3,
                         is_mobile=True,has_touch=True,user_agent=UA)

GEO="""()=>{
 const r=document.querySelector('#private-journal');
 const cs=getComputedStyle(r), b=r.getBoundingClientRect();
 const hit=el=>{ if(!el) return 'missing'; const x=el.getBoundingClientRect();
   if(!x.width||!x.height) return 'zero-size';
   const t=document.elementFromPoint(x.left+x.width/2,x.top+x.height/2);
   return t&&(el===t||el.contains(t))?'hittable':'blocked'; };
 const hits=document.elementsFromPoint(innerWidth/2,innerHeight/2);
 return {vw:innerWidth,vh:innerHeight,display:cs.display,visibility:cs.visibility,
   opacity:cs.opacity,z:cs.zIndex,w:b.width,h:b.height,l:b.left,t:b.top,
   topInsideOverlay: hits[0]? !!hits[0].closest('#private-journal') : false,
   close:hit(r.querySelector('.pj-scene-close')), cover:hit(r.querySelector('.pj-cover'))};
}"""

with sync_playwright() as p:
  print(f'\n=== browser engine: {ENGINE} ===')
  b=getattr(p,ENGINE).launch()

  print('\n=== 4. 实际运行版本 ===')
  c=ctx(b); pg=c.new_page(); pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(600)
  rt=pg.evaluate("()=>({v:window.__stPrivateJournalRuntime.version, html:document.documentElement.dataset.privateJournalVersion, root:document.querySelector('#private-journal').dataset.pluginVersion})")
  check('runtime.version === 0.21.3', rt['v']=='0.21.3', rt)
  check('documentElement dataset marker', rt['html']=='0.21.3', rt)
  check('root dataset marker', rt['root']=='0.21.3', rt)

  print('\n=== 9. 资源 URL（module 下 currentScript 为 null）===')
  a=pg.evaluate("()=>window.__stPrivateJournalRuntime.assets()")
  cs_null=pg.evaluate("()=>document.currentScript")
  check('document.currentScript is null under module load', cs_null is None)
  check('base resolved without depending on CSS', a['strategy'] in ('error-stack','script-tag'), a['strategy'])
  src=pg.evaluate("()=>document.querySelector('.pj-desk-art').getAttribute('src')")
  natural=pg.evaluate("()=>document.querySelector('.pj-desk-art').naturalWidth")
  check('desk asset absolute + loaded', src.startswith('http') and natural>0, f'{src} nw={natural}')

  print('\n=== 8. 样式表健康 ===')
  ss=pg.evaluate("()=>window.__stPrivateJournalRuntime.stylesheet()")
  check('stylesheet ok + marker matches', ss['status']=='ok' and ss['marker']=='0.21.3', ss)
  c.close()

  print('\n=== 10. 正文停止后释放生成锁 ===')
  c=ctx(b); pg=c.new_page(); pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(400)
  pg.evaluate("()=>window.__ST_EVENT_SOURCE.emit('generation_started')")
  active=pg.evaluate("()=>window.__stPrivateJournalRuntime.report().generationState.mainActive")
  pg.evaluate("()=>window.__ST_EVENT_SOURCE.emit('generation_stopped')")
  stopped=pg.evaluate("()=>window.__stPrivateJournalRuntime.report().generationState")
  check('GENERATION_STARTED acquires lock', active is True, active)
  check('GENERATION_STOPPED releases lock', stopped['mainActive'] is False and stopped['cycleSeen'] is False, stopped)
  c.close()

  print('\n=== 7. 真实移动端几何矩阵 ===')
  for w,h in SIZES:
    c=ctx(b,w,h); pg=c.new_page(); pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(400)
    pg.evaluate("()=>window.__stPrivateJournalRuntime.openJournal()"); pg.wait_for_timeout(400)
    g=pg.evaluate(GEO)
    ok = (g['display']!='none' and g['visibility']!='hidden' and float(g['opacity'])>0
          and g['w']>=g['vw'] and g['h']>=g['vh'] and g['topInsideOverlay']
          and g['close']=='hittable' and g['cover']=='hittable')
    check(f'{w}x{h} overlay fully visible + close/cover hittable', ok, json.dumps(g))
    c.close()

  print('\n=== 1 + 6. 入口事件 / pointerup 去重 ===')
  for target,prep,src in [('#private-journal-launcher',None,'launcher'),
      ('#private-journal-wand-entry',"()=>document.getElementById('extensionsMenu').classList.remove('closed')",'wand-entry'),
      ('#private-journal-extension-entry button',"()=>document.getElementById('rm_extensions_block').classList.remove('closed')",'drawer-entry')]:
    c=ctx(b); pg=c.new_page(); pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(400)
    if prep: pg.evaluate(prep); pg.wait_for_timeout(150)
    pg.tap(target); pg.wait_for_timeout(600)
    log=pg.evaluate("()=>window.__stPrivateJournalRuntime.entryLog()")
    tr=pg.evaluate("()=>window.__stPrivateJournalRuntime.trace()")
    opens=[r for r in tr if r['stage']=='openJournal:enter']
    acts=[r for r in log if r.get('phase')=='activate']
    types={r.get('eventType') for r in log}
    fields=all(k in log[0] for k in ['eventType','pointerType','target','currentTarget','defaultPrevented','targetConnected','instanceId','pluginVersion'])
    check(f'{src}: entry events recorded', len(log)>0 and fields, list(log[0].keys()) if log else 'none')
    check(f'{src}: pointerup/click observed', {'pointerup','click'} & types != set(), types)
    check(f'{src}: opened exactly once (no double)', len(opens)==1 and len(acts)==1, f'opens={len(opens)} acts={len(acts)}')
    check(f'{src}: activation source correct', acts and acts[0]['source']==src, acts[0]['source'] if acts else None)
    rep=pg.evaluate("()=>window.__stPrivateJournalRuntime.report()")
    check(f'{src}: self-report verdict visible', rep['verdict']=='visible', rep['verdict'])
    c.close()

  print('\n=== 2. openJournal 可见性诊断字段 ===')
  c=ctx(b); pg=c.new_page(); pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(400)
  pg.evaluate("()=>window.__stPrivateJournalRuntime.openJournal()"); pg.wait_for_timeout(500)
  tr=pg.evaluate("()=>window.__stPrivateJournalRuntime.trace()")
  probes=[r for r in tr if str(r['stage']).startswith('overlay:')]
  need=['rootConnected','className','hidden','inlineDisplay','display','visibility','opacity','position','zIndex','rect','viewport','coversViewport','topmostInsideOverlay','stack','stylesheet','verdict']
  check('after-open probe fired', any(r['stage']=='overlay:after-open' for r in probes))
  check('next-frame probe fired', any(r['stage']=='overlay:after-open-frame' for r in probes))
  miss=[k for k in need if k not in probes[0]] if probes else need
  check('probe carries all required fields', not miss, f'missing {miss}')
  check('elementsFromPoint top-10 captured', len(probes[0]['stack'])>0 and len(probes[0]['stack'])<=10)
  c.close()

  print('\n=== 8b. 过期 CSS（JS 0.21.3 + CSS 0.21.2 缓存）===')
  c=ctx(b); pg=c.new_page()
  def stale(route):
    body=open(__import__('pathlib').Path(__file__).resolve().parents[2]/'style.css',encoding='utf-8').read().replace('--pj-stylesheet-version:"0.21.3"','--pj-stylesheet-version:"0.21.2"')
    route.fulfill(status=200,content_type='text/css',body=body)
  pg.route('**/cand/style.css', stale)
  errs=[]; toasts=[]
  pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
  pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(700)
  ss=pg.evaluate("()=>window.__stPrivateJournalRuntime.stylesheet()")
  rep=pg.evaluate("()=>window.__stPrivateJournalRuntime.report()")
  toast=pg.evaluate("()=>window.__HARNESS_LOG.filter(r=>r[0].startsWith('toastr')).map(r=>r[1])")
  check('stale CSS detected', ss['status']=='stale' and ss['marker']=='0.21.1', ss)
  check('verdict D:stale-css-cached', rep['verdict']=='D:stale-css-cached', rep['verdict'])
  check('loud console error emitted', any('stylesheet' in e for e in errs), errs[:2])
  check('user-visible toastr emitted', any('样式表' in t for t in toast), toast)
  c.close()

  print('\n=== 8c. CSS 完全缺失 ===')
  c=ctx(b); pg=c.new_page()
  pg.goto('http://127.0.0.1:8899/st-mobile.html?src=cand&css=none',wait_until='networkidle'); pg.wait_for_timeout(700)
  ss=pg.evaluate("()=>window.__stPrivateJournalRuntime.stylesheet()")
  rep=pg.evaluate("()=>window.__stPrivateJournalRuntime.report()")
  geo=pg.evaluate("()=>{const r=document.querySelector('#private-journal');const b=r.getBoundingClientRect();return {display:getComputedStyle(r).display,w:b.width,h:b.height};}")
  check('missing CSS detected', ss['status']=='missing', ss)
  check('verdict D:css-not-loaded', rep['verdict']=='D:css-not-loaded', rep['verdict'])
  check('closed overlay NOT dumped into page', geo['display']=='none' and geo['h']==0, geo)
  c.close()

  print('\n=== 5. 二次初始化 / 清理归属 ===')
  c=ctx(b); pg=c.new_page(); warns=[]
  pg.on('console', lambda m: warns.append(m.text) if m.type=='warning' else None)
  pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(400)
  first=pg.evaluate("()=>window.__stPrivateJournalRuntime.instanceId")
  pg.evaluate("()=>{const s=document.createElement('script');s.type='module';s.src='/cand/index.js?v=2';document.body.appendChild(s);}")
  pg.wait_for_timeout(900)
  tr=pg.evaluate("()=>window.__stPrivateJournalTrace")
  second=pg.evaluate("()=>window.__stPrivateJournalRuntime.instanceId")
  ids=sorted({r['instanceId'] for r in tr})
  sup=[r for r in tr if r['stage']=='runtime:superseding']
  cl=[r for r in tr if r['stage']=='cleanupPluginInstance']
  check('trace ledger survives across instances', len(ids)==2, ids)
  check('supersede recorded with previous id', sup and sup[0]['previousInstanceId']==first, sup)
  check('cleanup carries a reason', cl and all(r.get('reason') for r in cl), [r.get('reason') for r in cl])
  check('exactly one root survives', pg.evaluate("()=>document.querySelectorAll('#private-journal').length")==1)
  check('root owned by live runtime', pg.evaluate("()=>window.__stPrivateJournalRuntime.instanceId===document.querySelector('#private-journal').dataset.privateJournalInstance"))
  rep=pg.evaluate("()=>window.__stPrivateJournalRuntime.report()")
  check('report flags multiple runtimes', rep['verdict']=='C:multiple-runtimes-in-page', rep['verdict'])
  c.close()

  c.close()

  print('\n=== 5b. 旧 runtime 丢失时的孤儿 DOM 归属 ===')
  c=ctx(b); pg=c.new_page(); warns=[]
  pg.on('console', lambda m: warns.append(m.text) if m.type=='warning' else None)
  pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(400)
  first=pg.evaluate("()=>window.__stPrivateJournalRuntime.instanceId")
  # Simulate a runtime handle that was clobbered, so the old instance can never
  # dispose itself and the new one inherits its orphaned DOM.
  pg.evaluate("()=>{delete window.__stPrivateJournalRuntime;}")
  pg.evaluate("()=>{const s=document.createElement('script');s.type='module';s.src='/cand/index.js?v=3';document.body.appendChild(s);}")
  pg.wait_for_timeout(900)
  tr=pg.evaluate("()=>window.__stPrivateJournalTrace")
  rm=[r for r in tr if r['stage']=='removeJournalDomArtifacts' and r.get('removedForeign',0)>0]
  check('orphaned foreign DOM identified in trace', len(rm)>0, [r for r in tr if r['stage']=='removeJournalDomArtifacts'])
  check('foreign-DOM removal warned', any('another instance' in w for w in warns), warns[:3])
  check('victims name the previous owner', rm and any(first in (v or '') for v in rm[0]['victims']), rm[0]['victims'] if rm else None)
  check('exactly one root survives', pg.evaluate("()=>document.querySelectorAll('#private-journal').length")==1)
  c.close()

  print('\n=== observer 节流（0.19.0 为 2 秒 92 次）===')
  c=ctx(b); pg=c.new_page(); pg.goto(BASE,wait_until='networkidle'); pg.wait_for_timeout(500)
  pg.evaluate("""()=>{window.__scan=0;const oq=Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll=function(s){if(typeof s==='string'&&s.includes('private-journal-wand-entry'))window.__scan++;return oq.call(this,s);};}""")
  pg.evaluate("()=>window.__stPrivateJournalRuntime.openJournal()"); pg.wait_for_timeout(300)
  pg.evaluate("()=>window.__scan=0")
  pg.evaluate("""()=>{const n=document.querySelector('#chat .mes');let i=0;
    window.__t=setInterval(()=>{n.classList.toggle('streaming');n.style.opacity=(i++%2)?'0.99':'1';},16);}""")
  pg.wait_for_timeout(2000); pg.evaluate("()=>clearInterval(window.__t)")
  scans=pg.evaluate("()=>window.__scan")
  check(f'menu rescans during 2s churn <= 12 (was 92)', scans<=12, scans)
  c.close()
  b.close()

print('\n================ RESULT ================')
print('FAILED:',fails if fails else 'none')
sys.exit(1 if fails else 0)
