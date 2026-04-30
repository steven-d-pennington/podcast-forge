import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { invalidSpeakerLabels } from './builder.js';

describe('script speaker label extraction', () => {
  it('ignores structural section headings and sentence openers while validating cast speakers', () => {
    const body = [
      'NOVA: Welcome to Weird Machines Weekly.',
      'SEGMENT ONE: The robot that looks absurd but solves a real handling problem.',
      'First: it is tempting to dunk on the design, but the source gives useful context.',
      'The key insight: odd machines often optimize for constraints that are not obvious.',
      'CLOSING: That is the tour for today.',
      'NOVA: Keep the machines weird and the sourcing boring.',
    ].join('\n');

    const invalid = invalidSpeakerLabels(body, [{
      name: 'NOVA',
      role: 'host',
      voice: 'Nova',
      persona: 'Curious host with dry wit.',
    }]);

    assert.deepEqual(invalid, []);
  });
});
