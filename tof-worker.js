importScripts('tof-athlete-tracker.js?v=body-model-20261024');
// Extract only the selected person's connected silhouette, not a torso-only
// landmark envelope. Ignore detached mask noise and other people's components.
function silhouetteBox(mask,pose){
 if(!mask)return null;
 const w=mask.width,h=mask.height,a=mask.getAsFloat32Array();
 const torso=[11,12,23,24].map(i=>pose[i]).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
 if(!torso.length)return null;
 const cx=torso.reduce((s,p)=>s+p.x,0)/torso.length*w,cy=torso.reduce((s,p)=>s+p.y,0)/torso.length*h;
 // A generous skeleton corridor prevents attached background/roof mask
 // pixels from stretching the person box; never substitute the corridor for
 // actual foreground pixels. Include low-visibility but present extremities.
 const usable=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility>=.25||(p.presence??0)>=.7);
 const links=[[0,7],[0,8],[7,11],[8,12],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[24,26],[26,28],[28,30],[30,32]];
 const bones=links.filter(([i,j])=>usable(pose[i])&&usable(pose[j]));
 const hasExtremities=[0,15,16,27,28].every(i=>usable(pose[i]));
 const rowLeft=new Float32Array(h).fill(-Infinity),rowRight=new Float32Array(h).fill(Infinity);
 if(hasExtremities&&bones.length>=18&&Math.hypot((pose[11].x-pose[23].x)*w,(pose[11].y-pose[23].y)*h)>3){
   rowLeft.fill(Infinity);rowRight.fill(-Infinity);
   const shoulder=Math.hypot((pose[11].x-pose[12].x)*w,(pose[11].y-pose[12].y)*h);
   const radius=Math.max(4,Math.min(w*.05,shoulder*.65));
   for(const [i,j] of bones){const u=pose[i],v=pose[j],x1=u.x*w,y1=u.y*h,x2=v.x*w,y2=v.y*h;
     for(let y=Math.max(0,Math.floor(Math.min(y1,y2)-radius));y<Math.min(h,Math.ceil(Math.max(y1,y2)+radius));y++){
       const t=Math.abs(y2-y1)<1?0:Math.max(0,Math.min(1,(y-y1)/(y2-y1)));
       const x=x1+(x2-x1)*t,extra=radius+(Math.abs(y2-y1)<radius?Math.abs(x2-x1):0);
       rowLeft[y]=Math.min(rowLeft[y],x-extra);rowRight[y]=Math.max(rowRight[y],x+extra);
     }
   }
 }
 const foreground=(i,x,y)=>a[i]>.5&&x>=rowLeft[y]&&x<=rowRight[y];
 let seed=-1,best=Infinity;
 for(let y=Math.max(0,Math.floor(cy-h*.15));y<Math.min(h,Math.ceil(cy+h*.15));y++)for(let x=Math.max(0,Math.floor(cx-w*.15));x<Math.min(w,Math.ceil(cx+w*.15));x++){const i=y*w+x;if(foreground(i,x,y)){const d=(x-cx)**2+(y-cy)**2;if(d<best){best=d;seed=i;}}}
 if(seed<0||best>(Math.max(w,h)*.15)**2)return null;
 const seen=new Uint8Array(a.length),q=new Int32Array(a.length);q[0]=seed;let count=1;seen[seed]=1;let left=w,right=0,top=h,bottom=0;
 for(let k=0;k<count;k++){const i=q[k],x=i%w,y=Math.floor(i/w);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  for(let direction=0;direction<4;direction++){const nx=x+(direction===0?-1:direction===1?1:0),ny=y+(direction===2?-1:direction===3?1:0);if(nx<0||nx>=w||ny<0||ny>=h)continue;const j=ny*w+nx;if(!seen[j]&&foreground(j,nx,ny)){seen[j]=1;q[count++]=j;}}}
 if(count<8)return null;
 return {x:left/w,y:top/h,right:(right+1)/w,bottom:(bottom+1)/h};
}
// Lightweight clothing-colour descriptor sampled inside the torso polygon.
// Frames/descriptors stay in this worker; no face recognition or server upload.
let appearanceCanvas;
function appearanceDescriptors(bitmap,poses){
 if(!poses.length)return [];
 try{
  if(!appearanceCanvas)appearanceCanvas=new OffscreenCanvas(160,160);
  const w=160,h=Math.max(1,Math.round(w*bitmap.height/bitmap.width));
  if(appearanceCanvas.height!==h)appearanceCanvas.height=h;
  const context=appearanceCanvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(bitmap,0,0,w,h);const pixels=context.getImageData(0,0,w,h).data;
  return poses.map(p=>{
   const corners=[p[11],p[12],p[23],p[24]];
   if(corners.some(v=>!v||v.visibility<.3||!Number.isFinite(v.x)||!Number.isFinite(v.y)))return null;
   const hist=new Array(64).fill(0);let count=0;
   for(const u of [.2,.4,.6,.8])for(const v of [.25,.4,.55,.7]){
    const x=Math.round(((1-v)*((1-u)*p[11].x+u*p[12].x)+v*((1-u)*p[23].x+u*p[24].x))*w);
    const y=Math.round(((1-v)*((1-u)*p[11].y+u*p[12].y)+v*((1-u)*p[23].y+u*p[24].y))*h);
    if(x<1||x>=w-1||y<1||y>=h-1)continue;
    let r=0,g=0,b=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const k=((y+dy)*w+x+dx)*4;r+=pixels[k];g+=pixels[k+1];b+=pixels[k+2];}
    hist[(Math.floor(r/9)>>6)*16+(Math.floor(g/9)>>6)*4+(Math.floor(b/9)>>6)]++;count++;
   }
   return count>=8?hist.map(v=>v/count):null;
  });
 }catch(_){return [];}
}
let detector;const tracker=new AthleteTracker();
self.onmessage=async({data})=>{
  if(data.type==='select'){tracker.select(data.point);return;}
  if(data.type==='init'){
    try{
      const {FilesetResolver,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
      detector=await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_'+(data.quality==='full'?'full':'lite')+'/float16/1/pose_landmarker_'+(data.quality==='full'?'full':'lite')+'.task',delegate:'CPU'},
        canvas:new OffscreenCanvas(256,256),runningMode:'VIDEO',numPoses:6,outputSegmentationMasks:true,
        minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45,
      });self.postMessage({type:'ready'});
    }catch(e){self.postMessage({type:'error',message:'分析模型無法載入，請檢查網絡或改用電腦 Chrome。錄影不受影響。'});}
  }
  if(data.type==='frame'){
    let detection;
    try{
      detector.detectForVideo(data.bitmap,data.time,output=>{
      detection=output;
      const result=tracker.update(detection.landmarks,data.sampleTime??data.time,[],appearanceDescriptors(data.bitmap,detection.landmarks));
      // Use the same whole-body rectangle that the user sees, including
      // hips, shoulders and hands during seat/front/back landings.
      const poseIndex=detection.landmarks.indexOf(result.selected?.pose);
      const box=poseIndex>=0?silhouetteBox(detection.segmentationMasks?.[poseIndex],result.selected.pose):null;
      const complete=!!box;
      const valid=complete&&!!box&&[box.x,box.y,box.right,box.bottom].every(Number.isFinite)&&box.x>=0&&box.y>=0&&box.right<=1&&box.bottom<=1;
      self.postMessage({type:'sample',time:data.time,sampleTime:data.sampleTime,revision:data.revision,
        landmarks:result.selected?.pose?.map(p=>({x:p.x,y:p.y,visibility:p.visibility}))||[],
        people:result.people.map(c=>c===result.selected&&box?box:c.box),selected:complete?box:null,locked:result.locked,
        y:valid?box.bottom:null,bodyY:valid?result.selected.hipY:null,
        message:!result.locked?'請點選正在跳的運動員':!valid?'所選運動員追蹤未確認，保留本套；不自動轉跟旁人':'持續追蹤已選運動員'});
      });
    }catch(e){self.postMessage({type:'sample',time:data.time,sampleTime:data.sampleTime,revision:data.revision,people:[],selected:null,locked:!!tracker.target,y:null,bodyY:null,message:'暫時無法辨識，保留本套並等待接續'});}
    finally{detection?.segmentationMasks?.forEach(m=>m.close());data.bitmap.close();}
  }
};
