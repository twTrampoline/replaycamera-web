(function(root){
  class FlightCounter {
    constructor(line=0.8){this.line=line;this.reset();}
    reset(){this.results=[];this.details=[];this.peak=Infinity;this.ascent=0;this.phase='idle';this.previous=null;this.candidate=null;this.takeoff=null;this.error='';this.airTime=0;}
    start(){this.reset();this.phase='ground';}
    stop(reason='已停止'){this.phase='stopped';this.error=reason;}
    sample(t,y,bodyY=y){
      if(!['ground','ready','air'].includes(this.phase))return;
      if(!Number.isFinite(y)){if(this.previous&&t-this.previous.t>300)this.stop('人體追蹤中斷，請重新開始整套動作');return;}
      if(!Number.isFinite(t))return;
      const p=this.previous;
      if(p&&t<=p.t)return;
      if(p&&t-p.t>300){this.stop('取樣中斷，請重新開始整套動作');return;}
      const above=y<this.line;
      const crossing=p&&((p.y<this.line)!==above)&&p.y!==y ? p.t+(t-p.t)*(this.line-p.y)/(y-p.y) : t;
      let airborne=0;
      if(p){const wasAbove=p.y<this.line;airborne=wasAbove&&above?t-p.t:wasAbove?crossing-p.t:above?t-crossing:0;}
      this.previous={t,y};
      if(this.phase==='ground'){
        if(!above){if(this.candidate===null)this.candidate=t;if(t-this.candidate>=200){this.phase='ready';this.candidate=null;}}
        else this.candidate=null;
        return;
      }
      if(this.phase==='ready'){
        if(above){if(this.candidate===null){this.candidate=crossing;this.airTime=0;this.peak=Infinity;this.ascent=0;}this.airTime+=airborne;this.trackPeak(bodyY);if(t-this.candidate>=70){this.takeoff=this.candidate;this.phase='air';this.candidate=null;}}
        else this.candidate=null;
        return;
      }
      this.airTime+=airborne;
      if(above)this.trackPeak(bodyY);
      if(t-this.takeoff>5000){this.stop('騰空時間異常，請檢查基準線並重新開始');return;}
      if(!above){
        if(this.candidate===null)this.candidate=crossing;
        if(t-this.candidate>=70){
          const seconds=this.airTime/1000;
          if(seconds>=0.15){this.results.push(seconds);this.details.push({ascent:this.ascent/1000,descent:(this.airTime-this.ascent)/1000,air:seconds});}
          this.phase=this.results.length===10?'complete':'ready';this.candidate=null;this.takeoff=null;
        }
      } else this.candidate=null;
    }
    trackPeak(y){if(Number.isFinite(y)&&y<this.peak){this.peak=y;this.ascent=this.airTime;}}
    get total(){return this.results.reduce((a,b)=>a+b,0);}
  }
  root.FlightCounter=FlightCounter;
  if(typeof module!=='undefined')module.exports=FlightCounter;
})(typeof window!=='undefined'?window:globalThis);
