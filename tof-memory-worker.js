/* Whole-subject video memory. All images stay in this worker on this device. */
importScripts('tof-mask.js?v=memory-20261026');
let model,canvas,ctx,selected=false,epoch=0,working=false;
self.onmessage=async({data})=>{
 if(data.type==='select'){epoch++;selected=false;return;}
 if(data.type==='init'){
  try{
   const ort=await import('./edge/ort/ort.all.bundle.min.mjs');
   const {WebTracker}=await import('./edge/track.mjs');
   ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('./edge/ort/',self.location.href).href;
   const adapter=await self.navigator.gpu?.requestAdapter().catch(()=>null);
   const ep=adapter?'webgpu':'wasm',fp16=!!adapter?.features.has('shader-f16');
   model=new WebTracker(ort,{dir:new URL('./edge/models/',self.location.href).href,ep,fp16});
   await model.load(()=>self.postMessage({type:'loading',message:'正在載入全身追蹤模型…'}));
   canvas=new OffscreenCanvas(model.man.image_size,model.man.image_size);ctx=canvas.getContext('2d',{willReadFrequently:true});
   self.postMessage({type:'loading',message:'正在準備追蹤，首次使用需稍候…'});
   model.reset();const blank=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   await model.step(blank,{coords:new Float32Array([180,120,300,400]),labels:new Float32Array([2,3])});
   await model.step(blank,null);model.reset();
   self.postMessage({type:'ready',backend:ep});
  }catch(e){self.postMessage({type:'error',message:'全身追蹤模型未能載入，請重新開啟分析或更新瀏覽器；錄影不受影響。',detail:String(e)});}
  return;
 }
 if(data.type!=='frame')return;
 const {bitmap,selectionBox}=data,rev=epoch;
 if(working||!model){bitmap.close();return;}
 working=true;
 try{
  if(!selected&&!selectionBox){self.postMessage({type:'sample',revision:data.revision,time:data.time,sampleTime:data.sampleTime,y:null,bodyY:null,selected:null,people:[],locked:false,message:'拖框選取整個運動員'});return;}
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  let prompt=null;
  if(selectionBox){model.reset();const b=selectionBox,S=canvas.width;prompt={coords:new Float32Array([b.x*S,b.y*S,b.right*S,b.bottom*S]),labels:new Float32Array([2,3])};}
  const result=await model.step(ctx.getImageData(0,0,canvas.width,canvas.height).data,prompt);
  if(rev!==epoch){self.postMessage({type:'discarded'});return;}
  const box=result.score>=Math.log(3)?self.tofBodyMask(result.low,result.size):null;
  if(selectionBox)selected=!!box;
  self.postMessage({type:'sample',revision:data.revision,time:data.time,sampleTime:data.sampleTime,score:result.score,y:box?.bottom??null,bodyY:box?(box.y+box.bottom)/2:null,selected:box,people:[],locked:selected,message:box?'':'運動員暫時被遮擋，正在追蹤原對象；時間待核對'});
 }catch(e){self.postMessage({type:'error',message:'人物追蹤中斷，請重新開啟分析；錄影不受影響。',detail:String(e)});}
 finally{bitmap.close();working=false;}
};
