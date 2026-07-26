"""`lcyt-stt` CLI: serve the inference server, or run dataset pipeline commands."""

import argparse
import logging
import os
import sys


def _serve(args):
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run("lcyt_stt.serve.app:app", host="0.0.0.0", port=args.port)


def _dataset_pull(args):
    from .dataset.pull import pull_snapshot

    pull_snapshot(
        base_url=args.base_url,
        corpus_id=args.corpus_id,
        token_env=args.token_env,
        out_dir=args.out,
    )


def _dataset_build(args):
    from .dataset.build import build_dataset

    build_dataset(snapshot_dir=args.snapshot, out_dir=args.out, seed=args.seed)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="lcyt-stt")
    sub = parser.add_subparsers(dest="command", required=True)

    serve_p = sub.add_parser("serve", help="Run the FastAPI inference server")
    serve_p.add_argument("--port", type=int, default=int(os.environ.get("LCYT_STT_PORT", "8090")))
    serve_p.set_defaults(func=_serve)

    dataset_p = sub.add_parser("dataset", help="Dataset pipeline commands")
    dataset_sub = dataset_p.add_subparsers(dest="dataset_command", required=True)

    pull_p = dataset_sub.add_parser("pull", help="Pull a validated snapshot from crowd-source-voice")
    pull_p.add_argument("--base-url", required=True, help="crowd-source-voice base URL, e.g. https://csv.example.org")
    pull_p.add_argument("--corpus-id", required=True, type=int)
    pull_p.add_argument("--token-env", default="CSV_ADMIN_TOKEN", help="Env var holding the admin bearer token")
    pull_p.add_argument("--out", required=True, help="Snapshot output directory")
    pull_p.set_defaults(func=_dataset_pull)

    build_p = dataset_sub.add_parser("build", help="Build an HF dataset + train/dev/test split from a snapshot")
    build_p.add_argument("--snapshot", required=True, help="Snapshot directory produced by `dataset pull`")
    build_p.add_argument("--out", required=True, help="Output directory for the built dataset")
    build_p.add_argument("--seed", type=int, default=42)
    build_p.set_defaults(func=_dataset_build)

    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
