import type { ResolvedModelProfile } from '../models/resolver.js';
import type { LlmInvocationMetadata, LlmRuntime } from '../llm/types.js';
import { PROMPT_OUTPUT_SCHEMAS, type ScriptGenerationResult } from '../prompts/schemas.js';
import { renderPromptTemplate } from '../prompts/renderer.js';
import type { PromptRegistry } from '../prompts/types.js';
import type { ResearchClaim, ResearchPacketRecord } from '../research/store.js';
import type { ShowRecord } from '../sources/store.js';

export interface BuiltScriptDraft {
  title: string;
  body: string;
  format: string;
  speakers: string[];
  metadata: Record<string, unknown>;
}

export interface ScriptGenerationRuntimeOptions {
  runtime: LlmRuntime;
  promptRegistry: PromptRegistry;
}

export interface ScriptProvenanceWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  sourceDocumentId?: string;
  metadata?: Record<string, unknown>;
}

type ProvenancePacket = {
  id: string;
  status: string;
  sourceDocumentIds: string[];
  claims: Array<Pick<ResearchClaim, 'id' | 'sourceDocumentIds' | 'citationUrls'>>;
  citations: Array<{ sourceDocumentId: string; url: string }>;
  content: Record<string, unknown>;
};

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function packetReadiness(packet: Pick<ResearchPacketRecord, 'content'>): Record<string, unknown> {
  const readiness = packet.content.readiness;
  return readiness && typeof readiness === 'object' && !Array.isArray(readiness)
    ? readiness as Record<string, unknown>
    : {};
}

function claimById(packet: ResearchPacketRecord) {
  return new Map(packet.claims.map((claim) => [claim.id, claim]));
}

function citationUrlByDocumentId(packet: ResearchPacketRecord) {
  return new Map(packet.citations.map((citation) => [citation.sourceDocumentId, citation.url]));
}

function normalizeCitationMap(packet: ResearchPacketRecord, citationMap: ScriptGenerationResult['citationMap']) {
  const claims = claimById(packet);
  const urlsByDocumentId = citationUrlByDocumentId(packet);

  return citationMap.map((entry) => {
    const claim = entry.claimId ? claims.get(entry.claimId) : undefined;
    const sourceDocumentIds = entry.sourceDocumentIds.length > 0 ? entry.sourceDocumentIds : claim?.sourceDocumentIds ?? [];

    return {
      line: entry.line,
      claimId: entry.claimId,
      sourceDocumentIds,
      citationUrls: sourceDocumentIds.map((id) => urlsByDocumentId.get(id)).filter((url): url is string => Boolean(url)),
    };
  });
}

function promptWarningSeverity(severity: 'info' | 'warning' | 'critical'): ScriptProvenanceWarning['severity'] {
  return severity === 'critical' ? 'error' : severity;
}

export function provenanceWarnings(
  packet: ProvenancePacket,
  citationMap: Array<{ claimId?: string; sourceDocumentIds: string[] }>,
): ScriptProvenanceWarning[] {
  const warnings: ScriptProvenanceWarning[] = [];
  const knownSourceDocumentIds = new Set(packet.sourceDocumentIds);

  if (citationMap.length === 0) {
    warnings.push({
      code: 'MISSING_SCRIPT_CITATION_MAP',
      severity: 'warning',
      message: 'The script draft did not include a citation map, so editors must verify every factual line before production.',
      metadata: { researchPacketId: packet.id },
    });
  }

  for (const claim of packet.claims) {
    if (claim.sourceDocumentIds.length === 0 || claim.citationUrls.length === 0) {
      warnings.push({
        code: 'CLAIM_MISSING_PROVENANCE',
        severity: 'warning',
        message: `Research claim is missing source document or citation URL provenance: ${claim.id}`,
        metadata: { claimId: claim.id },
      });
    }
  }

  for (const entry of citationMap) {
    for (const sourceDocumentId of entry.sourceDocumentIds) {
      if (!knownSourceDocumentIds.has(sourceDocumentId)) {
        warnings.push({
          code: 'UNKNOWN_SCRIPT_CITATION_SOURCE',
          severity: 'warning',
          message: `Script citation references a source document outside the research packet: ${sourceDocumentId}`,
          sourceDocumentId,
          metadata: { claimId: entry.claimId },
        });
      }
    }
  }

  if (packet.status !== 'ready') {
    warnings.push({
      code: 'RESEARCH_PACKET_NOT_READY',
      severity: packet.status === 'blocked' ? 'error' : 'warning',
      message: `Research packet status is ${packet.status}; script requires editorial review before production.`,
      metadata: {
        researchPacketId: packet.id,
        readiness: packetReadiness(packet),
      },
    });
  }

  return warnings;
}

function showContext(show: ShowRecord) {
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    description: show.description,
    format: show.format,
    defaultRuntimeMinutes: show.defaultRuntimeMinutes,
    cast: show.cast.map((member) => ({ name: member.name, role: member.role })),
    settings: show.settings,
  };
}

function packetContext(packet: ResearchPacketRecord) {
  return {
    id: packet.id,
    title: packet.title,
    status: packet.status,
    readiness: packetReadiness(packet),
    sourceDocumentIds: packet.sourceDocumentIds,
    claims: packet.claims,
    citations: packet.citations,
    warnings: packet.warnings,
    summary: asString(packet.content.summary),
    knownFacts: asStringArray(packet.content.knownFacts),
    openQuestions: asStringArray(packet.content.openQuestions),
    content: packet.content,
  };
}

