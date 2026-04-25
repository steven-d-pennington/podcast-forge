# Podcast Forge

Agent-powered podcast production studio: configurable research sources, model routing, script generation, audio/art production, approvals, publishing, and analytics.

This repo is the productized successor to the local TSL Command Center + Byte Sized pipeline experiments.

## Goals

- Turn a topic or source profile into researched podcast episode candidates.
- Preserve source evidence and editorial decisions.
- Let humans approve/reject key steps before public publishing.
- Support multiple shows with different voices, feeds, formats, and model preferences.
- Package the system cleanly enough that other creators can self-host it later.

## Repo status

Planning/scaffold phase. See:

- [PRD](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Configuration schema](schemas/podcast-forge.config.schema.json)
- [Example config](config/examples/the-synthetic-lens.json)
- [Development plan](docs/DEVELOPMENT_PLAN.md)

## Working title

Podcast Forge. Alternatives: CastForge, Episode Foundry, SignalCast Studio.

## Config validation

The API package can validate Podcast Forge JSON configs against
[`schemas/podcast-forge.config.schema.json`](schemas/podcast-forge.config.schema.json).

Run the config checks:

```sh
npm run test:config --workspace @podcast-forge/api
npm run check
```

Start the API:

```sh
npm run dev --workspace @podcast-forge/api
```

Available config endpoints:

- `GET /health` returns API health.
- `GET /config/example` returns the bundled Synthetic Lens example config.
- `POST /config/validate` accepts a JSON config body and returns `{ "ok": true }`
  or `{ "ok": false, "errors": [...] }`.
- `GET /config?path=./config/examples/the-synthetic-lens.json` loads and
  validates a config file path. Leading `~/` is expanded, and relative paths
  resolve from the API process working directory.
