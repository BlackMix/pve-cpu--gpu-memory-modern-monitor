// BEGIN PVE-HARDWARE-MONITOR
(function () {
    'use strict';
    const CSS = `
    .phm {display:flow-root; padding:10px; font-size:12px; line-height:1.4; color:inherit;}
    .phm-grid {display:grid; grid-template-columns:minmax(0,2fr) minmax(250px,1fr) minmax(250px,1fr); gap:12px; align-items:start;}
    .phm-card {min-width:0; padding:13px; border:1px solid rgba(128,128,128,.32); border-radius:8px; background:rgba(128,128,128,.045);}
    .phm-head {display:flex; justify-content:space-between; gap:8px; align-items:flex-start; margin-bottom:12px;}
    .phm-title {font-size:14px; font-weight:600; overflow-wrap:anywhere;}
    .phm-sub {opacity:.72; font-size:11px; overflow-wrap:anywhere;}
    .phm-value {font-size:18px; font-weight:600; white-space:nowrap; font-variant-numeric:tabular-nums;}
    .phm-cores {display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:6px;}
    .phm-core {border:1px solid rgba(128,128,128,.22); border-radius:5px; padding:6px; min-width:0;}
    .phm-core-label {font-size:10px; opacity:.7; margin-bottom:3px;}
    .phm-row {display:flex; align-items:center; justify-content:space-between; gap:6px; margin:5px 0 3px; font-variant-numeric:tabular-nums;}
    .phm-row > span:last-child {white-space:nowrap;}
    .phm-track {height:7px; background:rgba(128,128,128,.20); border-radius:3px; overflow:hidden;}
    .phm-fill {height:100%; border-radius:3px; transition:width .35s ease, background .35s ease;}
    .phm-memory {display:flex; height:18px; border-radius:5px; overflow:hidden; background:rgba(128,128,128,.2); margin:10px 0;}
    .phm-memory > div {transition:width .35s ease;}
    .phm-dot {display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:6px;}
    .phm-line {border-top:1px solid rgba(128,128,128,.25); margin:10px 0;}
    .phm-note {opacity:.72; font-size:11px; margin-top:8px;}
    .phm-status {font-size:11px; margin:0 0 8px; opacity:.8;}
    .phm-gpu + .phm-gpu {border-top:1px solid rgba(128,128,128,.25); padding-top:12px; margin-top:12px;}
    .phm-spark {width:100%; height:34px; display:block; margin-top:4px;}
    @media(max-width:1350px){.phm-grid {grid-template-columns:repeat(2,minmax(0,1fr));}.phm-cpu{grid-column:1/-1;}}
    @media(max-width:800px){.phm-grid{grid-template-columns:minmax(0,1fr);}.phm-cpu{grid-column:auto;}}
    @media(prefers-reduced-motion:reduce){.phm-fill,.phm-memory>div{transition:none;}}
    `;
    const colors = {used:'#388bd4',cache:'#d6a43c',buffers:'#9975cf',free:'#3c9e71',gpu:'#76a82d'};
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const valid = v => typeof v === 'number' && Number.isFinite(v);
    const clamp = v => valid(v) ? Math.max(0,Math.min(100,v)) : 0;
    const pct = (a,b) => valid(a) && valid(b) && b>0 ? 100*a/b : null;
    const ptxt = v => valid(v) ? `${v.toFixed(1)}%` : '—';
    const gib = v => valid(v) ? `${(v/1073741824).toFixed(2)} GiB` : '—';
    const mib = v => valid(v) ? `${(v/1024).toFixed(2)} GiB` : '—';
    const unit = (v,u) => valid(v) ? `${v.toFixed(0)} ${u}` : '—';
    const row = (label, val) => `<div class="phm-row"><span>${label}</span><span>${val}</span></div>`;
    const loadColor = v => v>=85?'#e05c5c':v>=55?'#d6a43c':'#45a66c';
    const bar = (value,color) => `<div class="phm-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" ${valid(value)?`aria-valuenow="${clamp(value)}"`:'aria-valuetext="Unavailable"'}><div class="phm-fill" style="width:${clamp(value)}%;background:${color}"></div></div>`;
    const metric = (label,value,display,color) => row(label,display)+bar(value,color);
    function renderCPU(cpu) {
        const groups = new Map();
        const threads = Array.isArray(cpu.threads) ? cpu.threads : [];
        threads.forEach(t => {
            const key = `${t.socket}:${t.core}`;
            if (!groups.has(key)) groups.set(key,[]);
            groups.get(key).push(t);
        });
        const sensors = (cpu.temperatures || []).filter(t=>valid(t.c));
        const temp = sensors.length ? `${Math.max(...sensors.map(t=>t.c)).toFixed(1)} °C` : '—';
        const body = [...groups.values()].map(ts => `<div class="phm-core"><div class="phm-core-label">Socket ${esc(ts[0].socket)} · Core ${esc(ts[0].core)}</div>${ts.map(t=>`<div title="${esc(valid(t.mhz)?`${t.mhz.toFixed(0)} MHz`:'Frequency unavailable')}">${metric(`CPU ${esc(String(t.id).padStart(2,'0'))}`,t.usage,ptxt(t.usage),loadColor(t.usage))}</div>`).join('')}</div>`).join('');
        return `<div class="phm-card phm-cpu"><div class="phm-head"><div><div class="phm-title">CPU · ${esc(cpu.model)}</div><div class="phm-sub">${esc(cpu.cores)} cores / ${threads.length} threads · Peak sensor: ${esc(temp)}</div></div><div class="phm-value">${ptxt(cpu.usage)}</div></div><div class="phm-cores">${body}</div><div class="phm-note">Logical CPUs grouped by physical core · Hover for clock frequency</div></div>`;
    }
    function renderMemory(m) {
        const fields = [['used','Used (excl. Linux cache/buffers)'],['cache','Cache'],['buffers','Buffers'],['free','Free']];
        const segments = fields.map(([k])=>`<div style="width:${clamp(pct(m[k],m.total))}%;background:${colors[k]}"></div>`).join('');
        return `<div class="phm-card"><div class="phm-head"><div><div class="phm-title">Memory Usage</div><div class="phm-sub">Linux RAM · live breakdown</div></div><div class="phm-value">${gib(m.total)}</div></div><div class="phm-memory" aria-label="RAM breakdown">${segments}</div>${fields.map(([k,n])=>row(`<i class="phm-dot" style="background:${colors[k]}"></i>${n}`,gib(m[k]))).join('')}<div class="phm-line"></div>${row('Available',gib(m.available))}${row('Swap',`${gib(m.swap_used)} / ${gib(m.swap_total)}`)}${valid(m.zfs_arc)?row('ZFS ARC (separate detail)',gib(m.zfs_arc)):''}<div class="phm-note">Available is a kernel estimate, not an extra segment. Cache excludes shared memory. ZFS ARC is not added to total RAM.</div></div>`;
    }
    function renderGPU(data, history) {
        const cards = (data.gpus || []).map(g=>{
            const series=history.get(g.bus)||[];
            const points=series.map((v,i)=>`${(i*120/Math.max(1,series.length-1)).toFixed(1)},${(30-clamp(v)*.28).toFixed(1)}`).join(' ');
            const draw=series.length>1?`<svg class="phm-spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-label="VRAM recent history"><polyline fill="none" stroke="${colors.gpu}" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${points}"/></svg>`:'';
            return `<div class="phm-gpu"><div class="phm-title">${esc(g.name)}</div><div class="phm-sub">Driver ${esc(g.driver)} · PCI ${esc(g.bus)}</div>${metric('GPU Usage',g.usage,ptxt(g.usage),colors.gpu)}${metric('VRAM',pct(g.vram_used,g.vram_total),`${mib(g.vram_used)} / ${mib(g.vram_total)}`,colors.gpu)}${draw}${metric('Temperature',g.temp,unit(g.temp,'°C'),loadColor(g.temp))}${metric('Fan',g.fan,ptxt(g.fan),'#388bd4')}${metric('Power',pct(g.power,g.power_limit),`${unit(g.power,'W')} / ${unit(g.power_limit,'W')}`,'#d6a43c')}</div>`;
        }).join('');
        return `<div class="phm-card"><div class="phm-head"><div><div class="phm-title">NVIDIA GPU</div><div class="phm-sub">Live hardware metrics · ~2 seconds</div></div></div>${cards||`<div class="phm-note">${esc(data.gpu_error||'No NVIDIA GPU available')}</div>`}<div class="phm-note">VRAM history: up to 60 samples in this view, not stored on disk.</div></div>`;
    }
    // Patch matching elements in place so bars animate instead of being recreated every second.
    function morph(a,b) {
        if(a.nodeType!==b.nodeType || a.nodeName!==b.nodeName) {a.replaceWith(b.cloneNode(true));return;}
        if(a.nodeType===3){if(a.nodeValue!==b.nodeValue)a.nodeValue=b.nodeValue;return;}
        if(a.nodeType!==1)return;
        [...a.attributes].forEach(x=>{if(!b.hasAttribute(x.name))a.removeAttribute(x.name);});
        [...b.attributes].forEach(x=>{if(a.getAttribute(x.name)!==x.value)a.setAttribute(x.name,x.value);});
        for(let i=0;i<b.childNodes.length;i++) {
            if(a.childNodes[i])morph(a.childNodes[i],b.childNodes[i]);else a.appendChild(b.childNodes[i].cloneNode(true));
        }
        while(a.childNodes.length>b.childNodes.length)a.lastChild.remove();
    }
    function attach(summary) {
        const node=summary.pveSelNode && summary.pveSelNode.data && summary.pveSelNode.data.node;
        if(!node)return;
        if(summary.getComponent('phm-live-panel'))return;
        if(!document.getElementById('phm-styles')) {const s=document.createElement('style');s.id='phm-styles';s.textContent=CSS;document.head.appendChild(s);}
        const panel=Ext.create('Ext.panel.Panel', {itemId:'phm-live-panel',title:'Hardware Monitor · Live',height:85,iconCls:'fa fa-tachometer',collapsible:true,margin:'0 5 5 5',bodyPadding:0,html:'<div class="phm"><div class="phm-status">Waiting for hardware monitor…</div><div class="phm-grid"></div></div>'});
        let timer=null, busy=false, dead=false, lastGPU=null, history=new Map();
        // PHM layout hotfix 0.1.2: ExtJS does not observe manual HTML updates.
        let frame=null, observer=null;
        function fitContent() {
            if(dead||panel.destroyed||panel.collapsed||!panel.rendered||!panel.body||!panel.isVisible(true))return;
            const body=panel.body.dom, content=body.querySelector('.phm');
            if(!content||!content.offsetWidth)return;
            const chrome=Math.max(0,panel.getHeight()-body.offsetHeight);
            const needed=Math.ceil(Math.max(content.offsetHeight,content.scrollHeight)+chrome+2);
            if(Math.abs(panel.getHeight()-needed)>1)panel.setHeight(needed);
        }
        function queueFit() {
            if(dead||frame!==null)return;
            frame=requestAnimationFrame(()=>{frame=null;fitContent();});
        }
        function status(message) {const el=panel.body && panel.body.dom.querySelector('.phm-status');if(el)el.textContent=message;queueFit();}
        function poll() {
            if(dead||busy||document.hidden||panel.collapsed||!panel.rendered||!panel.isVisible(true))return;
            busy=true;
            Ext.Ajax.request({url:'/api2/json/nodes/'+encodeURIComponent(node)+'/hardware-monitor',method:'GET',timeout:5000,disableCaching:true,
                callback: function(opts,ok,res) {
                    busy=false;if(dead||panel.destroyed||!panel.body)return;
                    if(!ok){status(`Hardware monitor unavailable (HTTP ${(res && res.status)||0}) · retrying`);return;}
                    try {
                        const data=JSON.parse(res.responseText).data;
                        if(!data||data.version!==1||!data.cpu||!data.memory)throw new Error('Invalid snapshot');
                        if(data.gpu_timestamp!==lastGPU){lastGPU=data.gpu_timestamp;(data.gpus||[]).forEach(g=>{const v=pct(g.vram_used,g.vram_total);if(valid(v)){const series=history.get(g.bus)||[];series.push(v);if(series.length>60)series.shift();history.set(g.bus,series);}});}
                        const el=panel.body.dom.querySelector('.phm-grid');if(!el)return;
                        const template=document.createElement('template');template.innerHTML=`<div class="phm-grid">${renderCPU(data.cpu)}${renderMemory(data.memory)}${renderGPU(data,history)}</div>`;
                        morph(el,template.content.firstElementChild);
                        status(`Live · ${node} · ${new Date(data.timestamp*1000).toLocaleTimeString()} · CPU/RAM 1s`);
                    } catch(e) {status('Hardware monitor: invalid data · retrying');}
                }
            });
        }
        panel.on('afterrender',()=>{
            const content=panel.body.dom.querySelector('.phm');
            if(content&&typeof ResizeObserver!=='undefined'){
                observer=new ResizeObserver(queueFit);observer.observe(content);
            }
            timer=setInterval(poll,1000);poll();queueFit();
        });
        panel.on('resize',queueFit);
        panel.on('destroy',()=>{dead=true;if(timer!==null)clearInterval(timer);if(observer)observer.disconnect();if(frame!==null)cancelAnimationFrame(frame);});
        panel.on('expand',()=>{queueFit();poll();});
        try {
            summary.insert(0,panel);
        } catch(e) {
            if(!panel.destroyed)panel.destroy();
            throw e;
        }
    }
    // Discover the native, already-rendered Summary. Never override initComponent
    // or callParent: ExtJS relies on caller metadata that strict functions hide.
    const attempted = new WeakSet();
    function scan() {
        try {
            if(document.hidden)return;
            for(const summary of Ext.ComponentQuery.query('pveNodeSummary')) {
                if(!summary.rendered || summary.destroyed || summary.destroying ||
                   !summary.isVisible(true) || attempted.has(summary))continue;
                attempted.add(summary);
                try { attach(summary); }
                catch(e) { console.error('PVE Hardware Monitor: attachment failed',e); }
            }
        } catch(e) { console.error('PVE Hardware Monitor: discovery failed',e); }
    }
    Ext.onReady(function(){ scan(); setInterval(scan,1000); });
})();
// END PVE-HARDWARE-MONITOR
