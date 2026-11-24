# qAuth TypeScript SDKs

Public releases of the qAuth SDKs for JavaScript and TypeScript:

- **`@isdlc.ai/qauth`**: the SDK for Node backends (Node 20+, Deno, Bun, workers). Verify access tokens
  offline, protect routes, check permissions, act as the signed-in person, validate API keys.
- **`@isdlc.ai/qauth-screens`**: ready-made React screens (my account, organization people and
  invitations, roles, company sign-in), English and Arabic.

## Install

No account or token needed. Each version is a release of this repository with the npm tarball attached:

```sh
npm install https://github.com/ExaCall-LLC/qauth-js/releases/download/qauth-v0.14.0/isdlc.ai-qauth-0.14.0.tgz
```

```ts
import { QAuth } from "@isdlc.ai/qauth";
```

The package names stay `@isdlc.ai/...`, so imports are the same however you install.

| Package | Release tag | File |
| --- | --- | --- |
| `@isdlc.ai/qauth` | `qauth-vX.Y.Z` | `isdlc.ai-qauth-X.Y.Z.tgz` |
| `@isdlc.ai/qauth-screens` | `qauth-screens-vX.Y.Z` | `isdlc.ai-qauth-screens-X.Y.Z.tgz` |

The address is `https://github.com/ExaCall-LLC/qauth-js/releases/download/<tag>/<file>`. To update, change
both numbers in it ([all releases](https://github.com/ExaCall-LLC/qauth-js/releases)).

The screens build on the `@isdlc.ai` UI kit (`@isdlc.ai/ui`, `@isdlc.ai/react-i18n`, `@isdlc.ai/tokens`,
peer dependencies), which is on the `@isdlc.ai` registry only; an app that uses the screens needs that
registry for the kit.

Apps that already use the `@isdlc.ai` registry can keep installing from it (`npm install @isdlc.ai/qauth`);
it has the same versions.

## Documentation

Each package's README (`qauth/README.md`, `qauth-screens/README.md`) is its full reference and change list.

## This repository

A read-only copy: the SDKs are developed inside qAuth's repository, and its CI copies the source here and
makes a release for every new version. Issues and changes go to the qAuth team, not to pull requests here.

The Go SDK is [github.com/ExaCall-LLC/qauth-go](https://github.com/ExaCall-LLC/qauth-go).

MIT licensed (see `LICENSE`).
