import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LangProvider } from '../../src/contexts/LangContext.jsx';
import { CameraForm } from '../../src/components/ProductionCamerasPage.jsx';

/** The control-type select: the one that offers the webcam option (the connection picker is a select too). */
function controlTypeSelect() {
  return screen.getByRole('option', { name: 'Webcam (browser)' }).closest('select');
}

function renderForm(initial) {
  return render(
    <LangProvider>
      <CameraForm initial={initial} bridges={[]} onSave={vi.fn()} onCancel={vi.fn()} />
    </LangProvider>,
  );
}

describe('CameraForm', () => {
  it('does not offer an RTMP option, and points to the Feeds card', () => {
    renderForm(undefined);
    const values = [...controlTypeSelect().querySelectorAll('option')].map(o => o.value);
    expect(values).not.toContain('rtmp');
    expect(values).toContain('webcam');
    const link = screen.getByRole('link', { name: 'Open the Feeds card' });
    expect(link).toHaveAttribute('href', '/setup/feeds');
    expect(screen.getByText(/are feeds now/)).toBeInTheDocument();
  });
});
