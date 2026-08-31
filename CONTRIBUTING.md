# Contributing

Thanks for improving Korean Law MCP. The repository layout, tool architecture, and local troubleshooting notes live in [the development guide](docs/DEVELOPMENT.md); please start there rather than duplicating implementation details here.

## Prerequisites and setup

- Node.js 20.19.0 or newer (the `engines` floor, matching the production host). CI runs the suite on both 20.19.0 and 22.12.0; the published Docker image ships 22.12.0.
- A current checkout based on `main`. Keep generated `build/` output and local credentials out of commits.
- `LAW_OC` is needed for live 법제처 API calls, but not for the unit test suite.

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run verify:package
```

Developer tooling needs platform-specific optional bindings, so contributor installs retain optional packages but suppress every lifecycle script with `--ignore-scripts`. Supported plugin, global, Docker, and published-runtime paths additionally use `--omit=optional`: Kordoc's optional OCR/ML/native graph is absent, while the required pure-JS PDF runtime remains a normal pinned dependency. CI prunes to that production graph and runs `npm run verify:annex-runtime`. See the development guide for local API configuration, CLI use, and Docker details.

## Change scope and pull requests

- Open or reference an issue before changing behavior; keep each pull request focused on that issue or a clearly related set of issues.
- Follow the existing TypeScript style and make the smallest change that owns the behavior at the actual consumer boundary.
- Add or update focused regression tests for behavior changes. Run all four checks above; use `npm pack --dry-run` as an additional release-path check when touching packaging.
- Do not commit `build/`, `node_modules/`, `.env`, API keys, captured production data, or unrelated local changes.
- In the pull request, link the issue, explain the user-visible or security effect, list validation run, and call out deliberately untested external integrations or deployment assumptions.

## Security reports

Please do not open public issues for suspected vulnerabilities or exposed credentials. Report them privately through [GitHub Security Advisories](https://github.com/chrisryugj/korean-law-mcp/security/advisories/new), including reproduction details and impact. If that route is unavailable, contact the repository maintainer privately through GitHub rather than disclosing the details in an issue or pull request.
