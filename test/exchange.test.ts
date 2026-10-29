import {test,expect} from 'bun:test';
import {handleExchange,samplePrices,priceGraph} from '../src/exchange';
import {ArchiveSite} from '../src/archive';
const req=(path:string,method='GET')=>new Request('http://localhost'+path,{method});
test('sample GE search, bounded date ranges and CSV expose contrived history without game dependencies',async()=>{
 const home=await handleExchange(req('/grand-exchange'));expect(home?.status).toBe(200);expect(await home!.text()).toContain('Sample data');
 const search=await(await handleExchange(req('/grand-exchange?query=coal')))!.text();expect(search).toContain('Coal');expect(search).not.toContain('Rune scimitar');
 for(const days of [30,90,180]){
  const page=await(await handleExchange(req('/grand-exchange/items/1333?days='+days)))!.text();expect(page).toContain('graph.svg?days='+days);
  const csv=await handleExchange(req('/grand-exchange/items/1333/history.csv?days='+days));expect(csv!.headers.get('content-type')).toContain('text/csv');
  const lines=(await csv!.text()).split('\r\n');expect(lines).toHaveLength(days+1);expect(lines[1]).toEndWith(',sample');
 }
 expect((await handleExchange(req('/grand-exchange/items/99999')))!.status).toBe(404);
 expect((await handleExchange(req('/grand-exchange/items/1333?days=999')))!.status).toBe(400);
 expect((await handleExchange(req('/grand-exchange','POST')))!.status).toBe(405);
 expect((await handleExchange(req('/grand-exchange','HEAD')))!.body).toBeNull();
});
test('GE graph generates native-size yellow and blue price series with accessible date and coin axes',async()=>{
 const response=await handleExchange(req('/grand-exchange/items/1333/graph.svg?days=180'));
 expect(response!.headers.get('content-type')).toContain('image/svg+xml');const svg=await response!.text();
 expect(svg).toContain('viewBox="0 0 499 382"');expect(svg).toContain('#efd621');expect(svg).toContain('#00bcec');expect(svg).toContain('2026-10-28');expect(svg).not.toMatch(/NaN|Infinity/);
 const history=await samplePrices.history(1333);expect(history).toHaveLength(210);expect(await samplePrices.history(1333)).toEqual(history);expect(priceGraph(history,30,'x',samplePrices.now())).toContain('2026-10-28');
 expect(priceGraph([],30,'No data')).toContain('No price history');
});
test('GE adapters preserve supplied original template frames while replacing historical prices and graph images',async()=>{
 const archive=await ArchiveSite.load();if(!archive)return;
 const page=await(await handleExchange(req('/grand-exchange/items/1333?days=90'),archive))!.text();
 expect(page).toContain('id="item_additional"');expect(page).toContain('id="item_graph_image"');expect(page).toContain('/grand-exchange/items/1333/graph.svg?days=90');expect(page).toContain('Last 90 Days');expect(page).toContain('button_180.png');expect(page).not.toContain('3062d_graphimg3eaae.gif');expect(page).toContain('Sample data');
 const home=await(await handleExchange(req('/grand-exchange'),archive))!.text();expect(home).toContain('class="top5_table row_a"');expect(home).toContain('name="query"');expect(home).not.toContain('Teak logs');
});
import {gameMarket,priceWindow,priceChange} from '../src/exchange';
const now=Date.UTC(2026,9,29,12);
const fakeGame=(overrides:Record<string,unknown>={})=>{
 const calls:string[]=[];
 const routes:Record<string,unknown>={
  '/market/items?query=coal':{version:1,items:[{id:453,name:'Coal',guidePrice:231},{id:-1,name:'Bad',guidePrice:1}]},
  '/market/items?query=':{version:1,items:[{id:453,name:'Coal',guidePrice:231},{id:4151,name:'Abyssal whip',guidePrice:1500000}]},
  '/market/items?query=A':{version:1,items:[{id:453,name:'Coal',guidePrice:231},{id:4151,name:'Abyssal whip',guidePrice:1500000}]},
  '/market/items/453':{version:1,id:453,name:'Coal',guidePrice:231,min:220,max:243,guideSource:'completed-trades'},
  '/market/items/4151':{version:1,id:4151,name:'Abyssal whip',guidePrice:1500000,min:1425000,max:1575000,guideSource:'content-seed'},
  '/market/items/453/history?days=180':{version:1,itemId:453,source:'completed-trades',timezone:'UTC',points:[
   {date:'2026-08-01',price:200,volume:10,value:2000},{date:'2026-10-20',price:210,volume:5,value:1050},{date:'2026-10-21',price:220,volume:'90071992547409930',value:'1'},{date:'2026-10-28',price:231,volume:3,value:693}]},
  '/market/items/4151/history?days=180':{version:1,itemId:4151,source:'completed-trades',timezone:'UTC',points:[]},
  ...overrides};
 const fetcher=(async(input:URL|string)=>{const u=new URL(input.toString());calls.push(u.pathname+u.search);const body=routes[u.pathname+u.search];
  if(body instanceof Error)throw body;if(typeof body==='number')return new Response('x',{status:body});
  return body===undefined?new Response('Item not found',{status:404}):Response.json(body);}) as typeof fetch;
 return {calls,source:gameMarket('http://game.internal:43595/',{fetch:fetcher,now:()=>now})};
};
test('live GE reads game guide prices and sparse completed-trade history without sample labels',async()=>{
 const {source,calls}=fakeGame();
 const home=await(await handleExchange(req('/grand-exchange?query=coal'),undefined,source))!.text();
 expect(home).toContain('Live Grand Exchange guide prices');expect(home).not.toContain('Sample data');expect(home).toContain('/grand-exchange/items/453');expect(home).not.toContain('Bad');
 const page=await(await handleExchange(req('/grand-exchange/items/453'),undefined,source))!.text();
 expect(page).toContain('<b>Market price:</b> 231');expect(page).toContain('<b>Minimum price:</b> 220');expect(page).toContain('<b>Maximum price:</b> 243');expect(page).toContain('latest completed trading day');
 expect(page).toContain('3 trading days recorded in the last 30 days');expect(page).toContain('A useful fuel.');
 expect(page).toMatch(/30 Days:<\/b> <span class="rise">\+15\.5%/);
 const csv=(await(await handleExchange(req('/grand-exchange/items/453/history.csv?days=30'),undefined,source))!.text()).split('\r\n');
 expect(csv).toEqual(['date,daily_average,volume,source','2026-10-20,210,5,completed-trades','2026-10-21,220,90071992547409930,completed-trades','2026-10-28,231,3,completed-trades']);
 const svg=await(await handleExchange(req('/grand-exchange/items/453/graph.svg?days=30'),undefined,source))!.text();
 expect(svg).toContain('2026-09-30');expect(svg).toContain('2026-10-29');expect(svg).toContain('<circle');expect(svg.match(/<polyline/g)).toHaveLength(2);expect(svg).not.toMatch(/NaN|Infinity/);
 const seeded=await(await handleExchange(req('/grand-exchange/items/4151?days=90'),undefined,source))!.text();
 expect(seeded).toContain('no completed trading day yet');expect(seeded).toContain('No completed trades in the last 90 days');expect(seeded).toContain('<b>Market price:</b> 1.5m');expect(seeded).toContain('n/a');
 expect(await(await handleExchange(req('/grand-exchange/items/4151/graph.svg'),undefined,source))!.text()).toContain('No price history available');
 expect((await handleExchange(req('/grand-exchange/items/1'),undefined,source))!.status).toBe(404);
 expect((await handleExchange(req('/grand-exchange/items/999999'),undefined,source))!.status).toBe(404);
 const whips=await(await handleExchange(req('/grand-exchange?letter=a'),undefined,source))!.text();expect(whips).toContain('Abyssal whip');expect(whips).not.toContain('>Coal<');
 const before=calls.length;await handleExchange(req('/grand-exchange/items/453'),undefined,source);expect(calls.length).toBe(before);
});
test('live GE reports unavailable or malformed game markets as 503 instead of inventing prices',async()=>{
 for(const failure of [new TypeError('refused'),500,{version:2,items:[]},{version:1}]){
  const {source}=fakeGame({'/market/items?query=':failure,'/market/items/453':failure});
  const home=await handleExchange(req('/grand-exchange'),undefined,source);expect(home!.status).toBe(503);expect(await home!.text()).toContain('temporarily unavailable');
  expect((await handleExchange(req('/grand-exchange/items/453/graph.svg'),undefined,source))!.status).toBe(503);
 }
 const {source}=fakeGame({'/market/items/453':{version:1,id:453,name:'Coal',guidePrice:0,min:1,max:2,guideSource:'completed-trades'}});
 expect((await handleExchange(req('/grand-exchange/items/453'),undefined,source))!.status).toBe(503);
});
test('GE windows use calendar days, not row counts, and never interpolate missing days',()=>{
 const history=[{date:'2026-01-01',price:100},{date:'2026-10-01',price:150},{date:'2026-10-29',price:300}];
 const w=priceWindow(history,30,now);expect(w.start).toBe('2026-09-30');expect(w.points.map(p=>p.date)).toEqual(['2026-10-01','2026-10-29']);expect(w.averages).toEqual([150,225]);
 expect(priceChange(history,30,now)).toBeCloseTo(200);expect(priceChange(history,180,now)).toBeCloseTo(200);expect(priceChange(history.slice(1),180,now)).toBeUndefined();
});
test('live GE item pages keep original item frames, link every range button and never show archived market tables',async()=>{
 const archive=await ArchiveSite.load();if(!archive)return;
 const {source}=fakeGame();
 for(const id of [453,4151]){
  const page=await(await handleExchange(req(`/grand-exchange/items/${id}?days=90`),archive,source))!.text();
  expect(page).toContain('id="item_additional"');expect(page).not.toContain('Teak logs');expect(page).not.toContain('Price Rises');expect(page).not.toContain('Sample data');
  for(const d of [30,90,180])expect(page).toContain(`/grand-exchange/items/${id}?days=${d}"`);
  expect(page).toContain('Last 90 Days');
 }
});
