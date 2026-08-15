# Iteration 05.2 — Rework 01: Yandex Container Registry manifest compatibility

Status: REWORK  
Base commit: `9efc22490f7ccb49e3eddc2a4faee9cf3af0d99e`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Deployment incident

The first Human-operated deployment reached the immutable image push and failed before Serverless Container revision deployment.

Observed command path:

```text
local Docker smoke passed
→ local image tagged as cr.yandex/<registry-id>/ai-gantt-planner:<git-sha>
→ docker push uploaded layers
→ registry rejected the final manifest
```

Observed error:

```text
error from registry: Cannot read manifest data. Make sure it is consistent with
https://docs.docker.com/registry/spec/manifest-v2-2/
```

The preceding Docker Desktop build output explicitly contained:

```text
exporting attestation manifest
exporting manifest list
```

Modern Docker BuildKit adds minimal provenance attestations by default. The attestation is attached to an image index / manifest list. The current classic Yandex Container Registry endpoint accepted layer blobs but rejected the final manifest/index produced by this build path.

No Serverless Container revision was deployed: `deploy.ps1` invokes revision deployment only after `docker push` returns success. No rollback is required.

## Goal

Produce and push one deterministic, registry-compatible Linux AMD64 Docker image manifest while preserving:

- the accepted multi-stage Dockerfile;
- non-root runtime;
- immutable Git-SHA tagging;
- local Docker smoke before push;
- Yandex Container Registry and Serverless Container architecture;
- all secret, IAM and plan/apply safety contracts.

This rework is limited to container build/export compatibility and deployment verification.

## Required correction

### 1. Explicit target platform

Every production image build used by local container smoke or cloud deployment must explicitly target:

```text
linux/amd64
```

The deployment runtime is a Linux AMD64 Serverless Container. Do not build or push an accidental multi-platform index.

### 2. Disable build attestations for this registry output

Every production image build intended for Yandex Container Registry must explicitly disable:

```text
provenance attestations
SBOM attestations
```

Preferred explicit Docker flags:

```text
--platform linux/amd64
--provenance=false
--sbom=false
```

Do not rely only on the operator's global Docker configuration. Do not disable attestations globally in Docker Desktop. Scope the compatibility setting to this project's build commands.

If the installed Docker CLI does not support the explicit flags, fail before build/push with a precise compatibility message. A contained fallback using `BUILDX_NO_DEFAULT_ATTESTATIONS=1` is acceptable only if it is implemented and tested intentionally; do not silently ignore unsupported flags.

### 3. One canonical build argument contract

Avoid divergence between build paths.

The same compatibility arguments must be applied in:

- `infra/docker/smoke.ps1` normal build;
- `infra/yandex/deploy.ps1` normal path through local smoke;
- `infra/yandex/deploy.ps1 -SkipLocalSmoke` direct build path.

Prefer a small shared helper or an explicit parameter contract rather than duplicating slightly different build flags.

`-SkipLocalSmoke` remains an exceptional override and must still build the same compatible image format.

### 4. Preserve local smoke behavior

`infra/docker/smoke.ps1` must continue to verify:

- frontend shell and built assets;
- `/api/health` and `/api/seed`;
- API 404 behavior;
- container running state;
- no Python traceback;
- non-root runtime;
- cleanup in `finally`.

The new build flags must not weaken these checks or PowerShell 5.1 compatibility.

### 5. Verify local image contract

After build and before cloud push, verify at minimum:

- OS is `linux`;
- architecture is `amd64`;
- image can still run locally;
- the local immutable tag resolves.

Use `docker image inspect` or an equivalent stable Docker command.

Do not print environment values or secrets.

### 6. Push and remote verification

After `docker push` succeeds, verify that Yandex Container Registry exposes the immutable tag before attempting revision deployment.

Use a read-only check such as:

```text
yc container image list --registry-id <registry-id>
```

or an equivalent scoped JSON query, and assert that:

- repository name matches the configured repository;
- immutable Git-SHA tag exists;
- a digest is present.

If the registry tag cannot be resolved, stop before revision deployment.

Do not delete partially uploaded layer blobs or unrelated registry data automatically.

### 7. Retry semantics

The failed first push did not create a usable tagged manifest. Retrying the same immutable Git-SHA tag is allowed only when the registry read-only check confirms that no completed image/tag exists.

If the immutable tag already exists with a digest:

- do not overwrite it silently;
- verify whether it matches the locally built image or stop with a clear message;
- preserve immutability.

### 8. Deployment state safety

Preserve the existing order:

```text
local smoke
→ compatible image tag
→ push
→ verify remote tag/digest
→ deploy revision
→ cloud smoke
```

Do not deploy a revision when push or remote verification fails.

Do not alter bootstrap resources, IAM roles, Lockbox metadata/payload, public access or service-account bindings in this rework.

## Documentation

Update `infra/yandex/README.md` and the relevant root README section to explain:

- Yandex Container Registry compatibility build uses `linux/amd64`;
- provenance/SBOM attestations are disabled only for this registry delivery path;
- this is a registry-format compatibility choice, not a global Docker security setting;
- future CI/CD or another OCI registry may re-enable attestations when supported.

## Regression coverage

Add or update contract tests proving at minimum:

1. Local smoke production build includes `--platform linux/amd64`.
2. Local smoke build includes `--provenance=false` and `--sbom=false` or the approved equivalent.
3. `deploy.ps1 -SkipLocalSmoke` uses the same build compatibility contract.
4. Remote image verification occurs after push and before revision deployment.
5. Revision deployment cannot occur when push or remote verification fails.
6. Existing immutable Git-SHA, Lockbox, IAM, Apply confirmation and rollback contracts remain unchanged.
7. Scripts remain valid in Windows PowerShell 5.1 and PowerShell 7.
8. Secret values are still absent from configuration, command output and image build arguments.

## Verification

Run all available checks:

- targeted container/deployment contract tests;
- full backend suite;
- frontend unit/integration, lint and production build;
- Playwright suite;
- PowerShell 5.1 and 7 parser checks;
- `git diff --check`;
- clean worktree.

When Docker is available, run an actual local smoke using the compatibility build. Codex must not push to Yandex or create a revision during implementation.

Create one rework commit and stop for Human review. Do not run `deploy.ps1 -Apply` and do not begin Iteration 05.3.
