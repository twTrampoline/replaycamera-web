// Remove isolated segmentation speckles, but retain disconnected limbs.
// Work in mask coordinates; no timing threshold or baseline-dependent filtering.
(function(root){
 function bodyMask(low,size){
  const seen=new Uint8Array(low.length),queue=new Int32Array(low.length),parts=[];
  for(let seed=0;seed<low.length;seed++){
   if(seen[seed]||!(low[seed]>0))continue;
   let head=0,tail=1;queue[0]=seed;seen[seed]=1;
   let left=size,top=size,right=0,bottom=0;
   while(head<tail){const p=queue[head++],x=p%size,y=Math.floor(p/size);left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=size||yy>=size)continue;const j=yy*size+xx;if(!seen[j]&&low[j]>0){seen[j]=1;queue[tail++]=j;}}
   }
   parts.push({left,top,right,bottom,area:tail});
  }
  const largest=Math.max(0,...parts.map(p=>p.area));if(largest<3)return null;
  const kept=parts.filter(p=>p.area>=Math.max(3,largest*.05));
  return {x:Math.min(...kept.map(p=>p.left))/size,y:Math.min(...kept.map(p=>p.top))/size,right:Math.max(...kept.map(p=>p.right))/size,bottom:Math.max(...kept.map(p=>p.bottom))/size};
 }
 root.tofBodyMask=bodyMask;if(typeof module!=='undefined')module.exports=bodyMask;
})(typeof self!=='undefined'?self:globalThis);
