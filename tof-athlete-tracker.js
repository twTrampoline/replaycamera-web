// Geometry-based continuity tracking. Never use pose-array order as identity.
(function(root){
class AthleteTracker {
  constructor(){this.target=null;this.pending=null;this.lastTime=0;this.reference=null;this.bystanders=[];}
  select(point){this.pending=point;this.target=null;this.reference=null;this.bystanders=[];}
  candidates(poses,bodyBoxes=[],appearances=[]){return poses.map((p,index)=>{
    const torso=[11,12,23,24].map(i=>p[i]).filter(v=>v&&v.visibility>=.45&&Number.isFinite(v.x)&&Number.isFinite(v.y));
    const hips=[23,24].map(i=>p[i]).filter(v=>v&&v.visibility>=.45&&Number.isFinite(v.x)&&Number.isFinite(v.y));
    if(torso.length<3||!hips.length)return null;
    const points=p.filter(v=>v.visibility>=.45&&Number.isFinite(v.x)&&Number.isFinite(v.y));
    const x=torso.reduce((a,v)=>a+v.x,0)/torso.length,y=torso.reduce((a,v)=>a+v.y,0)/torso.length;
    const hipY=hips.reduce((a,v)=>a+v.y,0)/hips.length;
    let spread=0,pairs=0;for(let i=0;i<torso.length;i++)for(let j=i+1;j<torso.length;j++){spread+=Math.hypot(torso[i].x-torso[j].x,torso[i].y-torso[j].y);pairs++;}
    return {pose:p,appearance:appearances[index]||null,x,y,hipY,size:Math.max(.035,spread/pairs),box:bodyBoxes[index]||{x:Math.min(...points.map(v=>v.x)),y:Math.min(...points.map(v=>v.y)),right:Math.max(...points.map(v=>v.x)),bottom:Math.max(...points.map(v=>v.y))}};
  }).filter(Boolean);}
  update(poses,t,bodyBoxes=[],appearances=[]){
    const people=this.candidates(poses,bodyBoxes,appearances);let chosen=null;
    if(this.pending){
      const p=this.pending;
      const hits=people.filter(c=>p.x>=c.box.x-.03&&p.x<=c.box.right+.03&&p.y>=c.box.y-.03&&p.y<=c.box.bottom+.03).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
      if(hits.length===1||(hits.length>1&&Math.hypot(hits[1].x-p.x,hits[1].y-p.y)-Math.hypot(hits[0].x-p.x,hits[0].y-p.y)>.08)){chosen=hits[0];this.pending=null;this.reference={size:chosen.size,appearance:chosen.appearance};this.bystanders=people.filter(c=>c!==chosen).map(c=>({x:c.x,y:c.y,size:c.size}));}
    } else if(this.target){
      const old=this.target,dt=Math.min(.25,Math.max(0,(t-this.lastTime)/1000));
      const px=old.x+old.vx*dt,py=old.y+old.vy*dt;
      const age=Math.max(0,(t-this.lastTime)/1000),reference=this.reference||old;
      const ranked=people.map(c=>{
        const distance=Math.hypot((c.x-px)*2,c.y-py);
        const ratio=c.size/reference.size;
        const appearance=appearanceDistance(reference.appearance,c.appearance);
        // Keep the original selected identity anchor, rather than adapting
        // indefinitely until a nearby coach becomes the new reference.
        const knownBystander=this.bystanders.some(b=>Math.hypot(c.x-b.x,c.y-b.y)<.04&&Math.abs(Math.log(c.size/b.size))<.25);
        const valid=ratio>=.5&&ratio<=2&&Math.abs(c.x-old.x)<.14&&distance<Math.min(.32,.10+age*1.2)&&
          (appearance===null||appearance<.62)&&!(knownBystander&&appearance===null&&distance>.045)&&
          (age<=1.2||(appearance!==null&&appearance<.3&&distance<.12));
        return {c,score:distance+Math.abs(Math.log(c.size/old.size))*.12+(appearance??0)*.35,valid};
      }).filter(r=>r.valid).sort((a,b)=>a.score-b.score);
      if(ranked.length&&(!ranked[1]||ranked[1].score-ranked[0].score>.1))chosen=ranked[0].c;
    }
    if(chosen){
      const old=this.target,dt=Math.max(.05,(t-this.lastTime)/1000);
      this.target={...chosen,vx:old?Math.max(-1,Math.min(1,(chosen.x-old.x)/dt)):0,vy:old?Math.max(-3,Math.min(3,(chosen.y-old.y)/dt)):0};this.lastTime=t;
    }
    return {people,selected:chosen,locked:!!this.target};
  }
}
function appearanceDistance(a,b){if(!a||!b||a.length!==b.length)return null;let overlap=0;for(let i=0;i<a.length;i++)overlap+=Math.sqrt(a[i]*b[i]);return Math.sqrt(Math.max(0,1-Math.min(1,overlap)));}
AthleteTracker.appearanceDistance=appearanceDistance;
root.AthleteTracker=AthleteTracker;if(typeof module!=='undefined')module.exports=AthleteTracker;
})(typeof self!=='undefined'?self:globalThis);
