function cropValues(image,crop,size){
  const scale=(size/Math.min(image.naturalWidth,image.naturalHeight))*(crop.zoom/100);
  const sw=size/scale,sh=size/scale,maxX=Math.max(0,image.naturalWidth-sw),maxY=Math.max(0,image.naturalHeight-sh);
  return {sx:maxX*((crop.x+100)/200),sy:maxY*((crop.y+100)/200),sw,sh};
}

export function createCroppedCanvas(image,crop){
  const size=600,source=document.createElement('canvas');
  source.width=size;source.height=size;
  const context=source.getContext('2d',{willReadFrequently:true});
  const {sx,sy,sw,sh}=cropValues(image,crop,size);
  context.fillStyle='#fff';context.fillRect(0,0,size,size);
  context.drawImage(image,sx,sy,sw,sh,0,0,size,size);
  return source;
}

export function drawOriginal(source,canvas){
  canvas.width=source.width;canvas.height=source.height;
  canvas.getContext('2d').drawImage(source,0,0);
}

let activeWorker=null;
let rejectActive=null;
let requestId=0;

function drawSmoothPath(context,points){
  if(points.length<2)return;
  context.beginPath();
  context.moveTo(points[0].x,points[0].y);
  if(points.length===2){context.lineTo(points[1].x,points[1].y)}
  else{
    for(let i=1;i<points.length-1;i++){
      const x=(points[i].x+points[i+1].x)/2,y=(points[i].y+points[i+1].y)/2;
      context.quadraticCurveTo(points[i].x,points[i].y,x,y);
    }
    context.lineTo(points[points.length-1].x,points[points.length-1].y);
  }
  context.stroke();
}

export function drawOutline(source,canvas,settings,foregroundMask=null,faceData={paths:[],regions:[]}){
  const size=source.width;
  const pixels=source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,size,size);

  if(activeWorker){
    const oldWorker=activeWorker,oldReject=rejectActive;
    activeWorker=null;rejectActive=null;oldWorker.terminate();
    oldReject?.(new DOMException('A newer preview replaced this one.','AbortError'));
  }

  return new Promise((resolve,reject)=>{
    const id=++requestId,worker=new Worker(new URL('./image-processing-worker.js',import.meta.url));
    activeWorker=worker;rejectActive=reject;
    const finish=error=>{
      worker.terminate();
      if(activeWorker===worker){activeWorker=null;rejectActive=null}
      if(error)reject(error);else resolve();
    };
    worker.onmessage=event=>{
      if(event.data.id!==id)return;
      if(event.data.error){finish(new Error(event.data.error));return}
      try{
        canvas.width=size;canvas.height=size;
        const context=canvas.getContext('2d');
        context.fillStyle='#fff';context.fillRect(0,0,size,size);
        context.strokeStyle='#111';context.lineCap='round';context.lineJoin='round';
        context.lineWidth=Math.max(.8,Math.min(2.5,.62+settings.strength*.185));
        for(const points of event.data.paths||[])drawSmoothPath(context,points);
        finish();
      }catch(error){finish(error)}
    };
    worker.onerror=()=>finish(new Error('The drawing could not be generated. Please try another photo.'));
    const payload={id,pixels:pixels.data.buffer,size,detail:settings.detail,strength:settings.strength,style:settings.style||'classic',facePaths:faceData.paths||[],faceRegions:faceData.regions||[]};
    const transfer=[pixels.data.buffer];
    if(foregroundMask){
      payload.foregroundMask=new Float32Array(foregroundMask.data).buffer;
      payload.maskWidth=foregroundMask.width;
      payload.maskHeight=foregroundMask.height;
      transfer.push(payload.foregroundMask);
    }
    worker.postMessage(payload,transfer);
  });
}
