// BEGIN PVE-HARDWARE-MONITOR
(function () {
    'use strict';
    const CSS = `
    .phm {display:flow-root; padding:10px; font-size:12px; line-height:1.4; color:inherit;}
    .phm-grid.phm-no-gpu {grid-template-columns:minmax(0,2fr) minmax(250px,1fr);}
    .phm-grid {display:grid; grid-template-columns:minmax(0,2fr) minmax(250px,1fr) minmax(250px,1fr); gap:12px; align-items:stretch;}
    .phm-card {min-width:0; display:flex; flex-direction:column; padding:13px; border:1px solid rgba(128,128,128,.32); border-radius:8px; background:rgba(128,128,128,.045);}
    .phm-head {display:flex; justify-content:space-between; gap:8px; align-items:flex-start; margin-bottom:12px;}
    .phm-title {font-size:14px; font-weight:600; overflow-wrap:anywhere;}
    .phm-sub {opacity:.72; font-size:11px; overflow-wrap:anywhere;}
    .phm-value {font-size:18px; font-weight:600; white-space:nowrap; font-variant-numeric:tabular-nums;}
    .phm-cores {display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); grid-auto-rows:1fr; gap:6px; flex:1 0 auto;}
    .phm-core {display:flex; flex-direction:column; justify-content:space-between; border:1px solid rgba(128,128,128,.22); border-radius:5px; padding:6px; min-width:0;}
    .phm-core-label {font-size:10px; opacity:.7; margin-bottom:3px;}
    .phm-row {display:flex; align-items:center; justify-content:space-between; gap:10px; margin:5px 0 3px; font-variant-numeric:tabular-nums;}
    .phm-row > span:last-child {white-space:nowrap;}
    .phm-track {height:7px; background:rgba(128,128,128,.20); border-radius:3px; overflow:hidden;}
    .phm-fill {height:100%; border-radius:3px; transition:width .35s ease, background .35s ease;}
    .phm-memory {display:flex; height:18px; border-radius:5px; overflow:hidden; background:rgba(128,128,128,.2); margin:10px 0;}
    .phm-memory-card .phm-memory {flex-shrink:0; height:20px;}
    .phm-memory-details {display:flex; flex-direction:column; justify-content:space-evenly; flex:1 0 auto;}
    .phm-memory-details .phm-row {margin:6px 0 4px;}
    .phm-memory > div {transition:width .35s ease;}
    .phm-dot {display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:6px;}
    .phm-line {border-top:1px solid rgba(128,128,128,.25); margin:10px 0;}
    .phm-legend {display:flex; flex-wrap:wrap; gap:6px 12px; font-size:10px; margin-top:8px;}
    .phm-legend span {white-space:nowrap;}
    .phm-note {opacity:.72; font-size:11px; margin-top:8px;}
    .phm-status {font-size:11px; margin:0 0 8px; opacity:.8;}
    .phm-gpu + .phm-gpu {border-top:1px solid rgba(128,128,128,.25); padding-top:12px; margin-top:12px;}
    .phm-gpu-card {background:rgba(128,128,128,.045);}
    .phm-gpu-card .phm-gpu {border-left:3px solid var(--phm-brand,#808080); padding-left:9px; background:linear-gradient(145deg,var(--phm-tint,transparent),transparent 52%); border-radius:4px;}
    .phm-gpu-brand {display:flex;align-items:center;gap:9px;color:var(--phm-brand,#808080);font-weight:600;font-size:11px;margin-bottom:6px;}
    .phm-brand-badge {display:inline-flex;align-items:center;justify-content:center;flex:0 0 56px;width:56px;height:32px;border:1px solid var(--phm-brand,#808080);background:var(--phm-tint,transparent);border-radius:6px;}
    .phm-brand-icon {display:block;width:42px;height:22px;max-width:100%;color:inherit;}
    .phm-gpu-metric .phm-unsupported {opacity:.72;font-weight:400;font-size:11px;}
    .phm-gpu-card .phm-title i {color:inherit; margin-right:5px;}
    .phm-gpu-metric {margin-top:8px;}
    .phm-gpu-metric .phm-row {margin:0 0 4px;}
    .phm-gpu-metric .phm-row > span:last-child {font-weight:600;}
    .phm-gpu-metric .phm-track {height:9px; border-radius:5px;}
    .phm-heat-fill {width:100%; height:100%; clip-path:inset(0 calc(100% - var(--phm-load)) 0 0 round 5px); transition:clip-path .35s ease;}
    .phm-gpu-history {border:1px solid rgba(128,128,128,.23); border-radius:6px; padding:6px 8px; margin-top:8px; background:rgba(128,128,128,.045);}
    .phm-history-head {display:flex; justify-content:space-between; gap:6px; font-size:10px; opacity:.8;}
    .phm-spark {width:100%; height:48px; display:block; margin-top:4px;}
    .phm-gpu-scale {margin-top:9px;}
    .phm-gpu-card > .phm-note:last-child {margin-top:auto; padding-top:8px;}
    @media(prefers-reduced-motion:reduce){.phm-heat-fill{transition:none;}}
    @media(max-width:1350px){.phm-grid,.phm-grid.phm-no-gpu {grid-template-columns:repeat(2,minmax(0,1fr));}.phm-cpu,.phm-no-gpu .phm-memory-card{grid-column:1/-1;}}
    @media(max-width:800px){.phm-grid,.phm-grid.phm-no-gpu{grid-template-columns:minmax(0,1fr);}.phm-cpu{grid-column:auto;}}
    @media(prefers-reduced-motion:reduce){.phm-fill,.phm-memory>div{transition:none;}}
    `;
    // Respect PVE's language selector and datacenter default, not the browser preference.
    const lang = () => {
        let cookie;
        try { cookie = document.cookie.match(/(?:^|;\s*)PVELangCookie=([^;]*)/); } catch (_) { /* blocked cookies */ }
        const preference = cookie && cookie[1];
        const selected = (preference && preference !== '__default__' && preference !== 'default' ? preference : null) || (window.Proxmox && Proxmox.defaultLang) || document.documentElement.lang || 'en';
        return /^pt(?:[-_]|$)/i.test(selected) ? 'pt-BR' : 'en';
    };
    const ptBR = {
    "Not supported": "Não suportado",
    "Hardware Monitor · Live": "Monitor de hardware · Ao vivo",
    "Waiting for hardware monitor…": "Aguardando monitor de hardware…",
    "Live": "Ao vivo",
    "CPU/RAM 1s": "CPU/RAM 1s",
    "Hardware monitor unavailable": "Monitor de hardware indisponível",
    "retrying": "tentando novamente",
    "Hardware monitor: invalid data": "Monitor de hardware: dados inválidos",
    "Socket": "Soquete",
    "Hardware core ID": "ID físico do núcleo",
    "Core": "Núcleo",
    "Frequency unavailable": "Frequência não suportada",
    "cores": "núcleos",
    "threads": "threads",
    "Peak sensor": "Temperatura máxima",
    "CPU usage color thresholds": "Faixas de utilização da CPU",
    "Logical CPUs grouped by physical core · Hover core for hardware ID, CPU for clock frequency": "CPUs lógicas agrupadas por núcleo físico · Passe o mouse para ver o ID físico ou a frequência da CPU",
    "Used (excl. Linux cache/buffers)": "Usada (sem cache/buffers Linux)",
    "Cache": "Cache",
    "Buffers": "Buffers",
    "Free": "Livre",
    "Memory Usage": "Uso da memória",
    "Linux RAM · live breakdown": "RAM Linux · distribuição ao vivo",
    "RAM breakdown": "Distribuição da RAM",
    "Available": "Disponível",
    "Swap": "Swap",
    "ZFS ARC (separate detail)": "ZFS ARC (detalhe separado)",
    "Available is a kernel estimate, not an extra segment. Cache excludes shared memory. ZFS ARC is not added to total RAM.": "A memória disponível é uma estimativa do kernel, não um segmento adicional. O cache exclui memória compartilhada. O ZFS ARC não é somado à RAM total.",
    "GPU Usage": "Uso da GPU",
    "VRAM": "VRAM",
    "Temperature": "Temperatura",
    "Fan": "Ventoinha",
    "Power": "Potência",
    "Power limit": "Limite de potência",
    "Driver": "Driver",
    "VRAM history": "Histórico de VRAM",
    "VRAM recent history, color indicates utilization": "Histórico recente de VRAM, cor indica utilização",
    "Waiting for samples…": "Aguardando amostras…",
    "GPU utilization colors": "Cores de utilização da GPU",
    "GPU Monitoring": "Monitoramento de GPU",
    "Live hardware metrics": "Métricas de hardware ao vivo",
    "No compatible GPU detected": "Nenhuma GPU compatível detectada",
    "GPU sampling unavailable": "Coleta de GPU indisponível",
    "PCI passthrough · host telemetry not supported": "PCI passthrough · telemetria não suportada pelo host",
    "Intel usage: busiest engine (i915)": "Uso Intel: engine mais ocupada (i915)",
    "Temperature scale: 0–85 °C (visual reference, not a thermal alarm). VRAM history: up to 60 samples in this view, not stored on disk.": "Escala de temperatura: 0–85 °C (referência visual, não um alarme térmico). Histórico de VRAM: até 60 amostras nesta tela, sem gravação em disco."
};
    const t = key => lang()==='pt-BR' ? (ptBR[key] || key) : key;
    const unsupported = () => t('Not supported');
    // Vector brand marks from Simple Icons (via its locally available TeX distribution).
    // No font, remote requests, or third-party scripts are needed at runtime.
    const brandIcons = {
    "NVIDIA": "<svg class=\"phm-brand-icon\" viewBox=\"0 203 1200 794\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" data-vendor=\"NVIDIA\"><path fill=\"currentColor\" transform=\"translate(0 1200) scale(1 -1)\" d=\"M447 760V832C454 832 462 832 469 832C506 833 542 828 578 817C608 808 638 794 668 776C691 761 714 744 735 725C751 711 765 697 778 682L793 664L778 644C765 627 750 611 735 596C714 575 692 556 671 539C644 518 618 502 593 491C562 478 533 471 506 471C486 471 467 474 448 481V698C471 695 490 690 504 682C518 674 531 662 542 647C549 637 561 619 577 592L585 579L687 664L674 680C662 692 649 703 634 713C614 727 593 738 571 747C544 757 516 762 487 762C474 762 460 761 447 760ZM1200 997H447V890L469 891C520 893 570 887 620 872C663 859 704 841 745 817C778 798 809 775 839 749C860 731 880 712 898 692L919 668L896 642C877 621 856 600 834 580C803 553 772 528 741 507C702 480 665 460 628 445C584 428 542 420 503 420C485 420 467 421 448 424V358C465 356 480 355 493 355C556 355 616 365 675 386C726 403 778 430 831 465C872 492 920 529 973 575C980 570 1000 558 1034 539C1077 516 1103 500 1110 493C1067 458 1008 424 931 392C860 363 784 339 704 321C624 303 555 294 497 294C480 294 464 295 448 296V203H1200V997ZM447 481V424C413 430 382 442 353 460C328 475 306 494 286 517C270 535 256 555 243 578C234 594 227 610 220 627L214 647L230 662C244 675 259 687 276 698C299 713 324 726 349 736C381 749 414 757 447 760V698C430 700 412 698 393 692C379 687 365 680 350 671C340 664 330 656 321 647L310 636L317 617C324 601 331 586 340 571C353 551 367 534 383 520C402 501 424 488 447 481ZM133 627 123 655C127 660 131 666 136 672C147 685 160 699 175 712C195 731 217 747 240 762C269 781 299 796 331 807C368 820 407 829 448 832V890C403 887 357 876 309 859C268 845 227 826 186 803C153 784 121 763 88 740C65 723 44 706 24 689L0 667L6 653C11 640 17 627 24 614C33 595 44 576 55 558C69 535 84 514 100 493C119 469 140 447 161 427C186 404 211 384 238 367C269 348 300 333 333 321C370 308 408 300 447 296V358C402 364 360 378 321 401C288 420 257 445 229 476C206 501 186 528 167 559C154 581 143 604 133 627Z\"/></svg>",
    "AMD": "<svg class=\"phm-brand-icon\" viewBox=\"0 457 1200 286\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" data-vendor=\"AMD\"><path fill=\"currentColor\" transform=\"translate(0 1200) scale(1 -1)\" d=\"M1200 743H916L994 665H1122V537L1200 459V743ZM172 724H100L0 476H65L84 525H195L215 476H282L172 724ZM364 724H310V476H372V631L439 553H449L516 631V476H577V724H524L444 632L364 724ZM734 724H625V476H727C775 476 812 488 837 511C860 533 871 563 871 600C871 635 860 664 837 687C812 712 777 724 734 724ZM686 521V679H726C754 679 775 671 789 655C802 642 808 623 808 600C808 579 802 561 790 547C776 530 755 521 727 521H686ZM100 568 137 665 177 568H100ZM994 537V650L914 569V457H1026L1106 537H994Z\"/></svg>",
    "Intel": "<svg class=\"phm-brand-icon\" viewBox=\"0 367 1200 466\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" data-vendor=\"Intel\"><path fill=\"currentColor\" transform=\"translate(0 1200) scale(1 -1)\" d=\"M1104 833H1021V374H1104V833ZM87 826H0V739H87V826ZM572 809H489V506C489 481 491 459 496 442C500 425 507 411 517 401C527 390 540 383 557 378C574 373 595 371 620 371H631V447C619 447 609 448 602 449C594 450 588 453 583 458C578 463 574 470 573 477C572 487 571 497 572 507V616H631V687H572V809ZM314 693C294 693 276 689 260 681C243 673 230 662 219 648L214 642V687H133V374H215V535C216 564 223 586 237 601C251 615 268 622 289 622C312 622 330 615 343 601C355 586 361 566 361 540V374H444V552C444 596 433 631 410 656C387 681 355 693 314 693ZM817 693C796 693 775 689 755 681C735 672 718 661 703 646C688 631 676 613 667 593C658 573 654 552 654 530C654 507 658 486 666 467C674 447 685 430 700 415C715 400 732 389 753 380C773 371 795 367 820 367C851 367 880 374 905 387C925 397 943 411 959 429L899 474C892 465 882 458 869 451C853 443 837 439 820 439C797 439 778 444 763 456C748 467 739 481 734 499L733 501H978V531C978 553 974 574 967 594C959 613 948 631 934 646C919 661 902 672 883 680C862 689 840 693 817 693ZM85 687H2V374H85V687ZM816 623C833 623 849 619 863 611C874 605 883 597 890 587C896 577 899 568 899 560H733C733 568 736 577 743 587C749 597 758 605 769 611C783 618 799 622 816 623ZM1170 432C1161 432 1154 429 1148 423C1142 417 1139 410 1139 402C1139 393 1142 386 1148 380C1154 374 1161 371 1170 371C1178 371 1185 374 1191 380C1197 386 1200 393 1200 402C1200 410 1197 417 1191 423C1185 429 1178 432 1170 432ZM1169 427C1169 427 1169 427 1169 427C1176 427 1182 424 1187 420C1192 415 1194 408 1194 402C1194 395 1192 389 1187 384C1182 379 1177 377 1170 377C1163 377 1157 379 1152 384C1147 389 1144 394 1144 402C1144 409 1147 414 1152 420C1157 425 1162 427 1169 427ZM1171 419H1158V384H1164V398H1169L1177 384H1184L1175 399C1178 399 1180 400 1182 402C1183 403 1184 406 1184 409C1184 412 1183 414 1181 416C1179 418 1176 419 1171 419ZM1164 404V414H1172L1175 413C1176 413 1176 413 1177 412C1177 411 1177 410 1177 409C1177 408 1177 407 1177 406L1175 405L1172 404H1164Z\"/></svg>"
};
    const colors = {used:'#388bd4',cache:'#d6a43c',buffers:'#9975cf',free:'#3c9e71',gpu:'#76a82d'};
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const valid = v => typeof v === 'number' && Number.isFinite(v);
    const clamp = v => valid(v) ? Math.max(0,Math.min(100,v)) : 0;
    const pct = (a,b) => valid(a) && valid(b) && b>0 ? 100*a/b : null;
    const ptxt = v => valid(v) ? `${v.toFixed(1)}%` : unsupported();
    const gib = v => valid(v) ? `${(v/1073741824).toFixed(2)} GiB` : unsupported();
    const mib = v => valid(v) ? `${(v/1024).toFixed(2)} GiB` : unsupported();
    const unit = (v,u) => valid(v) ? `${v.toFixed(0)} ${u}` : unsupported();
    const row = (label, val) => `<div class="phm-row"><span>${label}</span><span>${val}</span></div>`;
    const loadColor = v => !valid(v)?'#808080':v>90?'#e05252':v>55?'#f08a32':v>=30?'#e4c246':'#45a66c';
    // Fixed GPU scale: the visible fill is clipped, not rescaled, as usage changes.
    const heatStops = [[0,'#45a66c'],[29,'#45a66c'],[30,'#e4c246'],[54,'#e4c246'],[55,'#f08a32'],[89,'#f08a32'],[90,'#e05252'],[100,'#e05252']];
    const heatGradient = `linear-gradient(90deg,${heatStops.map(([p,c])=>`${c} ${p}%`).join(',')})`;
    const heatColor = v => !valid(v)?'#808080':v>=90?'#e05252':v>=55?'#f08a32':v>=30?'#e4c246':'#45a66c';
    const GPU_TEMP_REFERENCE = 85; // Visual reference only, not a thermal alarm or hardware limit.
    const gpuMetric = (label,value,display,color=null) => valid(value) ? (color ? `<div class="phm-gpu-metric">${metric(label,value,display,color)}</div>` : heatMetric(label,value,display)) : `<div class="phm-gpu-metric">${row(label,`<span class="phm-unsupported">${display}</span>`)}</div>`;
    const heatMetric = (label,value,display) => `<div class="phm-gpu-metric">${row(label,display)}<div class="phm-track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" ${valid(value)?`aria-valuenow="${clamp(value)}"`:`aria-valuetext="${esc(unsupported())}"`}><div class="phm-heat-fill" style="--phm-load:${clamp(value)}%;background:${heatGradient}"></div></div></div>`;
    let gpuPanelSequence = 0;
    const bar = (value,color) => `<div class="phm-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" ${valid(value)?`aria-valuenow="${clamp(value)}"`:`aria-valuetext="${esc(unsupported())}"`}><div class="phm-fill" style="width:${clamp(value)}%;background:${color}"></div></div>`;
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
        const temp = sensors.length ? `${Math.max(...sensors.map(t=>t.c)).toFixed(1)} °C` : unsupported();
        // Display dense logical core numbers, preserving raw socket/core IDs for grouping.
        const ordered = [...groups.values()].map(ts => ts.slice().sort((a,b)=>Number(a.id)-Number(b.id)))
            .sort((a,b)=>Number(a[0].socket)-Number(b[0].socket)||Number(a[0].id)-Number(b[0].id));
        const multipleSockets = new Set(threads.map(t=>String(t.socket))).size > 1;
        const body = ordered.map((ts,i) => `<div class="phm-core"><div class="phm-core-label" title="${t('Socket')} ${esc(ts[0].socket)} · ${t('Hardware core ID')} ${esc(ts[0].core)}">${multipleSockets?`${t('Socket')} ${esc(ts[0].socket)} · `:''}${t('Core')} ${String(i).padStart(2,'0')}</div>${ts.map(t=>`<div title="${esc(valid(t.mhz)?`${t.mhz.toFixed(0)} MHz`:t('Frequency unavailable'))}">${metric(`CPU ${esc(String(t.id).padStart(2,'0'))}`,t.usage,ptxt(t.usage),loadColor(t.usage))}</div>`).join('')}</div>`).join('');
        return `<div class="phm-card phm-cpu"><div class="phm-head"><div><div class="phm-title">CPU · ${esc(cpu.model)}</div><div class="phm-sub">${esc(cpu.cores)} ${t('cores')} / ${threads.length} ${t('threads')} · ${t('Peak sensor')}: ${esc(temp)}</div></div><div class="phm-value" style="color:${loadColor(cpu.usage)}">${ptxt(cpu.usage)}</div></div><div class="phm-cores">${body}</div><div class="phm-legend" aria-label="${t('CPU usage color thresholds')}">${[[0,'&lt; 30%'],[30,'30–55%'],[56,'&gt; 55–90%'],[91,'&gt; 90%']].map(([v,label])=>`<span><i class="phm-dot" style="background:${loadColor(v)}"></i>${label}</span>`).join('')}</div><div class="phm-note">${t('Logical CPUs grouped by physical core · Hover core for hardware ID, CPU for clock frequency')}</div></div>`;
    }
    function renderMemory(m) {
        const fields = [['used','Used (excl. Linux cache/buffers)'],['cache','Cache'],['buffers','Buffers'],['free','Free']];
        const segments = fields.map(([k])=>`<div style="width:${clamp(pct(m[k],m.total))}%;background:${colors[k]}"></div>`).join('');
        return `<div class="phm-card phm-memory-card"><div class="phm-head"><div><div class="phm-title">${t('Memory Usage')}</div><div class="phm-sub">${t('Linux RAM · live breakdown')}</div></div><div class="phm-value">${gib(m.total)}</div></div><div class="phm-memory" aria-label="${t('RAM breakdown')}">${segments}</div><div class="phm-memory-details">${fields.map(([k,n])=>row(`<i class="phm-dot" style="background:${colors[k]}"></i>${t(n)}`,gib(m[k]))).join('')}<div class="phm-line"></div>${row(t('Available'),gib(m.available))}${row(t('Swap'),`${gib(m.swap_used)} / ${gib(m.swap_total)}`)}${row(t('ZFS ARC (separate detail)'),gib(m.zfs_arc))}</div><div class="phm-note">${t('Available is a kernel estimate, not an extra segment. Cache excludes shared memory. ZFS ARC is not added to total RAM.')}</div></div>`;
    }
    function renderGPU(data, history, panelId) {
        const cards = (data.gpus || []).map((g,index)=>{
            const series=(history.get(g.bus)||[]).filter(valid);
            const vram=pct(g.vram_used,g.vram_total);
            // Color follows the historical Y value, not the latest sample.
            // Each SVG uses its own ID, even when multiple node panels exist.
            const gradientId=`phm-heat-${panelId}-${index}`;
            const points=series.map((v,i)=>`${(i*120/Math.max(1,series.length-1)).toFixed(2)},${(30-clamp(v)*.28).toFixed(2)}`);
            if(points.length===1)points.push(`120,${(30-clamp(series[0])*.28).toFixed(2)}`);
            const stops=heatStops.map(([p,c])=>`<stop offset="${p}%" stop-color="${c}"/>`).join('');
            const draw=valid(vram)&&points.length?`<svg class="phm-spark" viewBox="0 0 120 32" preserveAspectRatio="none" role="img" aria-label="${t('VRAM recent history, color indicates utilization')}"><defs><linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="2">${stops}</linearGradient></defs><path d="M0 30 L${points.join(' L')} L120 30 Z" fill="url(#${gradientId})" opacity=".18"/><polyline fill="none" stroke="url(#${gradientId})" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${points.join(' ')}"/></svg>`:`<div class="phm-spark phm-note">${valid(vram)?t('Waiting for samples…'):unsupported()}</div>`;
            const vendor = ['NVIDIA','AMD','Intel'].includes(g.vendor) ? g.vendor : 'NVIDIA'; // Legacy API snapshots are NVIDIA only.
            const brand = {NVIDIA:['#76b900','#76b90012'],AMD:['#e74b48','#e74b4812'],Intel:['#2797e8','#2797e812']}[vendor];
            const vrText = valid(g.vram_used)||valid(g.vram_total) ? `${mib(g.vram_used)} / ${mib(g.vram_total)}` : unsupported();
            const powerText = valid(g.power)||valid(g.power_limit) ? `${unit(g.power,'W')} / ${unit(g.power_limit,'W')}` : unsupported();
            return `<div class="phm-gpu" style="--phm-brand:${brand[0]};--phm-tint:${brand[1]}"><div class="phm-gpu-brand"><span class="phm-brand-badge">${brandIcons[vendor]}</span><span>${lang()==='pt-BR'?`GPU ${vendor}`:`${vendor} GPU`}</span></div><div class="phm-title">${esc(g.name)}</div><div class="phm-sub">${t('Driver')} ${esc(g.driver||unsupported())} · PCI ${esc(g.bus)}</div>${g.passthrough?`<div class="phm-note">${t('PCI passthrough · host telemetry not supported')}</div>`:''}${gpuMetric(t('GPU Usage'),g.usage,ptxt(g.usage))}${vendor==='Intel'&&g.driver==='i915'&&valid(g.usage)?`<div class="phm-sub">${t('Intel usage: busiest engine (i915)')}</div>`:''}${gpuMetric(t('VRAM'),vram,vrText)}<div class="phm-gpu-history"><div class="phm-history-head"><span>${t('VRAM history')} · ${valid(vram)?series.length:0}/60</span><span>${ptxt(vram)}</span></div>${draw}</div>${gpuMetric(t('Temperature'),pct(g.temp,GPU_TEMP_REFERENCE),unit(g.temp,'°C'))}${gpuMetric(t('Fan'),g.fan,ptxt(g.fan),'#388bd4')}${gpuMetric(t('Power'),pct(g.power,g.power_limit),powerText)}</div>`;
        }).join('');
        const legend=`<div class="phm-legend phm-gpu-scale" aria-label="${t('GPU utilization colors')}">${[[0,'&lt;30%'],[30,'30–&lt;55%'],[55,'55–&lt;90%'],[90,'≥90%']].map(([v,label])=>`<span><i class="phm-dot" style="background:${heatColor(v)}"></i>${label}</span>`).join('')}</div>`;
        return `<div class="phm-card phm-gpu-card"><div class="phm-head"><div><div class="phm-title"><i class="fa fa-tachometer" aria-hidden="true"></i>${t('GPU Monitoring')}</div><div class="phm-sub">${t('Live hardware metrics')}</div></div></div>${cards||`<div class="phm-note">${t('GPU sampling unavailable')}</div>`}${cards?legend:''}<div class="phm-note">${t('Temperature scale: 0–85 °C (visual reference, not a thermal alarm). VRAM history: up to 60 samples in this view, not stored on disk.')}</div></div>`;
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
        const panel=Ext.create('Ext.panel.Panel', {itemId:'phm-live-panel',title:t('Hardware Monitor · Live'),height:85,iconCls:'fa fa-tachometer',collapsible:true,margin:'0 5 5 5',bodyPadding:0,html:`<div class="phm"><div class="phm-status">${t('Waiting for hardware monitor…')}</div><div class="phm-grid"></div></div>`});
        const panelId=++gpuPanelSequence;
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
                    if(!ok){status(`${t('Hardware monitor unavailable')} (HTTP ${(res && res.status)||0}) · ${t('retrying')}`);return;}
                    try {
                        const data=JSON.parse(res.responseText).data;
                        if(!data||data.version!==1||!data.cpu||!data.memory)throw new Error('Invalid snapshot');
                        if(data.gpu_timestamp!==lastGPU){lastGPU=data.gpu_timestamp;const buses=new Set((data.gpus||[]).map(g=>g.bus));for(const bus of history.keys())if(!buses.has(bus))history.delete(bus);(data.gpus||[]).forEach(g=>{const v=pct(g.vram_used,g.vram_total);if(valid(v)){const series=history.get(g.bus)||[];series.push(v);if(series.length>60)series.shift();history.set(g.bus,series);}else{history.delete(g.bus);}});}
                        const el=panel.body.dom.querySelector('.phm-grid');if(!el)return;
                        const template=document.createElement('template');template.innerHTML=`<div class="phm-grid${(data.gpus||[]).length||data.gpu_error?'':' phm-no-gpu'}">${renderCPU(data.cpu)}${renderMemory(data.memory)}${(data.gpus||[]).length||data.gpu_error?renderGPU(data,history,panelId):''}</div>`;
                        morph(el,template.content.firstElementChild);
                        status(`${t('Live')} · ${node} · ${new Date(data.timestamp*1000).toLocaleTimeString(lang())} · ${t('CPU/RAM 1s')}`);
                    } catch(e) {status(`${t('Hardware monitor: invalid data')} · ${t('retrying')}`);}
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
