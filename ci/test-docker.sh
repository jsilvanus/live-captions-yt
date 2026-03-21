#!/usr/bin/env bash
set -euo pipefail

# CI helper to run Docker-gated integration tests.
# Usage:
#   ci/test-docker.sh        # run backend tests with TEST_DOCKER=1
#   TEST_DOCKER=1 ./ci/test-docker.sh  # equivalent

export TEST_DOCKER=1

echo "Running Node tests (backend) with TEST_DOCKER=1"
# Run tests for the backend package only to keep CI time reasonable.
pushd packages/lcyt-backend >/dev/null
  # Use Node's test runner to run tests in this package. Respect existing npm test.
  NODE_OPTIONS= node --test --parallel test || {
    echo "Node tests failed" >&2
    popd >/dev/null
    exit 1
  }
popd >/dev/null

echo "Docker-gated tests finished."
