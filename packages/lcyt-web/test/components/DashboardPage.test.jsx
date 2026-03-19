import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub helper must be declared before vi.mock (vitest hoists mocks)
const stubWidget = (name) => ({ default: () => (<div data-testid={name}>{name}</div>) });

// Mock react-grid-layout to capture props passed to Responsive
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, ...props }) => (
    <div data-testid="responsive" data-props={JSON.stringify(props)}>{children}</div>
  ),
  useContainerWidth: () => ({ width: 1200, containerRef: { current: null }, mounted: true }),
}));

// Mock useDashboardConfig to provide a simple config with two panels
vi.mock('../../src/hooks/useDashboardConfig', () => ({
  useDashboardConfig: () => ({
    config: { panels: ['status', 'input'], layouts: {} },
    setPanels: () => {},
    updateLayouts: () => {},
    removePanel: () => {},
  }),
  WIDGET_REGISTRY: [
    { id: 'status', title: 'Status' },
    { id: 'input', title: 'Quick Send' },
  ],
}));

// Stub individual dashboard widgets so tests don't require providers
vi.mock('../../src/components/dashboard/StatusWidget', () => ({ default: () => (<div data-testid="status-widget">status-widget</div>) }));
vi.mock('../../src/components/dashboard/SentLogWidget', () => ({ default: () => (<div data-testid="sentlog-widget">sentlog-widget</div>) }));
vi.mock('../../src/components/dashboard/AudioWidget', () => ({ default: () => (<div data-testid="audio-widget">audio-widget</div>) }));
vi.mock('../../src/components/dashboard/InputWidget', () => ({ default: () => (<div data-testid="input-widget">input-widget</div>) }));
vi.mock('../../src/components/dashboard/FileWidget', () => ({ default: () => (<div data-testid="file-widget">file-widget</div>) }));
vi.mock('../../src/components/dashboard/BroadcastWidget', () => ({ default: () => (<div data-testid="broadcast-widget">broadcast-widget</div>) }));
vi.mock('../../src/components/dashboard/ViewerWidget', () => ({ default: () => (<div data-testid="viewer-widget">viewer-widget</div>) }));
vi.mock('../../src/components/dashboard/ViewportsWidget', () => ({ default: () => (<div data-testid="viewports-widget">viewports-widget</div>) }));
vi.mock('../../src/components/dashboard/MetacodeWidget', () => ({ default: () => (<div data-testid="metacode-widget">metacode-widget</div>) }));

import { DashboardPage } from '../../src/components/DashboardPage.jsx';

beforeEach(() => { vi.clearAllMocks(); });

describe('DashboardPage', () => {
  it('passes draggableHandle and draggableCancel and respects editMode toggle', async () => {
    render(<DashboardPage />);

    const responsive = await screen.findByTestId('responsive');
    const props = JSON.parse(responsive.getAttribute('data-props'));

    // By default editMode is false: isDraggable should be false
    expect(props.isDraggable).toBe(false);
    // Our change ensures draggableHandle is always set
    expect(props.draggableHandle).toBe('.db-card__drag-handle');
    // And locked cards should be canceled from drag
    expect(props.draggableCancel).toBe('.db-card--locked *');

    // Toggle edit mode by clicking the edit button
    const btn = screen.getByRole('button', { name: /edit layout|lock layout/i });
    fireEvent.click(btn);

    const responsiveAfter = await screen.findByTestId('responsive');
    const propsAfter = JSON.parse(responsiveAfter.getAttribute('data-props'));
    expect(propsAfter.isDraggable).toBe(true);
  });
});
