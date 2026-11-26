import type { AttachmentEntry } from '@/lib/db';

const SAFE_ATTACHMENT_DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

const MATHML_TAGS = [
  'math',
  'menclose',
  'merror',
  'mfrac',
  'mi',
  'mlabeledtr',
  'mmultiscripts',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mroot',
  'mrow',
  'ms',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msup',
  'msubsup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'mprescripts',
  'semantics',
  'annotation',
  'annotation-xml',
];

const URL_ATTRS = new Set([
  'href',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'data',
  'background',
  'cite',
  'longdesc',
  'dynsrc',
  'lowsrc',
]);

// ASCII control characters and whitespace can mask dangerous schemes in URL parsers.
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

interface DOMPurifyAttrHookEvent {
  attrName: string;
  attrValue: string;
  keepAttr: boolean;
  forceKeepAttr?: boolean;
}

interface DOMPurifyInstance {
  sanitize(dirty: string, cfg?: Record<string, unknown>): string;
  addHook(
    entryPoint: 'uponSanitizeAttribute',
    hook: (node: Element, data: DOMPurifyAttrHookEvent) => void
  ): void;
  removeHook(
    entryPoint: 'uponSanitizeAttribute',
    hook?: (node: Element, data: DOMPurifyAttrHookEvent) => void
  ): void;
}

/**
 * Validates that an attachment data URL is strictly a safe raster image base64 URL.
 */
export function isSafeAttachmentDataUrl(data: unknown): data is string {
  return typeof data === 'string' && SAFE_ATTACHMENT_DATA_URL_RE.test(data);
}

/**
 * Resolves `![label]` attachment placeholders only when the attachment exists
 * and holds a safe raster image data URL.
 */
export function resolveSafeAttachments(
  content: string,
  attachments: Record<string, AttachmentEntry>
): string {
  if (!content || !attachments) return content;

  return content.replace(/!\[([^\]\r\n]+)\](?!\()/g, (match, label: string) => {
    const key = label.trim();
    if (!key || !Object.prototype.hasOwnProperty.call(attachments, key)) {
      return match;
    }
    const att = attachments[key];
    if (!att || !isSafeAttachmentDataUrl(att.data)) {
      return match;
    }
    return `![${label}](${att.data})`;
  });
}

function isSafeHttpOrRelativeUrl(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed || CONTROL_CHAR_RE.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true;
  return false;
}

function isSafeImgSrc(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed || CONTROL_CHAR_RE.test(trimmed)) return false;
  if (isSafeAttachmentDataUrl(trimmed)) return true;
  return isSafeHttpOrRelativeUrl(trimmed);
}

function isSafeAnchorHref(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed || CONTROL_CHAR_RE.test(trimmed)) return false;
  if (/^mailto:/i.test(trimmed)) return true;
  return isSafeHttpOrRelativeUrl(trimmed);
}

function isSafeSrcset(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed || CONTROL_CHAR_RE.test(trimmed)) return false;
  return trimmed.split(',').every((part) => {
    const url = part.trim().split(/\s+/)[0] ?? '';
    return isSafeHttpOrRelativeUrl(url);
  });
}

function sanitizeAttributeHook(node: Element, data: DOMPurifyAttrHookEvent): void {
  const attrName = data.attrName.toLowerCase();
  const tagName = node.tagName ? node.tagName.toLowerCase() : '';
  const value = data.attrValue;

  if (attrName === 'src') {
    const allowed = tagName === 'img' ? isSafeImgSrc(value) : isSafeHttpOrRelativeUrl(value);
    if (!allowed) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
    }
    return;
  }

  if (attrName === 'srcset') {
    if (!isSafeSrcset(value)) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
    }
    return;
  }

  if (attrName === 'href') {
    const allowed = tagName === 'a' ? isSafeAnchorHref(value) : isSafeHttpOrRelativeUrl(value);
    if (!allowed) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
    }
    return;
  }

  if (URL_ATTRS.has(attrName)) {
    if (!isSafeHttpOrRelativeUrl(value)) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
    }
    return;
  }

  if (attrName === 'ping') {
    const urls = value.trim().split(/\s+/);
    if (!urls.every((u) => isSafeHttpOrRelativeUrl(u))) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
    }
    return;
  }

  if (attrName === 'style') {
    const collapsed = value.replace(/[\u0000-\u0020\u007f]+/g, '');
    if (/(?:javascript:|vbscript:|expression\s*\(|@import|url\s*\(|data:text\/html|data:image\/svg\+xml)/i.test(collapsed)) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
    }
  }
}

async function getDOMPurify(): Promise<DOMPurifyInstance> {
  if (typeof window === 'undefined') {
    throw new Error('renderSafeMarkdown requires a DOM window environment');
  }

  const mod = (await import('dompurify')) as unknown as {
    default?: unknown;
    sanitize?: unknown;
  };
  const candidate = mod.default ?? mod;

  if (
    typeof candidate === 'function' &&
    typeof (candidate as Partial<DOMPurifyInstance>).sanitize !== 'function'
  ) {
    return (candidate as (win: Window) => DOMPurifyInstance)(window);
  }

  return candidate as DOMPurifyInstance;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders Markdown + KaTeX math + safe raster image attachments into sanitized HTML.
 */
export async function renderSafeMarkdown(
  content: string,
  attachments: Record<string, AttachmentEntry>
): Promise<string> {
  if (!content || !content.trim()) return '';

  const { marked } = await import('marked');
  marked.setOptions({ breaks: true, gfm: true });

  let processed = resolveSafeAttachments(content, attachments);

  // Extract math blocks before Markdown parsing so underscores/backslashes stay intact.
  const mathBlocks: Array<{ id: string; math: string; display: boolean }> = [];

  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, math: string) => {
    const id = `KATEXMBLOCK${mathBlocks.length}END`;
    mathBlocks.push({ id, math: math.trim(), display: true });
    return id;
  });
  processed = processed.replace(/\$(?!\s)([^$]*?\S)\$/g, (_, math: string) => {
    const id = `KATEXMINLINE${mathBlocks.length}END`;
    mathBlocks.push({ id, math: math.trim(), display: false });
    return id;
  });

  let html = await marked.parse(processed);

  if (mathBlocks.length > 0 && typeof window !== 'undefined') {
    const katexMod = await import('katex');
    const katex = katexMod.default ?? katexMod;
    for (const { id, math, display } of mathBlocks) {
      try {
        const rendered = katex.renderToString(math, {
          displayMode: display,
          throwOnError: false,
        });
        html = html.replace(id, () => rendered);
      } catch {
        html = html.replace(id, () => `<code>${escHtml(math)}</code>`);
      }
    }
  }

  const purify = await getDOMPurify();
  purify.addHook('uponSanitizeAttribute', sanitizeAttributeHook);
  try {
    return purify.sanitize(html, {
      ADD_TAGS: MATHML_TAGS,
      ADD_ATTR: ['encoding'],
    });
  } finally {
    purify.removeHook('uponSanitizeAttribute', sanitizeAttributeHook);
  }
}
