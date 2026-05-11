import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cfbdRequest } from "../services/cfbdApi";

function stableStringify(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value);
  }
}

export function useCfbdEndpoint(path, params = {}, options = {}) {
  const { enabled = true, initialData = null } = options || {};

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);

  const paramsKey = useMemo(() => stableStringify(params), [params]);

  const run = useCallback(async () => {
    if (!enabled) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await cfbdRequest(path, params, { signal: controller.signal });
      setData(result);
      return result;
    } catch (e) {
      if (e?.name === "AbortError") return;
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [enabled, path, paramsKey]); // paramsKey is the stable dependency

  useEffect(() => {
    run();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [run]);

  return { data, loading, error, refetch: run };
}

export function useCfbdGames(params = {}, options = {}) {
  return useCfbdEndpoint("/games", params, options);
}

export function useCfbdTeams(year = 2026, options = {}) {
  return useCfbdEndpoint("/teams/fbs", { year }, options);
}

