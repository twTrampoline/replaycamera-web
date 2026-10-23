(function(root){
  class FlightCounter {
    constructor(line=0.8){this.line=line;this.reset();}
    reset(){this.routineStart=null;this.uncertain=false;this.notice='';this.results=[];this.details=[];this.peak=Infinity;this.ascent=0;this.phase='idle';this.previous=null;this.candidate=null;this.takeoff=null;this.error='';this.airTime=0;}
    start(){this.reset();this.phase='ground';}
    stop(reason='已停止'){this.phase='stopped';this.error=reason;}
    sample(t,y,bodyY=y){
      if(!['ground','ready','air'].includes(this.phase))return;
      if(!Number.isFinite(y)){this.notice='暫時遮擋：保留本套，等待接續';this.uncertain=true;return;}
      if(!Number.isFinite(t))return;
      const p=this.previous;
      if(p&&t<=p.t)return;
      if(p&&t-p.t>1200){this.recoverGap();this.previous={t,y};this.phase=this.results.length===10?'complete':y>=this.line?'ready':'ground';return;}
      this.notice='';
      if(p&&t-p.t>150)this.uncertain=true;
      const above=y<this.line;
      const crossing=p&&((p.y<this.line)!==above)&&p.y!==y ? p.t+(t-p.t)*(this.line-p.y)/(y-p.y) : t;
      let airborne=0;
      if(p){const wasAbove=p.y<this.line;airborne=wasAbove&&above?t-p.t:wasAbove?crossing-p.t:above?t-crossing:0;}
      this.previous={t,y};
      if(this.phase==='ground'){
        if(!above){this.phase='ready';this.candidate=null;}
        else this.candidate=null;
        return;
      }
      if(this.phase==='ready'){
        if(above){if(this.candidate===null){this.candidate=crossing;this.airTime=0;this.peak=Infinity;this.ascent=0;this.uncertain=false;}this.airTime+=airborne;this.trackPeak(bodyY);if(t-this.candidate>=0){this.takeoff=this.candidate;this.phase='air';this.candidate=null;}}
        else this.candidate=null;
        return;
      }
      this.airTime+=airborne;
      if(this.routineStart===null&&this.airTime>=150)this.routineStart=this.takeoff;
      if(above)this.trackPeak(bodyY);
      if(t-this.takeoff>5000){this.recoverGap();this.phase=this.results.length===10?'complete':'ground';return;}
      if(!above){
        if(this.candidate===null)this.candidate=crossing;
        if(t-this.candidate>=0){
          const seconds=this.airTime/1000;
          if(seconds>=0.15){this.results.push(seconds);this.details.push({ascent:this.ascent/1000,descent:(this.airTime-this.ascent)/1000,air:seconds,estimated:this.uncertain});}
          this.phase=this.results.length===10?'complete':'ready';this.candidate=null;this.takeoff=null;
        }
      } else this.candidate=null;
    }
    recoverGap(){if(this.phase==='air'){this.results.push(null);this.details.push({ascent:null,descent:null,air:null,estimated:true});}this.candidate=null;this.takeoff=null;this.previous=null;this.notice='已接續；遮擋期間的動作時間未確認，總和只計可用時間';}
    trackPeak(y){if(Number.isFinite(y)&&y<this.peak){this.peak=y;this.ascent=this.airTime;}}
    get total(){return this.results.reduce((a,b)=>a+b,0);}
  }
  root.FlightCounter=FlightCounter;
  if(typeof module!=='undefined')module.exports=FlightCounter;
})(typeof window!=='undefined'?window:globalThis);
