import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../src/lib/i18n.js';
import { makePanelT } from '../../../src/components/JobsIndicator.jsx';
import { formatJobAge, jobDetail, jobPercent, pollInterval } from '../../../src/components/jobs-panel/job-panel.js';

const t = makePanelT(getMessages('en'));
const now = Date.parse('2026-10-18T12:00:00Z');

describe('job panel helpers', { timeout: 10_000 }, () => {
  it('polls fast while open or active and slowly when idle', () => {
    expect(pollInterval(true, 0)).toBe(3000);
    expect(pollInterval(false, 2)).toBe(3000);
    expect(pollInterval(false, 0)).toBe(15000);
  });
  it('writes ages', () => {
    expect(formatJobAge('2026-10-18T11:59:30Z', now, t)).toBe('30 s ago');
    expect(formatJobAge('2026-10-18T11:55:00Z', now, t)).toBe('5 min ago');
    expect(formatJobAge('2026-10-18T09:00:00Z', now, t)).toBe('3 h ago');
    expect(formatJobAge('2026-10-16T12:00:00Z', now, t)).toBe('2 d ago');
    expect(formatJobAge(null, now, t)).toBe('');
  });
  it('clamps progress and fixes the ends', () => {
    expect(jobPercent({ status: 'RUNNING', progress: 42.4 })).toBe(42);
    expect(jobPercent({ status: 'RUNNING', progress: 140 })).toBe(100);
    expect(jobPercent({ status: 'QUEUED', progress: 30 })).toBe(0);
    expect(jobPercent({ status: 'COMPLETED', progress: 0 })).toBe(100);
  });
  it('shows the error of a failed job and the message otherwise', () => {
    expect(jobDetail({ status: 'FAILED', error: 'boom', message: 'x', phase: 'y' })).toBe('boom');
    expect(jobDetail({ status: 'RUNNING', error: null, message: 'fi · 7', phase: 'running' })).toBe('fi · 7');
    expect(jobDetail({ status: 'RUNNING', error: null, message: null, phase: 'ENCODING' })).toBe('ENCODING');
  });
});

describe('panel translations', { timeout: 10_000 }, () => {
  const KEYS = [
    'jobs.title', 'jobs.open', 'jobs.close', 'jobs.empty', 'jobs.badge', 'jobs.cancel', 'jobs.cancelling', 'jobs.cancelFailed', 'jobs.loadFailed',
    'jobs.cancelRequested', 'jobs.cancelConfirm', 'jobs.cancelYes', 'jobs.cancelNo', 'jobs.mode.pull', 'jobs.mode.push', 'jobs.section.active', 'jobs.section.recent', 'jobs.ago.s', 'jobs.ago.m', 'jobs.ago.h', 'jobs.ago.d',
    'jobs.type.FFMPEG', 'jobs.type.AUDITOR_LIVE',
    ...['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((s) => `jobStatus.${s}`),
    ...['offline', 'workers', 'slots', 'queue', 'draining', 'local', 'localWorkers', 'lanes', 'app', 'stt', 'sttBusy', 'live'].map((k) => `fleetStrip.${k}`),
  ];
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

  for (const lang of ['en', 'fi', 'sv']) {
    it(`${lang} has every key, with the same placeholders as English`, () => {
      const tt = makePanelT(getMessages(lang));
      const en = makePanelT(getMessages('en'));
      for (const key of KEYS) {
        expect(tt(key), `${lang} ${key}`).not.toBe(key);
        expect(placeholders(tt(key)), `${lang} ${key}`).toBe(placeholders(en(key)));
      }
    });
  }

  it('fills placeholders and leaves unknown ones as written', () => {
    expect(t('fleetStrip.slots', { used: 5, total: 8 })).toBe('slots 5/8');
    expect(t('fleetStrip.slots', { used: 5 })).toBe('slots 5/{total}');
  });
  it('falls back to the raw status for an unknown job status', () => {
    expect(t('jobStatus.WEIRD')).toBe('WEIRD');
  });
});

import { canCancelJob, nextConfirm, modeSymbol } from '../../../src/components/jobs-panel/job-panel.js';
describe('cancel and mode helpers', { timeout: 10_000 }, () => {
  it('canCancelJob', () => {
    const j = { status: 'RUNNING', cancelRequested: false };
    expect(canCancelJob(j)).toBe(true);
    expect(canCancelJob({ ...j, cancellable: false })).toBe(false);
    expect(canCancelJob({ ...j, cancellable: true })).toBe(true);
    expect(canCancelJob(j, false)).toBe(false);
    expect(canCancelJob({ ...j, cancelRequested: true })).toBe(false);
    expect(canCancelJob({ ...j, status: 'COMPLETED' })).toBe(false);
  });
  it('nextConfirm', () => {
    expect(nextConfirm(null, 'ask', 'a')).toBe('a');
    expect(nextConfirm('a', 'ask', 'b')).toBe('b');
    expect(nextConfirm('a', 'no', 'a')).toBeNull();
    expect(nextConfirm('a', 'no', 'b')).toBe('a');
  });
  it('modeSymbol', () => {
    expect(modeSymbol('pull')).toEqual({ symbol: '↓', key: 'jobs.mode.pull' });
    expect(modeSymbol('push').symbol).toBe('↑');
    expect(modeSymbol(undefined)).toBeNull();
  });
});
