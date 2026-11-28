/**
 * Utility functions for module detail and notebook previews.
 */

/**
 * Strips markdown syntax, code fences, images, links, and HTML to produce a clean plain-text snippet.
 */
export function stripMarkdown(content: string, maxLength = 130): string {
  if (!content || typeof content !== 'string') {
    return 'Empty notebook';
  }

  let text = content;

  // 1. Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, ' ');

  // 2. Remove inline code
  text = text.replace(/`([^`]+)`/g, '$1');

  // 3. Remove image tags: ![alt](url) -> alt
  text = text.replace(/!\[(.*?)\]\(.*?\)/g, '$1');

  // 4. Remove link tags: [text](url) -> text
  text = text.replace(/\[(.*?)\]\(.*?\)/g, '$1');

  // 5. Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // 6. Remove headings (#, ##, etc.) at line starts
  text = text.replace(/^#{1,6}\s+/gm, '');

  // 7. Remove blockquotes and list markers
  text = text.replace(/^>\s+/gm, '');
  text = text.replace(/^[-*+]\s+/gm, '');
  text = text.replace(/^\d+\.\s+/gm, '');
  text = text.replace(/^\[[ xX]\]\s+/gm, '');

  // 8. Remove formatting markers: bold, italic, strikethrough (*, _, ~)
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');

  // 9. Remove horizontal rules
  text = text.replace(/^(?:---|\*\*\*|___)\s*$/gm, '');

  // 10. Collapse all whitespace and newlines
  text = text.replace(/\s+/g, ' ').trim();

  if (!text) {
    return 'Empty notebook';
  }

  if (text.length > maxLength) {
    return `${text.slice(0, maxLength).trim()}…`;
  }

  return text;
}

/**
 * Formats an ISO date string into human-readable format (e.g. "Nov 28, 2026").
 */
export function formatNotebookDate(isoString: string): string {
  if (!isoString) return 'Recently';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
