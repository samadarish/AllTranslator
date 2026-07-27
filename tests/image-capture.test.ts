import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateImagePixelCrop, captureVisibleImage } from '../lib/image-capture';

const { captureVisibleTab } = vi.hoisted(() => ({
  captureVisibleTab: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { captureVisibleTab },
  },
}));

describe('visible image capture geometry', () => {
  beforeEach(() => {
    captureVisibleTab.mockReset();
  });

  it('maps CSS viewport coordinates to screenshot pixels', () => {
    expect(
      calculateImagePixelCrop(2_000, 1_200, {
        left: 100,
        top: 50,
        width: 400,
        height: 300,
        viewportWidth: 1_000,
        viewportHeight: 600,
      }),
    ).toEqual({
      sourceX: 200,
      sourceY: 100,
      sourceWidth: 800,
      sourceHeight: 600,
      outputWidth: 800,
      outputHeight: 600,
    });
  });

  it('clips partially offscreen images and limits the output edge', () => {
    expect(
      calculateImagePixelCrop(
        4_000,
        2_000,
        {
          left: -100,
          top: 100,
          width: 1_200,
          height: 900,
          viewportWidth: 1_000,
          viewportHeight: 500,
        },
        1_000,
      ),
    ).toEqual({
      sourceX: 0,
      sourceY: 400,
      sourceWidth: 4_000,
      sourceHeight: 1_600,
      outputWidth: 1_000,
      outputHeight: 400,
    });
  });

  it('rejects invalid or barely visible capture regions', () => {
    expect(
      calculateImagePixelCrop(1_000, 800, {
        left: 990,
        top: 0,
        width: 100,
        height: 100,
        viewportWidth: 1_000,
        viewportHeight: 800,
      }),
    ).toBeUndefined();
    expect(
      calculateImagePixelCrop(1_000, 800, {
        left: 0,
        top: 0,
        width: Number.NaN,
        height: 100,
        viewportWidth: 1_000,
        viewportHeight: 800,
      }),
    ).toBeUndefined();
  });

  it('returns an actionable error when screenshot permission is unavailable', async () => {
    captureVisibleTab.mockRejectedValue(
      new Error("Either the '<all_urls>' or 'activeTab' permission is required."),
    );

    await expect(
      captureVisibleImage(
        {
          requestId: 'permission-check',
          area: {
            left: 20,
            top: 30,
            width: 400,
            height: 300,
            viewportWidth: 1_000,
            viewportHeight: 800,
          },
        },
        1,
      ),
    ).resolves.toEqual({
      requestId: 'permission-check',
      error: {
        code: 'CAPTURE_PERMISSION_REQUIRED',
        message:
          'Reload or reinstall the updated extension to enable image capture, then try again.',
      },
    });
  });
});
