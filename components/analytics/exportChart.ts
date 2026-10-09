/** Export the displayed SVG with its computed styles, including theme colors. */
export async function exportAnalysisChart(svg: SVGElement | null, filename: string) {
  if (!svg) throw new Error('No chart to export');
  const bounds=svg.getBoundingClientRect();
  if (!bounds.width || !bounds.height) throw new Error('Empty chart');
  const clone=svg.cloneNode(true) as SVGElement;
  const originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  const properties=['fill','stroke','stroke-width','stroke-dasharray','opacity','fill-opacity','stroke-opacity','font-family','font-size','font-weight','text-anchor','paint-order','text-decoration'];
  originals.forEach((element,i)=>{
    const style=getComputedStyle(element);
    for(const property of properties) copies[i].setAttribute(property,style.getPropertyValue(property));
  });
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  clone.setAttribute('width',String(bounds.width));clone.setAttribute('height',String(bounds.height));
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}));
  try {
    const image=new Image();
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Could not render chart'));image.src=url;});
    const scale=Math.min(2,8192/bounds.width,8192/bounds.height,Math.sqrt(24_000_000/(bounds.width*bounds.height)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bounds.width*scale));canvas.height=Math.max(1,Math.round(bounds.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');
    context.scale(scale,scale);context.fillStyle=getComputedStyle(svg.closest('.discussion-analysis')??svg).getPropertyValue('--da-panel').trim()||'#ffffff';context.fillRect(0,0,bounds.width,bounds.height);context.drawImage(image,0,0,bounds.width,bounds.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not encode chart')),'image/png'));
    const downloadUrl=URL.createObjectURL(blob);
    try{const link=document.createElement('a');link.href=downloadUrl;link.download=filename;link.click();}finally{setTimeout(()=>URL.revokeObjectURL(downloadUrl),1000);}
  } finally {URL.revokeObjectURL(url);}
}
