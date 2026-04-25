import type { ResolvedModelProfile } from '../models/resolver.js';
import type { ResearchClaim, ResearchPacketRecord } from '../research/store.js';
import type { ShowRecord } from '../sources/store.js';

export interface BuiltScriptDraft {
  title: string;
  body: string;
  format: string;
  speakers: string[];
  metadata: Record<string, unknown>;
}

interface SpeakerPlan {
  host: string;
  analyst: string;
  correspondent: string;
}

function castName(show: ShowRecord, preferredRole: string, fallbackIndex: number): string {
  return show.cast.find((member) => member.role === preferredRole)?.name
    ?? show.cast[fallbackIndex]?.name
    ?? show.cast[0]?.name
    ?? 'HOST';
}

function speakerPlan(show: ShowRecord): SpeakerPlan {
  return {
    host: castName(show, 'host', 0),
    analyst: castName(show, 'analyst', 1),
    correspondent: castName(show, 'correspondent', 2),
  };
}

function citationIndex(claim: ResearchClaim): string {
  if (claim.citationUrls.length === 0) {
    return 'source on file';
  }

  return claim.citationUrls.map((url, index) => `[${index + 1}] ${url}`).join('; ');
}

function takeClaims(packet: ResearchPacketRecord, count: number): ResearchClaim[] {
  return packet.claims.slice(0, count);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractSpeakerLabels(body: string): string[] {
  const labels = new Set<string>();
  const matches = body.matchAll(/^([A-Za-z][A-Za-z0-9 _-]{0,63}):/gm);

  for (const match of matches) {
    labels.add(match[1].trim());
  }

  return [...labels];
}

export function invalidSpeakerLabels(body: string, cast: ShowRecord['cast']): string[] {
  const allowed = new Set(cast.map((member) => member.name));
  return extractSpeakerLabels(body).filter((speaker) => !allowed.has(speaker));
}

export function buildDeterministicScriptDraft(
  show: ShowRecord,
  packet: ResearchPacketRecord,
  modelProfile: ResolvedModelProfile | undefined,
  requestedFormat?: string,
): BuiltScriptDraft {
  const format = requestedFormat ?? show.format ?? 'feature-analysis';
  const speakers = speakerPlan(show);
  const claims = takeClaims(packet, 4);
  const summary = asString(packet.content.summary)
    ?? asString(packet.content.candidateSummary)
    ?? 'The packet does not include a synthesized summary yet.';
  const warningText = packet.warnings.length > 0
    ? packet.warnings.map((warning) => `${warning.code}: ${warning.message}`).join(' ')
    : 'No packet warnings are currently recorded.';
  const firstClaim = claims[0]?.text ?? 'The packet has no extracted factual claims yet.';
  const secondClaim = claims[1]?.text ?? 'Editors should add more sourced detail before production.';
  const thirdClaim = claims[2]?.text ?? 'The next pass should decide what is known, what is inferred, and what remains uncertain.';
  const citationLines = claims.length > 0
    ? claims.map((claim, index) => `${index + 1}. ${claim.text} (${citationIndex(claim)})`).join('\n')
    : '1. No extracted claims are available yet.';

  const body = [
    `${speakers.host}: This is ${show.title}. Today we are tracking ${packet.title}.`,
    '',
    `${speakers.host}: Here is the short version: ${summary}`,
    '',
    `${speakers.correspondent}: The research packet points to this core fact: ${firstClaim}`,
    '',
    `${speakers.analyst}: The context that matters is this: ${secondClaim}`,
    '',
    `${speakers.correspondent}: One more sourced detail before we widen the lens: ${thirdClaim}`,
    '',
    `${speakers.host}: What we know, from the sources captured in the packet:`,
    citationLines,
    '',
    `${speakers.analyst}: What remains uncertain: ${warningText}`,
    '',
    `${speakers.host}: Editorial note: this deterministic draft is ready for human review before audio generation.`,
  ].join('\n');

  return {
    title: `${packet.title} Script`,
    body,
    format,
    speakers: extractSpeakerLabels(body),
    metadata: {
      template: format,
      source: 'deterministic-placeholder',
      researchPacketId: packet.id,
      modelProfileId: modelProfile?.id,
      modelRole: modelProfile?.role,
    },
  };
}
