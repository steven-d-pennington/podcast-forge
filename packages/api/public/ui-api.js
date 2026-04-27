export class ApiRequestError extends Error {
  constructor(message, debugDetails) {
    super(message);
    this.name = 'ApiRequestError';
    this.debugDetails = debugDetails;
  }
}

export function debugText(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function friendlyApiMessage(body, status) {
  const code = typeof body?.code === 'string' ? body.code : '';
  const raw = typeof body?.error === 'string' ? body.error : '';

  const messages = {
    VALIDATION_ERROR: 'Please check the form values and try again.',
    CONFIG_FILE_NOT_FOUND: 'The requested config file could not be found.',
    SOURCE_PROFILE_NOT_FOUND: 'That story source could not be found. Refresh and try again.',
    SOURCE_PROFILE_SHOW_MISMATCH: 'That story source belongs to a different show.',
    SOURCE_URL_REQUIRED: 'Choose a candidate story with a URL, or add an extra source URL before creating a research brief.',
    STORY_CANDIDATE_NOT_FOUND: 'That candidate story could not be found. Refresh and try again.',
    STORY_CANDIDATE_IGNORED: 'Ignored candidate stories cannot be used for research briefs.',
    CANDIDATE_SHOW_MISMATCH: 'All selected candidate stories must belong to the same show.',
    EPISODE_PLANNER_RUNTIME_REQUIRED: 'AI episode planning is unavailable because the local LLM runtime is not configured.',
    EPISODE_PLANNER_MODEL_PROFILE_REQUIRED: 'Configure the episode planner AI role before requesting a plan.',
    EPISODE_PLAN_MODEL_OUTPUT_INVALID: 'The AI episode planner returned an unreadable plan. No research or approval state changed.',
    EPISODE_PLAN_MODEL_FAILED: 'The AI episode planner failed. No research or approval state changed.',
    RESEARCH_PACKET_NOT_FOUND: 'That research brief could not be found. Check the ID and try again.',
    RESEARCH_PACKET_OR_WARNING_NOT_FOUND: 'That research brief or warning could not be found.',
    RESEARCH_APPROVAL_BLOCKED: 'Research approval is blocked until the brief is ready and warnings have override reasons.',
    SCHEDULED_PIPELINE_NOT_FOUND: 'That scheduled pipeline could not be found. Refresh and try again.',
    SCHEDULED_RUN_NOT_FOUND: 'That scheduled run could not be found. Refresh and try again.',
    DUPLICATE_SHOW_SLUG: 'Another show already uses that slug. Choose a unique show slug.',
    DUPLICATE_SOURCE: 'A story source or search query with that unique key already exists.',
    DUPLICATE_SLUG: 'A record with that slug already exists in this show.',
    FEED_NOT_FOUND: 'That feed could not be found. Refresh and try again.',
    MODEL_PROFILE_NOT_FOUND: 'That AI role setting could not be found. Refresh and try again.',
    INVALID_CRON: 'The cron schedule is not valid. Check the cadence and try again.',
    SCHEDULED_RUN_NOT_FAILED: 'Only failed scheduled runs can be retried.',
    PUBLISH_BLOCKED: 'Publishing is blocked until the checklist items are complete.',
    PUBLISH_APPROVAL_BLOCKED: 'Publish approval is blocked until the checklist items are complete.',
    SCRIPT_COACHING_RUNTIME_UNAVAILABLE: 'AI script coaching is unavailable because the local LLM runtime is not configured.',
    SCRIPT_COACHING_MODEL_PROFILE_REQUIRED: 'Configure the script editor AI role before using coaching actions.',
    MALFORMED_MODEL_OUTPUT: 'The AI returned an unreadable script revision. No approval or revision state changed.',
    MODEL_INVOCATION_FAILED: 'The AI script editor failed. No approval or revision state changed.',
  };

  if (messages[code]) {
    return messages[code];
  }

  if (status === 404) {
    return 'That record could not be found. Refresh and try again.';
  }

  if (status === 409) {
    return raw || 'This action is blocked by the current review or publishing state.';
  }

  if (status >= 500) {
    return 'The local API hit a server error. Open technical details for the response.';
  }

  return raw || `Request failed with status ${status}.`;
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : undefined;
  } catch (error) {
    throw new ApiRequestError(
      response.ok ? 'The API returned an unreadable response.' : `Request failed with status ${response.status}.`,
      text,
    );
  }

  if (!response.ok || body.ok === false) {
    throw new ApiRequestError(friendlyApiMessage(body, response.status), {
      path,
      status: response.status,
      response: body,
    });
  }

  return body;
}
