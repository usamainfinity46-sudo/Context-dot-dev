import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import { config, limits } from "./config.js";

export function publicAddress(address: string): boolean {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function validateTarget(
  input: string,
  allowLocal = config.allowLocal,
) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP and HTTPS targets are supported.");
  if (url.username || url.password)
    throw new Error("Credentials in URLs are not supported.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  // Cloud metadata is never allowed, even with the local-development opt-in.
  if (
    [
      "metadata.google.internal",
      "metadata.goog",
      "169.254.169.254",
      "100.100.100.200",
      "fd00:ec2::254",
    ].includes(hostname)
  )
    throw new Error("Cloud metadata targets are blocked.");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true });
  if (
    !addresses.length ||
    (!allowLocal && addresses.some((a) => !publicAddress(a.address)))
  )
    throw new Error(
      "Private, loopback, and non-public targets are blocked. Set ALLOW_LOCAL_TARGETS=true only for your own development apps.",
    );
  return { url, addresses };
}
export interface ResponseData {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
export async function safeFetch(
  input: string,
  opts: {
    signal?: AbortSignal;
    maxBytes?: number;
    redirects?: boolean;
    headers?: Record<string, string>;
    beforeRequest?: (url: string) => Promise<void>;
  } = {},
): Promise<ResponseData> {
  let current = input;
  for (let hop = 0; hop <= limits.redirects; hop++) {
    opts.signal?.throwIfAborted();
    const { url, addresses } = await validateTarget(current);
    await opts.beforeRequest?.(url.href);
    // Pin the validated DNS answers to this connection, preventing DNS rebinding.
    const dispatcher = new Agent({
      connect: {
        lookup: ((_host: unknown, options: any, cb: any) => {
          const candidates = options.family
            ? addresses.filter((a) => a.family === options.family)
            : addresses;
          if (!candidates.length)
            return cb(new Error("No address for requested family"));
          cb(
            null,
            options.all ? candidates : candidates[0].address,
            options.all ? undefined : candidates[0].family,
          );
        }) as any,
      },
    });
    const timeout = AbortSignal.timeout(limits.timeout);
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeout])
      : timeout;
    try {
      const response = await fetch(url, {
        dispatcher,
        redirect: "manual",
        signal,
        headers: {
          "user-agent": "ContextLocal/1.0 (personal extraction)",
          accept: "*/*",
          ...opts.headers,
        },
      });
      const headers = Object.fromEntries(response.headers.entries());
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        headers.location
      ) {
        const next = new URL(headers.location, url).href;
        await validateTarget(next);
        await response.body?.cancel();
        delete headers['content-encoding'];delete headers['content-length'];delete headers['transfer-encoding'];
        if (opts.redirects === false)
          return {
            url: url.href,
            status: response.status,
            headers: { ...headers, location: next },
            body: Buffer.alloc(0),
          };
        current = next;
        continue;
      }
      const max = opts.maxBytes ?? limits.html;
      if (Number(headers["content-length"]) > max) {
        await response.body?.cancel();
        throw new Error("Response exceeds the size limit.");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body)
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > max) throw new Error("Response exceeds the size limit.");
          chunks.push(chunk);
        }
      delete headers["content-encoding"];
      delete headers["content-length"];
      delete headers["transfer-encoding"];
      return {
        url: url.href,
        status: response.status,
        headers,
        body: Buffer.concat(chunks),
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("Redirect limit exceeded.");
}
export function requireHtml(r: ResponseData) {
  if (r.status < 200 || r.status >= 300)
    throw new Error(
      `HTTP ${r.status}${[401, 403, 429].includes(r.status) ? " · Access blocked. No automatic retries were made." : ""}`,
    );
  if (
    !/(text\/html|application\/xhtml\+xml)/i.test(
      r.headers["content-type"] || "",
    )
  )
    throw new Error(
      `Unsupported content type: ${r.headers["content-type"] || "unknown"}. Expected HTML.`,
    );
}
