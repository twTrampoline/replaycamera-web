let detector;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    try{
      const {FilesetResolver,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
      detector=await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},
        canvas:new OffscreenCanvas(256,256),runningMode:'VIDEO',numPoses:2,
        minPoseDetectionConfidence:0.6,minPosePresenceConfidence:0.6,minTrackingConfidence:0.6,
      });
      self.postMessage({type:'ready'});
    }catch(e){self.postMessage({type:'error',message:'分析模型無法載入，請檢查網絡或改用電腦 Chrome。錄影不受影響。'});}
  }
  if(data.type==='frame'){
    try{
      const result=detector.detectForVideo(data.bitmap,data.time);
      const people=result.landmarks;
      const feet=people.length===1?[27,28,29,30,31,32].map(i=>people[0][i]):[];
      const valid=feet.length&&feet.every(p=>(p.visibility??0)>0.6&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);
      const hips=people.length===1?[people[0][23],people[0][24]]:[];
      const hipsValid=hips.length&&hips.every(p=>(p.visibility??0)>0.6);
      const usable=valid&&hipsValid;
      self.postMessage({type:'sample',time:data.time,revision:data.revision,ambiguous:people.length>1,y:usable?Math.max(...feet.map(p=>p.y)):null,bodyY:usable?(hips[0].y+hips[1].y)/2:null,
        message:people.length>1?'選取範圍內有多個人，請重新框選運動員':usable?'追蹤中':'請確保全身及雙腳清晰入鏡'});
    }catch(e){self.postMessage({type:'error',message:'此裝置無法執行即時人體分析。錄影不受影響。'});}
    finally{data.bitmap.close();}
  }
};
