import asyncio,json,os
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
from playwright.async_api import async_playwright,expect
expect.set_options(timeout=30000)
BASE=os.environ.get('AGRIDX_PREVIEW_URL','http://127.0.0.1:3115')
OUT=Path(__file__).resolve().parent;checks=[];errors=[]
def check(name,ok,detail=None):
 assert ok,f'{name}: {detail}'
 checks.append({'name':name,'result':'passed',**({'detail':detail} if detail is not None else {})});print('PASS',name,flush=True)
def delta(a,b):return sum(ImageStat.Stat(ImageChops.difference(Image.open(a).convert('RGB'),Image.open(b).convert('RGB'))).mean)/3
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('AGRIDX_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  c=await browser.new_context(viewport={'width':1440,'height':950});await c.add_init_script("localStorage.setItem('agridx-ui-version','old');localStorage.setItem('srt-theme','light');localStorage.setItem('srt-lang','zh')")
  page=await c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE+'/#/knowledge');glass=page.locator('.site-nav-glass');await expect(glass).to_have_attribute('data-glass-renderer','live')
  check('classic uses Material You color roles and a native live filter',await glass.get_attribute('data-glass-design')=='material-you' and await glass.locator('filter').count()==1)
  await page.screenshot(path=str(OUT/'classic-light.png'),animations='disabled')
  # A real WebGL canvas behind the actual React header verifies native optical sampling.
  await page.evaluate('''()=>{const canvas=document.createElement('canvas');canvas.id='optics-background';canvas.width=1440;canvas.height=160;canvas.style.cssText='position:fixed;left:0;top:0;width:1440px;height:160px;z-index:40;pointer-events:none';document.body.append(canvas);const gl=canvas.getContext('webgl');if(!gl)throw Error('WebGL unavailable');window.opticsGL=gl;window.paintOptics=(shift=0)=>{gl.enable(gl.SCISSOR_TEST);for(let x=0;x<1440;x+=12){gl.scissor(x,0,12,160);const light=((x/12+shift)%2)===0;gl.clearColor(...(light?[.82,.95,.89,1]:[.06,.22,.17,1]));gl.clear(gl.COLOR_BUFFER_BIT)}};paintOptics()}''')
  await page.mouse.move(1,500);await page.wait_for_timeout(900);original=await glass.evaluate("e=>e.style.getPropertyValue('--lg-live-filter')")
  await glass.screenshot(path=str(OUT/'webgl-refracted.png'));await glass.evaluate("e=>e.style.setProperty('--lg-live-filter','blur(3px) saturate(115%)')");await page.wait_for_timeout(150);await glass.screenshot(path=str(OUT/'webgl-blur.png'))
  difference=delta(OUT/'webgl-refracted.png',OUT/'webgl-blur.png');check('native refraction changes actual WebGL pixels beyond ordinary blur',difference>.5,round(difference,3))
  await glass.evaluate('(e,v)=>e.style.setProperty("--lg-live-filter",v)',original);await page.evaluate('paintOptics(1)');await page.wait_for_timeout(150);await glass.screenshot(path=str(OUT/'webgl-updated.png'))
  difference=delta(OUT/'webgl-refracted.png',OUT/'webgl-updated.png');check('live backdrop reflects later WebGL frames without DOM capture',difference>5,round(difference,3))
  await page.evaluate("document.querySelector('#optics-background').remove()")
  button=page.get_by_role('button',name='切换语言',exact=True);await page.locator('[data-theme-switch]').focus();box=await button.bounding_box();channel=glass.locator('feDisplacementMap').first;rest=float(await channel.get_attribute('scale'))
  await page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);await page.mouse.down();await page.wait_for_timeout(100)
  check('focus transfer keeps the new control pressed',await glass.get_attribute('data-glass-pressed')=='true');check('pointer press creates a clipped Material You ripple',await button.locator('.material-ripple').count()==1)
  await page.wait_for_function("Math.abs(document.querySelector('.site-nav-glass feDisplacementMap').getAttribute('scale'))>30.8",timeout=15000);pressed=float(await channel.get_attribute('scale'));check('pointer press changes the real lens strength',abs(pressed)>abs(rest)*1.1,{'rest':rest,'pressed':pressed})
  await page.screenshot(path=str(OUT/'pointer-pressed.png'));await page.mouse.move(1,500);await page.mouse.up();await page.wait_for_function("document.querySelector('.site-nav-glass feDisplacementMap').getAttribute('scale')==='-28.000' && document.querySelector('.site-nav-glass feOffset').getAttribute('dx')==='0.000' && document.querySelector('.site-nav-glass feOffset').getAttribute('dy')==='0.000'",timeout=15000)
  check('ripple is removed after its finite animation',await page.locator('.material-ripple').count()==0)
  await glass.evaluate('''e=>{window.lensChanges=0;window.lensObserver=new MutationObserver(items=>window.lensChanges+=items.length);lensObserver.observe(e.querySelector('filter'),{subtree:true,attributes:true})}''');await page.wait_for_timeout(400)
  check('optical filter has no attribute animation while idle',await page.evaluate('lensChanges')==0);await page.evaluate('lensObserver.disconnect()')
  await page.locator('[data-theme-switch]').focus();await button.focus();await page.keyboard.down(' ');await page.wait_for_timeout(80);check('keyboard press gets the same bounded ripple',await button.locator('.material-ripple').count()==1);await page.keyboard.up(' ');await page.wait_for_timeout(650)
  await page.locator('[data-theme-switch]').click();await expect(page.locator('html')).to_have_class(__import__('re').compile('.*theme-dark.*'));await page.wait_for_timeout(400);await page.screenshot(path=str(OUT/'classic-dark.png'),animations='disabled')
  check('classic dark theme changes semantic primary and surface colors',await page.locator('html').evaluate("e=>getComputedStyle(e).getPropertyValue('--md-primary').trim()")=='#8dd5b2')
  await c.close()
  for version,width,lang in [('old',320,'zh'),('old',390,'en'),('new',320,'zh'),('new',390,'en')]:
   c=await browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True)
   await c.add_init_script(f"localStorage.setItem('agridx-ui-version','{version}');localStorage.setItem('srt-lang','{lang}');localStorage.setItem('srt-theme','{'light' if width==320 else 'dark'}')")
   page=await c.new_page();page.on('pageerror',lambda e:errors.append(str(e)));await page.goto(BASE+'/')
   target=page.locator('.site-nav-glass' if version=='old' else '.expo-header-glass');await expect(target).to_have_attribute('data-glass-renderer','live')
   check(f'{version} mobile {width}: live Material You glass is enabled',await target.get_attribute('data-glass-design')=='material-you')
   check(f'{version} mobile {width}: no horizontal overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   await page.screenshot(path=str(OUT/f'{version}-mobile-{width}.png'),animations='disabled')
   if version=='old':
    menu=page.get_by_role('button',name='菜单' if lang=='zh' else 'Menu',exact=True);box=await menu.bounding_box();cdp=await c.new_cdp_session(page);await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}]});check(f'classic mobile {width}: touch press creates bounded ripple',await menu.locator('.material-ripple').count()==1);await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await expect(page.locator('#mobile-navigation')).to_be_visible();check(f'classic mobile {width}: touch release clears press state',await target.get_attribute('data-glass-pressed') is None);check(f'classic mobile {width}: menu remains operable',True)
   await c.close()
  c=await browser.new_context(viewport={'width':1440,'height':950});await c.add_init_script("localStorage.setItem('srt-theme','dark');localStorage.setItem('srt-lang','zh')");page=await c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE+'/');await expect(page.locator('.expo-dock-glass')).to_have_attribute('data-glass-renderer','live');await page.wait_for_timeout(1000);await page.screenshot(path=str(OUT/'new-campus.png'),animations='disabled')
  await page.locator('.expo-zone-nav button').first.click();await expect(page.locator('.expo-zone-card')).to_be_visible();check('new campus uses Material You tonal selection and live zone panel',await page.locator('.expo-zone-card .floating-panel-glass').get_attribute('data-glass-renderer')=='live')
  await page.locator('.expo-catalog-trigger').click();await expect(page.locator('.expo-search input')).to_be_focused();await expect(page.locator('.expo-catalog-row').first).to_be_visible();await page.screenshot(path=str(OUT/'new-catalog.png'),animations='disabled')
  await page.locator('.expo-search input').fill('LF804S');await expect(page.locator('.expo-catalog-row')).to_have_count(1);await page.locator('.expo-catalog-row').click();await expect(page.locator('.catalog-selectors')).to_be_visible()
  check('new knowledge route retains tonal shell and real model selection',await page.locator('.new-version-header-glass').get_attribute('data-glass-design')=='material-you')
  await page.screenshot(path=str(OUT/'new-knowledge.png'),animations='disabled');await page.locator('[data-theme-switch]').click();await expect(page.locator('html')).to_have_attribute('data-theme','light');check('new pages respect global light theme with their own Material You roles',await page.locator('.new-version-shell').evaluate("e=>getComputedStyle(e).getPropertyValue('--md-surface').trim()")== '#f6fafe');await page.screenshot(path=str(OUT/'new-knowledge-light.png'),animations='disabled')
  await c.close()
  for feature,options in [('reduced-motion',{'reduced_motion':'reduce'}),('forced-colors',{'forced_colors':'active'})]:
   c=await browser.new_context(viewport={'width':1280,'height':900},**options);await c.add_init_script("localStorage.setItem('agridx-ui-version','old')");page=await c.new_page();page.on('pageerror',lambda e:errors.append(str(e)));await page.goto(BASE+'/#/knowledge');glass=page.locator('.site-nav-glass');await expect(glass).to_have_attribute('data-glass-mode','blur' if feature=='reduced-motion' else 'solid')
   check(feature+' avoids SVG optics',await glass.locator('filter').count()==0)
   button=page.get_by_role('button',name='切换语言',exact=True);box=await button.bounding_box();await page.mouse.move(box['x']+10,box['y']+10);await page.mouse.down();check(feature+' avoids animated ripple',await page.locator('.material-ripple').count()==0);await page.mouse.up();await c.close()
  check('all tested pages have no script errors',not errors,errors)
  await browser.close()
 OUT.joinpath('browser-report.json').write_text(json.dumps({'version':json.loads((Path(__file__).resolve().parents[3]/'package.json').read_text())['version'],'checks':checks,'errors':errors,'scope':'Actual production UI; live WebGL optics; mobile Chinese/English; fallbacks'},ensure_ascii=False,indent=2)+'\n')
asyncio.run(main())
