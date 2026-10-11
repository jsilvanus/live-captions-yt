import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IntentStep } from '../../src/components/setup-wizard/IntentStep.jsx';
import { QuestionsStep } from '../../src/components/setup-wizard/QuestionsStep.jsx';
import { StepReview } from '../../src/components/setup-wizard/StepReview.jsx';

describe('IntentStep', () => {
  it('renders a card per intent and reports toggles as a new Set', () => {
    const onChange = vi.fn();
    render(<IntentStep intents={new Set(['captions'])} onChange={onChange} />);
    expect(screen.getByTestId('intent-captions')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('intent-video')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByTestId('intent-video'));
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['captions', 'video']);

    fireEvent.click(screen.getByTestId('intent-captions'));
    expect([...onChange.mock.calls[1][0]]).toEqual([]);
  });
});

describe('QuestionsStep', () => {
  it('shows questions of chosen intents only, and the STT location only after "transcribe"', () => {
    const { rerender } = render(<QuestionsStep intents={new Set(['captions'])} answers={{}} onChange={() => {}} />);
    expect(screen.getByTestId('question-captionSource')).toBeInTheDocument();
    expect(screen.queryByTestId('question-sttLocation')).toBeNull();
    expect(screen.queryByTestId('question-relay')).toBeNull();

    rerender(<QuestionsStep intents={new Set(['captions'])} answers={{ captionSource: 'transcribe' }} onChange={() => {}} />);
    expect(screen.getByTestId('question-sttLocation')).toBeInTheDocument();
  });

  it('merges a new answer into the answers object', () => {
    const onChange = vi.fn();
    render(<QuestionsStep intents={new Set(['video'])} answers={{ videoInput: 'rtmp' }} onChange={onChange} />);
    const relay = screen.getByTestId('question-relay');
    fireEvent.click(relay.querySelectorAll('input[type="radio"]')[0]); // Yes
    expect(onChange).toHaveBeenCalledWith({ videoInput: 'rtmp', relay: true });
  });

  it('explains graphics concepts when graphics is chosen', () => {
    render(<QuestionsStep intents={new Set(['graphics'])} answers={{}} onChange={() => {}} />);
    expect(screen.getByTestId('concept-graphics')).toHaveTextContent(/viewport/i);
  });
});

describe('StepReview with intents', () => {
  const steps = [{ id: 'intent', title: 'x' }, { id: 'review', title: 'Review' }];
  const base = { steps, localSettings: {}, configs: {}, onEditStep: () => {} };

  it('shows the production flow and prerequisites with links', () => {
    render(
      <StepReview
        {...base}
        selectedFeatures={new Set(['device-control'])}
        intents={new Set(['devices'])}
        answers={{ operatorDevices: true }}
      />
    );
    expect(screen.getByTestId('review-flow')).toBeInTheDocument();
    const pre = screen.getByTestId('review-prerequisites');
    expect(pre).toHaveTextContent(/device role/i);
    expect(pre.querySelector('a')).toHaveAttribute('href', '/production/devices');
  });

  it('shows no flow or prerequisites in the classic (no-intent) review', () => {
    render(<StepReview {...base} selectedFeatures={new Set(['captions'])} intents={new Set()} answers={{}} />);
    expect(screen.queryByTestId('review-flow')).toBeNull();
    expect(screen.queryByTestId('review-prerequisites')).toBeNull();
  });
});
