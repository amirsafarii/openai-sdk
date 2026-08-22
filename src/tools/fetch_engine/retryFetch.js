/**
 * fetch() wrapped with a client-side timeout (AbortController) and a
 * retry/backoff policy. Retries network errors, aborts, 429, and 5xx.
 * Does not retry other 4xx responses (bad request, not transient).
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err, response) {
  if (response) {
    if (response.status === 429) return true;
    if (response.status >= 500) return true;
    return false;
  }
  // no response => network error / abort
  return true;
}

async function fetchWithPolicy(url, fetchOptions, policy) {
  const { maxRetries, baseDelayMs, maxDelayMs, requestTimeoutMs } = policy;

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok && isRetryable(null, response) && attempt < maxRetries) {
        lastError = new Error(`HTTP ${response.status}`);
        attempt += 1;
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        const jitter = Math.random() * delay * 0.2;
        await sleep(delay + jitter);
        continue;
      }

      return response; // ok, or non-retryable error status (caller handles)
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const retryable = isRetryable(err, null);
      if (!retryable || attempt >= maxRetries) {
        throw err;
      }
      attempt += 1;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.random() * delay * 0.2;
      await sleep(delay + jitter);
    }
  }

  throw lastError || new Error('fetchWithPolicy: exhausted retries');
}

export { fetchWithPolicy, isRetryable, sleep };
