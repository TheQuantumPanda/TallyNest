import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AuthContext } from '../context/AuthContext';
import { useCreationIntent } from '../hooks/useCreationIntent';
const wrapper = (user) =>
  function Provider({ children }) {
    return <AuthContext.Provider value={{ user: { id: user } }}>{children}</AuthContext.Provider>;
  };
it('keeps the same frozen payload/key after timeout and subsequent session expiration', async () => {
  const wrap = wrapper(crypto.randomUUID());
  let hook = renderHook(() => useCreationIntent('transaction'), { wrapper: wrap });
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('timeout'))
    .mockRejectedValueOnce({ response: { status: 401 } })
    .mockResolvedValue({ replayed: true });
  const payload = { amountMinor: 1, title: 'Original' },
    draft = { amount: '0.01' };
  await act(async () => {
    await expect(hook.result.current.create(payload, draft, submit)).rejects.toThrow();
  });
  payload.title = 'Mutated outside form';
  const key = submit.mock.calls[0][1];
  hook.unmount();
  hook = renderHook(() => useCreationIntent('transaction'), { wrapper: wrap });
  expect(hook.result.current.intent.data.title).toBe('Original');
  await act(async () => {
    await expect(
      hook.result.current.create({ title: 'Changed' }, {}, submit),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });
  expect(hook.result.current.intent.key).toBe(key);
  await act(async () => {
    await hook.result.current.create({}, {}, submit);
  });
  expect(submit.mock.calls[2]).toEqual(submit.mock.calls[0]);
  expect(hook.result.current.intent).toBeNull();
});
it('isolates owners and resource types and releases a definitely rejected initial request', async () => {
  const owner = crypto.randomUUID(),
    wrap = wrapper(owner);
  const transaction = renderHook(() => useCreationIntent('transaction'), { wrapper: wrap });
  const reject = vi.fn().mockRejectedValue(new Error('unknown'));
  await act(async () => {
    await expect(
      transaction.result.current.create({ title: 'private' }, {}, reject),
    ).rejects.toThrow();
  });
  const schedule = renderHook(() => useCreationIntent('recurring'), { wrapper: wrap });
  const other = renderHook(() => useCreationIntent('transaction'), {
    wrapper: wrapper(crypto.randomUUID()),
  });
  expect(schedule.result.current.intent).toBeNull();
  expect(other.result.current.intent).toBeNull();
  await act(async () => {
    await expect(
      schedule.result.current.create(
        {},
        {},
        vi.fn().mockRejectedValue({ response: { status: 400 } }),
      ),
    ).rejects.toBeDefined();
  });
  expect(schedule.result.current.intent).toBeNull();
});
it('retains a key for an unchanged definitely rejected submission and changes it only with a new payload', async () => {
  const hook = renderHook(() => useCreationIntent('transaction'), {
    wrapper: wrapper(crypto.randomUUID()),
  });
  const reject = vi.fn().mockRejectedValue({ response: { status: 429 } });
  for (let i = 0; i < 2; i++)
    await act(async () => {
      await expect(
        hook.result.current.create({ amountMinor: 1 }, {}, reject),
      ).rejects.toBeDefined();
    });
  expect(reject.mock.calls[0][1]).toBe(reject.mock.calls[1][1]);
  expect(hook.result.current.intent).toBeNull();
  await act(async () => {
    await expect(hook.result.current.create({ amountMinor: 2 }, {}, reject)).rejects.toBeDefined();
  });
  expect(reject.mock.calls[2][1]).not.toBe(reject.mock.calls[0][1]);
});
