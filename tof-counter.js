(function(root){
  class FlightCounter {
    constructor(line=.8){this.line=line;this.reset();}
    reset(){this.missingSegments=0;this.routineStart=null;this.uncertain=false;this.notice='';this.results=[];this.details=[];this.peak=Infinity;this.ascent=0;this.phase='idle';this.previous=null;this.lastInput=-Infinity;this.lastSeen=null;this.takeoff=null;this.error='';this.airTime=0;}
    start(){this.reset();this.phase='ground';}
    stop(reason='已停止'){this.phase='stopped';this.error=reason;}
    sample(t,y,bodyY=y){
      if(!['ground','ready','air'].includes(this.phase)||!Number.isFinite(t)||t<=this.lastInput)return;
      this.lastInput=t;
      if(!Number.isFinite(y)||y<0||y>1){this.previous=null;this.notice='未能確認人物框底邊：不補算時間，保留已記錄動作';if(this.phase==='air')this.uncertain=true;else if(this.details.length)this.details[this.details.length-1].bedEstimated=true;return;}
      let p=this.previous;
      const gap=this.lastSeen!==null?t-this.lastSeen:0;
      this.lastSeen=t;this.previous={t,y};
      if(gap>250){p=null;if(this.phase==='air')this.uncertain=true;else if(this.details.length)this.details[this.details.length-1].bedEstimated=true;}
      const above=y<this.line; // Image y grows downwards. Equality is NOT airborne.
      this.notice=gap>250?'取樣不足，這段不補算；可用上傳影片逐格核對':'';
      if(!p){
        if(this.phase==='air'){
          this.uncertain=true;
          if(!above){this.finish(t);}
        }else if(this.phase==='ready'&&above){
          // A confirmed bed contact survives missing frames. We know takeoff
          // happened, but cannot invent its exact time or missing duration.
          this.beginFlight(t,0,bodyY,true);
        }else if(!above)this.phase='ready';
        return; // Never interpolate across an unobserved interval.
      }
      const wasAbove=p.y<this.line;
      const crossing=wasAbove!==above&&p.y!==y?p.t+(t-p.t)*(this.line-p.y)/(y-p.y):t;
      const airborne=wasAbove&&above?t-p.t:wasAbove?crossing-p.t:above?t-crossing:0;
      if(this.phase==='ground'){if(!above)this.phase='ready';return;}
      if(this.phase==='ready'){
        if(this.details.length)this.details[this.details.length-1].bed+=(t-p.t-airborne)/1000;
        if(above&&!wasAbove)this.beginFlight(crossing,airborne,bodyY,false);
        return;
      }
      this.airTime+=airborne;
      if(this.routineStart===null&&this.airTime>=150)this.routineStart=this.takeoff;
      if(above)this.trackPeak(bodyY);
      if(!above){this.finish(t);if(this.phase!=='complete'&&this.details.length)this.details[this.details.length-1].bed+=(t-crossing)/1000;return;}
      if(t-this.takeoff>5000){this.uncertain=true;this.notice='未確認下一次着網，保留目前動作；請核對人物框及基準線';}
    }
    beginFlight(t,observed,bodyY,uncertain){this.phase='air';this.takeoff=t;this.airTime=observed;this.peak=Infinity;this.ascent=0;this.uncertain=uncertain;this.trackPeak(bodyY);}
    finish(t){
      if(this.airTime>=150||(this.uncertain&&t-this.takeoff>=150)){if(this.routineStart===null)this.routineStart=this.takeoff;const air=this.airTime/1000;this.results.push(air);this.details.push({ascent:this.ascent/1000,descent:(this.airTime-this.ascent)/1000,air,bed:0,bedEstimated:false,estimated:this.uncertain});}
      else if(this.uncertain)this.missingSegments++;
      this.phase=this.results.length===10?'complete':'ready';this.takeoff=null;
    }
    trackPeak(y){if(Number.isFinite(y)&&y<this.peak){this.peak=y;this.ascent=this.airTime;}}
    get bedTotal(){return this.details.reduce((sum,d)=>sum+d.bed,0);}
    get total(){return this.results.reduce((a,b)=>a+b,0);}
  }
  root.FlightCounter=FlightCounter;if(typeof module!=='undefined')module.exports=FlightCounter;
})(typeof window!=='undefined'?window:globalThis);
