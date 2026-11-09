// Local simulator state is isolated per pool, like a separate provider instance.
const instances = new WeakMap();
function state(pool) {
  if (!instances.has(pool)) instances.set(pool, { outcomes: [], calls: [] });
  return instances.get(pool);
}
export function configureMock(pool, outcomes) {
  state(pool).outcomes = [...outcomes];
}
export function resetMock(pool) {
  instances.delete(pool);
}
export function mockCalls(pool) {
  return structuredClone(state(pool).calls);
}
export function deliverMock(pool, payload) {
  const provider = state(pool);
  provider.calls.push(structuredClone(payload));
  const outcome = provider.outcomes.shift() ?? 202;
  if (outcome !== 202) {
    const error = new Error(
      outcome === "timeout"
        ? "Mock transport timeout"
        : "Mock send returned " + outcome,
    );
    error.retryable = outcome === "timeout" || outcome >= 500;
    error.code = outcome === "timeout" ? "ETIMEDOUT" : "HTTP_" + outcome;
    throw error;
  }
  return { external_id: `mock_${payload.correlation_id}` };
}
