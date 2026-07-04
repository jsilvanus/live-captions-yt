export function BackendCard({
  selected = false,
  onClick = () => {},
  title,
  subtitle,
  description,
  children,
}) {
  return (
    <div
      className={`auth-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="auth-card__radio"></div>
      <div className="auth-card__content">
        <div className="auth-card__title">{title}</div>
        {subtitle && <div className="auth-card__url">{subtitle}</div>}
        {description && <div className="auth-card__desc">{description}</div>}
        {children}
      </div>
    </div>
  );
}
