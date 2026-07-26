from lcyt_stt.dataset.build import DEFAULT_SPLIT_RATIOS, compute_split
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
