import {expect,test} from 'bun:test';
import {renderRichText,renderContent,safeContentUrl} from '../src/richtext';
test('editor formatting produces safe headings, emphasis, links, lists and inline pictures',()=>{
 const html=renderRichText('## Heading\n\n**Bold** and *italic* [guide](/guide)\n\n![Example](https://example.com/image.png)\n\n- First\n- Second');
 expect(html).toContain('<h3>Heading</h3>');expect(html).toContain('<strong>Bold</strong>');expect(html).toContain('<em>italic</em>');expect(html).toContain('href="/guide"');expect(html).toContain('src="https://example.com/image.png"');expect(html).toContain('<ul><li>First</li><li>Second</li></ul>');
});
test('raw HTML and hostile URLs cannot become active markup',()=>{
 const html=renderRichText('<script>alert(1)</script>\n\n[x](javascript:alert) ![x](data:image/svg+xml,evil) ![x](//evil.invalid/x) [x](https://good.invalid/"onclick="evil)');
 expect(html).not.toContain('<script');expect(html).not.toContain('<img');expect(html).not.toContain(' onclick=');expect(html).toContain('&lt;script&gt;');expect(safeContentUrl('https://user:pass@example.com')).toBeUndefined();expect(safeContentUrl('/local/image.png',true)).toBe('/local/image.png');expect(renderContent('**legacy**')).toContain('**legacy**');
});
