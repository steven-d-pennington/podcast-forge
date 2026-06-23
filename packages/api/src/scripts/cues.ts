export function isStructuralScriptCue(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, ' ');
  return /^(intro|introduction|opening|cold open|segment( [a-z0-9-]+)?|closing|outro|recap|summary)$/.test(normalized)
    || /^(first|second|third|fourth|fifth|next|then|finally|and finally)$/.test(normalized)
    || /^(the key insight|key insight|takeaway|practical takeaway|source note|editor note)$/.test(normalized);
}
