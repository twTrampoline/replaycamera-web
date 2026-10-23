(function(root){
  class FlightCounter {
    constructor(line=.8){this.line=line;this.reset();}
    reset(){this.missingSegments=0;this.routineStart=null;this.uncertain=false;this.notice='';this.results=[];this.details=[];this.peak=Infinity;this.ascent=0;this.phase='idle';this.previous=null;this.lastInput=-Infinity;this.lastSeen=null;this.takeoff=null;this.error='';this.airTime=0;}
    start(){this.reset();this.phase='ground';}
    stop(reason='已停止'){this.phase='stopped';this.error=reason;}
    sample(t,y,bodyY=y){
      if(!['ground','ready','air'].includes(this.phase)||!Number.isFinite(t)||t<=this.lastInput)return;
      this.lastInput=t;
      if(!Number.isFinite(y)||y<0||y>1){this.previous=null;this.notice='未能確認腳部位置：不補算時間，保留已記錄動作';if(this.phase==='air')this.uncertain=true;return;}
      let p=this.previous;
      const gap=this.lastSeen!==null?t-this.lastSeen:0;
      this.lastSeen=t;this.previous={t,y};
      if(gap>250){p=null;if(this.phase==='air')this.uncertain=true;}
      const above=y<this.line; // Image y grows downwards. Equality is NOT airborne.
      this.notice=gap>250?'取樣不足，這段不補算；可用上傳影片逐格核對':'';
      if(!p){
        if(this.phase==='air'){
          this.uncertain=true;
          if(!above||gap>1200){this.finish();if(this.phase!=='complete')this.phase=above?'ground':'ready';}
        }else this.phase=above?'ground':'ready';
        return; // Never interpolate across an unobserved interval.
      }
      const wasAbove=p.y<this.line;
      const crossing=wasAbove!==above&&p.y!==y?p.t+(t-p.t)*(this.line-p.y)/(y-p.y):t;
      const airborne=wasAbove&&above?t-p.t:wasAbove?crossing-p.t:above?t-crossing:0;
      if(this.phase==='ground'){if(!above)this.phase='ready';return;}
      if(this.phase==='ready'){
        if(above&&!wasAbove){this.phase='air';this.takeoff=crossing;this.airTime=airborne;this.peak=Infinity;this.ascent=0;this.uncertain=false;this.trackPeak(bodyY);}
        return;
      }
      this.airTime+=airborne;
      if(this.routineStart===null&&this.airTime>=150)this.routineStart=this.takeoff;
      if(above)this.trackPeak(bodyY);
      if(!above){this.finish();return;}
      if(t-this.takeoff>5000){this.uncertain=true;this.finish();if(this.phase!=='complete')this.phase='ground';this.notice='長時間未見落線，請檢查黃線位置；未確認完整一跳';}
    }
    finish(){
      if(this.airTime>=150){const air=this.airTime/1000;this.results.push(air);this.details.push({ascent:this.ascent/1000,descent:(this.airTime-this.ascent)/1000,air,estimated:this.uncertain});}
      if(this.uncertain&&this.airTime<150)this.missingSegments++;
      this.phase=this.results.length===10?'complete':'ready';this.takeoff=null;
    }
    trackPeak(y){if(Number.isFinite(y)&&y<this.peak){this.peak=y;this.ascent=this.airTime;}}
    get total(){return this.results.reduce((a,b)=>a+b,0);}
  }
  root.FlightCounter=FlightCounter;if(typeof module!=='undefined')module.exports=FlightCounter;
})(typeof window!=='undefined'?window:globalThis);
