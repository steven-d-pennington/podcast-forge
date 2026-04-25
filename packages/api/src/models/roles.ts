export const MODEL_ROLES = [
  'candidate_scorer',
  'source_summarizer',
  'claim_extractor',
  'research_synthesizer',
  'script_writer',
  'script_editor',
  'metadata_writer',
  'cover_prompt_writer',
] as const;

export type ModelRole = typeof MODEL_ROLES[number];

const modelRoleSet = new Set<string>(MODEL_ROLES);

export function isModelRole(value: string): value is ModelRole {
  return modelRoleSet.has(value);
}
