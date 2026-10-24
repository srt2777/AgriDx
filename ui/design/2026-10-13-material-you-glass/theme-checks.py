import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect

expect.set_options(timeout=30000)
OUT=Path(__file__).resolve().parent
BASE=os.environ.get('AGRIDX_PREVIEW_URL','http://127.0.0.1:3115')
checks=[];errors=[]

def check(name,ok,detail=None):
 assert ok,f'{name}: {detail}'
 checks.append({'name':name,'result':'passed',**({'detail':detail} if detail is not None else {})})
 print('PASS',name,flush=True)

def contrast(a,b):
 def luminance(rgb):
  channels=[v/255 for v in rgb[:3]]
  return sum((v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4)*weight for v,weight in zip(channels,[.2126,.7152,.0722]))
 x,y=sorted([luminance(a),luminance(b)])
 return (y+.05)/(x+.05)

async def colors(target,background):
 return await target.evaluate('''(e,selector)=>{
  const surface=selector==='self'?e:e.querySelector(selector);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const context=canvas.getContext('2d');
  const color=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data]};
  return {foreground:color(getComputedStyle(e).color),background:color(getComputedStyle(surface).backgroundColor)};
 }''',background)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('AGRIDX_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  for version in ['old','new']:
   for theme in ['light','dark']:
    context=await browser.new_context(viewport={'width':1440,'height':950})
    await context.add_init_script(f"localStorage.setItem('agridx-ui-version','{version}');localStorage.setItem('srt-theme','{theme}');localStorage.setItem('srt-lang','zh')")
    page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    await page.goto(BASE+'/#/knowledge')
    header=page.locator('.site-nav-glass' if version=='old' else '.new-version-header-glass')
    await expect(header).to_have_attribute('data-glass-renderer','live')
    await page.screenshot(path=str(OUT/f'contrast-{version}-{theme}.png'),animations='disabled')
    for kind,target in [('navigation',header.locator('.site-nav-item.is-active' if version=='old' else '.new-version-nav-item.is-active')),('version',header.locator('.ui-version-switch button[aria-pressed="true"]').first)]:
     data=await colors(target,'.fluid-selection-surface');ratio=contrast(data['foreground'],data['background'])
     check(f'{version} {theme}: selected {kind} has readable tonal colors',data['background'][3]==255 and ratio>=4.5,round(ratio,2))
    brand=page.locator('.catalog-selectors select').nth(0)
    option=brand.locator('option').filter(has_text='东方红');await expect(option).to_have_count(1);await brand.select_option(await option.get_attribute('value'))
    model=page.locator('.catalog-selectors select').nth(1);option=model.locator('option').filter(has_text='LF804S');await expect(option).to_have_count(1);await model.select_option(await option.get_attribute('value'))
    action=page.locator('.knowledge-page .catalog-action').first;await expect(action).to_be_visible()
    data=await colors(action,'self');ratio=contrast(data['foreground'],data['background'])
    check(f'{version} {theme}: diagnosis action uses readable primary colors',data['background'][3]==255 and ratio>=4.5,round(ratio,2))
    await context.close()
  context=await browser.new_context(viewport={'width':320,'height':844},is_mobile=True,has_touch=True)
  await context.add_init_script("localStorage.setItem('agridx-ui-version','new');if(!localStorage.getItem('srt-theme'))localStorage.setItem('srt-theme','light')")
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));await page.goto(BASE+'/#/knowledge')
  header=page.locator('.new-version-header-glass');await expect(header).to_have_attribute('data-glass-renderer','live');button=header.locator('[data-theme-switch]')
  box=await button.bounding_box();check('new mobile theme control retains a 44px hit area',box['width']>=44 and box['height']>=44,box)
  await header.evaluate("e=>{window.rippleInsertions=0;window.rippleObserver=new MutationObserver(items=>{for(const item of items)for(const node of item.addedNodes)if(node instanceof Element&&node.matches('.material-ripple'))rippleInsertions++});rippleObserver.observe(e,{subtree:true,childList:true})}")
  cdp=await context.new_cdp_session(page);await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}]})
  check('new mobile touch press reaches its own optical surface',await header.get_attribute('data-glass-pressed')=='true')
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await expect(page.locator('html')).to_have_attribute('data-theme','dark')
  check('new mobile touch creates a real ripple and releases cleanly',await page.evaluate('rippleInsertions')==1 and await header.get_attribute('data-glass-pressed') is None)
  await page.evaluate('rippleObserver.disconnect()');await page.reload();await expect(page.locator('html')).to_have_attribute('data-theme','dark');check('new mobile theme selection survives reload',True)
  await cdp.send('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-transparency','value':'reduce'}]})
  await expect(header).to_have_attribute('data-glass-mode','solid')
  check('reduced transparency removes native optics and uses an opaque surface',await header.locator('filter').count()==0 and await header.get_attribute('data-glass-renderer') is None)
  await cdp.send('Emulation.setEmulatedMedia',{'features':[]});await expect(header).to_have_attribute('data-glass-renderer','live');check('restoring transparency preference remounts one optical filter',await header.locator('filter').count()==1)
  await context.close();check('theme and preference checks have no script errors',not errors,errors)
  OUT.joinpath('theme-report.json').write_text(json.dumps({'version':json.loads((Path(__file__).resolve().parents[3]/'package.json').read_text())['version'],'checks':checks,'errors':errors,'scope':'Actual UI, opaque selected fills and primary actions; mobile touch; Chromium emulated transparency'},ensure_ascii=False,indent=2)+'\n')
  await browser.close()

asyncio.run(main())
