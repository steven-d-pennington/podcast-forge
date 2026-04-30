export const MODEL_ROLE_LABELS = {
  episode_planner: {
    title: 'Episode planner',
    description: 'Drafts advisory story briefs and episode plans before research begins.',
  },
  candidate_scorer: {
    title: 'Candidate scorer',
    description: 'Ranks possible stories for editorial fit, significance, novelty, source quality, and urgency.',
  },
  source_summarizer: {
    title: 'Source summarizer',
    description: 'Summarizes fetched source snapshots without adding unsupported claims.',
  },
  claim_extractor: {
    title: 'Claim extractor',
    description: 'Turns source material into attributed claims for the research brief.',
  },
  research_synthesizer: {
    title: 'Research synthesizer',
    description: 'Builds the evidence-first research brief and preserves uncertainty.',
  },
  script_writer: {
    title: 'Script writer',
    description: 'Drafts the episode script from approved research brief material.',
  },
  script_editor: {
    title: 'Script editor',
    description: 'Revises drafts while preserving citation and provenance metadata.',
  },
  integrity_reviewer: {
    title: 'Integrity reviewer',
    description: 'Checks script drafts against source evidence before production.',
  },
  metadata_writer: {
    title: 'Metadata writer',
    description: 'Creates episode titles, summaries, and feed metadata.',
  },
  cover_prompt_writer: {
    title: 'Cover prompt writer',
    description: 'Writes art direction for cover image generation.',
  },
};

export const SETTINGS_SECTIONS = {
  basic: 'Basic show settings',
  sources: 'Content sources',
  publishing: 'Publishing',
  automation: 'Automation',
  ai: 'AI configuration',
  advanced: 'Advanced/internal',
};

export const SURFACES = new Set(['workflow', 'settings', 'debug']);
