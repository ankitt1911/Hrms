import { useCallback, useRef } from "react";

const createKey = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((value, index) => `${[4, 6, 8, 10].includes(index) ? "-" : ""}${value.toString(16).padStart(2, "0")}`).join("");
};

export default function useIdempotencyKey() {
  const keys = useRef(new Map());
  const getKey = useCallback((attempt) => {
    if (!keys.current.has(attempt)) keys.current.set(attempt, createKey());
    return keys.current.get(attempt);
  }, []);
  const finish = useCallback((attempt) => keys.current.delete(attempt), []);
  return { getKey, finish, resetKey: finish };
}
