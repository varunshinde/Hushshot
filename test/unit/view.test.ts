import { describe, expect, it } from 'vitest';
import {
  autoScrollSpeed,
  dragCrop,
  fitPageZoom,
  fitWidthZoom,
  isWholeImage,
  MIN_CROP,
  percentOf,
  rectFromPoints,
  roundRect,
  sliderOf,
  stepZoom,
  zoomLimits,
  zoomOfSlider,
} from '../../src/lib/geometry/view';

const img = { width: 2000, height: 10000 };

describe('viewer zoom', () => {
  it('fits width or the whole page, never above 100%', () => {
    expect(fitWidthZoom(1000, 2000, 2)).toBeCloseTo(0.5);
    expect(fitWidthZoom(1000, 400, 2)).toBeCloseTo(0.5); // capped at one image px per device px
    expect(fitPageZoom(1000, 800, 2000, 10000, 1)).toBeCloseTo(0.08);
  });

  it('maps the slider logarithmically and back', () => {
    const limits = zoomLimits(0.02, 2);
    expect(zoomOfSlider(0, limits)).toBeCloseTo(limits[0]);
    expect(zoomOfSlider(1, limits)).toBeCloseTo(limits[1]);
    for (const z of [0.05, 0.3, 1, 3]) expect(zoomOfSlider(sliderOf(z, limits), limits)).toBeCloseTo(z);
  });

  it('steps through round percentages', () => {
    const limits = zoomLimits(0.01, 1);
    expect(percentOf(stepZoom(1, 1, 1, limits), 1)).toBe(125);
    expect(percentOf(stepZoom(1, -1, 1, limits), 1)).toBe(75);
    expect(percentOf(stepZoom(0.6, 1, 1, limits), 1)).toBe(67);
    expect(stepZoom(8, 1, 1, limits)).toBe(limits[1]);
  });
});

describe('crop box', () => {
  const start = { x: 100, y: 100, width: 500, height: 800 };

  it('resizes from corners and edges', () => {
    expect(dragCrop(start, 'se', 50, 70, img)).toEqual({ x: 100, y: 100, width: 550, height: 870 });
    expect(dragCrop(start, 'nw', -20, -30, img)).toEqual({ x: 80, y: 70, width: 520, height: 830 });
    expect(dragCrop(start, 'e', 10, 999, img)).toEqual({ x: 100, y: 100, width: 510, height: 800 });
    expect(dragCrop(start, 'n', 999, 40, img)).toEqual({ x: 100, y: 140, width: 500, height: 760 });
  });

  it('stays inside the image and never smaller than the minimum', () => {
    expect(dragCrop(start, 'nw', -500, -500, img)).toEqual({ x: 0, y: 0, width: 600, height: 900 });
    expect(dragCrop(start, 'se', 5000, 50000, img)).toEqual({ x: 100, y: 100, width: 1900, height: 9900 });
    const tiny = dragCrop(start, 'se', -1000, -1000, img);
    expect(tiny.width).toBe(MIN_CROP);
    expect(tiny.height).toBe(MIN_CROP);
  });

  it('moves the whole box without leaving the image', () => {
    expect(dragCrop(start, 'move', 300, 200, img)).toEqual({ x: 400, y: 300, width: 500, height: 800 });
    expect(dragCrop(start, 'move', 5000, 50000, img)).toEqual({ x: 1500, y: 9200, width: 500, height: 800 });
    expect(dragCrop(start, 'move', -5000, -5000, img)).toEqual({ x: 0, y: 0, width: 500, height: 800 });
  });

  it('draws boxes in any direction and rounds to whole pixels', () => {
    expect(rectFromPoints(300, 400, 100, 50, img)).toEqual({ x: 100, y: 50, width: 200, height: 350 });
    expect(rectFromPoints(-50, -50, 2500, 20000, img)).toEqual({ x: 0, y: 0, width: 2000, height: 10000 });
    expect(roundRect({ x: 10.4, y: 20.6, width: 99.5, height: 50.2 }, img)).toEqual({ x: 10, y: 21, width: 100, height: 50 });
    expect(isWholeImage({ x: 0, y: 0, ...img }, img)).toBe(true);
    expect(isWholeImage(start, img)).toBe(false);
  });

  it('scrolls faster the closer the pointer gets to an edge', () => {
    expect(autoScrollSpeed(500, 0, 1000)).toBe(0);
    expect(autoScrollSpeed(990, 0, 1000)).toBeGreaterThan(autoScrollSpeed(970, 0, 1000));
    expect(autoScrollSpeed(5, 0, 1000)).toBeLessThan(0);
  });
});
