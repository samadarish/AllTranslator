import { describe, expect, it } from 'vitest';
import { createBatches, createPriorityBatches } from '../lib/batching';

describe('translation batching', () => {
  it('caps regular batches at six segments', () => {
    const segments = Array.from({ length: 13 }, (_, index) => ({
      id: `s${index}`,
      text: `Segment ${index}`,
    }));
    expect(createBatches(segments).map((batch) => batch.length)).toEqual([6, 6, 1]);
  });

  it('starts a new batch before exceeding the character budget', () => {
    const segments = [
      { id: 's1', text: 'a'.repeat(800) },
      { id: 's2', text: 'b'.repeat(500) },
    ];
    expect(createBatches(segments)).toHaveLength(2);
  });

  it('keeps a single oversized text segment intact', () => {
    const segments = [{ id: 's1', text: 'a'.repeat(1_500) }];
    expect(createBatches(segments)).toEqual([segments]);
  });

  it('uses a small first batch and larger follow-up batches', () => {
    const segments = Array.from({ length: 30 }, (_, index) => ({
      id: `s${index}`,
      text: `Text ${index}`,
    }));

    expect(createPriorityBatches(segments).map((batch) => batch.length)).toEqual([
      4, 6, 6, 6, 6, 2,
    ]);
  });
});
