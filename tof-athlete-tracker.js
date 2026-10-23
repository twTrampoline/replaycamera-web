// Geometry-based continuity tracking. Never use pose-array order as identity.
(function(root){
class AthleteTracker {
  constructor(){this.target=null;this.pending=null;this.lastTime=0;}
  select(point){this.pending=point;this.target=null;}
  candidates(poses,bodyBoxes=[]){return poses.map((p,index)=>{
    const torso=[11,12,23,24].map(i=>p[i]).filter(v=>v&&v.visibility>=.45&&Number.isFinite(v.x)&&Number.isFinite(v.y));
    const hips=[23,24].map(i=>p[i]).filter(v=>v&&v.visibility>=.45&&Number.isFinite(v.x)&&Number.isFinite(v.y));
    if(torso.length<3||!hips.length)return null;
    const points=p.filter(v=>v.visibility>=.45&&Number.isFinite(v.x)&&Number.isFinite(v.y));
    const x=torso.reduce((a,v)=>a+v.x,0)/torso.length,y=torso.reduce((a,v)=>a+v.y,0)/torso.length;
    const hipY=hips.reduce((a,v)=>a+v.y,0)/hips.length;
    let spread=0,pairs=0;for(let i=0;i<torso.length;i++)for(let j=i+1;j<torso.length;j++){spread+=Math.hypot(torso[i].x-torso[j].x,torso[i].y-torso[j].y);pairs++;}
    return {pose:p,x,y,hipY,size:Math.max(.035,spread/pairs),box:bodyBoxes[index]||{x:Math.min(...points.map(v=>v.x)),y:Math.min(...points.map(v=>v.y)),right:Math.max(...points.map(v=>v.x)),bottom:Math.max(...points.map(v=>v.y))}};
  }).filter(Boolean);}
  update(poses,t,bodyBoxes=[]){
    const people=this.candidates(poses,bodyBoxes);let chosen=null;
    if(this.pending){
      const p=this.pending;
      const hits=people.filter(c=>p.x>=c.box.x-.03&&p.x<=c.box.right+.03&&p.y>=c.box.y-.03&&p.y<=c.box.bottom+.03).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
      if(hits.length===1||(hits.length>1&&Math.hypot(hits[1].x-p.x,hits[1].y-p.y)-Math.hypot(hits[0].x-p.x,hits[0].y-p.y)>.08)){chosen=hits[0];this.pending=null;}
    } else if(this.target){
      const old=this.target,dt=Math.min(.25,Math.max(0,(t-this.lastTime)/1000));
      const px=old.x+old.vx*dt,py=old.y+old.vy*dt;
      const ranked=people.map(c=>({c,score:Math.hypot((c.x-px)*2,c.y-py)+Math.abs(Math.log(c.size/old.size))*.12})).filter(({c,score})=>Math.abs(c.x-old.x)<.18&&Math.abs(c.y-old.y)<.5&&score<.55).sort((a,b)=>a.score-b.score);
      if(ranked.length&&(!ranked[1]||ranked[1].score-ranked[0].score>.1))chosen=ranked[0].c;
    }
    if(chosen){
      const old=this.target,dt=Math.max(.05,(t-this.lastTime)/1000);
      this.target={...chosen,vx:old?Math.max(-1,Math.min(1,(chosen.x-old.x)/dt)):0,vy:old?Math.max(-3,Math.min(3,(chosen.y-old.y)/dt)):0};this.lastTime=t;
    }
    return {people,selected:chosen,locked:!!this.target};
  }
}
root.AthleteTracker=AthleteTracker;if(typeof module!=='undefined')module.exports=AthleteTracker;
})(typeof self!=='undefined'?self:globalThis);
