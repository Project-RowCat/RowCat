#!/usr/bin/env bash
# Succeeds only when the CI workflow (.github/workflows/ci.yml) passed on this exact commit.
#
#   scripts/ci-passed.sh <commit sha> [minutes to wait]
#
# The release workflows (images, npm) call this instead of running the suite again: CI is where
# the suite runs with its real services (Postgres, Redis, the browser journeys, the compose smoke),
# and a second, lighter copy of those gates inside a release workflow is the copy that drifts. A
# run still in progress is waited for; a commit CI never saw, or saw fail, is refused — there is no
# override, because the override is the thing a hurried release would use.
#
# Needs `gh` with a token that may read Actions (GH_TOKEN, `actions: read`) and GITHUB_REPOSITORY.
set -euo pipefail

sha="${1:?usage: ci-passed.sh <commit sha> [minutes to wait]}"
minutes="${2:-60}"
deadline=$(($(date +%s) + minutes * 60))

while :; do
	runs="$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=50" \
		--jq '[.workflow_runs[] | {status, conclusion}]')"

	if jq -e 'any(.[]; .status == "completed" and .conclusion == "success")' <<<"$runs" >/dev/null; then
		echo "CI passed on ${sha}."
		exit 0
	fi

	if ! jq -e 'any(.[]; .status != "completed")' <<<"$runs" >/dev/null; then
		if [ "$(jq length <<<"$runs")" = 0 ]; then
			echo "::error::CI never ran on ${sha}. Push the commit to a branch and let CI pass before releasing it." >&2
		else
			echo "::error::CI did not pass on ${sha} ($(jq -c 'map(.conclusion)' <<<"$runs")). Fix it on a new commit; do not release this one." >&2
		fi
		exit 1
	fi

	if [ "$(date +%s)" -ge "$deadline" ]; then
		echo "::error::CI is still running on ${sha} after ${minutes} minutes." >&2
		exit 1
	fi
	echo "CI is still running on ${sha}; checking again in 30 s."
	sleep 30
done
