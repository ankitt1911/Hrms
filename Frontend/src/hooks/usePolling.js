import { useEffect, useRef } from "react";

export default function usePolling(callback, { intervalMs = 15000, enabled = true, immediate = true, onError } = {}) {
  const callbackRef = useRef(callback);
  const errorRef = useRef(onError);
  useEffect(() => { callbackRef.current = callback; }, [callback]);
  useEffect(() => { errorRef.current = onError; }, [onError]);
  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    let cancelled = false;
    const tick = async () => {
      try {
        if (!cancelled && document.visibilityState !== "hidden") await callbackRef.current();
      } catch (error) {
        errorRef.current?.(error);
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, intervalMs);
      }
    };
    if (immediate) tick(); else timer = window.setTimeout(tick, intervalMs);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled, immediate, intervalMs]);
}
