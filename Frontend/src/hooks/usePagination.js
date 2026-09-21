import { useCallback, useMemo, useState } from "react";

const clampInteger = (value, minimum, maximum = Number.MAX_SAFE_INTEGER) =>
  Math.min(maximum, Math.max(minimum, Math.floor(Number(value) || minimum)));

export default function usePagination({ initialPage = 1, initialLimit = 20, maxLimit = 100 } = {}) {
  const [page, setPageState] = useState(() => clampInteger(initialPage, 1));
  const [limit, setLimitState] = useState(() => clampInteger(initialLimit, 1, maxLimit));
  const [meta, setMetaState] = useState({ total: 0, pages: 1 });

  const setPage = useCallback((value) => setPageState((current) =>
    clampInteger(typeof value === "function" ? value(current) : value, 1)), []);
  const setLimit = useCallback((value) => {
    setLimitState(clampInteger(value, 1, maxLimit));
    setPageState(1);
  }, [maxLimit]);
  const setMeta = useCallback((value = {}) => setMetaState({
    total: Math.max(0, Number(value.total) || 0),
    pages: clampInteger(value.pages, 1),
  }), []);
  const reset = useCallback(() => {
    setPageState(1);
    setMetaState({ total: 0, pages: 1 });
  }, []);

  return useMemo(() => ({
    page,
    limit,
    total: meta.total,
    pages: meta.pages,
    query: { page, limit },
    hasPrevious: page > 1,
    hasNext: page < meta.pages,
    setPage,
    setLimit,
    setMeta,
    reset,
  }), [limit, meta.pages, meta.total, page, reset, setLimit, setMeta, setPage]);
}
