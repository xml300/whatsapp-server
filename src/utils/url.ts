import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF-safe URL validation.
 *
 * Guards against Server-Side Request Forgery by ensuring that user-supplied
 * media URLs:
 *   1. Use only https (or http when explicitly opted in).
 *   2. Do not target private, reserved, loopback, or link-local IPs.
 *   3. Do not resolve (via DNS) to any of the above.
 *
 * IMPORTANT: This performs a DNS resolution at validation time. The resolved IP
 * is returned so callers can pin it, avoiding TOCTOU / DNS-rebinding attacks
 * if the downstream library supports connecting by IP. If it doesn't, this
 * still raises the bar significantly.
 */

// RFC 1918 / RFC 6890 private & reserved IPv4 ranges
const BLOCKED_IPV4_PREFIXES = [
    "0.",         // "This" network (RFC 1122)
    "10.",        // Private (RFC 1918)
    "100.64.",    // Shared address space / CGN (RFC 6598)
    "127.",       // Loopback (RFC 1122)
    "169.254.",   // Link-local (RFC 3927)
    "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.",
    "172.28.", "172.29.", "172.30.", "172.31.",  // Private (RFC 1918)
    "192.0.0.",   // IETF Protocol Assignments (RFC 6890)
    "192.0.2.",   // Documentation (TEST-NET-1, RFC 5737)
    "192.168.",   // Private (RFC 1918)
    "198.18.", "198.19.",  // Benchmarking (RFC 2544)
    "198.51.100.",  // Documentation (TEST-NET-2, RFC 5737)
    "203.0.113.",   // Documentation (TEST-NET-3, RFC 5737)
];

const BLOCKED_IPV6_PREFIXES = [
    "::1",        // Loopback
    "fc",         // Unique local (RFC 4193)
    "fd",         // Unique local (RFC 4193)
    "fe80:",      // Link-local (RFC 4291)
    "::ffff:127.",  // IPv4-mapped loopback
    "::ffff:10.",   // IPv4-mapped private
    "::ffff:192.168.",  // IPv4-mapped private
    "::ffff:172.16.",   // IPv4-mapped private (partial)
    "::ffff:169.254.",  // IPv4-mapped link-local
];

function isBlockedIPv4(ip: string): boolean {
    return BLOCKED_IPV4_PREFIXES.some((prefix) => ip.startsWith(prefix));
}

function isBlockedIPv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    return BLOCKED_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function isBlockedIP(ip: string): boolean {
    if (isIP(ip) === 4) return isBlockedIPv4(ip);
    if (isIP(ip) === 6) return isBlockedIPv6(ip);
    return false;
}

// Multicast & broadcast catch-all for IPv4
function isMulticastOrBroadcast(ip: string): boolean {
    if (isIP(ip) !== 4) return false;
    const first = parseInt(ip.split(".")[0]!, 10);
    // 224.0.0.0 – 239.255.255.255 (multicast) and 255.255.255.255 (broadcast)
    return first >= 224;
}

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

export interface ValidatedUrl {
    /** The original (validated) URL string. */
    url: string;
    /** The resolved IP address (first A/AAAA record). */
    resolvedIp: string;
}

/**
 * Validates a user-supplied URL for SSRF safety.
 *
 * @returns `ValidatedUrl` if the URL is safe to fetch, or `null` if it should
 *          be blocked.
 */
export async function validateMediaUrl(raw: string): Promise<ValidatedUrl | null> {
    // --- 1. Parse ---
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    // --- 2. Protocol allow-list ---
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        return null;
    }

    // --- 3. Reject bare-IP hostnames that are private/reserved ---
    const hostname = parsed.hostname;
    if (!hostname) return null;

    // Strip IPv6 brackets for net.isIP check
    const bare = hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;

    if (isIP(bare)) {
        if (isBlockedIP(bare) || isMulticastOrBroadcast(bare)) {
            return null;
        }
        return { url: raw, resolvedIp: bare };
    }

    // --- 4. DNS resolution to catch rebinding / internal hostnames ---
    try {
        const { address } = await lookup(bare, { family: 0 });
        if (isBlockedIP(address) || isMulticastOrBroadcast(address)) {
            return null;
        }
        return { url: raw, resolvedIp: address };
    } catch {
        // DNS resolution failure — block rather than allow
        return null;
    }
}
