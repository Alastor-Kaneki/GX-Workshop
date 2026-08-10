export const COMPONENTS=['Mod kit','App icon','Background Music','Browser Sounds','Cursors','Fonts','Game Strip','Icons','Keyboard sounds','Mobile Icons','SD effects','Shader','Splash screen','Stickers','Theme','Wallpaper','Web Modding'];

export async function catalog(){
  const response=await fetch(`./data/catalog.json?t=${Date.now()}`,{cache:'no-store'});
  if(!response.ok)throw Error(`Catalog HTTP ${response.status}`);
  const data=await response.json();
  return{mods:(Array.isArray(data)?data:data.mods||[]).map(norm),meta:Array.isArray(data)?{}:data.meta||{}};
}

export function norm(mod){
  return{
    id:mod.id||mod.slug||crypto.randomUUID(),
    slug:mod.slug||'',
    name:mod.name||mod.title||'Untitled GX Mod',
    author:mod.author||mod.studio||'Unknown studio',
    description:mod.description||'',
    url:mod.url||'',
    packageUrl:mod.packageUrl||null,
    image:mod.image||mod.icon||mod.thumbnail||'',
    images:mod.images||[],
    tags:[...(mod.tags||[])],
    components:[...(mod.components||[])],
    platforms:[...(mod.platforms||[])],
    version:mod.version||'',
    installs:Number(String(mod.installs||0).replace(/[^\d]/g,''))||0,
    size:mod.size||'',
    createdAt:mod.createdAt||'',
    updatedAt:mod.updatedAt||'',
    detailFetchedAt:mod.detailFetchedAt||''
  };
}

function dateValue(value){
  const match=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match?`${match[3]}-${match[1]}-${match[2]}`:String(value||'');
}

export function search(mods,q='',filter='All',sort='relevance'){
  const terms=q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let output=mods.filter(mod=>{
    const filtered=filter==='All'||mod.components.includes(filter)||mod.tags.includes(filter)||mod.platforms.includes(filter);
    if(!filtered)return false;
    if(!terms.length)return true;
    const haystack=[mod.name,mod.author,mod.description,...mod.tags,...mod.components,...mod.platforms].join(' ').toLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
  if(sort==='installs')output.sort((a,b)=>b.installs-a.installs);
  if(sort==='updated')output.sort((a,b)=>dateValue(b.updatedAt).localeCompare(dateValue(a.updatedAt)));
  if(sort==='name')output.sort((a,b)=>a.name.localeCompare(b.name));
  return output;
}

export function parseUrl(value){
  try{
    const url=new URL(value);
    if(url.hostname!=='store.gx.me')return null;
    const match=url.pathname.match(/(?:\/[a-z]{2})?\/mods\/([a-z0-9]+)\/([^/]+)\/?/i);
    return match?{id:match[1],slug:match[2],url:`https://store.gx.me/mods/${match[1]}/${match[2]}/`}:null;
  }catch{return null;}
}

export const gxSearch=query=>`https://store.gx.me/mods/?search=${encodeURIComponent(query)}`;
