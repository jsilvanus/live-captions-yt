# Sequential product releases

This repository uses simple, sequential product release tags rather than SemVer:

- First release: `v1`
- Next release: `v2`
- Then `v3`, and so on

The release workflow publishes the coordinated container images with the same product version. It does not automatically bump npm or PyPI package versions.

## Request a release

1. In your release PR, add or edit the file `.github/version/release`.
2. Put a short note in the file, such as the PR number and release reason. The text is informational only.
3. Merge the PR to `main`.
4. The Release workflow detects that the marker changed in the push, finds the highest existing numeric `vN` tag, creates the next annotated tag on the merge commit, and calls the image publishing workflow.
5. Check the [Release workflow runs](../../actions/workflows/release.yml) and the published packages in GitHub Container Registry.

**Important:** the marker file intentionally stays in the repository. For each subsequent release request, edit its contents in the PR so that the file changes in the merge. Merely having the file present does not trigger a release; ordinary pushes that do not change it will not publish images.

The marker should be included in the release PR, not added directly to `main`. Only one release request should be in flight at a time; wait for the previous release workflow to finish before merging another request.

## Published images

For a release such as `v12`, the image workflow publishes:

- `ghcr.io/jsilvanus/lcyt:v12`
- `ghcr.io/jsilvanus/lcyt-fleet-worker:v12`

It also publishes `latest` and a commit-SHA tag. Use the numbered tag to pin a deployment to a specific product release; use the SHA tag to identify the exact source commit.

## Recovery

If the release workflow fails, inspect whether the `vN` tag was already created before retrying. Tags should be treated as immutable. If the tag exists and image publication failed, rerun the relevant publishing workflow for that tag or fix the workflow and rebuild that same release; do not create a second version merely to retry publishing.
