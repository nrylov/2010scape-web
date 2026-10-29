import type { ArchiveSite } from './archive';
import { escape, layout } from './view';

/** One observed UTC trading day. Days without trades are absent, never interpolated. */
export interface PricePoint { date: string; price: number; volume?: number|string; }
export interface ExchangeItem { id: number; name: string; guide: number; change30?: number; }
export interface ItemDetail extends ExchangeItem { min: number; max: number; guideSource: 'sample'|'content-seed'|'completed-trades'; description?: string; }
/** Website boundary for Grand Exchange data: the labeled sample catalogue or the game world's read-only market API. */
export interface PriceHistorySource {
  sample: boolean;
  now(): number;
  search(query: string): Promise<ExchangeItem[]>;
  item(id: number): Promise<ItemDetail|undefined>;
  /** Ascending observed days covering at least the last 180 calendar days. */
  history(id: number): Promise<PricePoint[]>;
}
export class MarketUnavailable extends Error {}

const DAY=86400000,root='/assets/services/m%3ditemdb_rs/';
const utcDay=(t:number)=>new Date(t).toISOString().slice(0,10),dayIndex=(date:string)=>Date.parse(date+'T00:00:00Z')/DAY;
/** Original 2010 item-database pages and art kept in the separately supplied archive. */
const archived: Record<number,{template:string;image:string;description:string}>={
  1333:{template:'Rune_scimitar/viewitem393a.html',image:'3059_obj_big8825.gif',description:'A vicious, curved sword.'},
  1511:{template:'Logs/viewitem3a37.html',image:'3059_obj_big4963.gif',description:'A pile of logs.'},
  453:{template:'Coal/viewitem0cd0.html',image:'3059_obj_bigabcd.gif',description:'A useful fuel.'},
  379:{template:'Lobster/viewitemb5e4.html',image:'3059_obj_big09f7.gif',description:'I should try eating this.'},
  556:{template:'Air_rune/viewitem83dd.html',image:'3059_obj_bigc993.gif',description:'One of the four basic elemental runes.'},
  440:{template:'Iron_ore/viewitem8c50.html',image:'3059_obj_big6f1e.gif',description:'This needs refining.'},
};

/** Latest observed price compared with the latest observed price at least `days` before today. */
export function priceChange(history:PricePoint[],days:number,now:number):number|undefined{
  const today=utcDay(now),before=utcDay(now-days*DAY),latest=history.filter(p=>p.date<=today).at(-1),older=history.filter(p=>p.date<=before).at(-1);
  return latest&&older?(latest.price-older.price)/older.price*100:undefined;
}

const sampleNames: Record<number,string>={1333:'Rune scimitar',1511:'Logs',453:'Coal',379:'Lobster',556:'Air rune',440:'Iron ore'};
const bases: Record<number,number>={1333:37900,1511:48,453:220,379:290,556:7,440:170};
const sampleEnd=Date.UTC(2026,9,28);
const sampleHistory=(id:number):PricePoint[]=>!bases[id]?[]:Array.from({length:210},(_,n)=>({date:utcDay(sampleEnd-(209-n)*DAY),price:Math.max(1,Math.round(bases[id]!*(1+0.11*Math.sin(n/17+id)+0.025*Math.sin(n/3)+n/1600)))}));
const sampleItem=(id:number):ExchangeItem=>{const h=sampleHistory(id);return {id,name:sampleNames[id]!,guide:h.at(-1)!.price,change30:priceChange(h,30,sampleEnd)};};
/** Deterministic contrived prices for local development without a game world. */
export const samplePrices: PriceHistorySource={sample:true,now:()=>sampleEnd,
  async search(query){return Object.keys(sampleNames).map(Number).filter(id=>sampleNames[id]!.toLowerCase().includes(query.toLowerCase())).map(sampleItem);},
  async item(id){if(!sampleNames[id])return;const item=sampleItem(id);return {...item,min:Math.max(1,Math.ceil(item.guide*.95)),max:Math.ceil(item.guide*1.05),guideSource:'sample',description:archived[id]?.description};},
  async history(id){return sampleHistory(id);},
};

