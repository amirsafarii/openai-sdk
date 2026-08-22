/**
 * Maps normalized tool options to Jina Reader X-* headers.
 * Only sets a header when the value differs from Jina's own default.
 */

const ENGINE_HEADER = {
  default: null,
  direct: 'direct',
  browser: 'browser',
  experimental: 'experimental',
};

const RETURN_FORMAT_HEADER = {
  default: null,
  markdown: 'markdown',
  html: 'html',
  text: 'text',
  screenshot: 'screenshot',
  pageshot: 'pageshot',
};

const RESPOND_TIMING_HEADER = {
  default: null,
  html: 'html',
  'visible-content': 'visible-content',
  'mutation-idle': 'mutation-idle',
  'resource-idle': 'resource-idle',
  'media-idle': 'media-idle',
  'network-idle': 'network-idle',
};

const SUMMARY_HEADER = {
  none: null, // keep inline, no header
  dedup: 'true',
  all: 'all',
};

const GFM_HEADER = {
  enabled: null,
  disabled: 'true',
  no_table: 'table',
};

function buildHeaders(opts) {
  const headers = {};

  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  if (opts.engine && opts.engine !== 'default') {
    headers['X-Engine'] = ENGINE_HEADER[opts.engine];
  }

  if (opts.returnFormat && opts.returnFormat !== 'default') {
    headers['X-Return-Format'] = RETURN_FORMAT_HEADER[opts.returnFormat];
  }

  if (opts.jsonResponse) headers['Accept'] = 'application/json';
  if (opts.stream) headers['Accept'] = 'text/event-stream'; // stream wins if both set

  if (opts.timeoutSeconds != null) headers['X-Timeout'] = String(opts.timeoutSeconds);
  if (opts.tokenBudget != null) headers['X-Token-Budget'] = String(opts.tokenBudget);

  if (opts.targetSelector) headers['X-Target-Selector'] = opts.targetSelector;
  if (opts.waitForSelector) headers['X-Wait-For-Selector'] = opts.waitForSelector;
  if (opts.removeSelector) headers['X-Remove-Selector'] = opts.removeSelector;

  if (opts.stripImages) headers['X-Retain-Images'] = 'none';

  if (opts.linksSummary && opts.linksSummary !== 'none') {
    headers['X-With-Links-Summary'] = SUMMARY_HEADER[opts.linksSummary];
  }
  if (opts.imagesSummary && opts.imagesSummary !== 'none') {
    headers['X-With-Images-Summary'] = SUMMARY_HEADER[opts.imagesSummary];
  }

  if (opts.imageCaption) headers['X-With-Generated-Alt'] = 'true';
  if (opts.noCache) headers['X-No-Cache'] = 'true';
  if (opts.cacheToleranceSeconds != null) {
    headers['X-Cache-Tolerance'] = String(opts.cacheToleranceSeconds);
  }

  if (opts.respondTiming && opts.respondTiming !== 'default') {
    headers['X-Respond-Timing'] = RESPOND_TIMING_HEADER[opts.respondTiming];
  }

  if (opts.userAgent) headers['X-User-Agent'] = opts.userAgent;
  if (opts.referer) headers['X-Referer'] = opts.referer;
  if (opts.keepImgDataUrl) headers['X-Keep-Img-Data-Url'] = 'true';

  if (opts.gfm && opts.gfm !== 'enabled') {
    headers['X-No-Gfm'] = GFM_HEADER[opts.gfm];
  }

  if (opts.locale) headers['X-Locale'] = opts.locale;

  return headers;
}

export { buildHeaders };
