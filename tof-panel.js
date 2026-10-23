(()=>{
 let dialog,worker,timer,watchdog,busy=false,ready=false,counter,preview,ctx,lineInput,status,summary,list,startButton,lastY=null,generation=0,locked=false,selecting=false,boxes=[],selectedBox=null,revision=0;
 const labels={idle:'設定基準線後按開始',ground:'請先讓雙腳落在基準線或線以下',ready:'等待起跳',air:'騰空中',complete:'已完成 10 個動作',stopped:'已停止'};
 function update(message=''){
   if(!dialog)return;
   status.textContent=counter.error||message||counter.notice||labels[counter.phase];
   summary.textContent=`${counter.results.length} / 10 個動作 · 已記錄合計 ${counter.total.toFixed(2)} 秒${counter.details.some(d=>d.estimated)?"（含估算／未確認，非完整成績）":""}`;
   const active=counter.phase==='air'?{ascent:counter.ascent/1000,descent:(counter.airTime-counter.ascent)/1000,air:counter.airTime/1000,live:true,estimated:counter.uncertain}:null;
   const key=JSON.stringify([counter.details,active,counter.phase]);
   if(list.dataset.key!==key){
     list.dataset.key=key;
     const cell=(d,k)=>!d?'—':d[k]===null?'未確認':d[k].toFixed(2)+(d.live?' 暫計':d.estimated?'*':'');
     list.innerHTML='<table><thead><tr><th>動作</th><th>上升（秒）</th><th>空中合計（秒）</th><th>下降（秒）</th></tr></thead><tbody>'+Array.from({length:10},(_,i)=>{
       const d=counter.details[i]||(i===counter.details.length?active:null);
       return `<tr class="${d?.live?'tof-active':''}"><th>${i+1}${d?.live?' · 進行中':''}</th><td>${cell(d,'ascent')}</td><td>${cell(d,'air')}</td><td>${cell(d,'descent')}</td></tr>`;
     }).join('')+`</tbody><tfoot><tr><th>已記錄總計</th><td>${counter.details.reduce((a,d)=>a+(d.ascent||0),0).toFixed(2)}</td><td>${counter.total.toFixed(2)}</td><td>${counter.details.reduce((a,d)=>a+(d.descent||0),0).toFixed(2)}</td></tr></tfoot></table>`;
   }
   const running=['ground','ready','air'].includes(counter.phase);
   lineInput.disabled=running;dialog.querySelector('#tof-calibrate').disabled=running||lastY===null;startButton.disabled=!ready||running||!locked||selecting;
 }
 function stopWorker(){generation++;clearInterval(timer);clearTimeout(watchdog);worker?.terminate();worker=null;busy=false;ready=false;}
 function close(){stopWorker();dialog?.remove();dialog=null;}
 window.traTofInvalidate=()=>{if(dialog){counter.stop('鏡頭或方向已變更，請重新設定基準線及開始');lastY=null;locked=false;boxes=[];selectedBox=null;revision++;worker?.postMessage({type:'select',point:null});update();}};
 async function frame(){
   if(!dialog||document.hidden)return;
   const source=window.traWebEngineLiveElement?.();
   if(!source?.width||!source.height)return;
   const width=Math.round(480*Math.min(1,source.width/source.height)),height=Math.round(width*source.height/source.width);
   if(preview.width!==width||preview.height!==height){preview.width=width;preview.height=height;}
   ctx.drawImage(source,0,0,width,height);
   ctx.strokeStyle='#f3d77d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,counter.line*height);ctx.lineTo(width,counter.line*height);ctx.stroke();
   for(const box of boxes){ctx.strokeStyle=box===selectedBox?'#65e5a0':'#999';ctx.lineWidth=2;ctx.strokeRect(box.x*width,box.y*height,(box.right-box.x)*width,(box.bottom-box.y)*height);}
   if(selectedBox){ctx.strokeStyle='#65e5a0';ctx.lineWidth=4;ctx.strokeRect(selectedBox.x*width,selectedBox.y*height,(selectedBox.right-selectedBox.x)*width,(selectedBox.bottom-selectedBox.y)*height);}
   if(lastY!==null){ctx.fillStyle='#65e5a0';ctx.beginPath();ctx.arc((selectedBox?(selectedBox.x+selectedBox.right)/2:.5)*width,lastY*height,5,0,Math.PI*2);ctx.fill();}
   if(!ready||busy||counter.phase==='complete')return;
   const g=generation,rev=revision,time=performance.now();busy=true;
   try{
     const bitmap=await createImageBitmap(source,{resizeWidth:width,resizeHeight:height});
     if(g!==generation){bitmap.close();return;}
     worker.postMessage({type:'frame',bitmap,time,revision:rev},[bitmap]);
     clearTimeout(watchdog);watchdog=setTimeout(()=>{counter.stop('分析回應逾時，請關閉後再開啟；錄影不受影響');stopWorker();update();},4000);
   }catch(e){if(g!==generation)return;busy=false;counter.stop('無法讀取分析畫面；錄影不受影響');stopWorker();update();}
 }
 window.traWebOpenTof=()=>{
   if(dialog)return;
   counter=new FlightCounter();lastY=null;locked=false;selecting=false;boxes=[];selectedBox=null;revision++;
   dialog=document.createElement('div');dialog.id='tof-panel';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','騰空時間分析');
   dialog.innerHTML=`<style>
#tof-panel{position:fixed;inset:0;z-index:2147483646;background:#111;color:#f4edda;overflow:auto;font:16px system-ui;padding:16px;box-sizing:border-box}
#tof-panel *{box-sizing:border-box}#tof-panel .tof-wrap{max-width:1200px;margin:auto}#tof-panel h2{color:#e1c474;margin:0 0 12px}
#tof-panel button{padding:12px;margin:4px 0;border-radius:10px;background:#d9bd70;color:#17130a;border:1px solid #8c7840;font:inherit;cursor:pointer}#tof-panel button:disabled{opacity:.4}
#tof-panel .tof-stage{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:16px;align-items:start}#tof-panel .tof-controls{position:sticky;top:8px;display:flex;flex-direction:column;gap:5px;background:#1b1915;padding:12px;border:1px solid #796638;border-radius:12px}
#tof-panel canvas{display:block;width:100%;max-height:62vh;object-fit:contain;background:#000;touch-action:none;cursor:crosshair}
#tof-panel table{width:100%;text-align:right;border-collapse:collapse}#tof-panel th,#tof-panel td{padding:9px 5px;border-bottom:1px solid #3d3524}#tof-panel .tof-active{background:#3a321c;color:#ffe8a0}
#tof-panel p{line-height:1.5}#tof-panel input{width:100%;accent-color:#d9bd70}#tof-panel .tof-box{padding:12px;border:1px solid #796638;border-radius:12px;margin:12px 0;overflow:auto}#tof-panel .tof-small{font-size:13px;color:#c5beb0}#tof-panel #tof-status{min-height:40px}
@media(max-width:600px){#tof-panel{padding:8px;font-size:13px}#tof-panel .tof-stage{grid-template-columns:minmax(0,1fr) 132px;gap:8px}#tof-panel .tof-controls{padding:7px;gap:3px}#tof-panel button{padding:10px 5px}#tof-panel canvas{max-height:55vh}#tof-panel th,#tof-panel td{padding:8px 3px}}
</style><div class="tof-wrap"><button id="tof-close" style="float:right">關閉</button><h2>Time of Flight · 騰空時間</h2>
<p class="tof-small">點一下正在跳的運動員，確認綠框跟隨對象，再開始。教練及其他人可以留在畫面。黃線設在雙腳接觸床面位置，線以上才計時。</p>
<div class="tof-stage"><div><canvas id="tof-preview"></canvas><p class="tof-small">點選身體，唔需要框住整個活動範圍。請保持全身入鏡。重選對象會清除本套結果。</p></div>
<aside class="tof-controls" aria-label="計時控制"><button id="tof-select">選擇運動員</button><label for="tof-line">基準線高度</label><input id="tof-line" type="range" min="5" max="99" value="80"><button id="tof-calibrate">用目前雙腳位置設線</button><span class="tof-small">請在接觸床面時設線</span><button id="tof-start" disabled>開始 10 個動作</button><button id="tof-stop">停止計算</button><button id="tof-copy">複製結果</button><p id="tof-status" role="status"></p></aside></div>
<div class="tof-box"><strong id="tof-summary"></strong><p class="tof-small">每跳即時顯示暫計，落地後記錄；下一跳自動接續。</p><div id="tof-list"></div></div>
<p class="tof-small">上升：離線至髖部最高點；下降：最高點至落線。空中合計＝上升＋下降。短暫遮擋會嘗試接續，星號為估算；較長遮擋的動作標記「未確認」，不計入總和。可能漏掉動作，請核對順序。多人交錯時不能保證身份辨識，請留意綠框。翻騰及收腹會影響最高點估算，這不是比賽電子計時。分析最多每秒 15 次，0.01 秒是顯示位數而非精度保證。模型首次使用需要下載，影像只在裝置處理。錄影繼續運作；低效能裝置可關閉分析。</p></div>`;
   document.body.append(dialog);
   preview=dialog.querySelector('#tof-preview');ctx=preview.getContext('2d');lineInput=dialog.querySelector('#tof-line');status=dialog.querySelector('#tof-status');summary=dialog.querySelector('#tof-summary');list=dialog.querySelector('#tof-list');startButton=dialog.querySelector('#tof-start');
   dialog.querySelector('#tof-close').onclick=close;
   dialog.querySelector('#tof-select').onclick=()=>{selecting=true;revision++;counter.reset();lastY=null;update('請點一下正在跳的運動員身體');};
   preview.onpointerdown=e=>{if(!ready||(!selecting&&locked))return;const b=preview.getBoundingClientRect();const scale=Math.min(b.width/preview.width,b.height/preview.height),w=preview.width*scale,h=preview.height*scale;const point={x:(e.clientX-b.left-(b.width-w)/2)/w,y:(e.clientY-b.top-(b.height-h)/2)/h};if(point.x<0||point.x>1||point.y<0||point.y>1)return;revision++;worker.postMessage({type:'select',point});locked=false;selecting=false;selectedBox=null;counter.reset();update('正在鎖定所選運動員…');};
   lineInput.oninput=()=>{counter.line=Number(lineInput.value)/100;counter.reset();update();};
   dialog.querySelector('#tof-calibrate').onclick=()=>{if(lastY===null)return;counter.line=Math.max(.05,Math.min(.99,lastY-.005));lineInput.value=counter.line*100;counter.reset();update('已設定接觸床面基準線');};
   startButton.onclick=()=>{if(!window.traWebEngineIsRecording?.()){update('請先啟動鏡頭錄影');return;}counter.start();update();};
   dialog.querySelector('#tof-stop').onclick=()=>{counter.stop();update();};
   dialog.querySelector('#tof-copy').onclick=async()=>{try{await navigator.clipboard.writeText(`騰空時間（基準線估算）\n${counter.details.map((d,i)=>`${i+1}${d.estimated?'（估算／未確認）':''}: 上升 ${(d.ascent===null?'未確認':d.ascent.toFixed(2))} 秒／空中合計 ${(d.air===null?'未確認':d.air.toFixed(2))} 秒／下降 ${(d.descent===null?'未確認':d.descent.toFixed(2))} 秒`).join('\n')}\n合計: ${counter.total.toFixed(2)} 秒\n${counter.results.length}/10 ${counter.phase==='complete'?'完成':'未完成'}${counter.details.some(d=>d.estimated)?'（含估算／未確認，非完整成績）':''}`);update('結果已複製');}catch{update('無法複製，請手動記錄畫面上的結果');}};
   dialog.querySelector('#tof-close').focus();dialog.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
   update('正在載入分析模型…');
   try{
     worker=new Worker('tof-worker.js?v=continuous-20261023');
     worker.onmessage=({data})=>{
       if(!dialog)return;
       if(data.type==='ready'){clearTimeout(watchdog);ready=true;update('模型就緒，請設定基準線');}
       if(data.type==='sample'){
         clearTimeout(watchdog);busy=false;if(data.revision!==revision)return;
         boxes=data.people||[];selectedBox=data.selected;locked=data.locked;lastY=data.y;
         counter.sample(data.time,data.y===null?NaN:data.y,data.bodyY===null?NaN:data.bodyY);
         update(data.y===null?data.message:'');
       }
       if(data.type==='error'){counter.stop(data.message);stopWorker();update();}
     };
     worker.onerror=()=>{counter.stop('分析功能無法啟動，請改用更新版 Safari 或電腦 Chrome；錄影不受影響');stopWorker();update();};
     worker.postMessage({type:'init'});
     watchdog=setTimeout(()=>{counter.stop('模型載入逾時，請檢查網絡後再試');stopWorker();update();},60000);
     timer=setInterval(frame,1000/15);
   }catch(e){counter.stop('此瀏覽器不支援背景分析；錄影不受影響');update();}
 };
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog){counter.sample(performance.now(),NaN);update();}});
})();
