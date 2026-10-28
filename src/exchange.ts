import type { ArchiveSite } from './archive';
import { escape, layout } from './view';

export interface PricePoint { date: string; price: number; }
export interface ExchangeItem { id: number; name: string; description: string; template: string; image: string; }
/** Replace this provider with database/service queries when the game GE exists. */
export interface PriceHistorySource {
  sample: boolean;
  items(): Promise<ExchangeItem[]>;
  history(itemId: number): Promise<PricePoint[]>;
}
const root='/archive/services.runescape.com/m%3ditemdb_rs/';
const catalog: ExchangeItem[]=[
  {id:1333,name:'Rune scimitar',description:'A vicious, curved sword.',template:'Rune_scimitar/viewitem393a.html',image:'3059_obj_big8825.gif'},
  {id:1511,name:'Logs',description:'A pile of logs.',template:'Logs/viewitem3a37.html',image:'3059_obj_big4963.gif'},
  {id:453,name:'Coal',description:'A useful fuel.',template:'Coal/viewitem0cd0.html',image:'3059_obj_bigabcd.gif'},
  {id:379,name:'Lobster',description:'I should try eating this.',template:'Lobster/viewitemb5e4.html',image:'3059_obj_big09f7.gif'},
  {id:556,name:'Air rune',description:'One of the four basic elemental runes.',template:'Air_rune/viewitem83dd.html',image:'3059_obj_bigc993.gif'},
  {id:440,name:'Iron ore',description:'This needs refining.',template:'Iron_ore/viewitem8c50.html',image:'3059_obj_big6f1e.gif'},
];
const bases: Record<number,number>={1333:37900,1511:48,453:220,379:290,556:7,440:170};
export const samplePrices: PriceHistorySource={sample:true,async items(){return catalog;},async history(id){
  if(!bases[id])return [];
  return Array.from({length:210},(_,n)=>({date:new Date(Date.UTC(2026,9,28)-(209-n)*86400000).toISOString().slice(0,10),price:Math.max(1,Math.round(bases[id]!*(1+0.11*Math.sin(n/17+id)+0.025*Math.sin(n/3)+n/1600)))}));
}};
const format=(n:number)=>n>=1000000?(n/1000000).toFixed(1)+'m':n>=1000?(n/1000).toFixed(1)+'k':Math.round(n).toLocaleString('en-GB');
const percent=(points:PricePoint[],days:number)=>{const latest=points.at(-1)?.price??0,older=points.at(-(days+1))?.price??points[0]?.price??0;return older?((latest-older)/older*100):0;};
const change=(n:number)=>`<span class="${n<0?'drop':'rise'}">${n>0?'+':''}${n.toFixed(1)}%</span>`;
export function priceGraph(history:PricePoint[],days:number,name:string) {
  const points=history.slice(-days);
  if(!points.length)return `<svg xmlns="http://www.w3.org/2000/svg" width="499" height="382"><text x="20" y="40">No price history available</text></svg>`;
  const averaged=points.map(point=>{const index=history.indexOf(point),window=history.slice(Math.max(0,index-29),index+1);return window.reduce((sum,p)=>sum+p.price,0)/window.length;});
  const values=[...points.map(p=>p.price),...averaged],low=Math.max(0,Math.floor(Math.min(...values)*.9)),high=Math.max(low+1,Math.ceil(Math.max(...values)*1.1));
  const x=(i:number)=>43+i*450/Math.max(1,points.length-1),y=(v:number)=>350-(v-low)/(high-low)*340;
  const path=(values:number[])=>values.map((v,i)=>`${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const grid=Array.from({length:9},(_,i)=>{const yy=10+i*42.5;return `<path d="M43 ${yy}H493"/><text x="38" y="${yy+3}" text-anchor="end">${format(high-(high-low)*i/8)}</text>`;}).join('')+Array.from({length:16},(_,i)=>`<path d="M${43+i*30} 10V350"/>`).join('');
  const dates=[0,Math.floor((points.length-1)/2),points.length-1].map((i,n)=>`<text x="${x(i)}" y="372" text-anchor="${n===0?'start':n===2?'end':'middle'}">${escape(points[i]!.date)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="499" height="382" viewBox="0 0 499 382" role="img" aria-label="${escape(name)} price history for ${days} days"><title>${escape(name)}: daily and trailing 30-day average prices in coins</title><rect width="499" height="382" fill="#51432b"/><g stroke="#a89b81" stroke-width=".5" fill="#dfd5bf" font-family="Arial,sans-serif" font-size="9">${grid}</g><polyline fill="none" stroke="#efd621" stroke-width="1" points="${path(points.map(p=>p.price))}"/><polyline fill="none" stroke="#00bcec" stroke-width="1" points="${path(averaged)}"/><g fill="#dfd5bf" font-family="Arial,sans-serif" font-size="10">${dates}</g></svg>`;
}
export async function handleExchange(req:Request,archive?:ArchiveSite,source:PriceHistorySource=samplePrices):Promise<Response|undefined>{
  const url=new URL(req.url),path=url.pathname;
  if(path!=='/grand-exchange'&&!path.startsWith('/grand-exchange/'))return;
  const headers={'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
  if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const itemMatch=/^\/grand-exchange\/items\/(\d{1,6})(?:\/(graph\.svg|history\.csv))?$/.exec(path);
  if(path!=='/grand-exchange'&&!itemMatch)return new Response('Item not found',{status:404});
  const items=await source.items(),item=itemMatch?items.find(i=>i.id===+itemMatch[1]!):undefined;
  if(itemMatch&&!item)return new Response('Item not found',{status:404});
  const requested=url.searchParams.get('days')??'30';
  if(!['30','90','180'].includes(requested))return new Response('Choose 30, 90 or 180 days',{status:400});
  const days=+requested,history=item?await source.history(item.id):[];
  if(itemMatch?.[2]){
    const svg=itemMatch[2]==='graph.svg';
    const body=svg?priceGraph(history,days,item!.name):'date,daily_average,source\r\n'+history.slice(-days).map(p=>`${p.date},${p.price},${source.sample?'sample':'market'}`).join('\r\n');
    return new Response(req.method==='HEAD'?null:body,{headers:{...headers,'Content-Type':svg?'image/svg+xml; charset=utf-8':'text/csv; charset=utf-8',...(svg?{}:{'Content-Disposition':`attachment; filename="item-${item!.id}-${days}-days.csv"`})}});
  }
  const query=(url.searchParams.get('query')??'').trim().slice(0,100),letter=url.searchParams.get('letter')??'';
  const selected=items.filter(i=>i.name.toLowerCase().includes(query.toLowerCase())&&(!letter||i.name.toUpperCase().startsWith(letter.toUpperCase())));
  const notice=source.sample?'Sample data — contrived prices for demonstration. No live Grand Exchange market is connected.':'Grand Exchange guide prices';
  const search=`<form action="/grand-exchange" method="get"><label>Item <input type="search" class="textinput" name="query" maxlength="100" value="${escape(query)}"></label> <input type="submit" class="search buttonsmall" value="Go"></form>`;
  const rows=(await Promise.all(selected.map(async i=>{const h=await source.history(i.id);return `<tr><td><a href="/grand-exchange/items/${i.id}">${escape(i.name)}</a></td><td>${format(h.at(-1)?.price??0)}</td><td>${change(percent(h,30))}</td></tr>`;}))).join('');
  const listing=`<div class="subsectionHeader">${query?'Search results':'Market guide'}</div><table class="top5_table row_a" style="width:100%"><tr class="row_b"><th>Item</th><th>Current Price</th><th>30-day change</th></tr>${rows||'<tr><td colspan="3">No matching items in the sample catalogue.</td></tr>'}</table>`;
  let template=await archive?.template('services.runescape.com','m=itemdb_rs/'+(item?.template??'frontpage.html'));
  if(!template&&item)template=await archive?.template('services.runescape.com','m=itemdb_rs/Rune_scimitar/viewitem393a.html');
  const price=history.at(-1)?.price??0;
  const detail=item?`${item.image?`<img id="item_image" src="${root+item.image}" alt="${escape(item.name)}">`:''}${escape(item.description)}<br><br><b>Current market price range:</b><br><span><b>Minimum price:</b> ${format(price*.95)}</span><span class="spaced_span"><b>Market price:</b> ${format(price)}</span><span><b>Maximum price:</b> ${format(price*1.05)}</span><br><br><b>Change in price:</b><br>${[30,90,180].map(d=>`<span class="spaced_span"><b>${d} Days:</b> ${change(percent(history,d))}</span>`).join('')}<br class="clear">`:'';
  const graph=item?`<tr><td><img class="exchange-graph" width="499" height="382" src="/grand-exchange/items/${item.id}/graph.svg?days=${days}" alt="${escape(item.name)}: ${days} days of daily average prices (yellow) and trailing 30-day averages (blue), in coins"></td></tr>`:'';
  const controls=item?`<p><a href="/grand-exchange">Back to market guide</a> · <a href="/grand-exchange/items/${item.id}/history.csv?days=${days}">Download ${days}-day history (CSV)</a></p>`:'';
  if(!template)return new Response(req.method==='HEAD'?null:layout(item?.name??'Grand Exchange',`<p>${notice}</p>${search}${item?`<h1>${escape(item.name)}</h1>${detail}<table>${graph}</table>${controls}`:listing}`),{headers});
  let main=0,heading=0;
  const rewrite=new HTMLRewriter().on('title',{element(e){e.setInnerContent(escape(item?.name??'Grand Exchange')+' - 2010scape',{html:true});}})
    .on('body',{element(e){e.setAttribute('class',(e.getAttribute('class')??'')+' exchange-page');}})
    .on('#ticker',{element(e){e.setInnerContent(notice);}})
    .on('#searchbox',{element(e){e.setInnerContent(search,{html:true});}})
    .on('#searchbox_text',{element(e){e.setInnerContent('Search the sample item catalogue. All prices are illustrative.');}})
    .on('#browse_list a',{element(e){const text=e.getAttribute('href')?.match(/cat=([A-Z])(?:&|$)/)?.[1];e.setAttribute('href',text?'/grand-exchange?letter='+text:'/grand-exchange');}})
    .on('.location',{element(e){e.setInnerContent(`<b>Location:</b> <a href="/">Home</a> &gt; <a href="/grand-exchange">Grand Exchange</a>${item?' &gt; '+escape(item.name):''}`,{html:true});}});
  if(item)rewrite.on('.main_ge_page > .subsectionHeader',{element(e){e.setInnerContent(heading++===0?escape(item.name):`Grand Exchange History for the Last ${days} Days`,{html:true});}})
    .on('#item_additional',{element(e){e.setInnerContent(detail,{html:true});}})
    .on('#item_graph_image',{element(e){e.setInnerContent(graph,{html:true});}})
    .on('#item_graph_nav',{element(e){e.after(controls,{html:true});}})
    .on('#item_graph_nav a',{element(e){const old=e.getAttribute('href')??'',scale=old.match(/scale=(\d)/)?.[1]??'0';e.setAttribute('href',`/grand-exchange/items/${item.id}?days=${[30,90,180][+scale]??30}`);}});
  else rewrite.on('.main_ge_page',{element(e){if(main++===0)e.setInnerContent(listing,{html:true});else e.remove();}});
  return new Response(req.method==='HEAD'?null:await rewrite.transform(new Response(template)).text(),{headers});
}
