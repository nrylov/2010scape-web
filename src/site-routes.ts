import {extname} from 'node:path';

/** URL namespaces are application-owned; source domains never appear in public routes. */
export const SOURCE_HOSTS: Record<string,string>={
 'www.runescape.com':'site','services.runescape.com':'services','secure.runescape.com':'secure',
 'news.runescape.com':'news','services.jagex.com':'jagex-services','www.jagex.com':'jagex',
 'www.jagexstore.com':'jagex-store','www.runefest.com':'runefest','www.funorb.com':'funorb',
};
export const SOURCE_BY_NAMESPACE=Object.fromEntries(Object.entries(SOURCE_HOSTS).map(([host,key])=>[key,host]));
const encodePath=(path:string)=>path.split('/').map(encodeURIComponent).join('/');
const slug=(path:string)=>path.split('/').map(part=>part.toLowerCase().replace(/\.html?$/,'').replace(/[^a-z0-9.-]+/g,'-').replace(/^-+|-+$/g,'')||'index').join('/');
/** Input is a decoded source path. Only map files; file-serving separately verifies containment. */
export function nativeSourcePath(host:string,path:string):string {
 const namespace=SOURCE_HOSTS[host];if(!namespace)throw new Error('Unsupported source host');
 path=path.replace(/^\/+/, '');
 const extension=extname(path).toLowerCase();
 if(extension&&!['.html','.htm','.ws'].includes(extension))return '/assets/'+namespace+'/'+encodePath(path);
 let locale='';const language=/^l=([123])\/(.*)$/.exec(path);
 if(language){locale='/'+({1:'de',2:'fr',3:'pt'}[+language[1]!]!);path=language[2]!;}
 path=path.replace(/\.ws$/i,'.html');
 if(host==='www.runescape.com'){
  if(/^(?:index|title)(?:\.html?)?$/.test(path)||!path)return locale||'/';
  if(!locale&&/^(?:game|options|splash)(?:\.html?)?$/.test(path))return '/play';
  if(/^parents(?:\.html?)?$/.test(path))return locale+'/parents-guide';
  const guide=/^(?:kbase\/guid|guide)\/(.+)$/.exec(path);
  if(guide){const name=slug(guide[1]!);const aliases:Record<string,string>={manual:'/game-guide','downloads-and-wallpapers':'/downloads-and-wallpapers','customer-support':'/help'};return locale+(aliases[name]??'/guide/'+name);}
  if(/^terms(?:\/terms)?(?:\.html?)?\/?$/.test(path))return locale+'/terms';
  if(/^privacy(?:\/privacy)?(?:\.html?)?\/?$/.test(path))return locale+'/privacy';
  return locale+'/pages/'+slug(path);
 }
 if(host==='www.jagex.com'){
  if(path==='terms/terms.html')return locale+'/terms';
  if(path==='privacy/privacy.html')return locale+'/privacy';
  if(path==='corporate/Parents_Guide/parents_guide.html')return locale+'/parents-guide';
 }
 if(host==='services.runescape.com'){
  const match=/^m=([^/]+)\/(.*)$/.exec(path);
  if(match){const module=match[1]!,tail=match[2]!;
   if(!locale){
    if(module==='itemdb_rs'&&/^frontpage[^/]*\.html$/.test(tail))return '/grand-exchange';
    if(module==='hiscore'&&/^hiscores\.html$/.test(tail))return '/hiscores';
    if(module==='news'&&/^(?:index|list)\.html$/.test(tail))return '/news';
    if(module==='devblog'&&/^index\.html$/.test(tail))return '/devblog';
    if(module==='forum'&&/^(?:sl=0\/)?(?:index|forums)\.html$/.test(tail))return '/forums';
   }
   const sections:Record<string,string>={news:'news/history',devblog:'devblog/history',forum:'forums/history',itemdb_rs:'grand-exchange/history',hiscore:'hiscores/history'};
   return locale+'/'+(sections[module]??'community/'+slug(module))+'/'+slug(tail);
  }
 }
 return locale+'/extras/'+namespace+'/'+slug(path);
}
/** Rewrites previously stored Markdown image/link URLs without rewriting the saved post. */
export function nativeLegacyUrl(value:string):string|undefined {
 if(!value.startsWith('/archive/'))return;
 try{const url=new URL(value,'https://site.invalid'),parts=decodeURIComponent(url.pathname.slice(9)).split('/'),host=parts.shift()!;
 if(!SOURCE_HOSTS[host]||parts.some(p=>p==='.'||p==='..')||parts.join('/').includes('\\')||parts.join('/').includes('\0'))return;
 return nativeSourcePath(host,parts.join('/'))+url.search+url.hash;
 }catch{return;}
}
