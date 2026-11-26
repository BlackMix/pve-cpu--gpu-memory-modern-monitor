"""Optional browser smoke test using mocked ExtJS and sample metrics (not real PVE)."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1600,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<body style="background:#252525;color:#ddd;font-family:Arial"><main id="root"></main></body>')
    page.evaluate('''() => {
      window.sample={version:1,timestamp:Date.now()/1000,cpu:{model:'Xeon test',cores:22,usage:12,temperatures:[{c:45}],threads:Array.from({length:44},(_,i)=>({id:i,socket:0,core:[0,1,2,3,4,5,8,9,10,11,12,16,17,18,19,20,21,24,25,26,27,28][i%22],usage:i,mhz:2200}))},memory:{total:128*2**30,used:10*2**30,cache:20*2**30,buffers:2*2**30,free:96*2**30,available:116*2**30,swap_used:0,swap_total:8*2**30},gpus:[{name:'RTX 3090',bus:'03:00.0',driver:'test',usage:12,vram_used:20000,vram_total:24576,temp:47,fan:53,power:84,power_limit:350}],gpu_timestamp:1};
      window.summaries=[];window.Ext={onReady:fn=>fn(),ComponentQuery:{query:()=>window.summaries},create:(name,opts)=>{const root=document.createElement('div');root.innerHTML=opts.html;root.style.height=opts.height+'px';root.style.overflow='hidden';const events={};return {body:{dom:root},rendered:true,isVisible:()=>true,getHeight:()=>root.offsetHeight,setHeight:h=>{root.style.height=h+'px';if(events.resize)events.resize();},on:(name,fn)=>events[name]=fn,events,root}},Ajax:{request:opts=>opts.callback(opts,true,{responseText:JSON.stringify({data:window.sample})})}};
    }''')
    page.add_script_tag(path=str(root/'src/dashboard.js'))
    page.evaluate('''() => {window.summaries.push({rendered:true,isVisible:()=>true,getComponent:()=>window.panel,pveSelNode:{data:{node:'pve'}},insert(i,p){document.querySelector('#root').appendChild(p.root);p.events.afterrender();window.panel=p;}})}''')
    page.locator('.phm-core').first.wait_for()
    assert page.locator('.phm-core').count()==22
    assert page.locator('.phm-core-label').all_text_contents()==[f'Core {i:02}' for i in range(22)]
    assert page.locator('.phm-core-label').last.get_attribute('title')=='Socket 0 · Hardware core ID 28'
    page.wait_for_function('window.panel.getHeight() > 85 && window.panel.getHeight() >= document.querySelector(".phm").scrollHeight')
    assert page.locator('.phm-core .phm-track').count()==44
    assert page.get_by_text('RTX 3090',exact=True).count()==1
    # Validate exact threshold edges and independent bars, including live transitions.
    page.evaluate('''() => { [0,29.9,30,55,55.1,90,90.1,100].forEach((v,i)=>window.sample.cpu.threads[i].usage=v) }''')
    page.wait_for_timeout(1500)
    actual=page.locator('.phm-core').evaluate_all('cores => cores.slice(0,8).map(c=>c.querySelector(".phm-fill").style.backgroundColor)')
    assert actual==['rgb(69, 166, 108)']*2+['rgb(228, 194, 70)']*2+['rgb(240, 138, 50)']*2+['rgb(224, 82, 82)']*2,actual
    page.evaluate('window.sample.cpu.threads[0].usage=88')
    page.wait_for_timeout(1200)
    assert page.get_by_text('88.0%',exact=True).count()==1
    assert page.locator('.phm').count()==1
    page.evaluate('window.panel.events.destroy()')
    assert not errors,errors
    browser.close()
print('Browser mock smoke test passed: 22 cores, 44 threads, GPU, live update.')
