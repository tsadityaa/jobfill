/**
 * A ultra-lightweight markdown-to-HTML parser for the chat agent.
 * Handles bold, italics, headers, lists, code, and line breaks.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  let html = text
    // Escape HTML tags to prevent XSS (basic)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Headers
    .replace(/^### (.*$)/gim, '<h4 style="margin: 8px 0 4px; font-weight: 600; font-size: 0.9rem;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="margin: 12px 0 4px; font-weight: 600; font-size: 1rem;">$1</h3>')
    .replace(/^# (.*$)/gim, '<h2 style="margin: 16px 0 6px; font-weight: 700; font-size: 1.1rem;">$1</h2>')

    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')

    // Inline Code
    .replace(/`(.*?)`/g, '<code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 0.8em;">$1</code>')

    // Code Blocks
    .replace(/```[\s\S]*?\n([\s\S]*?)```/g, '<pre style="background: rgba(128,128,128,0.1); padding: 8px; border-radius: 4px; overflow-x: auto;"><code style="font-family: monospace; font-size: 0.8em;">$1</code></pre>')

    // Unordered Lists (simple bullet points)
    .replace(/^\s*-\s+(.*)$/gim, '<li style="margin-left: 16px;">$1</li>')
    .replace(/^\s*\*\s+(.*)$/gim, '<li style="margin-left: 16px;">$1</li>')

    // Wrap consecutive <li> elements in a <ul> tag
    .replace(/(<li.*?>.*?<\/li>(?:\n|<br\/>)*)+/g, (match) => {
      // Remove any trailing breaks inside the ul
      const cleanMatch = match.replace(/<br\/>/g, '');
      return `<ul style="margin: 4px 0 4px; padding-left: 0; list-style-type: disc;">${cleanMatch}</ul>`;
    })

    // Line breaks for everything else
    .replace(/\n/g, '<br/>');

  // Cleanup: fix lists having <br/> around them unnecessarily
  html = html.replace(/<br\/><ul>/g, '<ul>').replace(/<\/ul><br\/>/g, '</ul>');

  return html;
}
