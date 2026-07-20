import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

vi.mock('../../src/components/AdminKeyGate.jsx', () => ({ AdminKeyGate: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/components/AdminTabShell.jsx', () => ({ AdminTabShell: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/components/setup-hub/McpAccessSection.jsx', () => ({ McpAccessSection: () => <div data-testid="admin-mcp-access-section" /> }));

import { AdminAiModelsPage } from '../../src/components/AdminAiModelsPage.jsx';

describe('AdminAiModelsPage', () => {
  it('renders the shared MCP access section', () => {
    render(
      <SessionContext.Provider value={{ backendUrl: 'http://localhost:3000' }}>
        <AdminAiModelsPage />
      </SessionContext.Provider>
    );

    expect(screen.getByText('MCP Access')).toBeInTheDocument();
    expect(screen.getByTestId('admin-mcp-access-section')).toBeInTheDocument();
  });
});
