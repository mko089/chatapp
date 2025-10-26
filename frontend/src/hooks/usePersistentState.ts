import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Options<T> = {
  deserialize?: (value: string) => T | null;
  serialize?: (value: T) => string;
};

const isBrowser = typeof window !== 'undefined';

export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  options: Options<T> = {},
): [T, (value: T | ((prev: T) => T)) => void] {
  const { deserialize, serialize } = options;
  const readValue = useCallback((): T => {
    if (!isBrowser) {
      return defaultValue;
    }
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) {
        return defaultValue;
      }
      if (deserialize) {
        const value = deserialize(stored);
        return value === null ? defaultValue : value;
      }
      return JSON.parse(stored) as T;
    } catch (error) {
      return defaultValue;
    }
  }, [key, defaultValue, deserialize]);

  const [state, setState] = useState<T>(() => readValue());
  const isFirstRender = useRef(true);

  const serializedState = useMemo(() => {
    if (serialize) {
      return serialize(state);
    }
    return JSON.stringify(state);
  }, [state, serialize]);

  useEffect(() => {
    if (!isBrowser) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      window.localStorage.setItem(key, serializedState);
    } catch (error) {
      // ignore write failures
    }
  }, [key, serializedState]);

  const updateState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => (typeof value === 'function' ? (value as (prev: T) => T)(prev) : value));
    },
    [],
  );

  return [state, updateState];
}
