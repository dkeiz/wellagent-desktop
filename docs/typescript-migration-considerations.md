# TypeScript Migration Considerations

## Summary
Switching this Electron app from plain JavaScript to TypeScript is useful, but it is not a free win. The most valuable path is gradual migration with `allowJs` enabled, starting with shared main-process modules and IPC contracts before moving renderer components.

## Estimated Time
- Minimum useful setup: 0.5-1 day to add TypeScript, config, build scripts, and a few converted leaf modules.
- Practical partial migration: 3-7 days for runtime paths, IPC payloads, database wrapper shapes, LLM config, and test helpers.
- Broad migration: 2-4 weeks, depending on how strict the project wants to be about DOM types, Electron globals, plugin APIs, and legacy renderer files.
- Full strict migration: 4-8 weeks if every renderer component, plugin-facing contract, and test fixture is typed with low `any` usage.

## Expected Perks
- IPC payloads become easier to validate because request and response shapes can be shared between main and renderer code.
- Runtime path, database, provider, tool, workflow, and subagent objects get safer refactors.
- Model/provider settings become harder to silently break because nested config fields can be typed.
- Editor autocomplete improves a lot in large files that currently pass loosely shaped objects around.
- Tests can catch more mistakes at compile time before Electron startup.

## Positive Outcomes
- Fewer typo bugs in settings keys, runtime config fields, and IPC channel payloads.
- Easier onboarding because interfaces document the project shape.
- Safer future refactors for files like `bootstrap.js`, `llm-config.js`, and IPC registrations.
- Better separation pressure: TypeScript will make oversized modules and implicit globals more obvious.

## Negative Outcomes
- Migration can stall if strictness is turned on too early.
- Renderer code with direct DOM access will need careful nullable handling.
- Electron globals and plugin APIs may need custom declarations.
- Build and packaging steps become more complex.
- A rushed conversion can create fake safety through broad `any` types while still adding maintenance cost.

## What Is 100% Guaranteed
- The repository will gain more tooling and configuration.
- Some files will need import/export cleanup during conversion.
- The first migration phase will reveal existing implicit contracts and unclear object shapes.
- TypeScript will not automatically fix runtime bugs, packaging path issues, database migrations, or UI race conditions.
- The migration will take longer if it tries to convert every file at once.

## Recommended Approach
Start with a hybrid setup: add `tsconfig.json`, enable `allowJs`, and type-check without emitting. Then convert small, high-value modules first: runtime paths, IPC shared utilities, LLM config shapes, and test helpers. After that, define shared IPC types and move renderer components gradually.
