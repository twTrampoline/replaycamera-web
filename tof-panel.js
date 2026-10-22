(()=>{
 let dialog,worker,timer,watchdog,busy=false,ready=false,counter,preview,ctx,lineInput,status,summary,list,startButton,lastY=null,generation=0,roi=null,selecting=false,dragStart=null,revision=0;
 const labels={idle:'設定基準線後按開始',ground:'請先讓雙腳落在基準線或線以下',ready:'等待起跳',air:'騰空中',complete:'已完成 10 個動作',stopped:'已停止'};
 function update(message=''){
   if(!dialog)return;
   status.textContent=counter.error||message||labels[counter.phase];
   summary.textContent=`${counter.results.length} / 10 個動作 · 合計 ${counter.total.toFixed(2)} 秒`;
   if(list.dataset.count!==String(counter.details.length)){list.dataset.count=String(counter.details.length);list.innerHTML='<table style="width:100%;text-align:right;border-collapse:collapse"><thead><tr><th>動作</th><th>上升（秒）</th><th>空中合計（秒）</th><th>下降（秒）</th></tr></thead><tbody>'+Array.from({length:10},(_,i)=>{const d=counter.details[i];return `<tr><td>${i+1}</td><td>${d?d.ascent.toFixed(2):'—'}</td><td>${d?d.air.toFixed(2):'—'}</td><td>${d?d.descent.toFixed(2):'—'}</td></tr>`;}).join('')+`</tbody><tfoot><tr><th>總計</th><td>${counter.details.reduce((a,d)=>a+d.ascent,0).toFixed(2)}</td><td>${counter.total.toFixed(2)}</td><td>${counter.details.reduce((a,d)=>a+d.descent,0).toFixed(2)}</td></tr></tfoot></table>`;}
   const running=['ground','ready','air'].includes(counter.phase);
   lineInput.disabled=running;startButton.disabled=!ready||running||!roi||selecting;
 }
 function stopWorker(){generation++;clearInterval(timer);clearTimeout(watchdog);worker?.terminate();worker=null;busy=false;ready=false;}
 function close(){stopWorker();dialog?.remove();dialog=null;}
 window.traTofInvalidate=()=>{if(dialog){counter.stop('鏡頭或方向已變更，請重新設定基準線及開始');lastY=null;roi=null;revision++;update();}};
 async function frame(){
   if(!dialog||document.hidden)return;
   const source=window.traWebEngineLiveElement?.();
   if(!source?.width||!source.height)return;
   const width=Math.round(480*Math.min(1,source.width/source.height)),height=Math.round(width*source.height/source.width);
   if(preview.width!==width||preview.height!==height){preview.width=width;preview.height=height;}
   ctx.drawImage(source,0,0,width,height);
   ctx.strokeStyle='#f3d77d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,counter.line*height);ctx.lineTo(width,counter.line*height);ctx.stroke();
   if(roi){ctx.strokeStyle='#65e5a0';ctx.lineWidth=2;ctx.strokeRect(roi.x*width,roi.y*height,roi.w*width,roi.h*height);}
   if(lastY!==null){ctx.fillStyle='#65e5a0';ctx.beginPath();ctx.arc((roi?roi.x+roi.w/2:.5)*width,lastY*height,5,0,Math.PI*2);ctx.fill();}
   if(!ready||busy||!roi||selecting||counter.phase==='complete')return;
   const g=generation,rev=revision,time=performance.now(),region={...roi};busy=true;
   try{
     const bitmap=await createImageBitmap(source,Math.round(region.x*source.width),Math.round(region.y*source.height),Math.max(1,Math.round(region.w*source.width)),Math.max(1,Math.round(region.h*source.height)),{resizeWidth:Math.max(1,Math.round(width*region.w)),resizeHeight:Math.max(1,Math.round(height*region.h))});
     if(g!==generation){bitmap.close();return;}
     worker.postMessage({type:'frame',bitmap,time,revision:rev},[bitmap]);
     clearTimeout(watchdog);watchdog=setTimeout(()=>{counter.stop('分析回應逾時，請關閉後再開啟；錄影不受影響');stopWorker();update();},4000);
   }catch(e){if(g!==generation)return;busy=false;counter.stop('無法讀取分析畫面；錄影不受影響');stopWorker();update();}
 }
 window.traWebOpenTof=()=>{
   if(dialog)return;
   counter=new FlightCounter();lastY=null;roi=null;selecting=false;dragStart=null;revision++;
   dialog=document.createElement('div');dialog.id='tof-panel';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','騰空時間分析');
   dialog.innerHTML=`<style>#tof-panel{position:fixed;inset:0;z-index:2147483646;background:#111;color:#f4edda;overflow:auto;font:16px system-ui;padding:16px;box-sizing:border-box}#tof-panel *{box-sizing:border-box}#tof-panel .tof-wrap{max-width:900px;margin:auto}#tof-panel h2{color:#e1c474;margin:0 0 12px}#tof-panel button{padding:10px 16px;margin:4px;border-radius:10px;background:#d9bd70;color:#17130a;border:1px solid #8c7840;font:inherit}#tof-panel button:disabled{opacity:.4}#tof-panel canvas{display:block;max-height:48vh;max-width:100%;margin:12px auto;background:#000}#tof-panel th,#tof-panel td{padding:7px 4px;border-bottom:1px solid #3d3524}#tof-panel p{line-height:1.5}#tof-panel input{width:100%;accent-color:#d9bd70}#tof-panel .tof-box{padding:12px;border:1px solid #796638;border-radius:12px;margin:12px 0}#tof-panel .tof-small{font-size:13px;color:#c5beb0}</style>
   <div class="tof-wrap"><button id="tof-close" style="float:right">關閉</button><h2>Time of Flight · 騰空時間</h2><p class="tof-small">直播錄影繼續運作。固定鏡頭、保持全身及雙腳入鏡，先框選運動員整個跳躍活動範圍，排除旁邊教練。範圍內如出現第二人會停止計時，請避免兩人重疊。將黃線設在落地／接觸床面時雙腳的位置；雙腳高於黃線才計時。</p><button id="tof-select">框選／重選運動員</button><p class="tof-small">按框選後，在畫面拖拉綠框；請包括從落地到最高點的全身活動範圍。重選會清除本套結果。</p><canvas id="tof-preview" style="touch-action:none"></canvas><label for="tof-line">基準線高度</label><input id="tof-line" type="range" min="15" max="95" value="80"><div class="tof-box"><strong id="tof-summary"></strong><p id="tof-status" role="status"></p><div id="tof-list"></div></div><button id="tof-start" disabled>開始一套（10 個動作）</button><button id="tof-stop">停止計算</button><button id="tof-copy">複製結果</button><p class="tof-small">上升：離線至髖部最高點；下降：最高點至落線。空中合計＝上升＋下降，不重複累加。最高點以髖部位置估算，收腹及翻騰可能影響判斷。此為影片基準線估算，不是比賽電子計時。翻騰遮擋、動作幅度、基準線及取樣速度會影響結果。偵測中斷會停止整套，請重新開始。分析約每秒 15 次，顯示至 0.01 秒不代表測量精度。首次開啟需下載分析模型；影像在裝置內處理，不會上傳。低效能裝置可關閉此功能。</p></div>`;
   document.body.append(dialog);
   preview=dialog.querySelector('#tof-preview');ctx=preview.getContext('2d');lineInput=dialog.querySelector('#tof-line');status=dialog.querySelector('#tof-status');summary=dialog.querySelector('#tof-summary');list=dialog.querySelector('#tof-list');startButton=dialog.querySelector('#tof-start');
   dialog.querySelector('#tof-close').onclick=close;
   dialog.querySelector('#tof-select').onclick=()=>{selecting=true;roi=null;revision++;counter.reset();lastY=null;update('請在畫面拖拉運動員活動範圍');};
   const point=e=>{const b=preview.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};};
   preview.onpointerdown=e=>{if(!selecting)return;dragStart=point(e);preview.setPointerCapture(e.pointerId);};
   preview.onpointermove=e=>{if(!selecting||!dragStart)return;const q=point(e);roi={x:Math.min(q.x,dragStart.x),y:Math.min(q.y,dragStart.y),w:Math.abs(q.x-dragStart.x),h:Math.abs(q.y-dragStart.y)};};
   preview.onpointerup=e=>{if(!selecting||!dragStart)return;preview.onpointermove(e);dragStart=null;if(!roi||roi.w<.08||roi.h<.15){roi=null;update('選取範圍太小，請重新拖拉');return;}selecting=false;revision++;update('已選取運動員範圍，請設定基準線');};
   preview.onpointercancel=()=>{dragStart=null;roi=null;update('框選已取消，請重新拖拉');};
   lineInput.oninput=()=>{counter.line=Number(lineInput.value)/100;counter.reset();update();};
   startButton.onclick=()=>{if(!window.traWebEngineIsRecording?.()){update('請先啟動鏡頭錄影');return;}counter.start();update();};
   dialog.querySelector('#tof-stop').onclick=()=>{counter.stop();update();};
   dialog.querySelector('#tof-copy').onclick=async()=>{try{await navigator.clipboard.writeText(`騰空時間（基準線估算）\n${counter.details.map((d,i)=>`${i+1}: 上升 ${d.ascent.toFixed(2)} 秒／空中合計 ${d.air.toFixed(2)} 秒／下降 ${d.descent.toFixed(2)} 秒`).join('\n')}\n合計: ${counter.total.toFixed(2)} 秒\n${counter.results.length}/10 ${counter.phase==='complete'?'完成':'未完成'}`);update('結果已複製');}catch{update('無法複製，請手動記錄畫面上的結果');}};
   dialog.querySelector('#tof-close').focus();dialog.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
   update('正在載入分析模型…');
   try{
     worker=new Worker('tof-worker.js?v=20261023-details');
     worker.onmessage=({data})=>{
       if(!dialog)return;
       if(data.type==='ready'){clearTimeout(watchdog);ready=true;update('模型就緒，請設定基準線');}
       if(data.type==='sample'){
         clearTimeout(watchdog);busy=false;if(data.revision!==revision||!roi||selecting)return;lastY=data.y===null?null:roi.y+data.y*roi.h;
         if(data.ambiguous&&['ground','ready','air'].includes(counter.phase))counter.stop('框內有第二人，請重新框選並開始整套');
         counter.sample(data.time,lastY===null?NaN:lastY,data.bodyY===null?NaN:roi.y+data.bodyY*roi.h);
         update(counter.phase==='idle'?data.message:'');
       }
       if(data.type==='error'){counter.stop(data.message);stopWorker();update();}
     };
     worker.onerror=()=>{counter.stop('分析功能無法啟動，請改用更新版 Safari 或電腦 Chrome；錄影不受影響');stopWorker();update();};
     worker.postMessage({type:'init'});
     watchdog=setTimeout(()=>{counter.stop('模型載入逾時，請檢查網絡後再試');stopWorker();update();},60000);
     timer=setInterval(frame,1000/15);
   }catch(e){counter.stop('此瀏覽器不支援背景分析；錄影不受影響');update();}
 };
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog){counter.stop('已切換到背景，請返回後重新開始整套');update();}});
})();
