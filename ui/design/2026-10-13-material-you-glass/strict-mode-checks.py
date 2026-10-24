import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path(__file__).resolve().parent
expect.set_options(timeout=30000)
BASE=os.environ.get('AGRIDX_STRICT_URL','http://127.0.0.1:3116')
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('AGRIDX_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox']);c=await b.new_context(viewport={'width':1280,'height':900})
  await c.add_init_script("const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t.includes('webgl')?null:g.call(this,t,...a)}")
  page=await c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));checks=[]
  await page.add_init_script("localStorage.setItem('agridx-ui-version','old')");await page.goto(BASE+'/#/knowledge',wait_until='domcontentloaded')
  for index,width in enumerate([1280,1024,375,1280]):
   await page.set_viewport_size({'width':width,'height':900});glass=page.locator('.site-nav-glass');await expect(glass).to_have_attribute('data-glass-renderer','live');await page.wait_for_timeout(600)
   data=await glass.evaluate("e=>({filters:e.querySelectorAll('filter').length,offsets:e.querySelectorAll('feOffset[result=lens]').length,masks:e.querySelectorAll('feImage[result=rim]').length,live:getComputedStyle(e).backdropFilter.includes('url(')})")
   assert data=={'filters':1,'offsets':1,'masks':1,'live':True},data;checks.append({'name':f'React StrictMode resize {width}px, cycle {index}','result':'passed','detail':data})
   await page.evaluate("document.documentElement.classList.add('glass-off')");await expect(glass).to_have_attribute('data-glass-mode','solid');await page.wait_for_timeout(100)
   assert await glass.locator('filter').count()==0
   await page.evaluate("document.documentElement.classList.remove('glass-off')")
  assert not errors,errors
  checks.append({'name':'StrictMode cleanup and remount have no DOM or script errors','result':'passed'})
  (OUT/'strict-mode-checks.json').write_text(json.dumps({'browser':'Chromium '+b.version,'mode':'Actual Vite development React StrictMode; WebGL disabled to isolate effect cleanup','checks':checks,'errors':errors},indent=2)+'\n')
  print('PASS',len(checks),'StrictMode checks',flush=True);await c.close();await b.close()
asyncio.run(main())
