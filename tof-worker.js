importScripts('tof-athlete-tracker.js?v=silhouette-bed-20261023');
// Extract only the selected person's connected silhouette, not a torso-only
// landmark envelope. Ignore detached mask noise and other people's components.
function silhouetteBox(mask,pose){
 if(!mask)return null;
 const w=mask.width,h=mask.height,a=mask.getAsFloat32Array();
 const torso=[11,12,23,24].map(i=>pose[i]).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
 if(!torso.length)return null;
 const cx=torso.reduce((s,p)=>s+p.x,0)/torso.length*w,cy=torso.reduce((s,p)=>s+p.y,0)/torso.length*h;
 let seed=-1,best=Infinity;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(a[i]>.5){const d=(x-cx)**2+(y-cy)**2;if(d<best){best=d;seed=i;}}}
 if(seed<0||best>(Math.max(w,h)*.15)**2)return null;
 const seen=new Uint8Array(a.length),q=[seed];seen[seed]=1;let left=w,right=0,top=h,bottom=0;
 for(let k=0;k<q.length;k++){const i=q[k],x=i%w,y=Math.floor(i/w);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(j>=0&&!seen[j]&&a[j]>.5){seen[j]=1;q.push(j);}}
 if(q.length<8)return null;
 return {x:left/w,y:top/h,right:(right+1)/w,bottom:(bottom+1)/h};
}
let detector;const tracker=new AthleteTracker();
self.onmessage=async({data})=>{
  if(data.type==='select'){tracker.select(data.point);return;}
  if(data.type==='init'){
    try{
      const {FilesetResolver,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
      detector=await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},
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
      const silhouettes=detection.landmarks.map((p,i)=>silhouetteBox(detection.segmentationMasks?.[i],p));
      const result=tracker.update(detection.landmarks,data.sampleTime??data.time,silhouettes);
      // Use the same whole-body rectangle that the user sees, including
      // hips, shoulders and hands during seat/front/back landings.
      const box=result.selected?.box;
      const poseIndex=detection.landmarks.indexOf(result.selected?.pose);
      const complete=!!silhouettes[poseIndex];
      const valid=complete&&!!box&&[box.x,box.y,box.right,box.bottom].every(Number.isFinite)&&box.x>=0&&box.y>=0&&box.right<=1&&box.bottom<=1;
      self.postMessage({type:'sample',time:data.time,sampleTime:data.sampleTime,revision:data.revision,
        people:result.people.map(c=>c.box),selected:complete?box:null,locked:result.locked,
        y:valid?box.bottom:null,bodyY:valid?result.selected.hipY:null,
        message:!result.locked?'請點選正在跳的運動員':!valid?'暫時未看清運動員，保留本套並等待接續':'持續追蹤已選運動員'});
      });
    }catch(e){self.postMessage({type:'sample',time:data.time,sampleTime:data.sampleTime,revision:data.revision,people:[],selected:null,locked:!!tracker.target,y:null,bodyY:null,message:'暫時無法辨識，保留本套並等待接續'});}
    finally{detection?.segmentationMasks?.forEach(m=>m.close());data.bitmap.close();}
  }
};
