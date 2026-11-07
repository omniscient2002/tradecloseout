const {createRequire}=require('node:module');
const requireApp=createRequire('/home/cassandra/tradecloseout/apps/api/package.json');
const {PDFDocument}=requireApp('pdf-lib');
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {compileHandoverDossierStreamingQpdf}=require('/home/cassandra/tradecloseout/apps/api/dist/apps/worker/src/queues/pdf-stream-compiler.js');
const {PackageBuilder}=require('/home/cassandra/tradecloseout/packages/pdf-engine/dist/package-builder.js');
(async()=>{
 const dir=await fs.mkdtemp('/tmp/tc-pdf-quality-');
 try {
  const src=await PDFDocument.create();src.addPage();const bytes=await src.save();const source=dir+'/source.pdf';await fs.writeFile(source,bytes);
  const input={packageId:'synthetic',versionNo:1,orgLegalName:'Synthetic Contractor',projectCode:'P1',projectName:'Synthetic Project',clientName:'Synthetic Client',contractRef:'C1',snapshotChecksum:'0'.repeat(64),generatedAtIst:'07 Nov 2026',requirementsIndex:[],sourceFiles:[{documentVersionId:'synthetic-source',sectionKey:'01',title:'Synthetic title',localPath:source,sha256:createHash('sha256').update(bytes).digest('hex')}]};
  try {await compileHandoverDossierStreamingQpdf({...input,orgLegalName:'शर्मा HVAC'},dir+'/unicode.pdf');console.log(JSON.stringify({probe:'unicode-contractor',result:'success'}));}catch(e){console.log(JSON.stringify({probe:'unicode-contractor',error:e.message}));}
  const rows=Array.from({length:50},(_,i)=>({itemId:'item'+i,documentTitle:'UNIQUE_ROW_'+String(i).padStart(3,'0'),docTypeKey:'MANUAL',revisionCode:'R0',issueDate:'2026-11-07',filePath:source,sortOrder:i,pageStart:i+3,pageEnd:i+3}));
  const header=await PackageBuilder.generateFrontMatterPdf({packageId:'synthetic',packageTitle:'Synthetic',projectCode:'P1',projectName:'Synthetic',clientName:'Synthetic',contractorName:'Synthetic',generatedAt:new Date()},rows);
  const tocPath=dir+'/toc.pdf';await fs.writeFile(tocPath,header);
  const text=execFileSync('pdftotext',[tocPath,'-'],{encoding:'utf8'});
  console.log(JSON.stringify({probe:'exported-builder-index-50',requested:50,renderedUniqueRows:(text.match(/UNIQUE_ROW_\d+/g)||[]).length,pages:(await PDFDocument.load(header)).getPageCount(),liveWorkerUsesThisBuilder:false}));
 }finally{await fs.rm(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
