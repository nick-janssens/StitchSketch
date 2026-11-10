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

export function drawOutline(source,canvas,settings,foregroundMask=null){
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
      try{
        canvas.width=size;canvas.height=size;
        const output=new ImageData(new Uint8ClampedArray(event.data.pixels),size,size);
        canvas.getContext('2d').putImageData(output,0,0);
        finish();
      }catch(error){finish(error)}
    };
    worker.onerror=()=>finish(new Error('The drawing could not be generated. Please try another photo.'));
    const payload={id,pixels:pixels.data.buffer,size,detail:settings.detail,strength:settings.strength};
    const transfer=[pixels.data.buffer];
    if(foregroundMask){
      payload.foregroundMask=foregroundMask.data.buffer;
      payload.maskWidth=foregroundMask.width;
      payload.maskHeight=foregroundMask.height;
      transfer.push(foregroundMask.data.buffer);
    }
    worker.postMessage(payload,transfer);
  });
}
