(function(root){
  class FlightCounter {
    constructor(line=.8){this.line=line;this.reset();}
    reset(){this.missingSegments=0;this.routineStart=null;this.routineEnd=null;this.uncertain=false;this.notice='';this.results=[];this.details=[];this.peak=Infinity;this.ascent=0;this.phase='idle';this.previous=null;this.lastInput=-Infinity;this.lastSeen=null;this.takeoff=null;this.error='';this.airTime=0;}
    start(){this.reset();this.phase='ground';}
    stop(reason='已停止'){this.phase='stopped';this.error=reason;}
    updateBed(t){const d=this.details[this.details.length-1];if(d&&this.phase==='ready')d.bed=Math.max(0,(t-d.landing)/1000);}
    sample(t,y,bodyY=y){
      if(!['ground','ready','air'].includes(this.phase)||!Number.isFinite(t)||t<=this.lastInput)return;
      this.lastInput=t;this.updateBed(t);
      if(!Number.isFinite(y)||y<0||y>1){this.previous=null;this.notice='追蹤缺失：時間持續推算，需逐格核對跨線位置';if(this.phase==='air')this.uncertain=true;else if(this.details.length)this.details[this.details.length-1].bedEstimated=true;return;}
      let p=this.previous;
      const gap=this.lastSeen!==null?t-this.lastSeen:0;
      this.lastSeen=t;this.previous={t,y};
      if(gap>250){p=null;if(this.phase==='air')this.uncertain=true;else if(this.details.length)this.details[this.details.length-1].bedEstimated=true;}
      const above=y<this.line;
      this.notice=gap>250?'取樣不足，跨線時間為推算，請核對':'';
      if(!p){
        if(this.phase==='air'){this.uncertain=true;if(!above)this.finish(t);}
        else if(this.phase==='ready'&&above)this.beginFlight(t,0,bodyY,true);
        else if(!above)this.phase='ready';
        return;
      }
      const wasAbove=p.y<this.line;
      const crossing=wasAbove!==above&&p.y!==y?p.t+(t-p.t)*(this.line-p.y)/(y-p.y):t;
      const airborne=wasAbove&&above?t-p.t:wasAbove?crossing-p.t:above?t-crossing:0;
      if(this.phase==='ground'){if(!above)this.phase='ready';return;}
      if(this.phase==='ready'){
        if(this.details.length)this.details[this.details.length-1].observedBed+=(t-p.t-airborne)/1000;
        if(above&&!wasAbove)this.beginFlight(crossing,airborne,bodyY,false);
        return;
      }
      this.airTime+=airborne;
      if(this.routineStart===null&&t-this.takeoff>=150)this.routineStart=this.takeoff;
      if(above)this.trackPeak(bodyY);
      if(!above){this.finish(crossing);if(this.phase!=='complete'){this.updateBed(t);if(this.details.length)this.details[this.details.length-1].observedBed+=(t-crossing)/1000;}return;}
      if(t-this.takeoff>5000){this.uncertain=true;this.notice='未確認下一次着網，保留目前動作；請核對人物框及基準線';}
    }
    beginFlight(t,observed,bodyY,uncertain){
      this.updateBed(t);this.phase='air';this.takeoff=t;this.airTime=observed;this.peak=Infinity;this.ascent=0;this.uncertain=uncertain;this.trackPeak(bodyY);
    }
    finish(t){
      const duration=t-this.takeoff;
      if(duration>=150){
        if(this.routineStart===null)this.routineStart=this.takeoff;
        const air=duration/1000,ascent=Math.min(air,this.ascent/1000);
        this.results.push(air);this.details.push({takeoff:this.takeoff,landing:t,ascent,descent:air-ascent,air,observedAir:Math.min(air,this.airTime/1000),bed:0,observedBed:0,bedEstimated:false,estimated:this.uncertain});
      }else {
        if(this.uncertain)this.missingSegments++;
        // Rejected tiny excursions belong to the preceding bed interval;
        // flag that classification instead of silently losing elapsed time.
        if(this.details.length)this.details[this.details.length-1].bedEstimated=true;
      }
      this.phase=this.results.length===10?'complete':'ready';
      if(this.phase==='complete')this.routineEnd=t;else this.updateBed(t);
      this.takeoff=null;
    }
    trackPeak(y){if(Number.isFinite(y)&&y<this.peak){this.peak=y;this.ascent=Math.max(0,this.lastInput-this.takeoff);}}
    get activeAir(){return this.phase==='air'?Math.max(0,(this.lastInput-this.takeoff)/1000):0;}
    get bedTotal(){return this.details.reduce((sum,d)=>sum+d.bed,0);}
    get total(){return this.results.reduce((a,b)=>a+b,0);}
    get timelineTotal(){return this.routineStart===null?0:Math.max(0,((this.routineEnd??this.lastInput)-this.routineStart)/1000);}
    get unverifiedTime(){const observed=this.details.reduce((s,d)=>s+d.observedAir+d.observedBed,0)+(this.phase==='air'?this.airTime/1000:0);return Math.max(0,this.timelineTotal-observed);}
  }
  root.FlightCounter=FlightCounter;if(typeof module!=='undefined')module.exports=FlightCounter;
})(typeof window!=='undefined'?window:globalThis);
