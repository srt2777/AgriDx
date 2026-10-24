"""Local production checks. Requires Python Playwright, Pillow and Chromium; no external LLM calls."""
import asyncio, json, os, shutil, tempfile
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('AGRIDX_PREVIEW_URL', 'http://127.0.0.1:3105')
OUT = Path(__file__).resolve().parent
VIDEO_OUT = Path(tempfile.gettempdir())/'agridx-live-glass-video'
expect.set_options(timeout=20000)
checks, errors = [], []
INIT = """window.glassRaf=0;const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{window.glassRaf++;cb(t)});"""
NO_GL = """const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.includes('webgl')?null:get.call(this,type,...args)}"""
def check(name, ok, detail=None):
    assert ok, f'{name}: {detail}'
    checks.append({'name': name, 'result': 'passed', **({'detail': detail} if detail is not None else {})})
    print('PASS', name, flush=True)
def difference(first, second):
    diff = ImageChops.difference(Image.open(first).convert('RGB'), Image.open(second).convert('RGB'))
    return round(sum(ImageStat.Stat(diff).mean) / 3, 4)
def write_report(project_version, browser_version):
    (OUT/'browser-checks.json').write_text(json.dumps({'version':project_version,'browser':'Chromium '+browser_version,'checks':checks,'errors':errors,'scope':'Local production. Real WebGL pixel probe and real campus; no WebGL only for fallback/mobile UI isolation. Touch/preferences simulated in Chromium. No live LLM calls or deployment.'},ensure_ascii=False,indent=2)+'\n')
async def context_for(browser, width=1280, lang='zh', reduced=False, forced=False, gl=False, video=False, ua=None):
    options = {'viewport': {'width': width, 'height': 900 if width > 640 else 812}, 'is_mobile': width < 640, 'has_touch': width < 640,
               'reduced_motion': 'reduce' if reduced else 'no-preference', 'forced_colors': 'active' if forced else 'none'}
    if ua: options['user_agent'] = ua
    if video: options.update(record_video_dir=str(VIDEO_OUT), record_video_size=options['viewport'])
    context = await browser.new_context(**options)
    await context.add_init_script(INIT)
    await context.add_init_script(f"localStorage.setItem('srt-lang', {json.dumps(lang)})")
    if not gl: await context.add_init_script(NO_GL)
    page = await context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    return context, page
async def ready(glass):
    await glass.scroll_into_view_if_needed()
    await expect(glass).to_have_attribute('data-glass-renderer', 'live')
async def close_video(context, page, name):
    video = page.video
    await context.close()
    if video: shutil.copyfile(await video.path(), VIDEO_OUT / name)

