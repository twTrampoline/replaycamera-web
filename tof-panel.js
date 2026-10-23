(()=>{
 let dialog,worker,timer,watchdog,busy=false,ready=false,counter,preview,ctx,lineInput,status,summary,list,startButton,lastY=null,generation=0,locked=false,selecting=false,boxes=[],selectedBox=null,revision=0,mode="live",fileVideo=null,fileUrl=null,fileRun=false,filePaused=false,fileSeeking=false,fileEpoch=0,seekTimer=null,loadTimer=null;
 const labels={idle:'設定基準線後按開始',ground:'請先讓人物框底邊碰到基準線或線以下',ready:'等待起跳',air:'騰空中',complete:'已完成 10 個動作',stopped:'已停止'};
 function update(message=''){
   if(!dialog)return;
   status.textContent=counter.error||message||counter.notice||labels[counter.phase];
   summary.textContent=`${counter.phase==='air'?`第 ${counter.results.length+1} 個動作進行中 · `:''}${counter.results.length} / 10 個動作已完成 · 空中 ${counter.total.toFixed(2)} 秒 · 沉網 ${counter.bedTotal.toFixed(2)} 秒${counter.missingSegments?` · ${counter.missingSegments} 段未能確認動作`:""}${(counter.missingSegments>0||counter.details.some(d=>d.estimated||d.bedEstimated))?"（有漏判，只含已觀察時間，非完整成績）":""}`;
   const boundary=dialog.querySelector('#tof-boundary');boundary.textContent=lastY===null?'未能確認人物框底邊｜不補算時間':lastY<counter.line?(counter.phase==='air'&&!(mode==='file'&&filePaused)?'線上方｜正在計時':'線上方｜尚未計時／等待完整起跳'):(counter.phase==='ready'&&counter.details.length?'線上或線下｜沉網計時中':'線上或線下｜等待第一次離網');boundary.style.color=lastY===null?'#aaa':lastY<counter.line?'#65e5a0':'#efb477';
   const active=counter.phase==='air'?{ascent:counter.ascent/1000,descent:(counter.airTime-counter.ascent)/1000,air:counter.airTime/1000,bed:0,live:true,estimated:counter.uncertain}:null;
   const key=JSON.stringify([counter.details,active,counter.phase]);
   if(list.dataset.key!==key){
     list.dataset.key=key;
     const cell=(d,k)=>!d?'—':d[k]===null?'未確認':d[k].toFixed(2)+(d.live?' 暫計':(d.estimated||k==='bed'&&d.bedEstimated)?'*':'');
     list.innerHTML='<table><thead><tr><th>動作</th><th>空中（秒）</th><th>落網後沉網（秒）</th></tr></thead><tbody>'+Array.from({length:10},(_,i)=>{
       const d=counter.details[i]||(i===counter.details.length?active:null);
       return `<tr class="${d?.live?'tof-active':''}"><th>${i+1}${d?.live?' · 進行中':''}</th><td>${cell(d,'air')}</td><td>${i===9?'—':cell(d,'bed')}</td></tr>`;
     }).join('')+`</tbody><tfoot><tr><th>已記錄總計</th><td>${counter.total.toFixed(2)}</td><td>${counter.bedTotal.toFixed(2)}</td></tr></tfoot></table>`;
   }
   const mediaControls=dialog.querySelector('#tof-media-controls');mediaControls.hidden=mode!=='file';
   if(mode==='file'&&fileVideo){dialog.querySelector('#tof-position').textContent=`影片 ${fileVideo.currentTime.toFixed(2)} / ${Number.isFinite(fileVideo.duration)?fileVideo.duration.toFixed(2):'—'} 秒`;dialog.querySelector('#tof-seek').value=fileVideo.currentTime;dialog.querySelector('#tof-pause').disabled=!fileRun;dialog.querySelector('#tof-pause').textContent=filePaused?'繼續分析':'暫停分析';dialog.querySelector('#tof-seek').disabled=fileRun;dialog.querySelector('#tof-origin').textContent=counter.routineStart===null?'等待第一跳：準備時間不計入成績':`第一跳起點：影片 ${(counter.routineStart/1000).toFixed(2)} 秒（由此開始記錄）`;}
   dialog.querySelector('#tof-mode').textContent=mode==='file'?'影片分析（只在本機處理）':'直播計時';
   const running=['ground','ready','air'].includes(counter.phase);
   lineInput.disabled=running;dialog.querySelector('#tof-calibrate').disabled=running||lastY===null;startButton.disabled=!ready||running||!locked||selecting||(mode==='file'&&(!fileVideo||fileVideo.readyState<2||fileSeeking));
 }
 function stopWorker(){generation++;clearInterval(timer);clearTimeout(watchdog);worker?.terminate();worker=null;busy=false;ready=false;}
 function close(){releaseFile();stopWorker();dialog?.remove();dialog=null;}
 window.traTofInvalidate=()=>{if(dialog&&mode==='live'){counter.stop('鏡頭或方向已變更，請重新設定基準線及開始');lastY=null;locked=false;boxes=[];selectedBox=null;revision++;worker?.postMessage({type:'select',point:null});update();}};
 function resetSource(){revision++;counter.reset();locked=false;selecting=false;boxes=[];selectedBox=null;lastY=null;worker?.postMessage({type:'select',point:null});}
 function releaseFile(){fileEpoch++;clearTimeout(seekTimer);clearTimeout(loadTimer);fileRun=false;filePaused=false;fileSeeking=false;if(fileVideo){fileVideo.onloadeddata=fileVideo.onerror=fileVideo.onseeked=null;fileVideo.pause();fileVideo.removeAttribute('src');fileVideo.load();fileVideo.remove();fileVideo=null;}if(fileUrl){URL.revokeObjectURL(fileUrl);fileUrl=null;}}
 function seekFile(time){
   if(!fileVideo||!Number.isFinite(fileVideo.duration))return;
   const target=Math.max(0,Math.min(fileVideo.duration-.001,time));
   if(Math.abs(fileVideo.currentTime-target)<.0001){fileSeeking=false;return;}
   fileSeeking=true;const epoch=fileEpoch;clearTimeout(seekTimer);
   fileVideo.currentTime=target;
   seekTimer=setTimeout(()=>{if(epoch!==fileEpoch||!dialog)return;fileSeeking=false;fileRun=false;counter.stop('影片定位逾時，已保留完成的記錄；請重新選擇位置');update();},10000);
 }
 function advanceFile(){
   if(!fileRun||filePaused||fileSeeking||!fileVideo)return;
   if(counter.phase==='complete'){fileRun=false;update('已完成 10 個動作');return;}
   if(fileVideo.currentTime+1/30>=fileVideo.duration){fileRun=false;counter.stop('影片已到結尾，已保留完成的動作；不足 10 跳不會補算');update();return;}
   seekFile(fileVideo.currentTime+1/30);
 }
 function loadFile(file){
   releaseFile();mode='file';resetSource();const epoch=fileEpoch;
   fileVideo=document.createElement('video');fileVideo.muted=true;fileVideo.playsInline=true;fileVideo.preload='auto';fileVideo.style.display='none';dialog.append(fileVideo);
   fileVideo.onloadeddata=()=>{if(epoch!==fileEpoch)return;clearTimeout(loadTimer);if(!Number.isFinite(fileVideo.duration)||fileVideo.duration<=0){counter.stop('無法讀取影片長度，請選擇完整影片');update();return;}dialog.querySelector('#tof-seek').max=Math.max(0,fileVideo.duration-.001);update('影片就緒：移到動作開始前，點選運動員並設基準線');};
   fileVideo.onseeked=()=>{if(epoch!==fileEpoch)return;clearTimeout(seekTimer);fileSeeking=false;update();};
   fileVideo.onerror=()=>{if(epoch!==fileEpoch)return;clearTimeout(loadTimer);clearTimeout(seekTimer);fileRun=false;fileSeeking=false;counter.stop('此影片無法解碼，請嘗試 MP4（H.264）或 WebM 影片');update();};
   fileUrl=URL.createObjectURL(file);fileVideo.src=fileUrl;fileVideo.load();
   loadTimer=setTimeout(()=>{if(epoch!==fileEpoch||!dialog)return;counter.stop('影片載入逾時，請重新選擇影片');update();},15000);
   update('正在讀取影片…');
 }
 async function frame(){
   if(!dialog||document.hidden)return;
   const source=mode==='file'?fileVideo:window.traWebEngineLiveElement?.();
   const sw=mode==='file'?source?.videoWidth:source?.width,sh=mode==='file'?source?.videoHeight:source?.height;
   if(!sw||!sh||(mode==='file'&&(fileSeeking||source.readyState<2)))return;
   // Float mask rows require a four-pixel-aligned width in the vision runtime.
   const width=Math.max(4,Math.round(480*Math.min(1,sw/sh)/4)*4),height=Math.round(width*sh/sw);
   if(preview.width!==width||preview.height!==height){preview.width=width;preview.height=height;}
   ctx.drawImage(source,0,0,width,height);
   ctx.strokeStyle='#f3d77d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,counter.line*height);ctx.lineTo(width,counter.line*height);ctx.stroke();
   for(const box of boxes){ctx.strokeStyle=box===selectedBox?'#65e5a0':'#999';ctx.lineWidth=2;ctx.strokeRect(box.x*width,box.y*height,(box.right-box.x)*width,(box.bottom-box.y)*height);}
   if(selectedBox){ctx.strokeStyle='#65e5a0';ctx.lineWidth=4;ctx.strokeRect(selectedBox.x*width,selectedBox.y*height,(selectedBox.right-selectedBox.x)*width,(selectedBox.bottom-selectedBox.y)*height);}
   if(selectedBox&&lastY!==null){ctx.strokeStyle=lastY<counter.line?'#65e5a0':'#efb477';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(selectedBox.x*width,lastY*height);ctx.lineTo(selectedBox.right*width,lastY*height);ctx.stroke();}
   if(!ready||busy||counter.phase==='complete'||(mode==='file'&&fileRun&&filePaused))return;
   const g=generation,rev=revision,time=performance.now(),sampleTime=mode==='file'?source.currentTime*1000:time;busy=true;
   try{
     const bitmap=await createImageBitmap(source,{resizeWidth:width,resizeHeight:height});
     if(g!==generation){bitmap.close();return;}
     worker.postMessage({type:'frame',bitmap,time,sampleTime,revision:rev},[bitmap]);
     clearTimeout(watchdog);watchdog=setTimeout(()=>{counter.stop('分析回應逾時，請關閉後再開啟；錄影不受影響');stopWorker();update();},4000);
   }catch(e){if(g!==generation)return;busy=false;counter.stop('無法讀取分析畫面；錄影不受影響');stopWorker();update();}
 }
 window.traWebOpenTof=()=>{
   if(dialog)return;
   mode="live";counter=new FlightCounter();lastY=null;locked=false;selecting=false;boxes=[];selectedBox=null;revision++;
   dialog=document.createElement('div');dialog.id='tof-panel';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','騰空時間分析');
   dialog.innerHTML=`<style>
#tof-panel{position:fixed;inset:0;z-index:2147483646;background:#111;color:#f4edda;overflow:auto;font:16px system-ui;padding:16px;box-sizing:border-box}
#tof-panel *{box-sizing:border-box}#tof-panel .tof-wrap{max-width:1200px;margin:auto}#tof-panel h2{color:#e1c474;margin:0 0 12px}
#tof-panel button{padding:12px;margin:4px 0;border-radius:10px;background:#d9bd70;color:#17130a;border:1px solid #8c7840;font:inherit;cursor:pointer}#tof-panel button:disabled{opacity:.4}
#tof-panel .tof-stage{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:16px;align-items:start}#tof-panel .tof-controls{position:sticky;top:8px;max-height:calc(100vh - 32px);overflow:auto;display:flex;flex-direction:column;gap:5px;background:#1b1915;padding:12px;border:1px solid #796638;border-radius:12px}
#tof-panel .tof-primary{position:sticky;top:-12px;background:#1b1915;z-index:1;display:flex;flex-direction:column}#tof-panel canvas{display:block;width:100%;max-height:62vh;object-fit:contain;background:#000;touch-action:none;cursor:crosshair}
#tof-panel table{width:100%;text-align:right;border-collapse:collapse}#tof-panel th,#tof-panel td{padding:9px 5px;border-bottom:1px solid #3d3524}#tof-panel .tof-active{background:#3a321c;color:#ffe8a0}
#tof-panel p{line-height:1.5}#tof-panel input{width:100%;accent-color:#d9bd70}#tof-panel .tof-box{padding:12px;border:1px solid #796638;border-radius:12px;margin:12px 0;overflow:auto}#tof-panel .tof-small{font-size:13px;color:#c5beb0}#tof-panel #tof-status{min-height:40px}
@media(max-width:600px){#tof-panel{padding:8px;font-size:13px}#tof-panel .tof-stage{grid-template-columns:minmax(0,1fr) 132px;gap:8px}#tof-panel .tof-controls{padding:7px;gap:3px}#tof-panel button{padding:10px 5px}#tof-panel .tof-primary{position:sticky;top:-12px;background:#1b1915;z-index:1;display:flex;flex-direction:column}#tof-panel canvas{max-height:55vh}#tof-panel th,#tof-panel td{padding:8px 3px}}
</style><div class="tof-wrap"><button id="tof-close" style="float:right">關閉</button><h2>Time of Flight · 騰空時間</h2>
<p class="tof-small">點一下正在跳的運動員，確認綠框跟隨對象，再開始。教練及其他人可以留在畫面。黃線設在床面位置；全身長方形框的底邊高於黃線才計時，碰線或線下即視為着網，另外記錄沉網時間。適用於腳、坐、腹及背彈。</p>
<p id="tof-mode" class="tof-small"></p><div class="tof-stage"><div><canvas id="tof-preview"></canvas><p id="tof-boundary" role="status"></p><p class="tof-small">點選身體，唔需要框住整個活動範圍。請保持全身入鏡。重選對象會清除本套結果。</p></div>
<aside class="tof-controls" aria-label="計時控制"><div class="tof-primary"><button id="tof-start" disabled>開始 10 個動作</button><button id="tof-stop">停止計算</button></div><button id="tof-upload">上傳影片分析</button><input id="tof-file" type="file" accept="video/*" hidden><button id="tof-live">返回直播</button><div id="tof-media-controls" hidden><label for="tof-seek">移到第一個動作開始前</label><input id="tof-seek" type="range" min="0" max="0" value="0" step="0.0333333333"><p id="tof-position" class="tof-small"></p><p id="tof-origin" class="tof-small"></p><button id="tof-pause">暫停分析</button></div><button id="tof-select">選擇運動員</button><label for="tof-line">基準線高度</label><input id="tof-line" type="range" min="5" max="99" value="80"><button id="tof-calibrate">用人物框底邊設線</button><span class="tof-small">請在接觸床面時設線；以人物框底邊為準</span><button id="tof-copy">複製結果</button><p id="tof-status" role="status"></p></aside></div>
<div class="tof-box"><strong id="tof-summary"></strong><p class="tof-small">可在準備跳的空中按開始；系統先等下一次踩網，再於離網時開始第 1 個動作，之後連續記錄。每列記錄一次空中時間，以及之後落網至再離網的沉網時間。第 10 次落網即完成（10 次空中、9 段中間沉網），第一次離網前的準備時間不計；如有熱身跳躍，請先移到正式動作開始前。</p><div id="tof-list"></div></div>
<p class="tof-small">空中：人物輪廓框底邊高於線；沉網：底邊碰線或在線下。兩種時間分開累計。追蹤缺失的區間不補時；星號表示該跳有漏判，所列為已觀察到的部分時間。可能漏掉動作，請核對順序。多人交錯時不能保證身份辨識，請留意綠框。輪廓遮擋或人物重疊會影響估算，這不是比賽電子計時。分析最多每秒 15 次，0.01 秒是顯示位數而非精度保證。模型首次使用需要下載，影像只在裝置處理。錄影繼續運作；低效能裝置可關閉分析。</p></div>`;
   document.body.append(dialog);
   preview=dialog.querySelector('#tof-preview');ctx=preview.getContext('2d');lineInput=dialog.querySelector('#tof-line');status=dialog.querySelector('#tof-status');summary=dialog.querySelector('#tof-summary');list=dialog.querySelector('#tof-list');startButton=dialog.querySelector('#tof-start');
   dialog.querySelector('#tof-close').onclick=close;
   dialog.querySelector('#tof-upload').onclick=()=>dialog.querySelector('#tof-file').click();
   dialog.querySelector('#tof-file').onchange=e=>{const file=e.target.files[0];if(file)loadFile(file);e.target.value='';};
   dialog.querySelector('#tof-live').onclick=()=>{releaseFile();mode='live';resetSource();update('已返回直播計時');};
   dialog.querySelector('#tof-seek').oninput=e=>{if(fileRun)return;resetSource();seekFile(Number(e.target.value));update('已移動位置，請重新點選運動員');};
   dialog.querySelector('#tof-pause').onclick=()=>{if(!fileRun)return;filePaused=!filePaused;update(filePaused?'分析已暫停，成績保留':'繼續逐格分析');};
   dialog.querySelector('#tof-select').onclick=()=>{fileRun=false;filePaused=false;selecting=true;revision++;counter.reset();lastY=null;update('請點一下正在跳的運動員身體');};
   preview.onpointerdown=e=>{if(!ready)return;const b=preview.getBoundingClientRect();const scale=Math.min(b.width/preview.width,b.height/preview.height),w=preview.width*scale,h=preview.height*scale;const point={x:(e.clientX-b.left-(b.width-w)/2)/w,y:(e.clientY-b.top-(b.height-h)/2)/h};if(point.x<0||point.x>1||point.y<0||point.y>1)return;if(!selecting&&locked){if(mode==='live')window.traWebEngineFocusAt?.(point.x,point.y).then(message=>update(message));return;}revision++;worker.postMessage({type:'select',point});locked=false;selecting=false;selectedBox=null;counter.reset();update('正在鎖定所選運動員…');};
   lineInput.oninput=()=>{counter.line=Number(lineInput.value)/100;counter.reset();update();};
   dialog.querySelector('#tof-calibrate').onclick=()=>{if(lastY===null)return;counter.line=Math.max(.05,Math.min(.99,lastY));lineInput.value=counter.line*100;counter.reset();update('已設定接觸床面基準線');};
   startButton.onclick=()=>{if(mode==='live'&&!window.traWebEngineIsRecording?.()){update('請先啟動鏡頭錄影');return;}revision++;counter.start();if(mode==='file'){fileRun=true;filePaused=false;}update();};
   dialog.querySelector('#tof-stop').onclick=()=>{fileRun=false;filePaused=false;counter.stop();update();};
   dialog.querySelector('#tof-copy').onclick=async()=>{try{await navigator.clipboard.writeText(`騰空時間（基準線估算）\n${mode==='file'&&counter.routineStart!==null?'影片第一跳：'+(counter.routineStart/1000).toFixed(2)+' 秒\n':''}${counter.details.map((d,i)=>`${i+1}${d.estimated||d.bedEstimated?'（漏判／部分時間）':''}: 空中 ${d.air.toFixed(2)} 秒／落網後沉網 ${i===9?'—':d.bed.toFixed(2)} 秒`).join('\n')}\n空中合計: ${counter.total.toFixed(2)} 秒／沉網合計: ${counter.bedTotal.toFixed(2)} 秒\n${counter.results.length}/10 ${counter.phase==='complete'?'完成':'未完成'}${(counter.missingSegments>0||counter.details.some(d=>d.estimated||d.bedEstimated))?'（有漏判，只含已觀察時間，非完整成績）':''}`);update('結果已複製');}catch{update('無法複製，請手動記錄畫面上的結果');}};
   dialog.querySelector('#tof-close').focus();dialog.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
   update('正在載入分析模型…');
   try{
     worker=new Worker('tof-worker.js?v=continuous-focus-20261023');
     worker.onmessage=({data})=>{
       if(!dialog)return;
       if(data.type==='ready'){clearTimeout(watchdog);ready=true;update('模型就緒，請設定基準線');}
       if(data.type==='sample'){
         clearTimeout(watchdog);busy=false;if(data.revision!==revision)return;
         boxes=data.people||[];selectedBox=data.selected;locked=data.locked;lastY=data.y;
         if(mode==='live'||(fileRun&&!filePaused))counter.sample(data.sampleTime??data.time,data.y===null?NaN:data.y,data.bodyY===null?NaN:data.bodyY);
         update(data.y===null?data.message:'');
         if(mode==='file')advanceFile();
       }
       if(data.type==='error'){counter.stop(data.message);stopWorker();update();}
     };
     worker.onerror=()=>{counter.stop('分析功能無法啟動，請改用更新版 Safari 或電腦 Chrome；錄影不受影響');stopWorker();update();};
     worker.postMessage({type:'init'});
     watchdog=setTimeout(()=>{counter.stop('模型載入逾時，請檢查網絡後再試');stopWorker();update();},60000);
     timer=setInterval(frame,1000/15);
   }catch(e){counter.stop('此瀏覽器不支援背景分析；錄影不受影響');update();}
 };
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog&&mode==='live'){counter.sample(performance.now(),NaN);update();}});
})();
