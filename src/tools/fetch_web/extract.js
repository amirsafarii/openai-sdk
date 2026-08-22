"use strict";

import { load } from "cheerio";

/* -------------------------------------------------------
 * loadHtml
 * ----------------------------------------------------- */

export function loadHtml(html) {
  return load(html, { xml: false });
}

/* -------------------------------------------------------
 * Text extraction
 *
 * Strategy: work on an independent clone of the DOM so the
 * shared `$` (used by other extractors) is left untouched.
 * Remove script/style/comments/nav/header/footer/sidebar-ish
 * noise, prefer <main>/<article> as the content root when
 * present, then flatten the cleaned-up fragment to text while
 * turning block-level boundaries into newlines and <li> into
 * bullet points.
 * ----------------------------------------------------- */

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "object",
  "embed",
  "nav",
  "header",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[aria-hidden='true']",
  ".nav",
  ".navbar",
  ".menu",
  ".sidebar",
  ".breadcrumbs",
  ".cookie",
  ".cookie-banner",
  ".advertisement",
  ".ads",
  ".ad",
  ".social-share",
  ".comments",
  "#comments"
].join(", ");

export function extractText($) {
  const $clone = load($.html());
  $clone(NOISE_SELECTORS).remove();

  const candidates = [$clone("main").first(), $clone("article").first(), $clone("body").first()];
  const root = candidates.find(candidate => candidate.length > 0);
  let fragment = (root ? root.html() : $clone.html()) || "";

  fragment = fragment
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n\u2022 ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return fragment;
}

/* -------------------------------------------------------
 * Links
 * ----------------------------------------------------- */

export function extractLinks($, baseUrl, { sameOriginOnly = false, stripFragments = false } = {}) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const links = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const trimmed = href.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:")
    ) {
      return;
    }

    let absolute;
    try {
      absolute = new URL(trimmed, base);
    } catch {
      return;
    }

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;
    if (sameOriginOnly && absolute.origin !== base.origin) return;
    if (stripFragments) absolute.hash = "";

    const url = absolute.toString();
    if (seen.has(url)) return;
    seen.add(url);

    const text = $(el).text().replace(/\s+/g, " ").trim();
    links.push({ text, url });
  });

  return links;
}

/* -------------------------------------------------------
 * Images
 * ----------------------------------------------------- */

export function extractImages($, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const images = [];

  function toAbsolute(src) {
    if (!src) return null;
    try {
      return new URL(src.trim(), base).toString();
    } catch {
      return null;
    }
  }

  $("img").each((_, el) => {
    const src = toAbsolute($(el).attr("src"));
    const alt = $(el).attr("alt") || "";

    if (src && !seen.has(src)) {
      seen.add(src);
      images.push({ url: src, alt, type: "image" });
    }

    const srcset = $(el).attr("srcset");
    if (srcset) {
      for (const candidate of srcset.split(",")) {
        const url = toAbsolute(candidate.trim().split(/\s+/)[0]);
        if (url && !seen.has(url)) {
          seen.add(url);
          images.push({ url, alt, type: "image" });
        }
      }
    }
  });

  const ogImage = toAbsolute($('meta[property="og:image"]').attr("content"));
  if (ogImage && !seen.has(ogImage)) {
    seen.add(ogImage);
    images.push({ url: ogImage, alt: "", type: "og:image" });
  }

  const twitterImage = toAbsolute($('meta[name="twitter:image"]').attr("content"));
  if (twitterImage && !seen.has(twitterImage)) {
    seen.add(twitterImage);
    images.push({ url: twitterImage, alt: "", type: "twitter:image" });
  }

  const faviconHref =
    $('link[rel="icon"]').attr("href") ||
    $('link[rel="shortcut icon"]').attr("href") ||
    $('link[rel="apple-touch-icon"]').attr("href");
  const favicon = toAbsolute(faviconHref) || toAbsolute("/favicon.ico");
  if (favicon && !seen.has(favicon)) {
    seen.add(favicon);
    images.push({ url: favicon, alt: "", type: "favicon" });
  }

  return images;
}