# A real WebGL background, drawn only when requested, isolates backdrop sampling from text/shine.
GL_BACKDROP = """() => {
 const canvas=document.createElement('canvas');canvas.id='glass-test-background';canvas.width=innerWidth;canvas.height=160;
 canvas.style.cssText='position:fixed;inset:0 0 auto;height:160px;width:100%;z-index:20;pointer-events:none';document.body.append(canvas);
 const gl=canvas.getContext('webgl',{preserveDrawingBuffer:true});if(!gl)throw Error('WebGL backdrop fixture unavailable');
 function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform float phase;void main(){float stripe=step(.5,fract((gl_FragCoord.x+gl_FragCoord.y+phase)/32.));gl_FragColor=vec4(mix(vec3(.09,.31,.21),vec3(.87,.97,.91),stripe),1.);}'));
 gl.linkProgram(program);gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const location=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);const uniform=gl.getUniformLocation(program,'phase');
 window.glassTestPaint=phase=>{gl.uniform1f(uniform,phase);gl.drawArrays(gl.TRIANGLES,0,6);gl.finish()};window.glassTestPaint(0);
 return gl.getParameter(gl.VERSION);
}"""
async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get('AGRIDX_CHROMIUM', '/usr/bin/chromium'), args=['--no-sandbox'])
        context, page = await context_for(browser, gl=True)
        requests=[];page.on('request',lambda request:requests.append(request.url))
        await page.goto(BASE + '/#/knowledge', wait_until='domcontentloaded')
        run_version=(await (await page.request.get(BASE+'/api/health')).json())['version']
        glass=page.locator('.site-nav-glass');await ready(glass)
        check('classic secondary page uses a live native backdrop', 'url(' in await glass.evaluate('e=>getComputedStyle(e).backdropFilter'))
        gl_version=await page.evaluate(GL_BACKDROP)
        await glass.evaluate("e=>{e.querySelector('.liquid-glass-content').style.opacity='0';e.querySelector('.liquid-glass-shine').style.display='none'}")
        await page.mouse.move(1, 1);await page.wait_for_timeout(800)
        await glass.screenshot(path=str(OUT/'optics-webgl-rest.png'))
        original=await glass.evaluate("e=>e.style.getPropertyValue('--lg-live-filter')")
        await glass.evaluate("e=>e.style.setProperty('--lg-live-filter','blur(2.667px) saturate(135%)')")
        await page.wait_for_timeout(250);await glass.screenshot(path=str(OUT/'optics-webgl-blur.png'))
        delta=difference(OUT/'optics-webgl-rest.png',OUT/'optics-webgl-blur.png')
        check('actual WebGL pixels bend differently from identical frosting',delta>.8,{'mean_rgb_difference':delta,'context':gl_version})
        await glass.evaluate("(e,f)=>e.style.setProperty('--lg-live-filter',f)",original)
        button=page.get_by_role('button',name='切换主题',exact=True);box=await button.bounding_box()
        await page.mouse.move(box['x']+box['width']*.8,box['y']+box['height']*.6);await page.mouse.down();await page.wait_for_timeout(400)
        scale=float(await glass.locator('feDisplacementMap').first.get_attribute('scale'))
        await glass.screenshot(path=str(OUT/'optics-webgl-pressed.png'))
        delta=difference(OUT/'optics-webgl-rest.png',OUT/'optics-webgl-pressed.png')
        check('press changes actual refracted pixels with content and shine hidden',delta>.5 and abs(scale)>36,{'mean_rgb_difference':delta,'scale':scale})
        await page.mouse.move(1,1);await page.mouse.up();await page.wait_for_timeout(900)
        check('release returns the real optical filter to its resting curvature',abs(float(await glass.locator('feDisplacementMap').first.get_attribute('scale'))+28)<.01)
        # The unchanged glass samples a newly drawn WebGL framebuffer without a pointer event.
        await glass.screenshot(path=str(OUT/'optics-webgl-before-update.png'))
        await page.evaluate('glassTestPaint(16)');await page.wait_for_timeout(250)
        await glass.screenshot(path=str(OUT/'optics-webgl-updated.png'))
        delta=difference(OUT/'optics-webgl-before-update.png',OUT/'optics-webgl-updated.png')
        check('backdrop redraw immediately updates glass without input or screenshots-as-textures',delta>15,{'mean_rgb_difference':delta})
        await page.evaluate("document.getElementById('glass-test-background').remove()")
        await glass.evaluate("e=>{e.querySelector('.liquid-glass-content').style.removeProperty('opacity');e.querySelector('.liquid-glass-shine').style.removeProperty('display')}")
        await page.get_by_role('button',name='切换主题',exact=True).focus();await page.keyboard.down('Space');await page.wait_for_timeout(350)
        check('keyboard pressure drives the optical spring',abs(float(await glass.locator('feDisplacementMap').first.get_attribute('scale')))>34)
        await page.keyboard.up('Space');await page.mouse.move(1,1);await page.wait_for_timeout(1000)
        await page.get_by_role('button',name='切换主题',exact=True).click();await page.wait_for_timeout(900)
        await page.locator('.site-navigation').get_by_role('link',name='首页',exact=True).click()
        # The secondary UI retains the selected new/old preference; explicitly choose Classic.
        await page.locator('.expo-header .ui-version-switch').get_by_role('button',name='旧版',exact=True).click()
        await ready(page.locator('.site-nav-glass'));await ready(page.locator('.hero-model-entry'))
        await page.screenshot(path=str(OUT/'classic-desktop.png'))
        check('classic homepage and model entry share the live material',await page.locator('.hero-model-entry').get_attribute('data-glass-renderer')=='live')
        await page.locator('.site-navigation').get_by_role('link',name='诊断工作台',exact=True).click()
        await expect(page.get_by_role('textbox',name='故障描述')).to_be_visible()
        await page.mouse.move(1,1);await page.wait_for_timeout(1800)
        before=await page.evaluate('glassRaf');await page.wait_for_timeout(600);after=await page.evaluate('glassRaf')
        check('settled text page adds no continuous optical animation',after-before<=2,{'idle_raf_callbacks':after-before})
        check('glass adds no external fonts, background downloads or diagnosis calls',not any('fonts.googleapis' in u or 'fonts.gstatic' in u or '/api/chat' in u for u in requests))
        await page.set_viewport_size({'width':1024,'height':900});await ready(page.locator('.site-nav-glass'))
        await page.wait_for_timeout(500)
        geometry=await page.locator('.site-nav-glass').evaluate("e=>({width:e.clientWidth,map:Number(e.querySelector('feImage').getAttribute('width')),filters:e.querySelectorAll('filter').length})")
        check('resizing replaces the geometry without duplicate filters',geometry['width']==geometry['map'] and geometry['filters']==1,geometry)
        await page.evaluate("document.documentElement.classList.add('glass-off')")
        await expect(page.locator('.site-nav-glass')).to_have_attribute('data-glass-mode','solid')
        check('disabling glass releases its real optical engine',await page.locator('.site-nav-glass filter').count()==0)
        await page.evaluate("document.documentElement.classList.remove('glass-off')");await ready(page.locator('.site-nav-glass'))
        check('reenabling glass restores a single working lens',await page.locator('.site-nav-glass filter').count()==1)
        await context.close()

        context,page=await context_for(browser,gl=True,video=True)
        await page.goto(BASE,wait_until='domcontentloaded');await expect(page.locator('.world-zone-label')).to_have_count(4,timeout=40000)
        await expect(page.get_by_text('正在打开三维园区…',exact=True)).to_have_count(0,timeout=40000)
        for selector in ['.expo-header-glass','.expo-guide-glass','.expo-dock-glass']:
            await ready(page.locator(selector))
        check('new header, zone guide and dock all use the shared live material',True)
        bounds=await page.evaluate("({guide:document.querySelector('.expo-guide-glass').getBoundingClientRect().bottom,map:document.querySelector('.expo-mini-map').getBoundingClientRect().top})")
        check('glass guide stays clear of the campus map controls',bounds['guide']<bounds['map'],bounds)
        await page.locator('.expo-zone-nav button').first.click();panel=page.locator('.expo-zone-card');await expect(panel).to_be_visible();await ready(panel.locator('.floating-panel-glass'));await page.wait_for_timeout(1000)
        await page.screenshot(path=str(OUT/'new-campus.png'))
        geometry=await panel.evaluate("e=>({outer:getComputedStyle(e).borderRadius,glass:getComputedStyle(e.querySelector('.floating-panel-glass')).borderRadius})")
        check('zone panel uses a geometry-matched live lens',geometry['outer']==geometry['glass'],geometry)
        dock=page.locator('.expo-dock-glass');original=await dock.evaluate("e=>e.style.getPropertyValue('--lg-live-filter')")
        await dock.screenshot(path=str(OUT/'campus-dock-refracted.png'))
        await dock.evaluate("e=>e.style.setProperty('--lg-live-filter','blur(1.667px) saturate(135%)')");await page.wait_for_timeout(250)
        await dock.screenshot(path=str(OUT/'campus-dock-blur.png'))
        delta=difference(OUT/'campus-dock-refracted.png',OUT/'campus-dock-blur.png')
        check('actual campus WebGL backdrop is refracted under the dock',delta>.1,{'mean_rgb_difference':delta})
        await dock.evaluate("(e,f)=>e.style.setProperty('--lg-live-filter',f)",original)
        await panel.get_by_role('button',name='关闭展区说明',exact=True).click();await expect(panel).to_have_count(0)
        trigger=page.locator('.expo-catalog-trigger');await trigger.click();catalog=page.locator('#world-catalog')
        await expect(page.locator('.expo-search input')).to_be_focused();await ready(catalog.locator('.floating-panel-glass'));await page.wait_for_timeout(600)
        await page.locator('.expo-search input').fill('LF804S');await expect(page.locator('.expo-catalog-row')).to_have_count(1)
        check('glass catalog retains search focus and real model filtering',True)
        geometry=await catalog.evaluate("e=>({panel:e.clientHeight,glass:e.querySelector('.floating-panel-glass').clientHeight,content:e.querySelector('.floating-panel-content').clientHeight,list:e.querySelector('.expo-catalog-list').clientHeight})")
        check('catalog flex layout and scrollable list stay within the sheet',geometry['panel']==geometry['glass']==geometry['content'] and geometry['list']>0,geometry)
        await page.screenshot(path=str(OUT/'new-catalog.png'))
        catalog_handle=await catalog.element_handle()
        await catalog.get_by_role('button',name='关闭资料目录',exact=True).click()
        check('dismissed catalog becomes inert and restores trigger focus',await catalog_handle.evaluate('e=>e.inert && e.getAttribute("aria-hidden")==="true"') and await trigger.evaluate('e=>e===document.activeElement'))
        await expect(catalog).to_have_count(0)
        for index in [1,2,0]:
            await page.locator('.expo-zone-nav button').nth(index).click();await page.wait_for_timeout(700)
        await page.locator('.expo-zone-card').get_by_role('button',name='关闭展区说明',exact=True).click();await page.wait_for_timeout(900)
        await page.get_by_role('button',name='驾驶漫游',exact=True).click();stage=page.locator('.expo-world-stage');await expect(stage).to_have_attribute('data-mode','drive')
        before=await stage.get_attribute('data-tractor-z');await page.keyboard.down('w');await page.wait_for_timeout(400);await page.keyboard.up('w')
        check('real campus driving remains functional through live overlays',await stage.get_attribute('data-tractor-z')!=before)
        await page.keyboard.press('Escape');await expect(stage).to_have_attribute('data-mode','overview');await page.mouse.move(1,1);await page.wait_for_timeout(2200)
        before=await page.evaluate('glassRaf');await page.wait_for_timeout(600);after=await page.evaluate('glassRaf')
        check('parked real campus and glass settle without a persistent render loop',after-before<=2,{'idle_raf_callbacks':after-before})
        await close_video(context,page,'new-campus-live.webm')

        for width,lang in [(320,'zh'),(375,'en')]:
            context,page=await context_for(browser,width,lang)
            await page.goto(BASE,wait_until='domcontentloaded');await ready(page.locator('.expo-header-glass'));await ready(page.locator('.expo-guide-glass'));await ready(page.locator('.expo-dock-glass'))
            check(f'{width}px {lang} new UI enables bounded touch refraction',await page.locator('.expo-dock-glass').get_attribute('data-glass-mode')=='refract')
            check(f'{width}px {lang} new UI fits without horizontal overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            button=page.locator('.expo-zone-nav button').first;await button.scroll_into_view_if_needed();await ready(page.locator('.expo-guide-glass'));box=await button.bounding_box();cdp=await context.new_cdp_session(page)
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}]});await page.wait_for_timeout(350)
            scale=float(await page.locator('.expo-guide-glass feDisplacementMap').first.get_attribute('scale'))
            check(f'{width}px {lang} real touch pressure changes optical curvature',abs(scale)>29 and await button.get_attribute('data-glass-pressed')=='true',{'scale':scale})
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]});await page.wait_for_timeout(900)
            check(f'{width}px {lang} touch cancellation clears pressure and springs',await page.locator('[data-glass-pressed]').count()==0 and abs(float(await page.locator('.expo-guide-glass feDisplacementMap').first.get_attribute('scale'))+24)<.01)
            await page.evaluate('scrollTo(0,0)');await page.wait_for_timeout(500)
            check(f'{width}px {lang} below-fold dock releases its SVG renderer',await page.locator('.expo-dock-glass filter').count()==0)
            await page.locator('.expo-zone-nav button').first.click();await expect(page.locator('.expo-zone-card')).to_be_visible();await ready(page.locator('.expo-zone-card .floating-panel-glass'))
            await page.screenshot(path=str(OUT/f'new-mobile-{width}-{lang}.png'),full_page=True)
            version=page.locator('.expo-header .ui-version-switch').get_by_role('button',name='旧版' if lang=='zh' else 'Classic',exact=True)
            await version.click();await ready(page.locator('.site-nav-glass'));await ready(page.locator('.site-version-mobile-glass'))
            check(f'{width}px {lang} classic nav and version capsule share touch optics',await page.locator('.site-nav-glass').get_attribute('data-glass-mode')=='refract' and await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            menu=page.get_by_role('button',name='菜单' if lang=='zh' else 'Menu',exact=True);await menu.click();await expect(page.locator('#mobile-navigation')).to_be_visible()
            await page.screenshot(path=str(OUT/f'classic-mobile-{width}-{lang}.png'),full_page=True)
            check(f'{width}px {lang} classic menu remains usable',await page.locator('#mobile-navigation a').count()>0)
            await context.close()

        for preference in ['reduced','forced','glass-off','transparency','unsupported','safari-fallback']:
            context,page=await context_for(browser,reduced=preference=='reduced',forced=preference=='forced',ua='Mozilla/5.0 Version/18.0 Safari/605.1.15' if preference=='safari-fallback' else None)
            if preference=='glass-off': await context.add_init_script("document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('glass-off'))")
            if preference=='transparency': await context.add_init_script("const match=matchMedia.bind(window);window.matchMedia=q=>q.includes('prefers-reduced-transparency')?{matches:true,addEventListener(){},removeEventListener(){}}:match(q)")
            if preference=='unsupported': await context.add_init_script("const supports=CSS.supports.bind(CSS);CSS.supports=(p,v)=>p.includes('backdrop-filter')?false:supports(p,v)")
            for path,selector in [('/','.expo-dock-glass'),('/#/knowledge','.site-nav-glass')]:
                await page.goto(BASE+path,wait_until='domcontentloaded');glass=page.locator(selector);await expect(glass).to_be_visible();await page.wait_for_timeout(450)
                expected='blur' if preference in ['reduced','safari-fallback'] else 'solid'
                check(f'{preference} fallback on {selector}',await glass.get_attribute('data-glass-mode')==expected and await glass.locator('[data-glass-optics="live"]').count()==0)
                if expected=='solid': check(f'{preference} removes background sampling on {selector}',await glass.evaluate('e=>getComputedStyle(e).backdropFilter')=='none')
            await context.close()
        check('no browser script errors',not errors,errors)
        write_report(run_version,browser.version)
        print('TOTAL',len(checks),flush=True)
        await browser.close()
if __name__=='__main__':
    asyncio.run(main())
