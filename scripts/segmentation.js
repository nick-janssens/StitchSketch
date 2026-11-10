let segmenterPromise=null;

async function createSegmenter(){
  const {FilesetResolver,ImageSegmenter}=await import('../assets/mediapipe/vision_bundle.mjs');
  const wasm=await FilesetResolver.forVisionTasks(new URL('../assets/mediapipe/wasm/',import.meta.url).href);
  return ImageSegmenter.createFromOptions(wasm,{
    baseOptions:{
      modelAssetPath:new URL('../assets/mediapipe/selfie_segmenter.tflite',import.meta.url).href,
      delegate:'CPU'
    },
    runningMode:'IMAGE',
    outputCategoryMask:false,
    outputConfidenceMasks:true
  });
}

export async function segmentPerson(sourceCanvas){
  if(!segmenterPromise){
    segmenterPromise=createSegmenter().catch(error=>{segmenterPromise=null;throw error});
  }
  const segmenter=await segmenterPromise;
  return new Promise((resolve,reject)=>{
    try{
      segmenter.segment(sourceCanvas,result=>{
        try{
          const person=result.confidenceMasks&&result.confidenceMasks[1];
          if(!person)throw new Error('The person mask was not returned.');
          const data=new Float32Array(person.getAsFloat32Array());
          let foreground=0;
          for(let i=0;i<data.length;i++)if(data[i]>=0.45)foreground++;
          if(foreground<data.length*0.002)throw new Error('No person was detected. Uncheck background removal to include all lines.');
          resolve({data,width:person.width,height:person.height});
        }catch(error){reject(error)}
      });
    }catch(error){reject(error)}
  });
}
