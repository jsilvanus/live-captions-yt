---
id: plan/speech_to_sign_language
title: "Possible Future Feature: Speech to Finnish Sign Language (SVK) Avatar"
status: draft
summary: "Idea only. Spoken Finnish during a livestream (first target: church services) rendered as Finnish Sign Language by a signing avatar or signed video, shown as a separate picture-in-picture or dedicated signing stream. Staged approach: human-validated, offline demonstrator first, Deaf-led evaluation before any live use. Not scheduled; no code exists."
related: plan/server_stt, plan/mediamtx, plan/hls_sidecar
---

# Possible Future Feature: Speech to Finnish Sign Language

Status: draft idea, not scheduled. Source: an exploratory conversation (October 2026) with a general-purpose chat assistant, shared at https://chatgpt.com/share/6acbf514-b77c-83ed-9ad2-6454d3f5725b. The shared text is the origin of this summary. Nothing here has been prototyped or validated with Deaf users or sign-language professionals.

## Idea

Turn spoken Finnish into Finnish Sign Language (suomalainen viittomakieli, SVK) so that sermons, announcements and livestreams are usable by Deaf sign-language users. SVK is its own language with its own grammar, spatial structure and facial grammar. It is not Finnish with hand gestures, and it is distinct from Finnish-Swedish Sign Language, which would be a separate project.

Pipeline sketched in the conversation:

1. Finnish speech from the production mixer feed, a livestream or an uploaded recording.
2. Streaming Finnish speech recognition with timestamps. LCYT already has server-side STT (`plan_server_stt.md`), so this stage is mostly reuse.
3. Translation into SVK: an LLM with context and a domain glossary produces a structured intermediate representation (lexical sign IDs, grammatical roles, spatial references, non-manual markers, timing, confidence). Plain gloss sequences are not enough.
4. Sign realisation: either a recorded human signer, approved pre-recorded sign sequences, or a rigged 3D avatar driven by a validated motion library. A generic talking avatar is not sufficient.
5. Output as a separate video source (keyed or transparent avatar, or a dedicated signing scene), not burned into the main programme.

The hard part is steps 3 and 4. Speech recognition is comparatively mature; natural, grammatical signing is not.

## Approaches

| Approach | Description | Assessment |
|---|---|---|
| A. AI-assisted human signing | AI transcribes and drafts the translation; a qualified interpreter reviews or performs the signing. | Most practical first prototype. Still needs a human for reliable output. |
| B. Real-time 3D avatar | Structured sign sequences performed by a rigged avatar with facial expression. | Potentially scalable; needs sign-specific motion data and linguistic expertise. |
| C. AI-generated signing video | Translate a whole recording or paragraph, then produce a signed video to publish next to the original. | Good for asynchronous content because the output can be checked before publication. |

## Scope boundaries

- Language pair: spoken Finnish to SVK only.
- First domain: Finnish-language Lutheran church services (sermons, prayers, readings, announcements). Terminology, biblical names and quotations need a glossary and human review. Liturgical content should follow the Lutheran confession and church-year data the organisation already uses.
- Output is labelled as AI-generated and never presented as equivalent to a qualified human interpreter unless evidence supports that claim. A human interpreter and captions remain the fallback.
- Offer a separate, optional signing view. Do not cover the preacher's face by default.
- Unsupported or low-confidence content should show a visible warning and fall back, not silently generate plausible-looking signs.

## Data and licensing (must be settled before any model training)

- Corpus of Finnish Sign Language (Kielipankki): signed narratives and conversations; access and use conditions differ by subcorpus. A third part was released as a release candidate in 2025 and is not annotated.
- Finnish Signbank: lexical resource; stored videos are stated as CC BY-NC-SA. That is not blanket permission for commercial training or redistribution.
- Open questions to answer in writing: does the licence allow machine-learning training and derivative motion extraction; may weights or generated animations be redistributed; are church-institutional deployments allowed; does consent cover synthetic reproduction of a signer's appearance or style; what deletion and withdrawal rules apply.
- Viewing a sign video publicly is not the same as having permission to train on, synthesise from or redistribute it.
- New professional recordings with informed consent and a negotiated licence are likely needed for avatar motion and church vocabulary.

## Validation

- The success criterion is whether Deaf SVK users understand the message accurately and comfortably, not whether a hearing engineer finds the avatar convincing.
- Deaf-led evaluation group: Deaf SVK users with varied backgrounds, qualified SVK interpreters and translators, a sign-language linguist, the technical team and a church representative for theological terminology. Deaf participants must be able to block a release that fails agreed thresholds. Pay advisers.
- Measure meaning preservation, linguistic naturalness, comprehension, critical error rate (negation, agency, names, theological meaning), visual intelligibility, latency and viewer trust. Word-error rate and gloss accuracy alone do not establish comprehensibility.
- Suggested starting targets (proposals, not standards): at least 90% of independently scored core-message units conveyed; no unresolved critical meaning reversals; a majority of Deaf evaluators find output understandable; median end-to-end latency under 5 s for short supported utterances. An average score alone is not grounds for deployment.

## Staged plan

| Phase | Scope | Gate |
|---|---|---|
| 0. Feasibility and co-design | Recruit and pay advisers; review corpus access and licences; pick representative material; test whether existing data supports a limited vocabulary. | Credible path to licensed signing data and expert evaluation. |
| 1. Offline demonstrator | Prerecorded sermon audio, draft translation corrected by an SVK expert, rendered signing compared with human-signed reference. | Deaf evaluators find it intelligible enough to justify live development. |
| 2. Near-live prototype | Streaming ASR into translation, sermon context across sentences, queue and transitions, latency monitoring, fallback screen, browser output for OBS-type tools. | Agreed comprehension, critical-error and latency targets in controlled trials. |
| 3. Supervised church pilot | Trials in selected services with informed participants; compare with a human interpreter; structured feedback; incident and correction process. | Language quality, user trust, licensing and reliability are all acceptable. |

The avatar's signing quality, not software integration, is the main schedule risk. The project may stop or narrow scope after Phase 0 or 1.

## Production integration (ideas)

- Keep the signing feed as an independent video source. The AI pipeline should be restartable without touching the programme video.
- A video switcher (the conversation mentioned an ATEM) would composite the signer as a picture-in-picture or a separate scene. The AI application would not produce the final stream.
- Fits LCYT's existing streaming pieces: the mixer and STT feeds, MediaMTX for video distribution (`plan_mediamtx.md`), and HLS captions (`plan_hls_sidecar.md`).

## Open questions

- Is there a church or organisation partner willing to provide sermon material and a controlled test environment?
- Which Deaf and SVK-professional partners would co-design the work, and on what paid terms?
- Is a licensed data route available for the vocabulary the church domain needs?
- Would Finnish-Swedish Sign Language be a later, separate project?

## Not in scope of this document

No code, models, datasets or recordings are part of this note. Model weights and any sign-language data must not be committed to this repository (see `CLAUDE.md`).
