import {
  MAX_BATCH_CHARACTERS,
  MAX_BATCH_SEGMENTS,
  PRIORITY_BATCH_CHARACTERS,
  PRIORITY_BATCH_SEGMENTS,
} from './constants';
import type { TranslationSegment } from './types';

interface BatchLimits {
  maxSegments: number;
  maxCharacters: number;
}

export function createBatches(
  segments: TranslationSegment[],
  limits: BatchLimits = {
    maxSegments: MAX_BATCH_SEGMENTS,
    maxCharacters: MAX_BATCH_CHARACTERS,
  },
): TranslationSegment[][] {
  const batches: TranslationSegment[][] = [];
  let current: TranslationSegment[] = [];
  let characters = 0;

  for (const segment of segments) {
    const wouldOverflow =
      current.length > 0 &&
      (current.length >= limits.maxSegments ||
        characters + segment.text.length > limits.maxCharacters);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(segment);
    characters += segment.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function createPriorityBatches(segments: TranslationSegment[]): TranslationSegment[][] {
  if (segments.length === 0) return [];

  const [priority = []] = createBatches(segments, {
    maxSegments: PRIORITY_BATCH_SEGMENTS,
    maxCharacters: PRIORITY_BATCH_CHARACTERS,
  });
  const remaining = segments.slice(priority.length);
  return [priority, ...createBatches(remaining)];
}
