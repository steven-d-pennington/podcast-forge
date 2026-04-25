import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  legacyEpisodeSlug,
  mapLegacyEpisodeStatus,
  normalizeByteArticle,
  normalizeLegacyStory,
} from './legacy.js';

describe('legacy import normalization', () => {
  it('normalizes TSL stories with stable import metadata and canonical URLs', () => {
    const candidate = normalizeLegacyStory({
      id: 'story_123',
      title: 'AI story',
      source: 'Example.com',
      url: 'https://Example.com/story?utm_source=test#section',
      description: 'Summary',
      score: 8,
      origin: 'byte-sized-ranked',
      tags: ['ai-news', 'ranked'],
    }, 0, new Date('2026-04-25T00:00:00Z'));

    assert.ok(candidate);
    assert.equal(candidate.importKey, 'legacy-tsl:story:story_123');
    assert.equal(candidate.canonicalUrl, 'https://example.com/story');
    assert.equal(candidate.score, 8);
    assert.equal(candidate.metadata.importedFrom, 'legacy-tsl');
    assert.equal(candidate.metadata.ranked, true);
  });

  it('merges Byte Sized raw and ranked records deterministically', () => {
    const ranked = new Map([
      ['https://example.com/article', {
        url: 'https://example.com/article',
        score: 9,
        category: 'business',
        one_liner: 'Ranked summary',
      }],
    ]);
    const candidate = normalizeByteArticle({
      title: 'Raw title',
      description: 'Raw summary',
      url: 'https://example.com/article?utm_campaign=x',
      source: 'example.com',
      query: 'AI news',
    }, '2026-04-24', 'raw', ranked, 0);

    assert.ok(candidate);
    assert.equal(candidate.importKey, 'legacy-byte-sized:2026-04-24:raw:https://example.com/article?utm_campaign=x');
    assert.equal(candidate.canonicalUrl, 'https://example.com/article');
    assert.equal(candidate.score, 9);
    assert.equal(candidate.summary, 'Ranked summary');
    assert.equal(candidate.metadata.ranked, true);
  });

  it('preserves published EP metadata decisions', () => {
    const episode = {
      id: 'episode_fd9a594ec4a2',
      title: 'Model Shockwave',
      status: 'published',
      publicAudioUrl: 'https://podcast.example.com/the-synthetic-lens/tsl-ep85-model-shockwave-deepseek-v4.mp3',
    };

    assert.equal(mapLegacyEpisodeStatus(episode), 'published');
    assert.equal(legacyEpisodeSlug(episode), 'tsl-ep85-model-shockwave-deepseek-v4');
  });
});
