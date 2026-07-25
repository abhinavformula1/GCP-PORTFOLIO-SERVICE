# Clean Architecture

The service is organised around inward dependencies:

- `src/domain` contains pure policies, prompts, models, and errors. It has no environment, framework, SDK, or I/O dependencies.
- `src/application` contains use-case factories and application-owned ports. It may import only `domain` or other `application` modules.
- `src/interfaces` contains dependency-injected Express route/middleware factories and rendering adapters. It imports only domain/application/interfaces plus HTTP framework mechanics.
- `src/infrastructure` contains configuration and concrete Firestore, Salesforce, Stripe, GCS, identity, AI/search, PDF, and tracing adapters.
- `src/main` is the composition root. It owns process setup, adapter wiring, middleware/route order, static files, and server startup.
- Root `server.js` is a compatibility launcher for existing package and container entrypoints.

Run `npm run check:architecture` to enforce these rules. There are no allowlisted dependency-edge exceptions.

## Architecture enforcement

The checker parses every `.js`, `.cjs`, and `.mjs` source file with the direct `acorn` dev dependency. It discovers static imports/exports, quoted `require()`, quoted `require.resolve()`, and quoted `import()` calls from the AST, so import-like comments and strings are ignored. Computed or aliased loaders, `module.require`, `createRequire`, `eval`, and `Function` code generation are rejected because their targets cannot be proven at review or CI time.

Local targets are resolved through `realpath`. Missing targets, symlink escapes, paths outside `src`, root-level bridge/self imports, unknown source layers, forbidden layer edges, and readable dependency cycles fail CI. Interface framework package subpaths are checked by package root. Direct `process.env`, `process['env']`, imported `node:process`, and common process/environment aliases are permitted only in the exact configuration allowlist.

To resolve a violation:

- replace computed loading with a static dependency map whose entries use quoted imports;
- inject an inward-facing application port instead of importing an outer layer;
- move environment normalization into `infrastructure/config`;
- import the real module inside `src` rather than creating a root bridge;
- split shared code into the innermost layer that can legally own it to remove cycles.

The parser intentionally accepts standard ECMAScript only. TypeScript, JSX, decorators, loader aliases, and template-literal module specifiers are unsupported in `src` unless the checker is explicitly extended with deterministic parsing and resolution rules.

## Composition

`src/main/composition.js` instantiates factory-owned provider adapters, validates every application port, and freezes the safe capability graph. `src/main/server.js` validates narrow route capabilities before Express wiring. Stripe's raw-body route remains registered before JSON parsing.

Infrastructure adapters are composition-owned instances. One lazy Firestore client is shared by all Firestore repository factories and the RAG store; no network or credential lookup occurs until a repository method requests the client. Its idempotent terminate hook is registered with the application lifecycle. Repository contracts are validated during composition, and Atlas development fallback conversations, usage, warnings, and cache entries are isolated per repository instance.

Mutable provider state is instance-local: Salesforce token caching, Stripe and Google client caching, tracing runtime policy, and Atlas fallback state are created per composition. Stateless constants and pure normalization helpers may remain module-scoped. Local preview content lives under `src/infrastructure/content` rather than the ambiguous legacy `infrastructure/services` directory.

## Configuration and lifecycle

`loadConfig(env)` is the single environment normalization boundary. It validates and deep-freezes server, provider, security, and runtime settings; `createRuntime(config)` only derives a narrow runtime view from that validated configuration. Application and interface modules never read environment variables.

Development and test remain credential-free. Production requires the internal print-signing secret and validates only integrations that are enabled or partially configured. Configured HTTP(S) endpoints, `PORT`, `NODE_ENV`, booleans, Salesforce API versions, and provider credential combinations fail before listening; errors identify setting names without echoing values.

`createApp()` is import-safe and installs no process handlers. `startServer({ port: 0 })` returns `{ app, server, ready, address, close }`; only the root launcher installs `SIGTERM`/`SIGINT` handlers. Closing is idempotent, runs adapter hooks once in reverse registration order, and aggregates failures after all hooks run.

`/health` is liveness. `/ready` performs deterministic, network-free checks that critical composed capabilities were initialized; it returns only a safe ready/not-ready response and supports injected checks in tests. Unknown `/api` paths return JSON 404 responses before the SPA fallback.

Local preview authentication is accepted only when explicitly enabled, outside production and Cloud Run, from a localhost host. It never widens the configured Google-admin allowlist in hosted environments.
