import {ArchiveSite} from '../src/archive';
import {createApp} from '../src/app';

/** Read-only source inventory and representative link audit; uses only in-memory SQL. */
const site=await ArchiveSite.load(process.env.WEBSITE_ARCHIVE_ROOT);
if(!site)throw new Error('Original website files are required for this audit.');
const routes=site.nativePages();let next=0;const failures:string[]=[];
await Promise.all(Array.from({length:12},async()=>{for(;;){const path=routes[next++];if(!path)return;const response=await site.serve(new Request('http://localhost'+path,{method:'HEAD'}));if(response?.status!==200)failures.push(path+': '+response?.status);}}));
const app=await createApp({databaseUrl:':memory:',archiveRoot:site.root,adminPassword:crypto.randomUUID()});
const checkedLinks=new Set<string>();
const uncaptured:string[]=[];
try{
 for(const path of ['/','/downloads-and-wallpapers','/game-guide','/guide/controls-photobooth','/help','/news','/devblog','/forums','/grand-exchange','/hiscores']){
  const response=await app.handle(new Request('http://localhost'+path));if(response.status!==200){failures.push(path+': '+response.status);continue;}
  const html=await response.text();if(/(?:href|src)=["']\/archive\//i.test(html))failures.push(path+': legacy URL emitted');
  if(html.includes('Historical website reference from July 2010'))failures.push(path+': reference wrapper still visible');
  for(const match of html.matchAll(/(?:href|src)=["'](\/[^"'<>]*)["']/g)){
   const link=match[1]!.replaceAll('&amp;','&').split('#')[0]!;if(!link||checkedLinks.has(link))continue;checkedLinks.add(link);
   const target=await app.handle(new Request('http://localhost'+link,{method:link.startsWith('/assets/')?'HEAD':'GET'}));
   // Some source snapshots refer to uncaptured destinations. Report separately
   // rather than treating them as removed by native routing.
   if(target.status===404)uncaptured.push(link);
   if(target.status>=500)failures.push(link+': '+target.status);
  }
 }
}finally{await app.close();}
console.log(JSON.stringify({nativePages:routes.length,uniqueRoutes:new Set(routes).size,representativeLinks:checkedLinks.size,uncapturedDestinations:uncaptured.slice(0,15),uncapturedCount:uncaptured.length,failures:failures.slice(0,25),failureCount:failures.length}));
if(failures.length)process.exitCode=1;
