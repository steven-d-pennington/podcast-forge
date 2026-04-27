import type { LlmInvocationMetadata, LlmRuntime } from '../llm/types.js';
import type { ResolvedModelProfile } from '../models/resolver.js';
import { PROMPT_OUTPUT_SCHEMAS, type ScriptRevisionResult } from '../prompts/schemas.js';
import { renderPromptTemplate } from '../prompts/renderer.js';
import type { PromptRegistry } from '../prompts/types.js';
import type { ResearchPacketRecord } from '../research/store.js';
import type { ShowRecord } from '../sources/store.js';
import type { ScriptRecord, ScriptRevisionRecord } from './store.js';

export const SCRIPT_COACHING_ACTION_IDS = [
  'reduce_certainty',
  'clarify_intro',
  'add_attribution',
  'reduce_sensationalism',
] as const;

export type ScriptCoachingAction = typeof SCRIPT_COACHING_ACTION_IDS[number];

export interface ScriptCoachingActionDefinition {
  action: ScriptCoachingAction;
  label: string;
  description: string;
  instruction: string;
}

export interface ScriptCoachingRuntimeOptions {
  runtime: LlmRuntime;
  promptRegistry: PromptRegistry;
}

export interface BuiltScriptCoachingRevision {
  title: string;
  body: string;
  speakers: string[];
  changeSummary: string;
  metadata: Record<string, unknown>;
}

export const SCRIPT_COACHING_ACTIONS: Record<ScriptCoachingAction, ScriptCoachingActionDefinition> = {
  reduce_certainty: {
    action: 'reduce_certainty',
    label: 'Reduce certainty',
    description: 'Soften claims that are stronger than the evidence and add caveats where the packet is incomplete.',
    instruction: 'Reduce unsupported certainty. Add concise caveats where the research packet is incomplete, disputed, or based on limited sourcing. Do not remove necessary attribution.',
  },
  clarify_intro: {
    action: 'clarify_intro',
    label: 'Clarify intro',
    description: 'Tighten the opening so the episode quickly states what happened, what is known, and what remains open.',
    instruction: 'Tighten and clarify the introduction. Keep it grounded in the research packet, avoid new facts, and make the known/unknown split visible early.',
  },
  add_attribution: {
    action: 'add_attribution',
    label: 'Add attribution',
    description: 'Add source attribution and uncertainty language where factual lines need clearer sourcing.',
    instruction: 'Add source attribution and uncertainty language to factual lines that need it. Attribute claims to supplied sources, filings, statements, or the research packet where appropriate. Do not invent citations.',
  },
  reduce_sensationalism: {
    action: 'reduce_sensationalism',
    label: 'Reduce sensationalism',
    description: 'Remove hype, unsupported framing, or dramatic language that goes beyond the sourced evidence.',
    instruction: 'Reduce sensationalism, hype, and unsupported framing. Preserve the substance, but use restrained language that reflects the evidence actually present in the packet.',
  },
};

export function listScriptCoachingActions(): ScriptCoachingActionDefinition[] {
  return SCRIPT_COACHING_ACTION_IDS.map((action) => SCRIPT_COACHING_ACTIONS[action]);
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

const secretKeyPattern = /(api[_-]?key|authorization|cookie|credential|password|secret|token)/i;
const localDataKeyPattern = /(^|_)(local|absolute)?(file|dir|directory|path)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sanitizePromptValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[max-depth]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePromptValue(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value instanceof Date ? value.toISOString() : value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeyPattern.test(key) && !localDataKeyPattern.test(key))
      .map(([key, entry]) => [key, sanitizePromptValue(entry, depth + 1)]),
  );
}

function showContext(show: ShowRecord) {
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    description: show.description,
    format: show.format,
    defaultRuntimeMinutes: show.defaultRuntimeMinutes,
    settings: sanitizePromptValue(show.settings),
    cast: show.cast.map((member) => ({ name: member.name, role: member.role })),
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
  };
}

