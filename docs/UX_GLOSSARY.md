# UX Glossary

Podcast Forge keeps backend, database, and API identifiers technical so audit records stay stable. User-facing screens, docs for operators, and inline help should use clearer editorial language unless the exact API/table name is necessary.

## When to Use Each Term

- Use backend terms in schema files, migrations, route paths, TypeScript types, logs, debug details, API examples, and troubleshooting notes that refer to exact records.
- Use user-facing terms in UI headings, buttons, empty states, onboarding copy, help text, operator docs, and review checklists.
- If both are needed, lead with the user-facing term and include the backend term in parentheses only when it helps someone map UI to an API or audit record.

## Term Map

| Backend term | User-facing term | Definition | Use the backend term when... | Use the user-facing term when... |
| --- | --- | --- | --- | --- |
| Source Profile | Story Sources / Search Recipe | A saved source configuration that controls where a show discovers candidate stories, including provider type, freshness, weights, and domain filters. | Referring to `source_profiles`, API payload fields, migrations, route names, or debug output. | Labeling the source list, setup help, or operator steps for configuring discovery. |
| Source Query | Search Query | A specific query string, RSS URL, or source instruction under a story source. | Referring to `source_queries` rows or `/source-queries` endpoints. | Asking users to add or edit the query text that finds stories. |
| Story Candidate | Candidate Story / Possible Story | A deduped item discovered from search, RSS, manual URL entry, or import that may become an episode. | Referring to `story_candidates`, exact status values, or API examples. | Showing story lists, scores, selection actions, and empty states. |
| Research Packet | Research Brief / Episode Brief | The evidence bundle for a possible episode: fetched source snapshots, cited claims, warnings, synthesis, and readiness. | Referring to `research_packets`, endpoint paths, or persisted provenance fields. | Guiding editors through research review, warning checks, and script drafting. |
| Model Profile | AI Role Settings / Model Role | The provider, model, parameters, budget, fallbacks, and prompt connection for an agent role. | Referring to `model_profiles`, resolver behavior, or model routing internals. | Showing role configuration in settings or explaining which AI role handles scoring, research, writing, metadata, or art prompts. |
| Prompt Template | Prompt Template / Agent Instructions | Reusable instructions and response schema hints for an AI role. | Referring to `prompt_templates`, template keys, versions, or render endpoints. | Describing editable role instructions to operators. |
| Job | Task / Run | A tracked unit of work with status, progress, logs, input, output, and retry/failure metadata. | Referring to `jobs`, job types such as `source.search`, or debug logs. | Showing progress, retry actions, or scheduled/manual run history. |
| Episode Asset | Audio/Cover Asset | A persisted generated or uploaded production file such as preview audio, final audio, or cover art. | Referring to `episode_assets`, storage metadata, MIME type, checksums, or object keys. | Showing production output, review steps, or publishing checklist items. |
| Approval Event | Review Decision | A persisted human or system decision to approve, reject, or override a gate. | Referring to `approval_events` rows or audit trails. | Asking an editor to approve audio, override a warning, or approve publishing. |
| Publish Event | Publishing Record | A persisted RSS/storage publication action with GUIDs, URLs, changelog, and adapter metadata. | Referring to `publish_events`, idempotency behavior, or API responses. | Showing publishing history, checklist completion, or feed update results. |

## Technical Terms That May Stay Visible

Some terms are useful to operators and should not be hidden behind vague copy:

- RSS, feed GUID, OP3, URL, HTTP(S), MIME type, checksum, object key, and cron when the user is configuring or auditing those exact systems.
- Provider/model names and role keys when the screen is explicitly about AI role settings.
- IDs in forms that still require exact API record IDs, paired with friendly labels such as "Research brief ID."
- Raw JSON, route names, table names, and logs inside collapsible debug or technical-details areas.
