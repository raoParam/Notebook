// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { AttachmentEntry } from '@/lib/db';
import {
  isSafeAttachmentDataUrl,
  renderSafeMarkdown,
  resolveSafeAttachments,
} from '@/lib/markdown';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const WEBP_DATA_URL = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
const SVG_DATA_URL = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=';

function makeAttachment(name: string, data: string): AttachmentEntry {
  return { name, data, createdAt: '2026-01-01T00:00:00.000Z' };
}

function parseFragment(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('isSafeAttachmentDataUrl', () => {
  it('accepts valid base64 raster image data URLs', () => {
    expect(isSafeAttachmentDataUrl(PNG_DATA_URL)).toBe(true);
    expect(isSafeAttachmentDataUrl(JPEG_DATA_URL)).toBe(true);
    expect(isSafeAttachmentDataUrl(WEBP_DATA_URL)).toBe(true);
    expect(isSafeAttachmentDataUrl('data:image/jpg;base64,AAAA')).toBe(true);
    expect(isSafeAttachmentDataUrl('data:image/gif;base64,R0lGODlh')).toBe(true);
    expect(isSafeAttachmentDataUrl('DATA:IMAGE/PNG;BASE64,AAAA==')).toBe(true);
  });

  it('rejects svg, html, javascript, http(s), whitespace, parens, quotes, and newlines', () => {
    expect(isSafeAttachmentDataUrl(SVG_DATA_URL)).toBe(false);
    expect(isSafeAttachmentDataUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
    expect(isSafeAttachmentDataUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeAttachmentDataUrl('https://example.com/a.png')).toBe(false);
    expect(isSafeAttachmentDataUrl('http://example.com/a.png')).toBe(false);
    expect(isSafeAttachmentDataUrl(' data:image/png;base64,AAAA')).toBe(false);
    expect(isSafeAttachmentDataUrl('data:image/png;base64,AAAA ')).toBe(false);
    expect(isSafeAttachmentDataUrl('data:image/png;base64,AA)AA')).toBe(false);
    expect(isSafeAttachmentDataUrl('data:image/png;base64,"AAAA"')).toBe(false);
    expect(isSafeAttachmentDataUrl("data:image/png;base64,'AAAA'")).toBe(false);
    expect(isSafeAttachmentDataUrl('data:image/png;base64,AA\nAA')).toBe(false);
    expect(isSafeAttachmentDataUrl(null)).toBe(false);
    expect(isSafeAttachmentDataUrl(undefined)).toBe(false);
    expect(isSafeAttachmentDataUrl(123)).toBe(false);
  });
});

describe('resolveSafeAttachments', () => {
  it('resolves valid raster attachments and leaves unsafe/malformed/prototype keys unresolved', () => {
    const attachments: Record<string, AttachmentEntry> = {
      pic: makeAttachment('pic.png', PNG_DATA_URL),
      svg: makeAttachment('bad.svg', SVG_DATA_URL),
      breakout: makeAttachment('evil.png', 'x)<img src=x onerror=alert(1)>'),
    };

    const md = '![pic] ![svg] ![breakout] ![constructor] ![already](https://example.com/a.png)';
    const resolved = resolveSafeAttachments(md, attachments);

    expect(resolved).toContain(`![pic](${PNG_DATA_URL})`);
    expect(resolved).toContain('![svg]');
    expect(resolved).not.toContain(SVG_DATA_URL);
    expect(resolved).toContain('![breakout]');
    expect(resolved).not.toContain('<img src=x onerror=alert(1)>');
    expect(resolved).toContain('![constructor]');
    expect(resolved).toContain('![already](https://example.com/a.png)');
  });
});

describe('renderSafeMarkdown security and rendering', () => {
  it('returns empty string for blank input', async () => {
    expect(await renderSafeMarkdown('', {})).toBe('');
    expect(await renderSafeMarkdown('   \n\t  ', {})).toBe('');
  });

  it('strips script tags', async () => {
    const html = await renderSafeMarkdown('Hello <script>alert(1)</script> world', {});
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('Hello');
    expect(html).toContain('world');
  });

  it('strips event-handler attributes', async () => {
    const html = await renderSafeMarkdown(
      '<img src="x" onerror="alert(1)"><div onmouseover="alert(1)">hi</div>',
      {}
    );
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onmouseover');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('<div>hi</div>');
  });

  it('strips dangerous URL schemes in links, images, form, style, and svg/mathml attributes', async () => {
    const html = await renderSafeMarkdown(
      [
        '[x](javascript:alert(1))',
        '![x](javascript:alert(1))',
        '<a href="data:text/html,<script>alert(1)</script>">html-link</a>',
        '<a href="vbscript:msgbox(1)">vbs-link</a>',
        '<a href="java&#x09;script:alert(1)">tab-link</a>',
        '<img src="data:text/html,<script>alert(1)</script>" alt="bad-img">',
        '<img srcset="javascript:alert(1)" alt="bad-srcset">',
        '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">go</button></form>',
        '<svg><a xlink:href="javascript:alert(1)"><text>svg-link</text></a></svg>',
        '<math><mi href="javascript:alert(1)">x</mi></math>',
        '<div style="background:url(javascript:alert(1))">styled</div>',
      ].join('\n'),
      {}
    );

    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/vbscript:/i);
    expect(html).not.toMatch(/data:text\/html/i);
    expect(html).not.toContain('action=');
    expect(html).not.toContain('formaction=');
    expect(html).not.toContain('xlink:href');
    expect(html).not.toContain('srcset=');
    expect(html).not.toContain('style=');
    expect(html).toContain('html-link');
    expect(html).toContain('vbs-link');
  });

  it('blocks unsafe SVG attachments and inline SVG data URLs', async () => {
    const attachments: Record<string, AttachmentEntry> = {
      bad: makeAttachment('bad.svg', SVG_DATA_URL),
    };
    const html = await renderSafeMarkdown(
      `![bad]\n\n<img src="${SVG_DATA_URL}" alt="inline-svg">\n\n<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="raw-svg">`,
      attachments
    );

    expect(html).not.toContain('data:image/svg+xml');
    expect(html).toContain('![bad]');
    const root = parseFragment(html);
    const imgs = Array.from(root.querySelectorAll('img'));
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      expect(img.getAttribute('src')).toBeNull();
    }
  });

  it('prevents malformed attachment data from breaking Markdown image syntax', async () => {
    const attachments: Record<string, AttachmentEntry> = {
      evil: makeAttachment('evil.png', 'x)<img src=x onerror=alert(1)>'),
    };
    const html = await renderSafeMarkdown('![evil]', attachments);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('![evil]');
  });

  it('renders valid PNG, JPEG, and WebP attachments', async () => {
    const attachments: Record<string, AttachmentEntry> = {
      pngPhoto: makeAttachment('a.png', PNG_DATA_URL),
      jpgPhoto: makeAttachment('b.jpg', JPEG_DATA_URL),
      webpPhoto: makeAttachment('c.webp', WEBP_DATA_URL),
    };

    const html = await renderSafeMarkdown('![pngPhoto]\n![jpgPhoto]\n![webpPhoto]', attachments);
    const root = parseFragment(html);
    const imgs = Array.from(root.querySelectorAll('img'));

    expect(imgs).toHaveLength(3);
    expect(imgs[0].getAttribute('alt')).toBe('pngPhoto');
    expect(imgs[0].getAttribute('src')).toBe(PNG_DATA_URL);
    expect(imgs[1].getAttribute('alt')).toBe('jpgPhoto');
    expect(imgs[1].getAttribute('src')).toBe(JPEG_DATA_URL);
    expect(imgs[2].getAttribute('alt')).toBe('webpPhoto');
    expect(imgs[2].getAttribute('src')).toBe(WEBP_DATA_URL);
  });

  it('renders normal Markdown features and safe links accurately', async () => {
    const md = [
      '# Title',
      '',
      'Some **bold** text and [safe link](https://example.com/docs) and [mail](mailto:hi@example.com) and [hash](#sec) and [rel](/notes).',
      '',
      '- Item 1',
      '- Item 2',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');

    const html = await renderSafeMarkdown(md, {});

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html).toContain('href="#sec"');
    expect(html).toContain('href="/notes"');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Item 1</li>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Col A</th>');
  });

  it('preserves KaTeX inline, display math, MathML, and dollar-sign tokens safely', async () => {
    const html = await renderSafeMarkdown(
      'Inline $E=mc^2$ and $$a^2 + b^2 = c^2$$ and $$\\text{cost } \\$100 \\text{ and } \\$2$$ and $\\sqrt{x}$',
      {}
    );

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('<math');
    expect(html).toContain('<annotation encoding="application/x-tex">E=mc^2</annotation>');
    expect(html).toContain('<annotation encoding="application/x-tex">a^2 + b^2 = c^2</annotation>');
    expect(html).toContain('\\$100');
    expect(html).toContain('\\$2');
    expect(html).toContain('<svg');
  });

  it('handles concurrent renders cleanly without hook leakage', async () => {
    const results = await Promise.all([
      renderSafeMarkdown('[bad](javascript:alert(1))', {}),
      renderSafeMarkdown('[good](https://example.com)', {}),
      renderSafeMarkdown('![png](data:image/png;base64,AAAA)', {}),
    ]);

    expect(results[0]).not.toContain('javascript:');
    expect(results[1]).toContain('href="https://example.com"');
    expect(results[2]).toContain('src="data:image/png;base64,AAAA"');
  });
});
