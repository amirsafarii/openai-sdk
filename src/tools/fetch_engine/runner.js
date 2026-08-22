import { buildHeaders } from './headers.js';
import { fetchWithPolicy } from './retryFetch.js';

const READER_BASE = 'https://r.jina.ai/';

/** Fetch a single URL through Jina Reader, applying headers + retry/timeout policy. */
async function runOne(target, opts, policy) {
  const headers = buildHeaders(opts);
  const needsPost = opts.viewport || (opts.injectPageScript && opts.injectPageScript.length);

  let url;
  let fetchOptions;

  if (needsPost) {
    url = READER_BASE;
    headers['Content-Type'] = 'application/json';
    const body = { url: target };
    if (opts.viewport) body.viewport = opts.viewport;
    if (opts.injectPageScript && opts.injectPageScript.length) {
      body.injectPageScript = opts.injectPageScript;
    }
    fetchOptions = { method: 'POST', headers, body: JSON.stringify(body) };
  } else {
    url = READER_BASE + encodeURIComponent(target);
    fetchOptions = { method: 'GET', headers };
  }

  const startedAt = Date.now();

  try {
    const response = await fetchWithPolicy(url, fetchOptions, policy);
    const elapsedMs = Date.now() - startedAt;
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();

    let content = raw;
    let parsed = null;
    if (opts.jsonResponse && contentType.includes('application/json')) {
      try {
        parsed = JSON.parse(raw);
      } catch (_e) {
        // fall through, keep raw text
      }
    }

    return {
      target,
      ok: response.ok,
      status: response.status,
      elapsedMs,
      content: parsed ? undefined : content,
      data: parsed || undefined,
      error: response.ok ? undefined : `HTTP ${response.status}: ${raw.slice(0, 500)}`,
    };
  } catch (err) {
    return {
      target,
      ok: false,
      status: null,
      elapsedMs: Date.now() - startedAt,
      content: undefined,
      data: undefined,
      error: err.name === 'AbortError' ? 'Request timed out' : String(err.message || err),
    };
  }
}

/** Run runOne() over multiple targets with a concurrency cap (simple worker pool). */
async function runAll(targets, opts, policy, concurrency) {
  const results = new Array(targets.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await runOne(targets[i], opts, policy);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, targets.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export { runOne, runAll, READER_BASE };
