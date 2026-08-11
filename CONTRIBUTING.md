# Contributing

Thanks for improving Korean Law MCP. The repository layout, tool architecture, and local troubleshooting notes live in [the development guide](docs/DEVELOPMENT.md); please start there rather than duplicating implementation details here.

## Prerequisites and setup

- Node.js 22.12.0 or newer and the npm version bundled with it.
- A current checkout based on `main`. Keep generated `build/` output and local credentials out of commits.
- `LAW_OC` is needed for live 법제처 API calls, but not for the unit test suite.

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run verify:package
```

`--ignore-scripts` is the supported CI-safe install path: it avoids optional transitive native postinstall downloaders while retaining the pure-JS annex/PDF parser used by this server. See the development guide for local API configuration, CLI use, and Docker details.

## Change scope and pull requests

- Open or reference an issue before changing behavior; keep each pull request focused on that issue or a clearly related set of issues.
- Follow the existing TypeScript style and make the smallest change that owns the behavior at the actual consumer boundary.
- Add or update focused regression tests for behavior changes. Run all four checks above; use `npm pack --dry-run` as an additional release-path check when touching packaging.
- Do not commit `build/`, `node_modules/`, `.env`, API keys, captured production data, or unrelated local changes.
- In the pull request, link the issue, explain the user-visible or security effect, list validation run, and call out deliberately untested external integrations or deployment assumptions.

## Security reports

Please do not open public issues for suspected vulnerabilities or exposed credentials. Report them privately through [GitHub Security Advisories](https://github.com/chrisryugj/korean-law-mcp/security/advisories/new), including reproduction details and impact. If that route is unavailable, contact the repository maintainer privately through GitHub rather than disclosing the details in an issue or pull request.
