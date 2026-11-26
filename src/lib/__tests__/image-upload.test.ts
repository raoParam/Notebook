// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ImageUploadError,
  MAX_UPLOAD_IMAGE_BYTES,
  RESIZE_THRESHOLD_BYTES,
  detectImageMimeFromBytes,
  processImageUpload,
  validateImageFile,
} from '@/lib/imageUpload';
import { isSafeAttachmentDataUrl } from '@/lib/markdown';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF87A_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00]);
const GIF89A_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // chunk size
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20, // VP8
]);
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

function makeFile(bytes: Uint8Array, name: string, type: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type });
}

describe('detectImageMimeFromBytes', () => {
  it('detects PNG, JPEG, GIF87a, GIF89a, and WebP signatures', () => {
    expect(detectImageMimeFromBytes(PNG_BYTES)).toBe('image/png');
    expect(detectImageMimeFromBytes(JPEG_BYTES)).toBe('image/jpeg');
    expect(detectImageMimeFromBytes(GIF87A_BYTES)).toBe('image/gif');
    expect(detectImageMimeFromBytes(GIF89A_BYTES)).toBe('image/gif');
    expect(detectImageMimeFromBytes(WEBP_BYTES)).toBe('image/webp');
  });

  it('returns null for SVG, truncated headers, RIFF non-WebP, and random bytes', () => {
    expect(detectImageMimeFromBytes(SVG_BYTES)).toBeNull();
    expect(detectImageMimeFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectImageMimeFromBytes(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImageMimeFromBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x38, 0x61]))).toBeNull();
    // RIFF....WAVE (not WEBP)
    expect(
      detectImageMimeFromBytes(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
      )
    ).toBeNull();
    expect(detectImageMimeFromBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBeNull();
  });
});

describe('validateImageFile', () => {
  it('accepts valid PNG, JPEG (including image/jpg alias), GIF, and WebP files', async () => {
    await expect(validateImageFile(makeFile(PNG_BYTES, 'a.png', 'image/png'))).resolves.toBe('image/png');
    await expect(validateImageFile(makeFile(JPEG_BYTES, 'b.jpg', 'image/jpeg'))).resolves.toBe('image/jpeg');
    await expect(validateImageFile(makeFile(JPEG_BYTES, 'b2.jpg', 'image/jpg'))).resolves.toBe('image/jpeg');
    await expect(validateImageFile(makeFile(GIF89A_BYTES, 'c.gif', 'image/gif'))).resolves.toBe('image/gif');
    await expect(validateImageFile(makeFile(WEBP_BYTES, 'd.webp', 'image/webp'))).resolves.toBe('image/webp');
  });

  it('rejects SVG by MIME type, file extension, and spoofed image/png MIME', async () => {
    await expect(
      validateImageFile(makeFile(SVG_BYTES, 'icon.svg', 'image/svg+xml'))
    ).rejects.toThrow(ImageUploadError);

    await expect(
      validateImageFile(makeFile(SVG_BYTES, 'icon.svg', ''))
    ).rejects.toThrow(/SVG/i);

    await expect(
      validateImageFile(makeFile(PNG_BYTES, 'sneaky.svgz', ''))
    ).rejects.toThrow(/SVG/i);

    await expect(
      validateImageFile(makeFile(SVG_BYTES, 'spoofed.png', 'image/png'))
    ).rejects.toThrow(ImageUploadError);
  });

  it('rejects unsupported MIME types', async () => {
    for (const mime of ['text/html', 'application/pdf', 'image/bmp', 'image/tiff', 'image/x-icon']) {
      await expect(
        validateImageFile(makeFile(PNG_BYTES, 'file.bin', mime))
      ).rejects.toThrow(/Unsupported file format/i);
    }
  });

  it('rejects MIME/signature mismatches', async () => {
    await expect(
      validateImageFile(makeFile(PNG_BYTES, 'fake.jpg', 'image/jpeg'))
    ).rejects.toThrow(/mismatch/i);

    await expect(
      validateImageFile(makeFile(JPEG_BYTES, 'fake.png', 'image/png'))
    ).rejects.toThrow(/mismatch/i);

    await expect(
      validateImageFile(makeFile(GIF89A_BYTES, 'fake.webp', 'image/webp'))
    ).rejects.toThrow(/mismatch/i);

    await expect(
      validateImageFile(makeFile(WEBP_BYTES, 'fake.gif', 'image/gif'))
    ).rejects.toThrow(/mismatch/i);
  });

  it('rejects empty, corrupt, or truncated image files', async () => {
    await expect(
      validateImageFile(makeFile(new Uint8Array(0), 'empty.png', 'image/png'))
    ).rejects.toThrow(/empty/i);

    await expect(
      validateImageFile(makeFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'trunc.png', 'image/png'))
    ).rejects.toThrow(ImageUploadError);

    await expect(
      validateImageFile(makeFile(new Uint8Array([0xff, 0xd8]), 'trunc.jpg', 'image/jpeg'))
    ).rejects.toThrow(ImageUploadError);

    await expect(
      validateImageFile(makeFile(new TextEncoder().encode('not-an-image'), 'corrupt.png', 'image/png'))
    ).rejects.toThrow(ImageUploadError);
  });

  it('rejects oversized uploads exceeding 10 MB', async () => {
    const oversized = new Uint8Array(MAX_UPLOAD_IMAGE_BYTES + 1);
    oversized.set(PNG_BYTES, 0);
    const file = makeFile(oversized, 'huge.png', 'image/png');

    await expect(validateImageFile(file)).rejects.toThrow(/10 MB/i);
  });
});

describe('processImageUpload', () => {
  const originalImage = globalThis.Image;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('rejects when image decoding fails instead of returning invalid data URL', async () => {
    class FailingImage {
      width = 0;
      height = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    globalThis.Image = FailingImage as unknown as typeof Image;

    const corruptPng = makeFile(PNG_BYTES, 'broken.png', 'image/png');
    await expect(processImageUpload(corruptPng)).rejects.toThrow(/corrupted and could not be decoded/i);
  });

  it('rejects when decoded image reports zero dimensions', async () => {
    class ZeroDimImage {
      width = 0;
      height = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = ZeroDimImage as unknown as typeof Image;

    const png = makeFile(PNG_BYTES, 'zero.png', 'image/png');
    await expect(processImageUpload(png)).rejects.toThrow(/invalid dimensions/i);
  });

  it('accepts a valid small image and normalizes missing file.type to detected raster MIME', async () => {
    class ValidSmallImage {
      width = 640;
      height = 480;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = ValidSmallImage as unknown as typeof Image;

    const pngNoMime = makeFile(PNG_BYTES, 'photo', '');
    const result = await processImageUpload(pngNoMime);

    expect(result.startsWith('data:image/png;base64,')).toBe(true);
    expect(isSafeAttachmentDataUrl(result)).toBe(true);
  });

  it('resizes large images via canvas and returns a safe JPEG data URL', async () => {
    class LargeImage {
      width = 2800;
      height = 1400;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = LargeImage as unknown as typeof Image;

    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const mockCtx = { fillStyle: '', fillRect, drawImage };
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
          toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQ',
        } as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tagName);
    });

    const largeBytes = new Uint8Array(RESIZE_THRESHOLD_BYTES + 100);
    largeBytes.set(PNG_BYTES, 0);
    const largePng = makeFile(largeBytes, 'large.png', 'image/png');

    const result = await processImageUpload(largePng);
    expect(result).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(isSafeAttachmentDataUrl(result)).toBe(true);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1400, 700);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });
});
