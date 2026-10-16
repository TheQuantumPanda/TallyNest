import { act, renderHook, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { useGroupResource, useGroupPage } from '../hooks/useGroupData';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
it('invalidates late group responses and cancels obsolete requests', async () => {
  const old = deferred(),
    latest = deferred();
  const a = vi.fn(() => old.promise),
    b = vi.fn(() => latest.promise);
  const { result, rerender } = renderHook(({ key, load }) => useGroupResource(key, load), {
    initialProps: { key: 'a', load: a },
  });
  rerender({ key: 'b', load: b });
  await act(async () => latest.resolve({ group: 'b' }));
  await act(async () => old.resolve({ group: 'a' }));
  expect(result.current.data).toEqual({ group: 'b' });
  expect(a.mock.calls[0][0].aborted).toBe(true);
});
it('resets cursor state on group switches and prevents stale load-more rows', async () => {
  const more = deferred();
  const a = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'a' }],
        pagination: { hasMore: true, nextAfter: 'next' },
      })
      .mockReturnValueOnce(more.promise),
    b = vi
      .fn()
      .mockResolvedValue({ rows: [{ id: 'b' }], pagination: { hasMore: false, nextAfter: null } });
  const { result, rerender } = renderHook(({ key, load }) => useGroupPage(key, load), {
    initialProps: { key: 'a', load: a },
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  let pending;
  act(() => {
    pending = result.current.loadMore();
  });
  rerender({ key: 'b', load: b });
  await waitFor(() => expect(result.current.rows).toEqual([{ id: 'b' }]));
  await act(async () => {
    more.resolve({ rows: [{ id: 'foreign' }], pagination: { hasMore: false, nextAfter: null } });
    await pending;
  });
  expect(result.current.rows).toEqual([{ id: 'b' }]);
  expect(a.mock.calls[1][1].aborted).toBe(true);
});
it('deduplicates page rows and permits only one active next-page request', async () => {
  const more = deferred(),
    load = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'a' }],
        pagination: { hasMore: true, nextAfter: 'next' },
      })
      .mockReturnValueOnce(more.promise);
  const { result } = renderHook(() => useGroupPage('group', load));
  await waitFor(() => expect(result.current.loading).toBe(false));
  let first;
  act(() => {
    first = result.current.loadMore();
    void result.current.loadMore();
  });
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => {
    more.resolve({
      rows: [{ id: 'a' }, { id: 'b' }],
      pagination: { hasMore: false, nextAfter: null },
    });
    await first;
  });
  expect(result.current.rows).toEqual([{ id: 'a' }, { id: 'b' }]);
});
it('retains a same-group draft backdrop on refresh failure but marks authoritative data unavailable', async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce({ id: 'group' })
    .mockRejectedValueOnce(new Error('network'));
  const { result } = renderHook(() => useGroupResource('group', load));
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.data).toEqual({ id: 'group' });
  expect(result.current.loading).toBe(false);
});
it('invalidates a paginated request on unmount', async () => {
  const more = deferred(),
    load = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], pagination: { hasMore: true, nextAfter: 'next' } })
      .mockReturnValueOnce(more.promise);
  const { result, unmount } = renderHook(() => useGroupPage('group', load));
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => {
    void result.current.loadMore();
  });
  unmount();
  expect(load.mock.calls[1][1].aborted).toBe(true);
  await act(async () =>
    more.resolve({ rows: [{ id: 'a' }], pagination: { hasMore: false, nextAfter: null } }),
  );
});
