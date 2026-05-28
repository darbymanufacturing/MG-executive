/* global process */
/**
 * Hopp MCP HTTP client — calls tools on the deployed hopp-mcp server
 * (https://hopp-mcp.vercel.app/api/mcp) using JSON-RPC over Streamable HTTP.
 *
 * The hopp-mcp server is stateless (sessionIdGenerator: undefined) so each
 * call is a single POST + single response. The server may respond with
 * Content-Type: application/json (single message) OR text/event-stream
 * (SSE stream of one or more messages). We handle both.
 *
 * Required env vars (set in Vercel dashboard, Production + Preview):
 *   HOPP_MCP_URL       — typically https://hopp-mcp.vercel.app/api/mcp
 *   MCP_BEARER_TOKEN   — shared secret with the hopp-mcp project's env
 *
 * Available tools (per hopp-mcp/AGENT_REFERENCE.md):
 *   list_trips         — finished customer trips (revenue, distance, duration)
 *   list_status_events — vehicle state-change events (rent/return/fault/etc.)
 *   list_repair_events — maintenance tickets (issues + repairs)
 *
 * All three take { scooterId?, since: ISO8601, until: ISO8601 }.
 *
 * Used by: api/cron-hopp-sync.js
 */

let _reqId = 0;

/**
 * Call a tool on the Hopp MCP server.
 *
 *   const { rows } = await callHoppTool('list_trips', { scooterId: '54135', since, until });
 *
 * Returns the tool's parsed JSON output (the contents of result.content[0].text).
 * Throws if the server returns an error, the response is malformed, or the env vars are missing.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} [options]
 * @param {number} [options.timeoutMs=45000] — per-call timeout. Vercel maxDuration is 60s; leave headroom.
 * @returns {Promise<any>} — the parsed tool result
 */
export async function callHoppTool(toolName, args, options = {}) {
  const url = process.env.HOPP_MCP_URL;
  const token = process.env.MCP_BEARER_TOKEN;
  if (!url) throw new Error('HOPP_MCP_URL env var is not set');
  if (!token) throw new Error('MCP_BEARER_TOKEN env var is not set');

  const { timeoutMs = 45000 } = options;
  const id = ++_reqId;

  const envelope = {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Hopp MCP returned ${res.status} ${res.statusText} for ${toolName}: ${body.slice(0, 400)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  let rpc;
  if (contentType.includes('text/event-stream')) {
    rpc = await parseSseResponse(res, id);
  } else {
    rpc = await res.json();
  }

  if (rpc.error) {
    throw new Error(`Hopp MCP ${toolName} error ${rpc.error.code}: ${rpc.error.message}`);
  }
  if (!rpc.result || !Array.isArray(rpc.result.content) || rpc.result.content.length === 0) {
    throw new Error(`Hopp MCP ${toolName} returned no content`);
  }
  const text = rpc.result.content[0].text;
  if (typeof text !== 'string') {
    throw new Error(`Hopp MCP ${toolName} returned non-text content`);
  }

  // Tools return JSON-stringified payloads in content[0].text
  try {
    return JSON.parse(text);
  } catch {
    // A few tools may return plain strings — return as-is
    return text;
  }
}

/**
 * Parse a Streamable-HTTP / SSE response. Each event is a "data: <json>\n\n"
 * chunk; we walk them and return the JSON-RPC message with matching `id`
 * (or the first message with `result`/`error` if id matching fails).
 */
async function parseSseResponse(res, expectedId) {
  const body = await res.text();
  const events = body
    .split(/\n\n+/)
    .map((chunk) => {
      const dataLines = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) return null;
      try {
        return JSON.parse(dataLines.join('\n'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (events.length === 0) {
    throw new Error('Hopp MCP returned an empty SSE stream');
  }

  const matched = events.find((e) => e.id === expectedId && (e.result || e.error));
  if (matched) return matched;

  const anyResult = events.find((e) => e.result || e.error);
  if (anyResult) return anyResult;

  throw new Error('Hopp MCP SSE stream had no result/error message');
}
