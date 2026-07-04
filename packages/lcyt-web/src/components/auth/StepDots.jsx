export function StepDots({ step = 1, total = 2 }) {
  return (
    <div className="auth-step-dots">
      {Array.from({ length: total }).map((_, i) => {
        const stepNum = i + 1;
        let className = 'auth-step-dot';
        if (stepNum === step) className += ' active';
        if (stepNum < step) className += ' done';
        return <div key={i} className={className}></div>;
      })}
      {Array.from({ length: total - 1 }).map((_, i) => (
        <div key={`divider-${i}`} className="auth-step-divider"></div>
      ))}
    </div>
  );
}
