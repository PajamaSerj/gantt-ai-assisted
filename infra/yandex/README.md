# Yandex Cloud delivery automation

This directory contains the Human-operated delivery workflow for the accepted
single-image runtime. The scripts are compatible with Windows PowerShell 5.1
and PowerShell 7. They default to read-only plans; this repository does not run
cloud mutations automatically.

## 1. Architecture

One immutable Docker image is stored in Yandex Container Registry and deployed
as one Yandex Serverless Container revision. FastAPI serves both `/api/*` and
the React SPA. The public HTTPS container URL requires no reviewer
authentication. A dedicated `gantt-ai` runtime service account pulls the image,
calls Yandex AI Studio, and receives the AI credential from Yandex Lockbox.

Attaching Lockbox secrets to Serverless Container revisions is currently a
Yandex Cloud **Preview** feature. The scripts check the installed `yc` help
contract and fail before deployment if the required flags are unavailable.

## 2. Prerequisites

- Initialize the Yandex Cloud CLI manually with `yc init`.
- Select or obtain access to the target folder.
- Start Docker Desktop or another compatible Docker daemon.
- Use Git with a clean worktree for deployment.
- Ensure the Human operator can create the planned resources and bindings.
- Ensure the operator has `iam.serviceAccounts.user` for the runtime service
  account. Automation reports this permission when directly visible but never
  grants permissions to the current caller.

The runtime service account receives only:

- `ai.languageModels.user` on the configured folder;
- `container-registry.images.puller` on the registry;
- `lockbox.payloadViewer` on the configured Lockbox secret.

The workflow does not grant primitive `admin`/`editor` roles and does not create
a deployment service account.

## 3. Create local non-secret configuration

Copy the template to the ignored local path and replace all placeholders:

```powershell
Copy-Item .\infra\yandex\config.example.psd1 .\infra\yandex\config.psd1
notepad .\infra\yandex\config.psd1
```

`config.psd1` contains resource names, resource settings, the folder ID, AI
model identifier, base URL, Lockbox secret name, and Lockbox entry key. It must
never contain credential values. Unknown properties are rejected.

## 4. Inspect the bootstrap plan

The default command performs only read-only `yc` config/profile/whoami,
list/get/list-access-bindings operations and local availability checks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\bootstrap.ps1 `
  -Config .\infra\yandex\config.psd1
```

Review the active profile, folder mismatch, existing resources, exact missing
roles, Docker credential-helper state, Lockbox version/key metadata, public
access, and the proposed actions.

## 5. Apply bootstrap explicitly

Only after reviewing the plan:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\bootstrap.ps1 `
  -Config .\infra\yandex\config.psd1 `
  -Apply
```

Type `APPLY` at the prompt. `-Force` suppresses this second confirmation and is
intended only for an already reviewed Human-run invocation. Apply is
idempotent: exact-name resources and exact scoped bindings are inspected before
a missing item is created.

Bootstrap may create registry, runtime service account, Serverless Container
metadata, payload-free Lockbox metadata, least-privilege runtime bindings,
public invocation access, and the local `yc` Docker credential-helper entry.
It never changes the active `yc` profile or unrelated IAM bindings.

## 6. Add one Lockbox value manually

Automation does not accept, read, print, or persist the AI credential. If the
configured secret has no active version containing the configured key, open
Yandex Cloud Console, select the Lockbox secret, and add one custom entry:

```text
key: api-key
value: <existing Yandex AI Studio API key>
```

Do not pass this value to any repository script or place it in
`config.psd1`. The scripts inspect only version/key metadata and never retrieve
the Lockbox payload.

## 7. Verify bootstrap readiness

Run the plan-only bootstrap command again. Continue only when the registry,
container, runtime service account, three scoped runtime roles, public access,
Docker helper, and active Lockbox version/key all report ready. Resolve
`iam.serviceAccounts.user` with a cloud administrator if it is not confirmed;
the script deliberately will not grant it.

## 8. Inspect the deployment plan

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\deploy.ps1 `
  -Config .\infra\yandex\config.psd1
```

Plan mode runs no Docker build/push and deploys no revision. It verifies the
clean Git commit, calculates the immutable 12-character Git-SHA tag, inspects
bootstrap resources/roles, reports the previous active revision, and lists
blockers. `-AllowDirty` exists only as an explicit exceptional override.

## 9. Apply deployment explicitly

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\deploy.ps1 `
  -Config .\infra\yandex\config.psd1 `
  -Apply
```

After confirmation the script:

1. runs `infra/docker/smoke.ps1` with `ai-gantt-planner:<git-sha>`;
2. tags and pushes `cr.yandex/<registry-id>/<repository>:<git-sha>`;
3. deploys a new revision from that immutable tag;
4. attaches only non-secret provider/folder environment values;
5. attaches the Lockbox entry by secret ID, version ID, key, and target variable;
6. preserves all old images/revisions and runs cloud smoke.

`-SkipLocalSmoke` is an explicit exceptional override; it still builds the
immutable local image before push. The revision always uses the SHA tag, never
`:latest`.

If image push succeeds but revision deployment fails, the image is retained and
reported. If deployment succeeds but smoke fails, no automatic rollback occurs;
the previous revision and an exact rollback command are printed.

## 10. Cloud smoke

Resolve the URL from config:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\smoke.ps1 `
  -Config .\infra\yandex\config.psd1
```

Or supply an explicit public HTTPS URL with `-Url`. Baseline smoke uses no
authentication header and verifies the application shell, a referenced asset,
health JSON, seven seed tasks, and JSON API 404 behavior with cold-start retry.

Optional live provider validation sends one read-only Russian request and
asserts that the plan is unchanged:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\smoke.ps1 `
  -Config .\infra\yandex\config.psd1 `
  -LiveAi
```

## 11. Rollback

List immutable revisions without changing anything:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\rollback.ps1 `
  -Config .\infra\yandex\config.psd1
```

Prepare a target-specific read-only plan by adding `-RevisionId <revision-id>`.
Activate it only after review:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\infra\yandex\rollback.ps1 `
  -Config .\infra\yandex\config.psd1 `
  -RevisionId <revision-id> `
  -Apply
```

Rollback uses the official container rollback command, runs cloud smoke, and
never deletes revisions or images. Resource history remains available.

## 12. Cost-conscious cleanup after review

Serverless invocations, stored registry images, and Lockbox operations may
incur charges. After the Human review, inspect revisions/images and remove only
resources the owner explicitly decides are no longer required. Cleanup is not
automated here because deletion scope and retention are Human decisions. Keep a
known-good revision/image until the deployed demo is no longer needed.

## 13. Security and repository boundary

- Local config/state paths are ignored by Git.
- No script parameter or config property accepts the credential value.
- No script retrieves Lockbox payloads.
- Secret values are not printed or passed through process arguments.
- Runtime permissions are scoped to folder, registry, and secret as documented.
- Deployment uses immutable Git-SHA tags and preserves rollback history.
- Plan mode never changes cloud resources, IAM, public access, or Docker config.
- This README remains in GitHub and is not deployed as product documentation.

Official platform references:

- [Serverless Container revisions and runtime PORT](https://yandex.cloud/en/docs/serverless-containers/concepts/container)
- [Lockbox attachment to Serverless Containers (Preview)](https://yandex.cloud/en/docs/lockbox/operations/serverless/containers)
- [Yandex Container Registry Docker credential helper](https://yandex.cloud/en/docs/container-registry/operations/authentication)
