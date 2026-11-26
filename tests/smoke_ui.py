"""Optional browser smoke test using mocked ExtJS and sample metrics (not real PVE)."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1600,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m: print(m.text) if m.type=='error' else None)
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
    # GPU gradients remain full-width, clipped at the measured percentage.
    gpu=page.locator('.phm-gpu-card')
    assert gpu.locator('.phm-heat-fill').count()==4
    bar=gpu.locator('[aria-label="GPU Usage"] .phm-heat-fill')
    assert bar.evaluate('e=>e.style.getPropertyValue("--phm-load")')=='12%'
    assert bar.evaluate('e=>e.offsetWidth === e.parentElement.clientWidth')
    for load in (10,40,70,97):
        page.evaluate('(v)=>{sample.gpus[0].usage=v;sample.gpus[0].vram_used=sample.gpus[0].vram_total*v/100;sample.gpu_timestamp++}',load)
        page.wait_for_function('''(v)=>document.querySelector('.phm-gpu-card [aria-label="GPU Usage"]').getAttribute("aria-valuenow")===String(v)''',arg=load)
        assert bar.evaluate('e=>e.style.getPropertyValue("--phm-load")')==f'{load}%'
    stops=gpu.locator('linearGradient stop').evaluate_all('stops=>stops.map(s=>[s.getAttribute("offset"),s.getAttribute("stop-color")])')
    assert stops==[['0%','#45a66c'],['29%','#45a66c'],['30%','#e4c246'],['54%','#e4c246'],['55%','#f08a32'],['89%','#f08a32'],['90%','#e05252'],['100%','#e05252']],stops
    assert gpu.locator('linearGradient').get_attribute('gradientUnits')=='userSpaceOnUse'
    assert gpu.locator('polyline').get_attribute('stroke').startswith('url(#phm-heat-')
    pts=gpu.locator('polyline').get_attribute('points').split()
    assert [float(pt.split(',')[1]) for pt in pts[-4:]]==[27.2,18.8,10.4,2.84],pts
    page.evaluate('()=>{sample.gpus[0].usage=null;sample.gpus[0].temp=null;sample.gpu_timestamp++}')
    page.wait_for_function("document.querySelector('.phm-gpu-card').textContent.includes('Not supported') && !document.querySelector('.phm-gpu-card [aria-label=\"GPU Usage\"]')")
    page.wait_for_function('window.panel.getHeight() >= document.querySelector(".phm").scrollHeight')
    # Equal-height cards at desktop width; layout remains responsive on smaller screens.
    page.set_viewport_size({'width':1920,'height':1000})
    page.wait_for_function("""() => {const cards=[...document.querySelectorAll('.phm-grid > .phm-card')].map(e=>e.getBoundingClientRect());return cards.length===3 && cards.every(r=>Math.abs(r.top-cards[0].top)<1 && Math.abs(r.bottom-cards[0].bottom)<1)}""")
    assert page.locator('.phm-memory-details').count()==1
    assert page.locator('.phm-core').first.evaluate('e=>e.getBoundingClientRect().height') > 65
    page.set_viewport_size({'width':1100,'height':900})
    page.wait_for_function("""() => {const [cpu,ram,gpu]=[...document.querySelectorAll('.phm-grid > .phm-card')].map(e=>e.getBoundingClientRect());return cpu.bottom<=ram.top && Math.abs(ram.top-gpu.top)<1 && Math.abs(ram.bottom-gpu.bottom)<1}""")
    page.set_viewport_size({'width':650,'height':900})
    page.wait_for_function("""() => {const [cpu,ram,gpu]=[...document.querySelectorAll('.phm-grid > .phm-card')].map(e=>e.getBoundingClientRect());return cpu.bottom<=ram.top && ram.bottom<=gpu.top && document.querySelector('.phm-grid').scrollWidth<=document.querySelector('.phm-grid').clientWidth+1}""")
    page.wait_for_function('window.panel.getHeight() >= document.querySelector(".phm").scrollHeight')
    # Mixed vendor fixtures, translation and hidden card if no hardware.
    page.evaluate("""() => { sample.gpus.push({vendor:'AMD',name:'Radeon test',bus:'0000:04:00.0',driver:'amdgpu',usage:65,vram_used:100,vram_total:200,temp:50,fan:null,power:70,power_limit:null},{vendor:'Intel',name:'Arc test',bus:'0000:05:00.0',driver:'vfio-pci',passthrough:true});sample.gpu_timestamp++ }""")
    page.wait_for_function("document.querySelectorAll('.phm-gpu').length===3")
    assert page.locator('.phm-gpu-brand').all_text_contents()==['NVIDIA GPU','AMD GPU','Intel GPU']
    assert page.locator('.phm-brand-icon').count()==3
    assert page.locator('.phm-brand-icon').evaluate_all("icons=>icons.map(e=>e.getAttribute('data-vendor'))")==['NVIDIA','AMD','Intel']
    assert page.locator('.phm-brand-icon path').count()==3
    assert 'Not supported' in page.locator('.phm-gpu').last.inner_text()
    assert '70 W / Not supported' in page.locator('.phm-gpu').nth(1).inner_text()
    page.evaluate("window.Proxmox={defaultLang:'pt_BR'}")
    page.wait_for_function("document.querySelector('.phm-cpu').textContent.includes('Núcleo 00')")
    assert 'Não suportado' in page.locator('.phm-gpu').last.inner_text()
    assert 'Uso da memória' in page.locator('.phm-memory-card').inner_text()
    assert 'Uso da GPU' in page.locator('.phm-gpu-card').inner_text()
    page.evaluate('()=>{sample.gpus=[];sample.gpu_error=null;sample.gpu_timestamp++}')
    page.wait_for_function("document.querySelector('.phm-no-gpu') && !document.querySelector('.phm-gpu-card')")
    page.evaluate('window.panel.events.destroy()')
    assert not errors,errors
    browser.close()
print('Browser mock smoke test passed: 22 cores, 44 threads, GPU, live update.')
