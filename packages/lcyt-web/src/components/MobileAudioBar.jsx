/**
 * Mobile-only fixed bottom bar with mic controls, live preview, and file navigation.
 */
export function MobileAudioBar({
  fileStore,
  session,
  micListening,
  micHolding,
  micHoldToSpeak,
  mobileInterimText,
  mobileUtteranceEndEnabled,
  utteranceActive,
  utteranceTimerRunning,
  utteranceTimerSec,
  mobileBarMeterRef,
  audioPanelRef,
  inputBarRef,
}) {
  const file = fileStore.activeFile;
  const hasFile = !!file;
  const canGoPrev = hasFile && file.pointer > 0;
  const canGoNext = hasFile && file.pointer < file.lines.length - 1;
  const otherHasMic = session.micHolder !== null && session.micHolder !== session.clientId;

  return (
    <div id="mobile-audio-bar">
      {/* Live transcription preview bar — shown above mic controls when interim text exists */}
      {micListening && mobileInterimText && (
        <div className="mobile-interim-text">
          <span className="mobile-interim-text__content">{mobileInterimText}</span>
        </div>
      )}
      <div className="mobile-bar__meter-wrap">
        <canvas
          ref={mobileBarMeterRef}
          className="mobile-bar__meter"
          aria-hidden="true"
        />
        {micListening && mobileUtteranceEndEnabled && (
          <button
            className={[
              'audio-meter-end-btn',
              utteranceActive ? 'audio-meter-end-btn--active' : 'audio-meter-end-btn--idle',
            ].join(' ')}
            onClick={utteranceActive ? () => audioPanelRef.current?.utteranceEndClick() : undefined}
            title={utteranceActive ? 'Force end utterance' : 'Utterance detection active'}
          >🗣</button>
        )}
        {micListening && utteranceTimerRunning && (
          <div
            className="audio-meter-timer-border"
            style={{ animationDuration: `${utteranceTimerSec}s` }}
          />
        )}
      </div>
      {otherHasMic ? (
        <button
          className={`mobile-bar__mic-btn mobile-bar__mic-btn--locked${micHolding ? ' mobile-bar__mic-btn--holding' : ''}`}
          onPointerDown={(e) => audioPanelRef.current?.holdStart(e)}
          onPointerUp={() => audioPanelRef.current?.holdEnd()}
          onPointerLeave={() => audioPanelRef.current?.holdEnd()}
          onPointerCancel={() => audioPanelRef.current?.holdEnd()}
          title="Hold to steal the microphone"
        >{micHolding ? '🎙 Hold…' : '🔒 Locked'}</button>
      ) : micHoldToSpeak ? (
        <button
          className={`mobile-bar__mic-btn${micListening ? ' mobile-bar__mic-btn--active' : ''}`}
          onPointerDown={(e) => audioPanelRef.current?.holdSpeakStart(e)}
          onPointerUp={() => audioPanelRef.current?.holdSpeakEnd()}
          onPointerLeave={() => audioPanelRef.current?.holdSpeakEnd()}
          onPointerCancel={() => audioPanelRef.current?.holdSpeakEnd()}
          title="Hold to speak"
        >{micListening ? '⏹' : '🎙'}</button>
      ) : (
        <button
          className={`mobile-bar__mic-btn${micListening ? ' mobile-bar__mic-btn--active' : ''}`}
          onClick={() => audioPanelRef.current?.toggle()}
          title={micListening ? 'Stop microphone' : 'Start microphone'}
        >{micListening ? '⏹' : '🎙'}</button>
      )}
      <button
        className="mobile-bar__nav-btn"
        onClick={() => fileStore.setPointer(file.id, file.pointer - 1)}
        disabled={!canGoPrev}
        title="Previous line"
      >−</button>
      <button
        className="mobile-bar__send-btn"
        onClick={() => inputBarRef.current?.triggerSend()}
        disabled={!hasFile}
        title="Send current line"
      >►</button>
      <button
        className="mobile-bar__nav-btn"
        onClick={() => fileStore.advancePointer(file.id)}
        disabled={!canGoNext}
        title="Next line"
      >+</button>
    </div>
  );
}
