/**
 * Raw JSON Schema for the tool's parameters — NOT a zod schema.
 *
 * Why: @openai/agents accepts either a zod schema or a plain JSON Schema
 * object for `parameters` ("If a JSON schema is provided, the arguments to
 * the tool will be passed as is"). The automatic zod -> JSON Schema
 * conversion does not reliably produce OpenAI's required strict-mode shape
 * (every property in "required", nullable fields as
 * `anyOf: [{...}, {type:"null"}]` rather than `nullable: true`), which was
 * causing the model to omit fields and the SDK to reject the call with
 * "InvalidToolInputError: Invalid JSON input for tool". Jina's own official
 * API (api.jina.ai/openapi.json) uses exactly this anyOf-null pattern for
 * every optional field, confirming it's the correct/expected shape.
 *
 * Writing the schema by hand removes the conversion step entirely: this
 * object IS the wire schema, byte for byte. Every property is listed in
 * "required" (OpenAI strict-mode rule: all fields required, optionality is
 * expressed via a null variant, never via omission). jinaReaderTool.js
 * treats a `null` value as "not set" and applies real defaults with `??`.
 */

function nullableString(description) {
  return { anyOf: [{ type: 'string' }, { type: 'null' }], description };
}

function nullableNumber(description) {
  return { anyOf: [{ type: 'integer' }, { type: 'null' }], description };
}

function nullableBoolean(description) {
  return { anyOf: [{ type: 'boolean' }, { type: 'null' }], description };
}

function nullableEnum(values, description) {
  return { anyOf: [{ type: 'string', enum: values }, { type: 'null' }], description };
}

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    targets: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description:
        'One or more URLs to fetch and read. Pass a single-item array for one URL, ' +
        'or multiple items to fetch several pages in parallel.',
    },

    // --- content shaping ---
    engine: nullableEnum(
      ['default', 'direct', 'browser', 'experimental'],
      'direct = fastest, no JS rendering. browser = best quality/rendering. experimental = fast, JS-heavy sites, unstable. null = "default".'
    ),
    return_format: nullableEnum(
      ['default', 'markdown', 'html', 'text', 'screenshot', 'pageshot'],
      'null = "default".'
    ),
    json_response: nullableBoolean('Request structured JSON (url, title, content, timestamp) instead of raw text. null = false.'),
    target_selector: nullableString('CSS selector(s) to extract only, e.g. "article, .main-content". null = not set.'),
    wait_for_selector: nullableString('CSS selector(s) to wait for before extracting (dynamic content). null = not set.'),
    remove_selector: nullableString('CSS selector(s) to strip before extraction, e.g. "nav, footer, .ads". null = not set.'),
    strip_images: nullableBoolean('Remove all images from output to save tokens. null = false.'),
    links_summary: nullableEnum(['none', 'dedup', 'all'], 'Append a links section: none (inline only), dedup (unique), all. null = "none".'),
    images_summary: nullableEnum(['none', 'dedup', 'all'], 'null = "none".'),
    image_caption: nullableBoolean('Auto-caption images without alt text. null = false.'),
    keep_img_data_url: nullableBoolean('Keep inline base64 images instead of converting to URLs. null = false.'),
    gfm: nullableEnum(['enabled', 'disabled', 'no_table'], 'GitHub-flavored markdown; no_table keeps table HTML but drops GFM table syntax. null = "enabled".'),

    // --- page loading behavior ---
    timeout_seconds: nullableNumber('Max time to wait for the PAGE to load (Jina-side, X-Timeout). null = not set.'),
    respond_timing: nullableEnum(
      ['default', 'html', 'visible-content', 'mutation-idle', 'resource-idle', 'media-idle', 'network-idle'],
      'When to consider the page "loaded". Later = slower but more complete for dynamic pages. null = "default".'
    ),
    token_budget: nullableNumber('null = not set.'),
    no_cache: nullableBoolean("Bypass Jina's content cache, force a fresh fetch. null = false."),
    cache_tolerance_seconds: nullableNumber('Accept cache younger than N seconds. null = not set.'),
    user_agent: nullableString('null = not set.'),
    referer: nullableString('null = not set.'),
    locale: nullableString('Browser locale, e.g. "en-US". null = not set.'),
    stream: nullableBoolean('Use SSE stream mode for slow/large pages. null = false.'),

    // --- advanced, forces POST ---
    viewport: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            width: { type: 'integer' },
            height: { type: 'integer' },
          },
          required: ['width', 'height'],
        },
        { type: 'null' },
      ],
      description: 'Browser viewport size. null = not set.',
    },
    inject_page_script: {
      anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
      description: 'Inline JS snippets (or script URLs) run in-page before extraction. null = not set.',
    },

    // --- execution policy (agent-defined) ---
    concurrency: nullableNumber('Max number of targets fetched in parallel when "targets" has more than one item (1-10). null = 3.'),
    request_timeout_ms: nullableNumber('Client-side network timeout per HTTP attempt, in ms (separate from timeout_seconds). null = 30000.'),
    max_retries: nullableNumber('Retries per target on network errors, 429, or 5xx (0-5). null = 2.'),
    retry_base_delay_ms: nullableNumber('Base delay for exponential backoff between retries. null = 500.'),
    retry_max_delay_ms: nullableNumber('Cap on backoff delay between retries. null = 8000.'),
  },
  required: [
    'targets',
    'engine',
    'return_format',
    'json_response',
    'target_selector',
    'wait_for_selector',
    'remove_selector',
    'strip_images',
    'links_summary',
    'images_summary',
    'image_caption',
    'keep_img_data_url',
    'gfm',
    'timeout_seconds',
    'respond_timing',
    'token_budget',
    'no_cache',
    'cache_tolerance_seconds',
    'user_agent',
    'referer',
    'locale',
    'stream',
    'viewport',
    'inject_page_script',
    'concurrency',
    'request_timeout_ms',
    'max_retries',
    'retry_base_delay_ms',
    'retry_max_delay_ms',
  ],
};

export { parameters };
