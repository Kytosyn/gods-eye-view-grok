// @ts-nocheck
/**
 * Run collected Connect-style GEV proxy handlers against a Fetch Request.
 * Used by Nitro production middleware so /api/* works after deploy.
 */
import http from "node:http";
import { Socket } from "node:net";
import { collectGevMiddlewares } from "./vite.config.js";

/** @type {Array<{ path: string, handler: Function }> | null} */
let cachedStack = null;

function stack() {
  if (!cachedStack) cachedStack = collectGevMiddlewares({ includeKeySetup: false });
  return cachedStack;
}

function matchHandler(pathname) {
  let best = null;
  let bestLen = -1;
  for (const entry of stack()) {
    const mount = entry.path || "/";
    if (pathname === mount || pathname.startsWith(mount.endsWith("/") ? mount : `${mount}/`) || pathname.startsWith(mount)) {
      if (mount.length > bestLen) {
        best = entry;
        bestLen = mount.length;
      }
    }
  }
  return best;
}

/**
 * @param {Request} request
 * @returns {Promise<Response | null>}
 */
export async function dispatchGevProxy(request) {
  const url = new URL(request.url);
  const entry = matchHandler(url.pathname);
  if (!entry) return null;

  const mount = entry.path || "/";
  let rest = url.pathname.slice(mount.length) + url.search;
  if (!rest.startsWith("/")) rest = `/${rest}`;

  const socket = new Socket();
  const req = new http.IncomingMessage(socket);
  req.method = request.method;
  req.url = rest;
  req.headers = Object.fromEntries(request.headers.entries());

  if (request.body && request.method !== "GET" && request.method !== "HEAD") {
    const buf = Buffer.from(await request.arrayBuffer());
    req.push(buf);
  }
  req.push(null);

  return new Promise((resolve, reject) => {
    const res = new http.ServerResponse(req);
    const chunks = [];
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.getHeaders())) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, String(item));
        } else {
          headers.set(key, String(value));
        }
      }
      const body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      resolve(new Response(body, { status: res.statusCode || 200, headers }));
    };

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = (chunk, encoding, cb) => {
      if (chunk) chunks.push(chunk);
      return originalWrite(chunk, encoding, cb);
    };
    res.end = (chunk, encoding, cb) => {
      if (chunk && typeof chunk !== "function") chunks.push(chunk);
      const result = originalEnd(chunk, encoding, cb);
      finish();
      return result;
    };

    try {
      const maybe = entry.handler(req, res);
      if (maybe && typeof maybe.then === "function") {
        maybe.catch(reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}
