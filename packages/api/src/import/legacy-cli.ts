import 'dotenv/config';

import { importLegacyData } from './legacy.js';

function optionValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const summary = await importLegacyData({
  showSlug: optionValue('show-slug'),
  tslStoriesPath: optionValue('tsl-stories'),
  tslEpisodesPath: optionValue('tsl-episodes'),
  byteRawDir: optionValue('byte-raw'),
  byteRankedDir: optionValue('byte-ranked'),
});

console.log(JSON.stringify(summary, null, 2));
