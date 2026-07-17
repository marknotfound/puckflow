# Railpack non-root runtime deviation

- Status: `accepted-platform-deviation`
- Affected services: API, web, worker, and cron
- Railpack version reviewed: `0.31.1`
- Reviewed: `2026-07-16`
- Owner: repository owner / platform operations
- Revisit trigger: Railpack PR 547 merges and Railway deploys a release containing it, or `2026-08-16`, whichever comes first

## Conflict and decision

The approved M0 plan requires Railway Railpack for all application services and
forbids application Dockerfiles. Issue 16 also says the worker and cron
production images must run pinned and non-root. Released Railpack 0.31.1 has no
supported deploy-user or UID setting and its generated OCI images run as root by
default. Railway also owns the managed Railpack builder version, so the
repository cannot pin the resulting OCI image digest before a production build.
Meeting the pinned, non-root statement today would require a custom Dockerfile or
an unreleased Railpack fork, both of which contradict the approved platform
contract.

This is an explicitly accepted platform deviation pending released Railpack
non-root support. It is not full compliance with the issue's non-root image
criterion. Railpack remains selected so the implementation stays inside the
approved architecture; Node 24.18.0 and pnpm 11.13.0 remain pinned by the
repository runtime contracts.

## Security impact and compensating controls

Running as UID 0 inside an application container increases the impact of an
application compromise on that container's filesystem and process namespace.
Container isolation does not make UID 0 equivalent to host root, but it is still
a defense-in-depth gap. Not pinning the final OCI digest in source also limits
local reproducibility of Railway's managed build.

Until Railpack supports a nonzero runtime UID:

- application services receive no persistent volume or application-bucket credentials in M0;
- API, worker, and cron use the least-privilege Postgres runtime role over Railway private networking;
- only API and web have public domains, and the worker/cron expose no public application surface;
- exact runtime, package, lockfile, dependency-review, and source-scanning checks remain mandatory;
- worker errors are allowlisted before persistence, logs, or Sentry capture, and raw secrets are forbidden.

## Authoritative evidence

As of 2026-07-16:

- [Railpack v0.31.1](https://github.com/railwayapp/railpack/releases/tag/v0.31.1), published 2026-07-15, is the reviewed released version.
- [Railpack issue 286](https://github.com/railwayapp/railpack/issues/286), "Runs as root user," remains open.
- [Railpack PR 547](https://github.com/railwayapp/railpack/pull/547), which adds a deploy user and defaults to UID 1001, remains open and unreleased.

## Required production verification

When Railway deploys a Railpack release containing supported non-root behavior,
pin and record that Railpack version and the four resulting image digests. For
each API, web, worker, and cron image, run both checks against the exact digest:

```sh
docker image inspect --format '{{.Config.User}}' <image-digest>
docker run --rm --entrypoint sh <image-digest> -c 'test "$(id -u)" -ne 0 && id -u'
```

The configured image user must be neither empty, `0`, nor `root`, and the smoke
command must print a nonzero UID. Then rerun each production build/start contract,
API/web/worker health checks, and the cron one-shot exit check before marking this
deviation resolved. Store the image digests and command output in the protected
deployment record, not source control.
