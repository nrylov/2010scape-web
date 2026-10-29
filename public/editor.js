/* Progressive enhancement: the ordinary save form also works without JavaScript. */
for (const form of document.querySelectorAll('.editorial-editor, .forum-compose-form')) {
  const body = form.querySelector('textarea[name="body"]');
  const format = form.querySelector('[name="format"]');
  const preview = form.querySelector('.editor-preview');
  for (const button of form.querySelectorAll('[data-format]')) button.addEventListener('click', () => {
    const start = body.selectionStart, end = body.selectionEnd, selected = body.value.slice(start, end);
    let insertion;
    switch (button.dataset.format) {
      case 'bold': insertion = `**${selected || 'bold text'}**`; break;
      case 'italic': insertion = `*${selected || 'italic text'}*`; break;
      case 'heading': insertion = `\n\n## ${selected || 'Heading'}\n\n`; break;
      case 'list': insertion = `\n- ${selected || 'List item'}\n`; break;
      case 'link': {
        const url = prompt('Link URL', 'https://'); if (!url) return;
        insertion = `[${selected || 'Link text'}](${url})`; break;
      }
      case 'image': {
        const url = prompt('Picture URL (HTTPS or a local /assets/ image)', 'https://'); if (!url) return;
        const alt = prompt('Describe the picture', selected || '') ?? '';
        insertion = `![${alt}](${url})`; break;
      }
    }
    if (insertion === undefined) return;
    if (format) format.value = 'markdown'; body.setRangeText(insertion, start, end, 'select'); body.focus();
  });
  form.querySelector('[data-preview]').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; preview.hidden = false; preview.textContent = 'Loading preview…';
    try {
      const response = await fetch(form.dataset.previewUrl || '/admin/preview', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:form.elements.csrf.value,body:body.value,format:format?.value || 'markdown'})});
      if (!response.ok) throw new Error('Preview is unavailable. Reload the editor and try again.');
      const result = await response.json(); preview.innerHTML = result.html;
    } catch (error) { preview.textContent = error.message; }
    finally { button.disabled = false; }
  });
}
