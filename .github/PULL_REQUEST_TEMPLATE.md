## Summary

<!-- What changes for users, and why. Link the issue it resolves. -->

## Validation

- [ ] `pnpm validate`
- [ ] `pnpm python:check`, when `python/` or the MCP contract changed
- [ ] Tests or smoke coverage for the changed behavior

## Public surfaces

- [ ] README, `docs/`, `llms.txt`, and the landing updated in this change, or the change is
      internal
- [ ] `pnpm public:smoke` passes (setup prompt, copies, plugin pins, skills)

## Commits

- [ ] Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`...)
- [ ] Branch from `develop` (`feature/*`, `fix/*`, `chore/*`)

## Security

- [ ] No secrets, private documents, `.env` files, or generated `.ragmir/` state
- [ ] Public documentation exposes no private project, customer, or validation details

## Licensing

- [ ] I have the right to submit these changes under `AGPL-3.0-only`
- [ ] For code contributions, commercial relicensing rights have been confirmed with the maintainer
