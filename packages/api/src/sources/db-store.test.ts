import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { asCast, combineOptionalWhereClauses } from './db-store.js';

describe('database source store query helpers', () => {
  it('returns undefined instead of throwing when no optional where clauses are present', () => {
    assert.equal(combineOptionalWhereClauses([]), undefined);
  });

  it('keeps cast members when optional role and persona fields are nullish', () => {
    assert.deepEqual(asCast([
      { name: 'DAVID', role: null, voice: 'Orus', persona: undefined },
      { name: 'MARCUS', role: 'analyst', voice: 'Charon', persona: null },
      { name: 'BAD', role: 42, voice: 'Puck' },
    ]), [
      { name: 'DAVID', voice: 'Orus' },
      { name: 'MARCUS', role: 'analyst', voice: 'Charon' },
    ]);
  });
});
