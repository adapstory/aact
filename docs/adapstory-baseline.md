# Adapstory AACT Fork Baseline

This note records the local quality baseline for the Adapstory-owned AACT fork.
It is the first checkpoint before adding Adapstory-specific architecture
governance rules, report contracts, or root workspace integration.

## Scope

The baseline applies to the `adapstory-aact` submodule only.

This story does not add root quick-gate integration, blocking CI behavior,
Adapstory-specific rule packs, or report-only root scripts. Those belong to
later BMad stories after the fork baseline, finding contract, and policy
semantics are stable.

## Repository Setup

- Adapstory remote: `https://github.com/adapstory/aact.git`
- Upstream remote: `https://github.com/Byndyusoft/aact.git`
- Upstream push URL: disabled
- Package: `aact@2.1.5`
- Package manager: `pnpm@9.15.4`
- Required Node engine: `>=20`
- Local baseline runtime observed on 2026-05-13: Node `v22.22.2`, pnpm `9.15.4`

## Baseline Commands

Run these commands from the `adapstory-aact` directory:

```bash
pnpm test
pnpm build
pnpm exec tsc --noEmit
pnpm lint
```

## Baseline Evidence

Initial red phase on 2026-05-13:

- `pnpm test`: passed, 34 test files, 290 tests.
- `pnpm build`: passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm lint`: failed because Prettier formatting drift was detected in 84 files.

Story 1.1 remediation:

- Formatting drift is handled as a dedicated formatting-only baseline cleanup.
- No architecture rule behavior, CLI behavior, model parsing, or auto-fix logic is
  intentionally changed in this story.
- Final green phase on 2026-05-13:
    - `pnpm lint`: passed after formatting cleanup and one scoped ESLint directive
      relocation in `test/generators/kubernetes.test.ts`.
    - `pnpm test`: passed, 34 test files, 290 tests.
    - `pnpm build`: passed.
    - `pnpm exec tsc --noEmit`: passed.

## .NET Example Test Gap

The upstream repository contains a C# modular-monolith example under
`ModularMonolith/`. Those tests require a local `.NET` SDK/runtime and are not
part of the Adapstory AACT MVP quality gate yet.

Local capability check on 2026-05-13 returned `dotnet-not-found`.

This is an environment capability gap, not permission to ignore future
cross-stack architecture testing. Once `dotnet` is available in the intended
developer or CI environment, the example should be validated or explicitly
classified as non-MVP documentation.

## GPL-3.0 Distribution Guardrail

The fork is licensed as `GPL-3.0` through the upstream AACT codebase. Internal
submodule-based use can proceed for the MVP, but external package publishing,
redistribution, or productized distribution must wait for an explicit
license/distribution decision.

Until that decision exists:

- do not publish the fork as an external package;
- do not present the fork as a closed-source distributable product;
- keep Adapstory usage documented as internal development tooling;
- track distribution decisions through the BMad planning artifacts or a
  dedicated ADR.

## References

- `../AGENTS.md`
- `../package.json`
- Parent planning artifact:
  `specs/planning-artifacts/prd-adapstory-aact-architecture-governance.md`
- Parent architecture artifact:
  `specs/planning-artifacts/architecture-adapstory-aact-architecture-governance.md`
- Parent readiness report:
  `specs/planning-artifacts/implementation-readiness-report-adapstory-aact-architecture-governance-2026-05-13.md`
