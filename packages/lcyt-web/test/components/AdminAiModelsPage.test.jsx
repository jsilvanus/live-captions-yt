import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionContext } from '../../src/contexts/SessionContext.jsx';

vi.mock('../../src/components/AdminKeyGate.jsx', () => ({ AdminKeyGate: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/components/AdminTabShell.jsx', () => ({ AdminTabShell: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/components/setup-hub/AiModelsSection.jsx', () => ({ AiModelsSection: () => <div data-testid="admin-ai-models-section" /> }));
vi.mock('../../src/components/setup-hub/McpAccessSection.jsx', () => ({ McpAccessSection: () => <div data-testid="admin-mcp-access-section" /> }));

import { AdminAiModelsPage } from '../../src/components/AdminAiModelsPage.jsx';

describe('AdminAiModelsPage', () => {
  it('renders the shared AI models and MCP access sections', () => {
    render(
      <SessionContext.Provider value={{ backendUrl: 'http://localhost:3000' }}>
        <AdminAiModelsPage />
      </SessionContext.Provider>
    );

    expect(screen.getByText('AI Models & MCP Access')).toBeInTheDocument();
    expect(screen.getByTestId('admin-ai-models-section')).toBeInTheDocument();
    expect(screen.getByTestId('admin-mcp-access-section')).toBeInTheDocument();
  });
});
