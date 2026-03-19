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
const stubWidget = (name) => ({ default: () => (<div data-testid={name}>{name}</div>) });
vi.mock('../../src/components/dashboard/StatusWidget', () => stubWidget('status-widget'));
vi.mock('../../src/components/dashboard/SentLogWidget', () => stubWidget('sentlog-widget'));
vi.mock('../../src/components/dashboard/AudioWidget', () => stubWidget('audio-widget'));
vi.mock('../../src/components/dashboard/InputWidget', () => stubWidget('input-widget'));
vi.mock('../../src/components/dashboard/FileWidget', () => stubWidget('file-widget'));
vi.mock('../../src/components/dashboard/BroadcastWidget', () => stubWidget('broadcast-widget'));
vi.mock('../../src/components/dashboard/ViewerWidget', () => stubWidget('viewer-widget'));
vi.mock('../../src/components/dashboard/ViewportsWidget', () => stubWidget('viewports-widget'));
vi.mock('../../src/components/dashboard/MetacodeWidget', () => stubWidget('metacode-widget'));

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
