import { useCallback, useRef, useState } from 'react';

/**
 * useDskMetacodeSources — lazily fetches the two name lists the
 * `graphics`/`graphics[viewport]` metacode autocomplete (plan_ui.md v2 §5d,
 * `lib/metacodeAutocomplete.js`) needs: uploaded image shorthand names
 * (`GET /images`, same route `DskEditorPage.jsx`'s Media Library uses) and
 * project viewport names (`GET /dsk/:apikey/viewports`, same route
 * `DskViewportsPage.jsx` uses). Cached per apiKey in a ref — `ensureLoaded()`
 * is a no-op after the first successful fetch for the current key, so typing
 * `<!--` repeatedly doesn't refetch on every keystroke.
 */
export function useDskMetacodeSources({ session }) {
  const [shorthands, setShorthands] = useState([]);
  const [viewports, setViewports] = useState([]);
  const loadedForKeyRef = useRef(null);
  const loadingRef = useRef(false);

  const ensureLoaded = useCallback(async () => {
    const apiKey = session?.apiKey;
    const backendUrl = session?.backendUrl;
    if (!apiKey || !backendUrl) return;
    if (loadedForKeyRef.current === apiKey || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [imagesResult, viewportsResult] = await Promise.allSettled([
        session.listImages?.() ?? Promise.resolve({ images: [] }),
        fetch(`${backendUrl}/dsk/${encodeURIComponent(apiKey)}/viewports`, {
          headers: { 'X-API-Key': apiKey },
        }).then(r => (r.ok ? r.json() : { viewports: [] })),
      ]);

      const images = imagesResult.status === 'fulfilled' ? (imagesResult.value?.images ?? []) : [];
      setShorthands(images.map(img => img.shorthand).filter(Boolean));

      const vps = viewportsResult.status === 'fulfilled' ? (viewportsResult.value?.viewports ?? []) : [];
      setViewports(vps.map(v => (typeof v === 'string' ? v : v.name)).filter(Boolean));

      loadedForKeyRef.current = apiKey;
    } finally {
      loadingRef.current = false;
    }
  }, [session]);

  return { shorthands, viewports, ensureLoaded };
}
