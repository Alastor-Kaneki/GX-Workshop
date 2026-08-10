const U16=(b,o)=>b[o]|b[o+1]<<8;
const U32=(b,o)=>(b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0;
const SIG=(b,o,n)=>U32(b,o)===n;
const decoder=new TextDecoder();
export function parseZip(input){
  const b=input instanceof Uint8Array?input:new Uint8Array(input);
  let end=-1;
  for(let i=Math.max(0,b.length-22);i>=Math.max(0,b.length-65557);i--){if(SIG(b,i,0x06054b50)){end=i;break}}
  if(end<0)throw Error('ZIP end-of-central-directory record not found');
  const count=U16(b,end+10),size=U32(b,end+12),offset=U32(b,end+16);
  if(count===0xffff||size===0xffffffff||offset===0xffffffff)throw Error('ZIP64 archives are not supported yet');
  const out=[];let p=offset;
  for(let i=0;i<count&&p+46<=b.length;i++){
    if(!SIG(b,p,0x02014b50))break;
    const flags=U16(b,p+8),method=U16(b,p+10),crc=U32(b,p+16),compressedSize=U32(b,p+20),size=U32(b,p+24),nameLen=U16(b,p+28),extraLen=U16(b,p+30),commentLen=U16(b,p+32),localOffset=U32(b,p+42);
    const name=decoder.decode(b.subarray(p+46,p+46+nameLen));
    out.push({id:i,name,flags,method,crc,compressedSize,size,localOffset,directory:name.endsWith('/')});
    p+=46+nameLen+extraLen+commentLen;
  }
  return{entries:out,declaredCount:count,centralDirectorySize:size,centralDirectoryOffset:offset,totalSize:b.length};
}
export async function extractEntry(input,e){
  const b=input instanceof Uint8Array?input:new Uint8Array(input),o=e.localOffset;
  if(!SIG(b,o,0x04034b50))throw Error(`Invalid local header for ${e.name}`);
  const nameLen=U16(b,o+26),extraLen=U16(b,o+28),start=o+30+nameLen+extraLen,end=start+e.compressedSize;
  if(end>b.length)throw Error(`Truncated entry: ${e.name}`);
  const raw=b.slice(start,end);
  if(e.method===0)return raw;
  if(e.method===8){
    if(!('DecompressionStream'in globalThis))throw Error('This browser cannot decompress DEFLATE entries');
    let last;
    for(const format of['deflate-raw','deflate'])try{return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer())}catch(err){last=err}
    throw Error(`Could not inflate ${e.name}: ${last?.message||'DEFLATE error'}`);
  }
  throw Error(`Unsupported ZIP compression method ${e.method} for ${e.name}`);
}
export function mimeOf(name){const x=name.toLowerCase();if(x.endsWith('.png'))return'image/png';if(x.endsWith('.jpg')||x.endsWith('.jpeg'))return'image/jpeg';if(x.endsWith('.webp'))return'image/webp';if(x.endsWith('.gif'))return'image/gif';if(x.endsWith('.svg'))return'image/svg+xml';if(x.endsWith('.json'))return'application/json';if(x.endsWith('.css'))return'text/css';if(x.endsWith('.js'))return'text/javascript';if(x.endsWith('.mp3'))return'audio/mpeg';if(x.endsWith('.wav'))return'audio/wav';if(x.endsWith('.ogg'))return'audio/ogg';if(x.endsWith('.webm'))return'video/webm';if(x.endsWith('.mp4'))return'video/mp4';return'application/octet-stream'}
export function kindOf(name){const x=name.toLowerCase();if(/\.(png|jpe?g|webp|gif|svg|avif)$/.test(x))return'image';if(/\.(mp3|wav|ogg|flac|m4a|aac)$/.test(x))return'audio';if(/\.(mp4|webm|mov)$/.test(x))return'video';if(/\.(json|jsonc)$/.test(x))return'json';if(/\.(js|mjs|css|html?)$/.test(x))return'web';if(/\.(ttf|otf|woff2?)$/.test(x))return'font';if(/\.(zip|crx)$/.test(x))return'archive';return'other'}
export function summary(entries){const kinds={};let packed=0,unpacked=0;for(const e of entries){if(e.directory)continue;const k=kindOf(e.name);kinds[k]=(kinds[k]||0)+1;packed+=e.compressedSize;unpacked+=e.size}return{files:entries.filter(e=>!e.directory).length,folders:entries.filter(e=>e.directory).length,kinds,packed,unpacked}}
