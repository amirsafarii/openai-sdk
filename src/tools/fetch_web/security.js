"use strict";

import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

/* -------------------------------------------------------
 * Hostnames that are always blocked outright, regardless of
 * what they resolve to.
 * ----------------------------------------------------- */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal", // GCP metadata service
  "metadata", // GCP metadata short-name
  "instance-data", // legacy AWS metadata short-name
  "instance-data.ec2.internal"
]);

/* -------------------------------------------------------
 * IPv4 private / reserved / special-purpose ranges
 * (RFC 1918, RFC 6598, RFC 3927, RFC 5737, RFC 6890, etc.)
 * ----------------------------------------------------- */

const IPV4_PRIVATE_RANGES = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT (RFC6598)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (includes 169.254.169.254 cloud metadata)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32] // broadcast
];

function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isIPv4InRange(ip, rangeIp, prefix) {
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(rangeIp);
  if (ipInt === null || rangeInt === null) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isPrivateIPv4(ip) {
  return IPV4_PRIVATE_RANGES.some(([rangeIp, prefix]) => isIPv4InRange(ip, rangeIp, prefix));
}

/* -------------------------------------------------------
 * IPv6 private / reserved ranges. Not an exhaustive mapping
 * of the IANA special-purpose registry, but covers the
 * ranges that matter for SSRF: loopback, link-local, unique
 * local (RFC4193), documentation, and IPv4-mapped addresses
 * that embed a private IPv4 address.
 * ----------------------------------------------------- */

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();

  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local, fe80::/10
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA, fc00::/7
  if (normalized.startsWith("2001:db8:")) return true; // documentation

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);

  return false;
}

export function isPrivateOrReservedIP(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not a syntactically valid IP -> treat as unsafe
}

/* -------------------------------------------------------
 * validateUrlSafety
 *
 * Validates protocol, hostname, and (via DNS resolution)
 * the actual IP address a hostname points to. Must be called
 * for the initial URL AND for every redirect target - never
 * assume a redirect destination is safe just because the
 * origin request was.
 * ----------------------------------------------------- */

export async function validateUrlSafety(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Malformed URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "UNSAFE_URL",
      message: `Protocol "${parsed.protocol}" is not allowed - only http/https`
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!hostname) {
    return { ok: false, code: "INVALID_URL", message: "URL has no hostname" };
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localdomain")
  ) {
    return { ok: false, code: "UNSAFE_URL", message: `Hostname "${hostname}" is blocked` };
  }

  // Hostname is already a literal IP address.
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isPrivateOrReservedIP(hostname)) {
      return {
        ok: false,
        code: "UNSAFE_URL",
        message: `IP address ${hostname} is private or reserved`
      };
    }
    return { ok: true, hostname, ip: hostname, family: literalFamily };
  }

  // Resolve the hostname and validate every address it points to. We
  // reject if ANY resolved address is private, not just the first one,
  // since some SSRF payloads rely on the app only checking one of several
  // answers in a DNS response.
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, code: "DNS_ERROR", message: `Could not resolve hostname "${hostname}"` };
  }

  if (!addresses || addresses.length === 0) {
    return { ok: false, code: "DNS_ERROR", message: `No addresses resolved for "${hostname}"` };
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIP(addr.address)) {
      return {
        ok: false,
        code: "UNSAFE_URL",
        message: `Hostname "${hostname}" resolves to a private/reserved address`
      };
    }
  }

  const chosen = addresses[0];
  return { ok: true, hostname, ip: chosen.address, family: chosen.family };
}

/* -------------------------------------------------------
 * createPinnedAgent
 *
 * Returns an undici Agent whose socket connections are
 * hard-pinned to a single, already-validated IP address,
 * bypassing Node's normal DNS resolution for the actual
 * connection.
 *
 * Why this matters: validateUrlSafety() and the real TCP
 * connect are otherwise two separate DNS lookups. A
 * DNS-rebinding attacker can return a safe public IP for the
 * first lookup (passing validation) and a private IP for the
 * second lookup (the real connection), completely bypassing
 * the check above. Pinning the exact validated IP for the
 * connection closes that window.
 * ----------------------------------------------------- */

export function createPinnedAgent(ip, family) {
  return new Agent({
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, ip, family);
      }
    }
  });
}
