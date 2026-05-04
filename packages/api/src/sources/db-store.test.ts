import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { combineOptionalWhereClauses } from './db-store.js';

describe('database source store query helpers', () => {
  it('returns undefined instead of throwing when no optional where clauses are present', () => {
    assert.equal(combineOptionalWhereClauses([]), undefined);
  });
});