/* -------------------------------------------------------
 * Metadata
 * ----------------------------------------------------- */

export function extractMetadata($, finalUrl) {
  const metaContent = selector => $(selector).first().attr("content") || undefined;

  const title = $("title").first().text().trim() || metaContent('meta[property="og:title"]');
  const description =
    metaContent('meta[name="description"]') || metaContent('meta[property="og:description"]');

  const canonicalHref = $('link[rel="canonical"]').first().attr("href");
  let canonical;
  try {
    canonical = canonicalHref ? new URL(canonicalHref, finalUrl).toString() : undefined;
  } catch {
    canonical = undefined;
  }

  const language = $("html").first().attr("lang") || metaContent('meta[property="og:locale"]');
  const author = metaContent('meta[name="author"]') || metaContent('meta[property="article:author"]');
  const publishedAt =
    metaContent('meta[property="article:published_time"]') || metaContent('meta[name="date"]');
  const modifiedAt = metaContent('meta[property="article:modified_time"]');

  const openGraph = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr("property")?.replace(/^og:/, "");
    const value = $(el).attr("content");
    if (prop && value && !(prop in openGraph)) openGraph[prop] = value;
  });

  const twitter = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr("name")?.replace(/^twitter:/, "");
    const value = $(el).attr("content");
    if (name && value && !(name in twitter)) twitter[name] = value;
  });

  const metadata = {
    title: title || undefined,
    description,
    canonical,
    language,
    author,
    publishedAt,
    modifiedAt
  };

  Object.keys(metadata).forEach(key => {
    if (metadata[key] === undefined) delete metadata[key];
  });

  if (Object.keys(openGraph).length) metadata.openGraph = openGraph;
  if (Object.keys(twitter).length) metadata.twitter = twitter;

  return metadata;
}

/* -------------------------------------------------------
 * Headings
 * ----------------------------------------------------- */

export function extractHeadings($) {
  const headings = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    headings.push({ level: Number(el.name.slice(1)), text });
  });
  return headings;
}

/* -------------------------------------------------------
 * Forms (structure only - never values)
 * ----------------------------------------------------- */

export function extractForms($, baseUrl) {
  const base = new URL(baseUrl);
  const forms = [];

  $("form").each((_, formEl) => {
    const $form = $(formEl);
    const rawAction = $form.attr("action") || "";

    let action;
    try {
      action = rawAction ? new URL(rawAction, base).toString() : base.toString();
    } catch {
      action = rawAction;
    }

    const method = ($form.attr("method") || "GET").toUpperCase();

    const inputs = [];
    $form.find("input, select, textarea").each((_, inputEl) => {
      const $input = $(inputEl);
      const name = $input.attr("name");
      if (!name) return;

      const tag = inputEl.name;
      const type = $input.attr("type") || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : "text");

      inputs.push({
        name,
        type,
        required: $input.is("[required]")
      });
    });

    forms.push({ action, method, inputs });
  });

  return forms;
}

/* -------------------------------------------------------
 * Scripts (external src only by default - never inline bodies)
 * ----------------------------------------------------- */

export function extractScripts($, baseUrl) {
  const base = new URL(baseUrl);
  const scripts = [];

  $("script").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      try {
        scripts.push({ src: new URL(src, base).toString(), inline: false });
      } catch {
        // skip unresolvable src
      }
    } else {
      scripts.push({ src: null, inline: true });
    }
  });

  return scripts;
}

/* -------------------------------------------------------
 * Stylesheets
 * ----------------------------------------------------- */

export function extractStylesheets($, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const stylesheets = [];

  $('link[rel="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const absolute = new URL(href, base).toString();
      if (!seen.has(absolute)) {
        seen.add(absolute);
        stylesheets.push(absolute);
      }
    } catch {
      // skip unresolvable href
    }
  });

  return stylesheets;
}