const count=(n:unknown):n is number=>Number.isSafeInteger(n)&&(n as number)>0;
const isName=(n:unknown):n is string=>typeof n==='string'&&n.length>0&&n.length<=100;
const isVolume=(n:unknown)=>count(n)||(typeof n==='string'&&/^\d{1,40}$/.test(n));
/** Read-only client for the game world's `/market` API (version 1). Fetch it server-side over the internal Service address. */
export function gameMarket(baseUrl:string,options:{fetch?:typeof fetch;now?:()=>number;ttlMs?:number;timeoutMs?:number}={}):PriceHistorySource{
  const base=baseUrl.replace(/\/*$/,'/'),get=options.fetch??fetch,ttl=options.ttlMs??60_000,now=options.now??Date.now;
  const cache=new Map<string,{expires:number;value:Promise<any>}>();
  async function load(path:string){
    let response:Response;
    try{response=await get(new URL(path,base),{signal:AbortSignal.timeout(options.timeoutMs??2000),headers:{Accept:'application/json'},redirect:'error'});}
    catch(error){throw new MarketUnavailable(`The game market is unreachable: ${error instanceof Error?error.message:error}`);}
    if(response.status===404)return undefined;
    if(!response.ok)throw new MarketUnavailable(`The game market returned ${response.status}`);
    const data=await response.json().catch(()=>undefined);
    if(data?.version!==1)throw new MarketUnavailable('Unsupported game market response');
    return data;
  }
  function cached(path:string){
    const hit=cache.get(path),at=Date.now();
    if(hit&&hit.expires>at)return hit.value;
    if(cache.size>500)for(const [key,entry] of cache)if(entry.expires<=at)cache.delete(key);
    const value=load(path);cache.set(path,{expires:at+ttl,value});value.catch(()=>cache.delete(path));
    return value;
  }
  const invalid=()=>new MarketUnavailable('Malformed game market response');
  return {sample:false,now,
    async search(query){
      const data=await cached('market/items?query='+encodeURIComponent(query.slice(0,100)));
      if(!Array.isArray(data?.items))throw invalid();
      return data.items.filter((i:any)=>count(i?.id)&&isName(i.name)&&count(i.guidePrice)).map((i:any)=>({id:i.id,name:i.name,guide:i.guidePrice}));
    },
    async item(id){
      if(!count(id)||id>99999)return;
      const i=await cached('market/items/'+id);if(!i)return;
      if(i.id!==id||!isName(i.name)||![i.guidePrice,i.min,i.max].every(count)||!['content-seed','completed-trades'].includes(i.guideSource))throw invalid();
      return {id,name:i.name,guide:i.guidePrice,min:i.min,max:i.max,guideSource:i.guideSource,description:archived[id]?.description};
    },
    async history(id){
      if(!count(id)||id>99999)return [];
      const data=await cached(`market/items/${id}/history?days=180`);if(!data)return [];
      if(!Array.isArray(data.points))throw invalid();
      return data.points.filter((p:any)=>/^\d{4}-\d{2}-\d{2}$/.test(p?.date)&&count(p.price)&&isVolume(p.volume)).map((p:any)=>({date:p.date,price:p.price,volume:p.volume}))
        .sort((a:PricePoint,b:PricePoint)=>a.date.localeCompare(b.date));
    },
  };
}

const format=(n:number)=>n>=1000000?(n/1000000).toFixed(1)+'m':n>=1000?(n/1000).toFixed(1)+'k':Math.round(n).toLocaleString('en-GB');
const change=(n:number|undefined)=>n===undefined?'<span>n/a</span>':`<span class="${n<0?'drop':'rise'}">${n>0?'+':''}${n.toFixed(1)}%</span>`;
/** Observed days inside the calendar window ending today (UTC), with trailing 30-calendar-day averages of observed prices. */
export function priceWindow(history:PricePoint[],days:number,now:number){
  const end=utcDay(now),start=utcDay(now-(days-1)*DAY),points=history.filter(p=>p.date>=start&&p.date<=end);
  const averages=points.map(p=>{const d=dayIndex(p.date),window=history.filter(q=>dayIndex(q.date)>d-30&&dayIndex(q.date)<=d);return window.reduce((sum,q)=>sum+q.price,0)/window.length;});
  return {start,end,points,averages};
}
export function priceGraph(history:PricePoint[],days:number,name:string,now=Date.now()) {
  const {start,end,points,averages}=priceWindow(history,days,now);
  if(!points.length)return `<svg xmlns="http://www.w3.org/2000/svg" width="499" height="382" viewBox="0 0 499 382" role="img" aria-label="${escape(name)}: no trades"><rect width="499" height="382" fill="#51432b"/><text x="249" y="191" text-anchor="middle" fill="#dfd5bf" font-family="Arial,sans-serif" font-size="12">No price history available: no completed trades from ${start} to ${end}</text></svg>`;
  const values=[...points.map(p=>p.price),...averages],low=Math.max(0,Math.floor(Math.min(...values)*.9)),high=Math.max(low+1,Math.ceil(Math.max(...values)*1.1));
  const first=dayIndex(start),x=(date:string)=>43+(dayIndex(date)-first)*450/Math.max(1,days-1),y=(v:number)=>350-(v-low)/(high-low)*340;
  // Break lines across days without trades; a lone observed day is drawn as a dot.
  const series=(values:number[],colour:string)=>{
    const runs:number[][]=[];points.forEach((p,i)=>{if(i&&dayIndex(p.date)-dayIndex(points[i-1]!.date)===1)runs.at(-1)!.push(i);else runs.push([i]);});
    return runs.map(run=>run.length===1?`<circle cx="${x(points[run[0]!]!.date).toFixed(2)}" cy="${y(values[run[0]!]!).toFixed(2)}" r="1.5" fill="${colour}"/>`:`<polyline fill="none" stroke="${colour}" stroke-width="1" points="${run.map(i=>`${x(points[i]!.date).toFixed(2)},${y(values[i]!).toFixed(2)}`).join(' ')}"/>`).join('');
  };
  const grid=Array.from({length:9},(_,i)=>{const yy=10+i*42.5;return `<path d="M43 ${yy}H493"/><text x="38" y="${yy+3}" text-anchor="end">${format(high-(high-low)*i/8)}</text>`;}).join('')+Array.from({length:16},(_,i)=>`<path d="M${43+i*30} 10V350"/>`).join('');
  const middle=utcDay(Date.parse(start+'T00:00:00Z')+Math.floor((days-1)/2)*DAY);
  const dates=[start,middle,end].map((d,n)=>`<text x="${x(d)}" y="372" text-anchor="${n===0?'start':n===2?'end':'middle'}">${d}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="499" height="382" viewBox="0 0 499 382" role="img" aria-label="${escape(name)} price history for ${days} days"><title>${escape(name)}: daily and trailing 30-day average prices in coins</title><rect width="499" height="382" fill="#51432b"/><g stroke="#a89b81" stroke-width=".5" fill="#dfd5bf" font-family="Arial,sans-serif" font-size="9">${grid}</g>${series(points.map(p=>p.price),'#efd621')}${series(averages,'#00bcec')}<g fill="#dfd5bf" font-family="Arial,sans-serif" font-size="10">${dates}</g></svg>`;
}
export async function handleExchange(req:Request,archive?:ArchiveSite,source:PriceHistorySource=samplePrices):Promise<Response|undefined>{
  const url=new URL(req.url),path=url.pathname;
  if(path!=='/grand-exchange'&&!path.startsWith('/grand-exchange/'))return;
  const headers={'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
  if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const itemMatch=/^\/grand-exchange\/items\/(\d{1,6})(?:\/(graph\.svg|history\.csv))?$/.exec(path);
  if(path!=='/grand-exchange'&&!itemMatch)return new Response('Item not found',{status:404});
  const requested=url.searchParams.get('days')??'30';
  if(!['30','90','180'].includes(requested))return new Response('Choose 30, 90 or 180 days',{status:400});
  const days=+requested,query=(url.searchParams.get('query')??'').trim().slice(0,100),letter=/^[A-Za-z]$/.test(url.searchParams.get('letter')??'')?url.searchParams.get('letter')!.toUpperCase():'';
  const notice=source.sample?'Sample data — contrived prices for demonstration. No live Grand Exchange market is connected.':'Live Grand Exchange guide prices from the 2010scape world. Graphs show completed trades only.';
  const search=`<form action="/grand-exchange" method="get"><label>Item <input type="search" class="textinput" name="query" maxlength="100" value="${escape(query)}"></label> <input type="submit" class="search buttonsmall" value="Go"></form>`;
  let item:ItemDetail|undefined,history:PricePoint[]=[],selected:ExchangeItem[]=[];
  try{
    if(itemMatch){item=await source.item(+itemMatch[1]!);if(item)history=await source.history(item.id);}
    else selected=(await source.search(query||letter)).filter(i=>!letter||i.name.toUpperCase().startsWith(letter)).sort((a,b)=>a.name.localeCompare(b.name,'en-GB'));
  }catch(error){
    if(!(error instanceof MarketUnavailable))throw error;
    console.warn(`[grand-exchange] ${error.message}`);
    if(itemMatch?.[2])return new Response('Grand Exchange prices are temporarily unavailable',{status:503,headers:{'Retry-After':'30'}});
    return new Response(req.method==='HEAD'?null:layout('Grand Exchange',`<h1>Grand Exchange</h1><p>Grand Exchange prices are temporarily unavailable. Please try again shortly.</p>`),{status:503,headers:{...headers,'Retry-After':'30'}});
  }
  if(itemMatch&&!item)return new Response('Item not found',{status:404});
  const now=source.now();
  if(itemMatch?.[2]){
    const svg=itemMatch[2]==='graph.svg';
    const body=svg?priceGraph(history,days,item!.name,now):'date,daily_average,volume,source\r\n'+priceWindow(history,days,now).points.map(p=>`${p.date},${p.price},${p.volume??''},${source.sample?'sample':'completed-trades'}`).join('\r\n');
    return new Response(req.method==='HEAD'?null:body,{headers:{...headers,'Content-Type':svg?'image/svg+xml; charset=utf-8':'text/csv; charset=utf-8',...(svg?{}:{'Content-Disposition':`attachment; filename="item-${item!.id}-${days}-days.csv"`})}});
  }
  const changes=selected.some(i=>i.change30!==undefined);
  const rows=selected.map(i=>`<tr><td><a href="/grand-exchange/items/${i.id}">${escape(i.name)}</a></td><td>${format(i.guide)}</td>${changes?`<td>${change(i.change30)}</td>`:''}</tr>`).join('');
  const empty=source.sample?'No matching items in the sample catalogue.':'No matching tradeable items.';
  const listing=`<div class="subsectionHeader">${query||letter?'Search results':'Market guide'}</div><table class="top5_table row_a" style="width:100%"><tr class="row_b"><th>Item</th><th>Guide Price</th>${changes?'<th>30-day change</th>':''}</tr>${rows||`<tr><td colspan="${changes?3:2}">${empty}</td></tr>`}</table>${!source.sample&&selected.length>=100?'<p>Showing the first 100 matches. Refine your search to find other items.</p>':''}`;
  const art=item&&archived[item.id];
  // Items without their own archived page reuse the Rune scimitar page frame; its item content is replaced below.
  let template=await archive?.template('services.runescape.com','m=itemdb_rs/'+(item?art?.template??'Rune_scimitar/viewitem393a.html':'frontpage.html'));
  if(!template&&art)template=await archive?.template('services.runescape.com','m=itemdb_rs/Rune_scimitar/viewitem393a.html');
  const guideNote=!item?'':item.guideSource==='completed-trades'?'Guide price from the latest completed trading day.':item.guideSource==='content-seed'?'Starting guide price: this item has no completed trading day yet.':'Illustrative sample guide price.';
  const detail=item?`${art?`<img id="item_image" src="${root+art.image}" alt="${escape(item.name)}">`:''}${item.description?escape(item.description)+'<br><br>':''}<b>Current market price range:</b><br><span><b>Minimum price:</b> ${format(item.min)}</span><span class="spaced_span"><b>Market price:</b> ${format(item.guide)}</span><span><b>Maximum price:</b> ${format(item.max)}</span><br><small>${guideNote}</small><br><br><b>Change in price:</b><br>${[30,90,180].map(d=>`<span class="spaced_span"><b>${d} Days:</b> ${change(priceChange(history,d,now))}</span>`).join('')}<br class="clear">`:'';
  const graph=item?`<tr><td><img class="exchange-graph" width="499" height="382" src="/grand-exchange/items/${item.id}/graph.svg?days=${days}" alt="${escape(item.name)}: ${days} days of daily average prices (yellow) and trailing 30-day averages (blue), in coins"></td></tr>`:'';
  const traded=priceWindow(history,days,now).points.length;
  const controls=item?`<div class="exchange-graph-notes"><p>${traded?`${traded} trading day${traded===1?'':'s'} recorded in the last ${days} days.`:`No completed trades in the last ${days} days.`}</p><p><a href="/grand-exchange">Back to market guide</a> · <a href="/grand-exchange/items/${item.id}/history.csv?days=${days}">Download ${days}-day history (CSV)</a></p></div>`:'';
  if(!template)return new Response(req.method==='HEAD'?null:layout(item?.name??'Grand Exchange',`<p>${notice}</p>${search}${item?`<h1>${escape(item.name)}</h1>${detail}<table>${graph}</table>${controls}`:listing}`),{headers});
  let main=0,heading=0,button=0;
  const rewrite=new HTMLRewriter().on('title',{element(e){e.setInnerContent(escape(item?.name??'Grand Exchange')+' - 2010scape',{html:true});}})
    .on('body',{element(e){e.setAttribute('class',(e.getAttribute('class')??'')+' exchange-page');}})
    .on('#ticker',{element(e){e.setInnerContent(notice);}})
    .on('#searchbox',{element(e){e.setInnerContent(search,{html:true});}})
    .on('#searchbox_text',{element(e){e.setInnerContent(source.sample?'Search the sample item catalogue. All prices are illustrative.':'Search for any tradeable item by name.');}})
    .on('#browse_list a',{element(e){const text=e.getAttribute('href')?.match(/cat=([A-Z])(?:&|$)/)?.[1];e.setAttribute('href',text?'/grand-exchange?letter='+text:'/grand-exchange');}})
    .on('.location',{element(e){e.setInnerContent(`<b>Location:</b> <a href="/">Home</a> &gt; <a href="/grand-exchange">Grand Exchange</a>${item?' &gt; '+escape(item.name):''}`,{html:true});}});
  if(item)rewrite.on('.main_ge_page > .subsectionHeader',{element(e){e.setInnerContent(heading++===0?escape(item.name):`Grand Exchange History for the Last ${days} Days`,{html:true});}})
    .on('#item_additional',{element(e){e.setInnerContent(detail,{html:true});}})
    .on('#item_graph_image',{element(e){e.setInnerContent(graph,{html:true});}})
    .on('#item_graph_nav',{element(e){e.after(controls,{html:true});}})
    .on('#item_graph_nav a',{element(e){e.setAttribute('href',`/grand-exchange/items/${item.id}?days=${[30,90,180][button++]??30}`);}});
  else rewrite.on('.main_ge_page',{element(e){if(main++===0)e.setInnerContent(listing,{html:true});else e.remove();}});
  return new Response(req.method==='HEAD'?null:await rewrite.transform(new Response(template)).text(),{headers});
}
