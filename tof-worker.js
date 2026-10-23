importScripts('tof-athlete-tracker.js?v=strict-line-20261023');
let detector;const tracker=new AthleteTracker();
self.onmessage=async({data})=>{
  if(data.type==='select'){tracker.select(data.point);return;}
  if(data.type==='init'){
    try{
      const {FilesetResolver,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
      detector=await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},
        canvas:new OffscreenCanvas(256,256),runningMode:'VIDEO',numPoses:6,
        minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45,
      });self.postMessage({type:'ready'});
    }catch(e){self.postMessage({type:'error',message:'分析模型無法載入，請檢查網絡或改用電腦 Chrome。錄影不受影響。'});}
  }
  if(data.type==='frame'){
    try{
      const result=tracker.update(detector.detectForVideo(data.bitmap,data.time).landmarks,data.sampleTime??data.time);
      const p=result.selected?.pose;
      const foot=ids=>{
        const points=p?ids.map(i=>p[i]).filter(v=>v&&v.visibility>=.5&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&v.x>=0&&v.x<=1&&v.y>=0&&v.y<=1):[];
        if(points.length<2)return null;
        points.sort((a,b)=>a.y-b.y);
        if(points[points.length-1].y-points[0].y>.12)return null;
        return points[Math.floor(points.length/2)];
      };
      const left=foot([27,29,31]),right=foot([28,30,32]);
      const valid=!!left&&!!right;
      self.postMessage({type:'sample',time:data.time,sampleTime:data.sampleTime,revision:data.revision,
        people:result.people.map(c=>c.box),selected:result.selected?.box||null,locked:result.locked,
        feet:valid?[{x:left.x,y:left.y},{x:right.x,y:right.y}]:[],y:valid?Math.max(left.y,right.y):null,bodyY:valid?result.selected.hipY:null,
        message:!result.locked?'請點選正在跳的運動員':!valid?'暫時未看清運動員，保留本套並等待接續':'持續追蹤已選運動員'});
    }catch(e){self.postMessage({type:'sample',time:data.time,sampleTime:data.sampleTime,revision:data.revision,people:[],selected:null,locked:!!tracker.target,y:null,bodyY:null,message:'暫時無法辨識，保留本套並等待接續'});}
    finally{data.bitmap.close();}
  }
};
