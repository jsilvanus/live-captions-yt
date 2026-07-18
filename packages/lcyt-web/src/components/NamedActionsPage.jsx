import { useProjectRequired } from '../hooks/useProjectRequired';
import { NamedActionsManager } from './NamedActionsManager.jsx';

/** NamedActionsPage — `/actions`, the standalone-page wrapper around `NamedActionsManager`. */
export function NamedActionsPage() {
  useProjectRequired();
  return <NamedActionsManager />;
}
