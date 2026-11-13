import {PDFDocument,PDFPage,rgb,PDFFont} from 'pdf-lib';
export interface PackageBranding{brandColor?:string;footerText?:string;signatoryName?:string;signatoryDesignation?:string;logo?:{bytes:Uint8Array;mimeType:string};}
export function brandingColour(value:unknown){const hex=typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value)?value:'#0F2942';return rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);}
function safeText(value:string,max:number){return value.replace(/[^\x20-\x7e]/g,' ').replace(/[<>\\]/g,'').trim().slice(0,max);}
export async function drawPackageBranding(doc:PDFDocument,cover:PDFPage,font:PDFFont,branding?:PackageBranding){
 if(!branding)return;
 const {height}=cover.getSize();
 if(branding.logo){
  const bytes=Buffer.from(branding.logo.bytes);if(bytes.length>2097152)throw new Error('PACKAGE_LOGO_TOO_LARGE');
  if(branding.logo.mimeType==='image/png'){
   if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||
    bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16777216)throw new Error('PACKAGE_LOGO_DIMENSIONS_INVALID');
  }
  const image=branding.logo.mimeType==='image/png'?await doc.embedPng(bytes):branding.logo.mimeType==='image/jpeg'?await doc.embedJpg(bytes):null;
  if(!image||image.width*image.height>16777216)throw new Error('PACKAGE_LOGO_FORMAT_INVALID');
  const scale=Math.min(70/image.width,35/image.height);cover.drawImage(image,{x:470,y:height-78,width:image.width*scale,height:image.height*scale});
 }
 if(branding.footerText){const value=safeText(branding.footerText,180);for(let i=0;i<2;i++)cover.drawText(value.slice(i*90,(i+1)*90),{x:48,y:35-i*10,font,size:7,color:rgb(0.3,0.3,0.3)});}
 if(branding.signatoryName){cover.drawText(safeText('Prepared contact: '+branding.signatoryName+(branding.signatoryDesignation?' · '+branding.signatoryDesignation:''),90),{x:48,y:58,font,size:7,color:rgb(0.3,0.3,0.3)});}
}
