export async function callFirst(namespace, names, ...args) {
  const handler = names.map((name) => namespace[name]).find((fn) => typeof fn === "function");
  if (!handler) throw new Error(`API handler is not available: ${names.join(" / ")}`);
  return handler(...args);
}

export function unwrapCollection(payload) {
  const data = payload?.data ?? payload?.raw ?? payload;
  if (Array.isArray(data)) return { items: data, page: 1, pages: 1, total: data.length };
  return {
    items: data?.items ?? data?.records ?? data?.results ?? [],
    page: data?.page ?? 1,
    pages: data?.pages ?? 1,
    total: data?.total ?? data?.items?.length ?? 0,
  };
}

export function transitionResult(result) {
  if (result?.ok === false) throw Object.assign(new Error(result.message || "The action could not be completed."), { code: result.code });
  return result?.data ?? result;
}
