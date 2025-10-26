import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePersistentState } from './usePersistentState';

describe('usePersistentState', () => {
  it('returns default value when storage empty', () => {
    const { result } = renderHook(() => usePersistentState('test-key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() => usePersistentState('persist-key', 1));

    act(() => {
      result.current[1](value => value + 1);
    });

    expect(result.current[0]).toBe(2);
    expect(window.localStorage.getItem('persist-key')).toBe('2');
  });

  it('deserializes existing values', () => {
    window.localStorage.setItem('custom-key', '"stored"');
    const { result } = renderHook(() => usePersistentState('custom-key', 'default'));
    expect(result.current[0]).toBe('stored');
  });
});
