import { useEffect } from 'react';
import './auth.css';
import { KEYS } from '../../lib/storageKeys';

export function AuthLayout({
  cornerPrompt,
  cornerLinkLabel,
  cornerLinkHref,
  children,
}) {
  useEffect(() => {
    const theme = localStorage.getItem(KEYS.ui.theme);
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      // Light is the default; no attribute needed, but ensure any prior dark attr is removed
      root.removeAttribute('data-theme');
    }
  }, []);

  return (
    <div className="auth-page">
      <div className="auth-shell">
        {/* Dark brand panel */}
        <div className="auth-brand-panel">
          <svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
            <circle cx="500" cy="500" r="480" fill="none" stroke="white" strokeWidth="60" />
            <path
              d="M500,100 Q900,500 500,900 Q100,500 500,100"
              fill="none"
              stroke="white"
              strokeWidth="40"
            />
          </svg>
          <div className="auth-brand-content">
            <div className="auth-brand-bars">
              <div className="auth-brand-bar"></div>
              <div className="auth-brand-bar"></div>
              <div className="auth-brand-bar"></div>
            </div>
            <h1 className="auth-brand-headline">Live captions, done right.</h1>
            <p className="auth-brand-text">
              Professional-grade caption delivery for YouTube, streamers, production teams. Built for live broadcast and accessibility.
            </p>
          </div>
          <div className="auth-brand-footer">
            <p className="auth-brand-quote">
              "LCYT transformed how we caption our shows. Seamless, reliable, and our team absolutely loves the interface."
            </p>
            <div className="auth-brand-attribution">
              <div className="auth-brand-avatar">JD</div>
              <div className="auth-brand-person">
                <div className="auth-brand-name">Jordan Davis</div>
                <div className="auth-brand-role">Live Producer</div>
              </div>
            </div>
          </div>
        </div>

        {/* Form panel */}
        <div className="auth-form-panel">
          <div className="auth-form-content">
            {cornerPrompt && (
              <div className="auth-corner-prompt">
                {cornerPrompt}{' '}
                <a href={cornerLinkHref} className="auth-corner-link">
                  {cornerLinkLabel} →
                </a>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
