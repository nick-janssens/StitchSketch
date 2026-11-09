export async function saveDrawing(canvas,onStatus){
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('Could not prepare this image. Please try again.');
  const file=new File([blob],'StitchSketch.png',{type:'image/png'});
  if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:'StitchSketch drawing'});return 'shared';}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='StitchSketch.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  onStatus?.('The drawing was downloaded. Open it and use Share → Save Image to add it to Photos.');return 'downloaded';
}
