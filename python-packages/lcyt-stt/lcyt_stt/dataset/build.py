"""`lcyt-stt dataset build` — snapshot -> HF `datasets` DatasetDict with a speaker-disjoint split.

Splits by speaker_id (added to crowd-source-voice's export specifically for
this) when every row has one. If any row lacks it — e.g. a snapshot pulled
before that field existed — falls back to a seeded random utterance-level
split and marks the result `speaker_disjoint: false` rather than silently
pretending the split is speaker-disjoint.
"""

import json
import logging
import random
from pathlib import Path

from .normalize import normalize_text

logger = logging.getLogger(__name__)

DEFAULT_SPLIT_RATIOS = {"train": 0.9, "dev": 0.05, "test": 0.05}


def compute_split(rows, split_ratios=None, seed=42):
    """Returns (assignment: {file: split_name}, speaker_disjoint: bool)."""
    split_ratios = split_ratios or DEFAULT_SPLIT_RATIOS
    speaker_disjoint = len(rows) > 0 and all(row.get("speaker_id") for row in rows)
    if speaker_disjoint:
        assignment = _speaker_disjoint_split(rows, split_ratios, seed)
    else:
        assignment = _random_split(rows, split_ratios, seed)
    return assignment, speaker_disjoint


def build_dataset(snapshot_dir, out_dir, seed=42, split_ratios=None):
    from datasets import Audio, Dataset, DatasetDict

    split_ratios = split_ratios or DEFAULT_SPLIT_RATIOS
    snapshot_dir = Path(snapshot_dir)
    out_dir = Path(out_dir)

    rows = json.loads((snapshot_dir / "recordings.json").read_text())
    for row in rows:
        row["text"] = normalize_text(row["text"])
        row["audio"] = str(snapshot_dir / "audio" / row["file"])

    assignment, speaker_disjoint = compute_split(rows, split_ratios, seed)
    if not speaker_disjoint:
        logger.warning(
            "speaker_id missing on one or more rows — falling back to a seeded random "
            "utterance-level split. This is NOT speaker-disjoint: the same voice may "
            "appear in both train and eval splits."
        )

    split_row_counts = {
        split_name: sum(1 for r in rows if assignment[r["file"]] == split_name) for split_name in split_ratios
    }
    empty_splits = [name for name, count in split_row_counts.items() if count == 0]
    if empty_splits:
        # Small speaker counts round down to zero under the default ratios
        # (e.g. 3 speakers -> dev/test both get round(3*0.05)=0). Left
        # unchecked this reaches `datasets`' save_to_disk() and crashes with
        # an opaque ZeroDivisionError in _estimate_nbytes() for any empty
        # split with an Audio column — fail fast with an actionable message
        # instead of a snapshot too small for the requested split ratios.
        raise ValueError(
            f"Split(s) {empty_splits} would have 0 rows with split_ratios={split_ratios} "
            f"({len(rows)} rows, speaker_disjoint={speaker_disjoint}). Use a larger snapshot, "
            "fewer splits, or wider ratios for a dataset this small."
        )

    splits = {}
    for split_name in split_ratios:
        split_rows = [r for r in rows if assignment[r["file"]] == split_name]
        splits[split_name] = Dataset.from_list(
            [{"audio": r["audio"], "text": r["text"], "duration": r["duration"]} for r in split_rows]
        ).cast_column("audio", Audio(sampling_rate=16000))

    dataset = DatasetDict(splits)
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset.save_to_disk(str(out_dir))

    metadata = {
        "speaker_disjoint": speaker_disjoint,
        "seed": seed,
        "split_ratios": split_ratios,
        "split_sizes": {name: len(ds) for name, ds in splits.items()},
    }
    (out_dir / "build_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    logger.info("Built dataset: %s", metadata)
    return metadata


def _speaker_disjoint_split(rows, split_ratios, seed):
    speakers = sorted({row["speaker_id"] for row in rows})
    rng = random.Random(seed)
    rng.shuffle(speakers)

    boundaries = _ratio_boundaries(len(speakers), split_ratios)
    speaker_to_split = {}
    for split_name, (start, end) in boundaries.items():
        for speaker in speakers[start:end]:
            speaker_to_split[speaker] = split_name

    return {row["file"]: speaker_to_split[row["speaker_id"]] for row in rows}


def _random_split(rows, split_ratios, seed):
    files = [row["file"] for row in rows]
    rng = random.Random(seed)
    rng.shuffle(files)

    boundaries = _ratio_boundaries(len(files), split_ratios)
    assignment = {}
    for split_name, (start, end) in boundaries.items():
        for f in files[start:end]:
            assignment[f] = split_name
    return assignment


def _ratio_boundaries(n, split_ratios):
    boundaries = {}
    cursor = 0
    names = list(split_ratios.keys())
    for i, name in enumerate(names):
        end = n if i == len(names) - 1 else cursor + round(n * split_ratios[name])
        boundaries[name] = (cursor, end)
        cursor = end
    return boundaries
