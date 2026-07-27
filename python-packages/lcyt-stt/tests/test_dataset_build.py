import json

import pytest

from lcyt_stt.dataset.build import DEFAULT_SPLIT_RATIOS, build_dataset, compute_split
from lcyt_stt.dataset.normalize import normalize_text


def _rows(n, speakers_per=None):
    rows = []
    for i in range(n):
        speaker = f"spk{i % speakers_per}" if speakers_per else None
        rows.append({"file": f"{i:04d}.wav", "speaker_id": speaker, "text": "x", "duration": 1.0})
    return rows


def test_speaker_disjoint_when_all_rows_have_speaker_id():
    rows = _rows(30, speakers_per=6)
    assignment, speaker_disjoint = compute_split(rows, seed=1)

    assert speaker_disjoint is True
    assert set(assignment.keys()) == {r["file"] for r in rows}

    speaker_of = {r["file"]: r["speaker_id"] for r in rows}
    splits_by_speaker = {}
    for file, split_name in assignment.items():
        splits_by_speaker.setdefault(speaker_of[file], set()).add(split_name)

    assert all(len(splits) == 1 for splits in splits_by_speaker.values())


def test_falls_back_to_random_split_when_speaker_id_missing():
    rows = _rows(20, speakers_per=None)
    assignment, speaker_disjoint = compute_split(rows, seed=1)

    assert speaker_disjoint is False
    assert set(assignment.keys()) == {r["file"] for r in rows}
    assert set(assignment.values()) <= set(DEFAULT_SPLIT_RATIOS.keys())


def test_partial_speaker_id_also_falls_back():
    rows = _rows(10, speakers_per=3)
    rows[0]["speaker_id"] = None
    _, speaker_disjoint = compute_split(rows, seed=1)
    assert speaker_disjoint is False


def test_split_is_deterministic_given_seed():
    rows = _rows(20, speakers_per=6)
    a1, _ = compute_split(rows, seed=7)
    a2, _ = compute_split(rows, seed=7)
    assert a1 == a2


def test_split_sizes_roughly_match_ratios():
    rows = _rows(200, speakers_per=50)
    assignment, _ = compute_split(rows, seed=3)
    counts = {"train": 0, "dev": 0, "test": 0}
    for split_name in assignment.values():
        counts[split_name] += 1
    assert counts["train"] > counts["dev"]
    assert counts["train"] > counts["test"]
    assert sum(counts.values()) == 200


def test_normalize_text_strips_prompt_artifacts_and_collapses_whitespace():
    assert normalize_text("  Moi   maailma\\n  ") == "Moi maailma"
    assert normalize_text("rivi1\r\nrivi2") == "rivi1 rivi2"


def test_normalize_text_preserves_finnish_orthography_and_case():
    text = "Hyvää huomenta, Räätälintie 3!"
    assert normalize_text(text) == text


def test_normalize_text_passes_through_none():
    assert normalize_text(None) is None


def _write_snapshot(tmp_path, rows):
    audio_dir = tmp_path / "audio"
    audio_dir.mkdir()
    for row in rows:
        (audio_dir / row["file"]).write_bytes(b"RIFF0000WAVEfmt ")
    (tmp_path / "recordings.json").write_text(json.dumps(rows))


def test_build_dataset_raises_clear_error_instead_of_crashing_on_empty_split(tmp_path):
    # Few distinct speakers under the default 90/5/5 ratios round dev/test down
    # to 0 rows (round(6 * 0.05) == 0) — this used to reach datasets'
    # save_to_disk() and crash with an opaque ZeroDivisionError; it must now
    # fail fast with an actionable message instead.
    rows = [
        {"file": f"{i:04d}.wav", "speaker_id": f"spk{i % 3}", "text": "x", "duration": 1.0}
        for i in range(6)
    ]
    _write_snapshot(tmp_path, rows)

    with pytest.raises(ValueError, match="would have 0 rows"):
        build_dataset(str(tmp_path), str(tmp_path / "out"), seed=1)


def test_build_dataset_succeeds_and_writes_metadata_for_a_healthy_split(tmp_path):
    rows = [
        {"file": f"{i:04d}.wav", "speaker_id": f"spk{i % 30}", "text": f"row {i}", "duration": 1.0}
        for i in range(120)
    ]
    _write_snapshot(tmp_path, rows)

    out_dir = tmp_path / "out"
    metadata = build_dataset(str(tmp_path), out_dir=str(out_dir), seed=1)

    assert metadata["speaker_disjoint"] is True
    assert all(count > 0 for count in metadata["split_sizes"].values())
    assert sum(metadata["split_sizes"].values()) == 120
    assert json.loads((out_dir / "build_metadata.json").read_text()) == metadata
