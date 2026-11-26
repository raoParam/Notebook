import { isSafeAttachmentDataUrl } from '@/lib/markdown';

export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** Maximum original upload file size (10 MB) */
export const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;
/** Threshold above which images are resized/compressed to JPEG */
export const RESIZE_THRESHOLD_BYTES = 900 * 1024;
/** Maximum width/height in pixels before resizing */
export const MAX_IMAGE_SIDE_PX = 1400;

export const ALLOWED_IMAGE_MIME_TYPES = new Set<AllowedImageMime>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

function normalizeDeclaredMime(rawType: string): string {
  const normalized = rawType.trim().toLowerCase();
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  return normalized;
}

/**
 * Inspects file header magic bytes to determine whether the payload matches
 * PNG, JPEG, GIF (87a/89a), or WebP (RIFF....WEBP).
 */
export function detectImageMimeFromBytes(bytes: Uint8Array): AllowedImageMime | null {
  if (bytes.length >= PNG_MAGIC.length) {
    const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
    if (isPng) return 'image/png';
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 && // 8
    (bytes[4] === 0x37 || bytes[4] === 0x39) && // 7 or 9
    bytes[5] === 0x61 // a
  ) {
    return 'image/gif';
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}

async function readHeaderBytes(file: File, byteCount = 16): Promise<Uint8Array> {
  const slice = typeof file.slice === 'function' ? file.slice(0, byteCount) : file;
  if (typeof slice.arrayBuffer === 'function') {
    const buffer = await slice.arrayBuffer();
    return new Uint8Array(buffer).subarray(0, byteCount);
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result).subarray(0, byteCount));
      } else {
        reject(new ImageUploadError('Could not read image header bytes.'));
      }
    };
    reader.onerror = () => reject(new ImageUploadError('Could not read the selected image file.'));
    reader.readAsArrayBuffer(slice);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new ImageUploadError('Could not read the selected image file.'));
      }
    };
    reader.onerror = () => reject(new ImageUploadError('Could not read the selected image file.'));
    reader.readAsDataURL(file);
  });
}

function normalizeDataUrlMime(dataUrl: string, mime: AllowedImageMime): string {
  const base64Marker = ';base64,';
  const idx = dataUrl.indexOf(base64Marker);
  if (idx === -1) {
    return dataUrl;
  }
  const base64Body = dataUrl.slice(idx + base64Marker.length);
  return `data:${mime};base64,${base64Body}`;
}

/**
 * Validates file size, declared MIME type, filename extension (blocks SVG),
 * and actual magic-byte signature. Returns the detected raster image MIME type.
 */
export async function validateImageFile(file: File): Promise<AllowedImageMime> {
  if (!file || typeof file.size !== 'number') {
    throw new ImageUploadError('Invalid image file.');
  }
  if (file.size === 0) {
    throw new ImageUploadError('The selected image file is empty.');
  }
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new ImageUploadError('Image exceeds the 10 MB maximum upload size.');
  }

  const declaredMime = normalizeDeclaredMime(file.type || '');
  const lowerName = (file.name || '').trim().toLowerCase();

  if (declaredMime === 'image/svg+xml' || /\.svgz?$/.test(lowerName)) {
    throw new ImageUploadError(
      'SVG images are not supported for security reasons. Please upload a PNG, JPEG, GIF, or WebP image.'
    );
  }

  if (declaredMime !== '' && !ALLOWED_IMAGE_MIME_TYPES.has(declaredMime as AllowedImageMime)) {
    throw new ImageUploadError(
      'Unsupported file format. Only PNG, JPEG, GIF, and WebP images are allowed.'
    );
  }

  const headerBytes = await readHeaderBytes(file, 16);
  const detectedMime = detectImageMimeFromBytes(headerBytes);

  if (!detectedMime) {
    throw new ImageUploadError(
      'Invalid or unsupported image file. The file signature is not a valid PNG, JPEG, GIF, or WebP image.'
    );
  }

  if (declaredMime !== '' && declaredMime !== detectedMime) {
    throw new ImageUploadError(
      `Image format mismatch: file is declared as ${declaredMime} but contains ${detectedMime} data.`
    );
  }

  return detectedMime;
}

/**
 * Validates, decodes, and (when needed) resizes a local image upload into a safe
 * base64 raster data URL. Rejects on any validation or image decoding failure.
 */
export async function processImageUpload(file: File): Promise<string> {
  const detectedMime = await validateImageFile(file);
  const rawDataUrl = await readFileAsDataUrl(file);
  const safeOriginalUrl = normalizeDataUrlMime(rawDataUrl, detectedMime);

  if (!isSafeAttachmentDataUrl(safeOriginalUrl)) {
    throw new ImageUploadError('The selected file could not be encoded as a valid image.');
  }

  return await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= 0 || img.height <= 0) {
        reject(new ImageUploadError('The selected image is corrupted or has invalid dimensions.'));
        return;
      }

      const largest = Math.max(img.width, img.height);
      if (largest <= MAX_IMAGE_SIDE_PX && file.size <= RESIZE_THRESHOLD_BYTES) {
        resolve(safeOriginalUrl);
        return;
      }

      const scale = Math.min(1, MAX_IMAGE_SIDE_PX / largest);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new ImageUploadError('Could not initialize canvas to process the image.'));
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const resizedUrl = canvas.toDataURL('image/jpeg', 0.88);
      if (!isSafeAttachmentDataUrl(resizedUrl)) {
        reject(new ImageUploadError('Processed image produced an invalid data URL.'));
        return;
      }
      resolve(resizedUrl);
    };
    img.onerror = () => {
      reject(new ImageUploadError('The selected image is corrupted and could not be decoded.'));
    };
    img.src = safeOriginalUrl;
  });
}
