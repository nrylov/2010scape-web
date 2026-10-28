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
 const history=await samplePrices.history(1333);expect(history).toHaveLength(210);expect(await samplePrices.history(1333)).toEqual(history);
 expect(priceGraph([],30,'No data')).toContain('No price history');
});
test('GE adapters preserve supplied original template frames while replacing historical prices and graph images',async()=>{
 const archive=await ArchiveSite.load();if(!archive)return;
 const page=await(await handleExchange(req('/grand-exchange/items/1333?days=90'),archive))!.text();
 expect(page).toContain('id="item_additional"');expect(page).toContain('id="item_graph_image"');expect(page).toContain('/grand-exchange/items/1333/graph.svg?days=90');expect(page).toContain('Last 90 Days');expect(page).toContain('button_180.png');expect(page).not.toContain('3062d_graphimg3eaae.gif');expect(page).toContain('Sample data');
 const home=await(await handleExchange(req('/grand-exchange'),archive))!.text();expect(home).toContain('class="top5_table row_a"');expect(home).toContain('name="query"');expect(home).not.toContain('Teak logs');
});
