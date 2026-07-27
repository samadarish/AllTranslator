import { browser } from 'wxt/browser';
import { IMAGE_CAPTURE_MAX_BYTES, IMAGE_CAPTURE_MAX_EDGE } from './constants';
import type {
  ImageCaptureArea,
  ImageCaptureRequest,
  ImageCaptureResponse,
  TranslationBatchError,
} from './types';

export interface ImagePixelCrop {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function calculateImagePixelCrop(
  bitmapWidth: number,
  bitmapHeight: number,
  area: ImageCaptureArea,
  maxEdge = IMAGE_CAPTURE_MAX_EDGE,
): ImagePixelCrop | undefined {
  if (
    !finitePositive(bitmapWidth) ||
    !finitePositive(bitmapHeight) ||
    !finitePositive(area.width) ||
    !finitePositive(area.height) ||
    !finitePositive(area.viewportWidth) ||
    !finitePositive(area.viewportHeight) ||
    !finitePositive(maxEdge)
  ) {
    return undefined;
  }

  const visibleLeft = Math.max(0, area.left);
  const visibleTop = Math.max(0, area.top);
  const visibleRight = Math.min(area.viewportWidth, area.left + area.width);
  const visibleBottom = Math.min(area.viewportHeight, area.top + area.height);
  if (visibleRight - visibleLeft < 32 || visibleBottom - visibleTop < 32) return undefined;

  const scaleX = bitmapWidth / area.viewportWidth;
  const scaleY = bitmapHeight / area.viewportHeight;
  const sourceX = Math.max(0, Math.floor(visibleLeft * scaleX));
  const sourceY = Math.max(0, Math.floor(visibleTop * scaleY));
  const sourceRight = Math.min(bitmapWidth, Math.ceil(visibleRight * scaleX));
  const sourceBottom = Math.min(bitmapHeight, Math.ceil(visibleBottom * scaleY));
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  if (sourceWidth < 1 || sourceHeight < 1) return undefined;

  const outputScale = Math.min(1, maxEdge / sourceWidth, maxEdge / sourceHeight);
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth: Math.max(1, Math.round(sourceWidth * outputScale)),
    outputHeight: Math.max(1, Math.round(sourceHeight * outputScale)),
  };
}

function error(code: string, message: string): TranslationBatchError {
  return { code, message };
}

function captureError(cause: unknown): TranslationBatchError {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/['"]?<all_urls>['"]?|activeTab/i.test(message) && /permission/i.test(message)) {
    return error(
      'CAPTURE_PERMISSION_REQUIRED',
      'Reload or reinstall the updated extension to enable image capture, then try again.',
    );
  }
  return error('CAPTURE_FAILED', message || 'The image could not be captured.');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type};base64,${bytesToBase64(bytes)}`;
}

async function encodeCanvas(canvas: OffscreenCanvas): Promise<Blob> {
  let blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  if (blob.size > IMAGE_CAPTURE_MAX_BYTES) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
  }
  if (blob.size > IMAGE_CAPTURE_MAX_BYTES) {
    throw new Error('The visible image is too large to translate safely.');
  }
  return blob;
}

export async function captureVisibleImage(
  request: ImageCaptureRequest,
  windowId: number | undefined,
): Promise<ImageCaptureResponse> {
  if (windowId === undefined) {
    return {
      requestId: request.requestId,
      error: error('CAPTURE_UNAVAILABLE', 'The browser could not identify the image tab.'),
    };
  }

  let bitmap: ImageBitmap | undefined;
  try {
    const screenshot = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
    const screenshotBlob = await (await fetch(screenshot)).blob();
    bitmap = await createImageBitmap(screenshotBlob);
    const crop = calculateImagePixelCrop(bitmap.width, bitmap.height, request.area);
    if (!crop) {
      return {
        requestId: request.requestId,
        error: error(
          'IMAGE_NOT_VISIBLE',
          'Bring more of the image into view, then try again.',
        ),
      };
    }

    const canvas = new OffscreenCanvas(crop.outputWidth, crop.outputHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      crop.sourceX,
      crop.sourceY,
      crop.sourceWidth,
      crop.sourceHeight,
      0,
      0,
      crop.outputWidth,
      crop.outputHeight,
    );
    const imageBlob = await encodeCanvas(canvas);
    return {
      requestId: request.requestId,
      imageDataUrl: await blobDataUrl(imageBlob),
      width: crop.outputWidth,
      height: crop.outputHeight,
    };
  } catch (cause) {
    return {
      requestId: request.requestId,
      error: captureError(cause),
    };
  } finally {
    bitmap?.close();
  }
}