function revisionContext(revision: ScriptRevisionRecord) {
  return {
    id: revision.id,
    version: revision.version,
    title: revision.title,
    format: revision.format,
    speakers: revision.speakers,
    body: revision.body,
    changeSummary: revision.changeSummary,
    metadata: {
      citationMap: revision.metadata.citationMap,
      provenance: revision.metadata.provenance,
      validation: revision.metadata.validation,
      warnings: revision.metadata.warnings,
      provenanceStatus: revision.metadata.provenanceStatus,
      integrityReview: revision.metadata.integrityReview,
    },
  };
}

function instructionContext(input: {
  action: ScriptCoachingActionDefinition;
  show: ShowRecord;
  script: ScriptRecord;
  revision: ScriptRevisionRecord;
}) {
  return {
    coachingAction: {
      action: input.action.action,
      label: input.action.label,
      description: input.action.description,
      instruction: input.action.instruction,
    },
    safetyRules: [
      'This is coaching/rewrite assistance only, not approval.',
      'Return draft text that still requires normal human review, integrity review, and approval before production.',
      'Use only the supplied research packet and current script. Do not add unsourced factual claims.',
      'Preserve compatible speaker labels from the show cast.',
      'If source support is unclear, add attribution or caveats rather than increasing certainty.',
    ],
    showContext: showContext(input.show),
    script: {
      id: input.script.id,
      title: input.script.title,
      status: input.script.status,
      approvedRevisionId: input.script.approvedRevisionId,
    },
    sourceRevision: {
      id: input.revision.id,
      version: input.revision.version,
    },
  };
}

export async function buildLlmScriptCoachingRevision(
  show: ShowRecord,
  packet: ResearchPacketRecord,
  script: ScriptRecord,
  revision: ScriptRevisionRecord,
  actionId: ScriptCoachingAction,
  modelProfile: ResolvedModelProfile,
  options: ScriptCoachingRuntimeOptions,
): Promise<BuiltScriptCoachingRevision> {
  const action = SCRIPT_COACHING_ACTIONS[actionId];
  const rendered = await renderPromptTemplate(options.promptRegistry, {
    key: modelProfile.promptTemplateKey ?? undefined,
    role: modelProfile.promptTemplateKey ? undefined : 'script_editor',
    showId: show.id,
    variables: {
      script_draft: revisionContext(revision),
      research_packet: packetContext(packet),
      revision_instructions: instructionContext({ action, show, script, revision }),
    },
  });
  const schema = PROMPT_OUTPUT_SCHEMAS.script_revision_result;
  const result = await options.runtime.generateJson<ScriptRevisionResult>({
    profile: modelProfile,
    messages: rendered.messages,
    schemaName: rendered.responseFormat.schemaName ?? schema.name,
    schemaHint: rendered.responseFormat.schemaHint ?? schema.schemaHint,
    validate: (value) => schema.validate(value) as ScriptRevisionResult,
    requestMetadata: {
      purpose: 'script_coaching',
      scriptId: script.id,
      revisionId: revision.id,
      researchPacketId: packet.id,
      coachingAction: action.action,
      promptTemplateKey: rendered.template.key,
      promptTemplateVersion: rendered.template.version,
    },
  });

  return {
    title: result.value.title,
    body: result.value.body,
    speakers: result.value.speakers,
    changeSummary: `AI coaching: ${action.label}. ${result.value.changeSummary}`,
    metadata: {
      coachingAction: {
        action: action.action,
        label: action.label,
        description: action.description,
      },
      promptTemplateKey: rendered.template.key,
      promptTemplateVersion: rendered.template.version,
      modelProfileId: modelProfile.id,
      modelRole: modelProfile.role,
      modelRuntime: result.metadata as LlmInvocationMetadata,
      resolvedWarnings: result.value.resolvedWarnings,
      remainingWarnings: result.value.remainingWarnings,
    },
  };
}
