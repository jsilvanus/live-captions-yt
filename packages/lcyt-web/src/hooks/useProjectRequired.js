import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { hasProjectSessionConfig } from '../lib/projectSession.js';

/**
 * Hook for project-scoped pages — redirects to /projects if no project is active.
 * Usage: add at the top of a page component that requires a project context.
 */
export function useProjectRequired() {
  const [, setLocation] = useLocation();
  const { getPersistedConfig } = useSessionContext();
  const persistedCfg = getPersistedConfig();
  const hasProject = hasProjectSessionConfig(persistedCfg);

  useEffect(() => {
    if (!hasProject) {
      setLocation('/projects');
    }
  }, [hasProject, setLocation]);

  return hasProject;
}
