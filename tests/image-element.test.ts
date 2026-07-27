import { beforeEach, describe, expect, it } from 'vitest';
import { findEligibleImage, isEligibleImage } from '../lib/image-element';

function setRect(element: Element, rect: Partial<DOMRect> = {}): void {
  const value = {
    x: 20,
    y: 30,
    left: 20,
    top: 30,
    right: 420,
    bottom: 330,
    width: 400,
    height: 300,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => value,
  });
}

describe('image translation eligibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts substantial visible webpage images', () => {
    const image = document.createElement('img');
    document.body.append(image);
    setRect(image);

    expect(isEligibleImage(image, window)).toBe(true);
    expect(findEligibleImage([image, document.body], window)).toBe(image);
  });

  it('ignores tiny, hidden, presentational, and button images', () => {
    const tiny = document.createElement('img');
    document.body.append(tiny);
    setRect(tiny, { right: 60, bottom: 70, width: 40, height: 40 });
    expect(isEligibleImage(tiny, window)).toBe(false);

    const hidden = document.createElement('img');
    hidden.setAttribute('aria-hidden', 'true');
    document.body.append(hidden);
    setRect(hidden);
    expect(isEligibleImage(hidden, window)).toBe(false);

    const button = document.createElement('button');
    const buttonImage = document.createElement('img');
    button.append(buttonImage);
    document.body.append(button);
    setRect(buttonImage);
    expect(isEligibleImage(buttonImage, window)).toBe(false);
  });

  it('finds images dispatched through an open shadow root', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const image = document.createElement('img');
    shadow.append(image);
    document.body.append(host);
    setRect(image);

    expect(findEligibleImage([image, shadow, host, document.body], window)).toBe(image);
  });
});
