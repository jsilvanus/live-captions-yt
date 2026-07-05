import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppProviders } from '../../src/contexts/AppProviders';
const renderWithAppProviders = (ui, options) => render(<AppProviders>{ui}</AppProviders>, options);

vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, ...props }) => (
    <div data-testid="responsive" data-props={JSON.stringify(props)}>{children}</div>
  ),
  useContainerWidth: () => ({ width: 1200, containerRef: { current: null }, mounted: true }),
}));

const setPanels = vi.fn();
const updateLayouts = vi.fn();

vi.mock('../../src/hooks/useDashboardConfig', () => ({
  useDashboardConfig: () => ({
    config: { panels: ['status', 'input'], layouts: {} },
    setPanels,
    updateLayouts,
    removePanel: vi.fn(),
  }),
  WIDGET_REGISTRY: [
    { id: 'status',    title: 'Status',     defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 } },
    { id: 'sent-log',  title: 'Sent Log',   defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 } },
    { id: 'input',     title: 'Quick Send', defaultLayout: { w: 6, h: 2, minW: 3, minH: 2 } },
    { id: 'audio',     title: 'Audio',      defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 } },
    { id: 'file',      title: 'File',       defaultLayout: { w: 3, h: 5, minW: 2, minH: 3 } },
    { id: 'viewports', title: 'Viewports',  defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 } },
    { id: 'broadcast', title: 'Broadcast',  defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 } },
    { id: 'viewer',    title: 'Viewer',     defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 } },
    { id: 'metacode',  title: 'Metacodes',  defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 } },
  ],
}));

vi.mock('../../src/components/dashboard/StatusWidget', () => ({
  __esModule: true, StatusWidget: () => (<div data-testid="status-widget" />), default: () => (<div data-testid="status-widget" />),
}));
vi.mock('../../src/components/dashboard/SentLogWidget', () => ({
  __esModule: true, SentLogWidget: () => (<div data-testid="sentlog-widget" />), default: () => (<div data-testid="sentlog-widget" />),
}));
vi.mock('../../src/components/dashboard/AudioWidget', () => ({
  __esModule: true, AudioWidget: () => (<div data-testid="audio-widget" />), default: () => (<div data-testid="audio-widget" />),
}));
vi.mock('../../src/components/dashboard/InputWidget', () => ({
  __esModule: true, InputWidget: () => (<div data-testid="input-widget" />), default: () => (<div data-testid="input-widget" />),
}));
vi.mock('../../src/components/dashboard/FileWidget', () => ({
  __esModule: true, FileWidget: () => (<div data-testid="file-widget" />), default: () => (<div data-testid="file-widget" />),
}));
vi.mock('../../src/components/dashboard/BroadcastWidget', () => ({
  __esModule: true, BroadcastWidget: () => (<div data-testid="broadcast-widget" />), default: () => (<div data-testid="broadcast-widget" />),
}));
vi.mock('../../src/components/dashboard/ViewerWidget', () => ({
  __esModule: true, ViewerWidget: () => (<div data-testid="viewer-widget" />), default: () => (<div data-testid="viewer-widget" />),
}));
vi.mock('../../src/components/dashboard/ViewportsWidget', () => ({
  __esModule: true, ViewportsWidget: () => (<div data-testid="viewports-widget" />), default: () => (<div data-testid="viewports-widget" />),
}));
vi.mock('../../src/components/dashboard/MetacodeWidget', () => ({
  __esModule: true, MetacodeWidget: () => (<div data-testid="metacode-widget" />), default: () => (<div data-testid="metacode-widget" />),
}));

import { LiveTab, BROADCAST_PRESETS } from '../../src/components/broadcast/LiveTab.jsx';

beforeEach(() => { vi.clearAllMocks(); });

describe('LiveTab', () => {
  it('passes draggableHandle/draggableCancel and respects editMode toggle', async () => {
    renderWithAppProviders(<LiveTab />);

    const responsive = await screen.findByTestId('responsive');
    const props = JSON.parse(responsive.getAttribute('data-props'));
    expect(props.isDraggable).toBe(false);
    expect(props.draggableHandle).toBe('.db-card__drag-handle');
    expect(props.draggableCancel).toBe('.db-card--locked *');

    const btn = screen.getByRole('button', { name: /edit/i });
    fireEvent.click(btn);

    const responsiveAfter = await screen.findByTestId('responsive');
    const propsAfter = JSON.parse(responsiveAfter.getAttribute('data-props'));
    expect(propsAfter.isDraggable).toBe(true);
  });

  it('renders a preset button for every BROADCAST_PRESETS entry', () => {
    renderWithAppProviders(<LiveTab />);
    for (const preset of BROADCAST_PRESETS) {
      expect(screen.getByRole('button', { name: preset.label })).toBeInTheDocument();
    }
  });

  it('applying a preset calls setPanels and updateLayouts with the preset panel set', () => {
    renderWithAppProviders(<LiveTab />);
    const fullOperate = BROADCAST_PRESETS.find(p => p.id === 'full-operate');
    fireEvent.click(screen.getByRole('button', { name: fullOperate.label }));

    expect(setPanels).toHaveBeenCalledWith(fullOperate.panels);
    expect(updateLayouts).toHaveBeenCalledTimes(1);
    const layoutsArg = updateLayouts.mock.calls[0][0];
    expect(layoutsArg.lg.map(i => i.i)).toEqual(fullOperate.panels);
  });
});
