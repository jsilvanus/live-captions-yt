import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Router, Switch, Route, Redirect, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SETUP_REDIRECTS } from '../../src/lib/setupRedirects.js';

// Mirrors the setup routes of main.jsx: the redirects come before the generic card route.
function Where() {
  const [location] = useLocation();
  return <div data-testid="where">{location}</div>;
}

function renderAt(path) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <Switch>
        {SETUP_REDIRECTS.map(r => <Route key={r.from} path={r.from}><Redirect to={r.to} /></Route>)}
        <Route path="/setup/:card"><Where /></Route>
      </Switch>
    </Router>,
  );
}

describe('setup card redirects', () => {
  it('/setup/ingestion lands on /setup/feeds', () => {
    renderAt('/setup/ingestion');
    expect(screen.getByTestId('where')).toHaveTextContent('/setup/feeds');
  });

  it('other setup cards are not redirected', () => {
    renderAt('/setup/egress');
    expect(screen.getByTestId('where')).toHaveTextContent('/setup/egress');
  });
});
