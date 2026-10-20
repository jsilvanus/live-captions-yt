import { Router, Route, Switch, Redirect } from 'wouter';
import { AppProviders } from '../../contexts/AppProviders';
import { AudioProvider } from '../../contexts/AudioContext';
import { QuickListPage } from './QuickListPage.jsx';
import { QuickCaptionsPage } from './QuickCaptionsPage.jsx';
import { QuickRestreamPage } from './QuickRestreamPage.jsx';

/**
 * The `/quick` area: workflow pages without the sidebar, so each one fits a small pop-out window. Same providers as the
 * full app (the session auto-connects, and the hidden audio engine lives in AudioProvider), mounted by main.jsx behind
 * the AuthGate. Routes are relative to the `/quick` base.
 */
export function QuickApp() {
  return (
    <AppProviders embed>
      <AudioProvider>
        <Router base="/quick">
          <Switch>
            <Route path="/" component={QuickListPage} />
            <Route path="/captions" component={QuickCaptionsPage} />
            <Route path="/restream" component={QuickRestreamPage} />
            <Route><Redirect to="/" /></Route>
          </Switch>
        </Router>
      </AudioProvider>
    </AppProviders>
  );
}