function validationMetadata(input: {
  speakers: string[];
  invalidSpeakers: string[];
  provenanceWarnings: ScriptProvenanceWarning[];
}) {
  return {
    speakerLabels: {
      valid: input.invalidSpeakers.length === 0,
      labels: input.speakers,
      invalid: input.invalidSpeakers,
    },
    provenance: {
      valid: input.provenanceWarnings.every((warning) => warning.severity !== 'error'),
      warningCount: input.provenanceWarnings.length,
      warnings: input.provenanceWarnings,
    },
    readyForAudio: input.invalidSpeakers.length === 0
      && input.provenanceWarnings.every((warning) => warning.severity !== 'error'),
  };
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

export function invalidSpeakers(speakers: string[], cast: ShowRecord['cast']): string[] {
  const allowed = new Set(cast.map((member) => member.name));
  return speakers.filter((speaker) => !allowed.has(speaker));
}

export async function buildLlmScriptDraft(
  show: ShowRecord,
  packet: ResearchPacketRecord,
  modelProfile: ResolvedModelProfile,
  requestedFormat: string | undefined,
  options: ScriptGenerationRuntimeOptions,
): Promise<BuiltScriptDraft> {
  const format = requestedFormat ?? show.format ?? 'feature-analysis';
  const rendered = await renderPromptTemplate(options.promptRegistry, {
    key: modelProfile.promptTemplateKey ?? undefined,
    role: modelProfile.promptTemplateKey ? undefined : 'script_writer',
    showId: show.id,
    variables: {
      show_context: showContext(show),
      research_packet: packetContext(packet),
      format_notes: {
        requestedFormat: format,
        showFormat: show.format,
        defaultRuntimeMinutes: show.defaultRuntimeMinutes,
      },
    },
  });
  const schema = PROMPT_OUTPUT_SCHEMAS.script_generation_result;
  const result = await options.runtime.generateJson<ScriptGenerationResult>({
    profile: modelProfile,
    messages: rendered.messages,
    schemaName: rendered.responseFormat.schemaName ?? schema.name,
    schemaHint: rendered.responseFormat.schemaHint ?? schema.schemaHint,
    validate: (value) => schema.validate(value) as ScriptGenerationResult,
    requestMetadata: {
      purpose: 'script_generation',
      researchPacketId: packet.id,
      promptTemplateKey: rendered.template.key,
      promptTemplateVersion: rendered.template.version,
    },
  });
  const citationMap = normalizeCitationMap(packet, result.value.citationMap);
  const promptWarnings: ScriptProvenanceWarning[] = result.value.warnings.map((warning) => ({
    code: warning.code,
    severity: promptWarningSeverity(warning.severity),
    message: warning.message,
    sourceDocumentId: warning.sourceDocumentId,
    metadata: warning.metadata,
  }));
  const provenance = provenanceWarnings(packet, citationMap);
  const speakers = result.value.speakers.length > 0 ? result.value.speakers : extractSpeakerLabels(result.value.body);
  const invalid = [...new Set([...invalidSpeakerLabels(result.value.body, show.cast), ...invalidSpeakers(speakers, show.cast)])];

  return {
    title: result.value.title,
    body: result.value.body,
    format: result.value.format || format,
    speakers,
    metadata: {
      template: result.value.format || format,
      source: 'llm',
      researchPacketId: packet.id,
      promptTemplateKey: rendered.template.key,
      promptTemplateVersion: rendered.template.version,
      modelProfileId: modelProfile.id,
      modelRole: modelProfile.role,
      modelRuntime: result.metadata as LlmInvocationMetadata,
      citationMap,
      provenance: {
        researchPacketId: packet.id,
        sourceDocumentIds: packet.sourceDocumentIds,
        claimIds: packet.claims.map((claim) => claim.id),
        citationUrls: [...new Set(packet.claims.flatMap((claim) => claim.citationUrls))],
        warnings: provenance,
      },
      warnings: [...promptWarnings, ...provenance],
      validation: validationMetadata({
        speakers,
        invalidSpeakers: invalid,
        provenanceWarnings: provenance,
      }),
    },
  };
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
      citationMap: claims.map((claim) => ({
        line: claim.text,
        claimId: claim.id,
        sourceDocumentIds: claim.sourceDocumentIds,
        citationUrls: claim.citationUrls,
      })),
      provenance: {
        researchPacketId: packet.id,
        sourceDocumentIds: packet.sourceDocumentIds,
        claimIds: packet.claims.map((claim) => claim.id),
        citationUrls: [...new Set(packet.claims.flatMap((claim) => claim.citationUrls))],
        warnings: provenanceWarnings(packet, claims.map((claim) => ({
          claimId: claim.id,
          sourceDocumentIds: claim.sourceDocumentIds,
        }))),
      },
      warnings: provenanceWarnings(packet, claims.map((claim) => ({
        claimId: claim.id,
        sourceDocumentIds: claim.sourceDocumentIds,
      }))),
      validation: validationMetadata({
        speakers: extractSpeakerLabels(body),
        invalidSpeakers: invalidSpeakerLabels(body, show.cast),
        provenanceWarnings: provenanceWarnings(packet, claims.map((claim) => ({
          claimId: claim.id,
          sourceDocumentIds: claim.sourceDocumentIds,
        }))),
      }),
    },
  };
}
