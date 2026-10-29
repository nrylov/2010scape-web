import {nativeLegacyUrl} from "./site-routes";
/** Small Markdown dialect. Raw HTML is always text; every generated attribute is escaped. */
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export type ContentFormat = 'plain' | 'markdown';
export function safeContentUrl(value: string, image = false): string | undefined {
  const url = nativeLegacyUrl(value.trim()) ?? value.trim();
  if (!url || /[\u0000-\u0020\u007f\\]/.test(url)) return;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (!image && /^#[a-z0-9_-]+$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || !(image ? ['https:'] : ['https:', 'http:']).includes(parsed.protocol)) return;
    return parsed.href;
  } catch { return; }
}
function inline(source: string, depth = 0): string {
  if (depth > 4) return escape(source);
  const tokens = /`([^`\n]+)`|(!?)\[([^\]\n]*)\]\(([^)\n]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\\([\\`*_\[\]#!])/g;
  let output = '', previous = 0;
  for (const match of source.matchAll(tokens)) {
    output += escape(source.slice(previous, match.index));
    if (match[1] !== undefined) output += `<code>${escape(match[1])}</code>`;
    else if (match[2] !== undefined) {
      const image = match[2] === '!', url = safeContentUrl(match[4]!, image);
      output += !url ? escape(match[0]) : image
        ? `<img src="${escape(url)}" alt="${escape(match[3]!)}" loading="lazy" decoding="async">`
        : `<a href="${escape(url)}" rel="noopener noreferrer">${inline(match[3]!, depth + 1)}</a>`;
    } else if (match[5] !== undefined || match[6] !== undefined) output += `<strong>${inline(match[5] ?? match[6]!, depth + 1)}</strong>`;
    else if (match[7] !== undefined || match[8] !== undefined) output += `<em>${inline(match[7] ?? match[8]!, depth + 1)}</em>`;
    else output += escape(match[9]!);
    previous = match.index! + match[0].length;
  }
  return output + escape(source.slice(previous));
}
export function renderRichText(source: string, depth = 0): string {
  if (depth > 4) return `<p>${escape(source)}</p>`;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = []; index++;
      while (index < lines.length && !/^\s*```/.test(lines[index]!)) code.push(lines[index++]!);
      index++; output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { const level = Math.min(heading[1]!.length + 1, 4); output.push(`<h${level}>${inline(heading[2]!)}</h${level}>`); index++; continue; }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { output.push('<hr>'); index++; continue; }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) quote.push(lines[index++]!.replace(/^>\s?/, ''));
      output.push(`<blockquote>${renderRichText(quote.join('\n'), depth + 1)}</blockquote>`); continue;
    }
    const list = /^(?:[-*]\s+|\d+\.\s+).+/.exec(line);
    if (list) {
      const ordered = /^\d/.test(line), items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/;
      let item: RegExpExecArray | null;
      while (index < lines.length && (item = pattern.exec(lines[index]!))) { items.push(`<li>${inline(item[1]!)}</li>`); index++; }
      output.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && (paragraph.length === 0 || !/^(?:#{1,4}\s|>\s?|[-*]\s|\d+\.\s|\s*```)/.test(lines[index]!))) paragraph.push(lines[index++]!);
    output.push(`<p>${paragraph.map(line => inline(line)).join('<br>')}</p>`);
  }
  return output.join('\n');
}
export function renderContent(source: string, format: ContentFormat = 'plain'): string {
  return format === 'markdown' ? renderRichText(source) : source.split(/\n\s*\n/).map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}
export function contentExcerpt(source: string, limit = 260): string {
  const text = source.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[#>\s*-]+/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, limit) + (text.length > limit ? '…' : '');
}
