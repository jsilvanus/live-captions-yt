import { useEffect, useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { isOnboarded, markOnboarded } from '../lib/onboarding.js';

/**
 * OnboardingBanner — plan_ui.md v2 §2a's onboarding auto-trigger, adapted to
 * this codebase's actual shape: rather than gating the whole app behind a
 * blocking first-run wizard (the plan's original sketch, written before
 * `/setup/wizard` existed as a real standalone flow), this is a dismissible
 * nudge shown above a connected-but-unconfigured project's summary
 * (`RootRoute.jsx`) — "this project has no caption target yet, want to run
 * the wizard?" — backed by a per-project `lcyt.onboarded.<apiKey>` flag
 * (`lib/onboarding.js`) so it never nags a project twice, whether the user
 * runs the wizard, dismisses the banner, or the wizard's own handleFinish
 * marks it done directly.
 */
export function OnboardingBanner() {
  const session = useSessionContext();
  const apiKey = session?.apiKey;
  const backendUrl = session?.backendUrl;
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!apiKey || !backendUrl || isOnboarded(apiKey)) {
      setShow(false);
      return undefined;
    }
    (async () => {
      try {
        const token = session?.getSessionToken?.();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${backendUrl}/targets`, { headers });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const hasTargets = Array.isArray(data.targets) && data.targets.length > 0;
        if (!cancelled) setShow(!hasTargets);
      } catch { /* never block the page on this check */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, backendUrl]);

  if (!show) return null;

  function dismiss() {
    markOnboarded(apiKey);
    setShow(false);
  }

  return (
    <div className="onboarding-banner">
      <div className="onboarding-banner__text">
        <strong>This project isn't configured yet.</strong> Run the setup wizard to add a caption target and pick the features you need.
      </div>
      <div className="onboarding-banner__actions">
        <a className="btn btn--primary btn--sm" href="/setup/wizard" onClick={dismiss}>Run setup wizard</a>
        <button type="button" className="btn btn--ghost btn--sm" onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  );
}
