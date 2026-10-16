const { getSupabaseConfig } = require("../lib/supabase");

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  if (!String(request.headers["content-type"] || "").includes("application/json")) {
    sendJson(response, 415, { error: "Send this request as application/json." });
    return;
  }

  try {
    const input = await readJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      sendJson(response, 400, { error: "Request body must be a JSON object." });
      return;
    }
    const { url, anonKey } = getSupabaseConfig();
    let path;
    let payload;
    if (input.action === "signup") {
      path = "/auth/v1/signup";
      payload = { email: input.email, password: input.password };
    } else if (input.action === "signin") {
      path = "/auth/v1/token?grant_type=password";
      payload = { email: input.email, password: input.password };
    } else if (input.action === "refresh") {
      path = "/auth/v1/token?grant_type=refresh_token";
      payload = { refresh_token: input.refreshToken };
    } else if (input.action === "signout") {
      path = "/auth/v1/logout";
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) {
        sendJson(response, 401, { error: "Sign in before signing out." });
        return;
      }
      const signout = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!signout.ok) {
        sendJson(response, signout.status, { error: "Supabase could not end this session. Try again." });
        return;
      }
      sendJson(response, 200, { signedOut: true });
      return;
    } else {
      sendJson(response, 400, { error: "Unsupported authentication action." });
      return;
    }

    if (typeof payload.email === "string" &&
      (payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))) {
      sendJson(response, 400, { error: "Enter a valid email address." });
      return;
    }
    if (typeof payload.password === "string" &&
      (payload.password.length < 8 || payload.password.length > 128)) {
      sendJson(response, 400, { error: "Password must be between 8 and 128 characters." });
      return;
    }
    if (input.action === "refresh" &&
      (typeof payload.refresh_token !== "string" || payload.refresh_token.length > 4096)) {
      sendJson(response, 400, { error: "A valid refresh token is required." });
      return;
    }

    let authResponse;
    try {
      authResponse = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw Object.assign(new Error("Could not reach Supabase Auth. Please retry."), { status: 502 });
    }
    const authPayload = await authResponse.json().catch(() => null);
    if (!authResponse.ok) {
      const message = authPayload?.msg || authPayload?.message || authPayload?.error_description;
      sendJson(response, authResponse.status, {
        error: typeof message === "string" ? message.slice(0, 300) : "Supabase Auth could not complete the request.",
      });
      return;
    }
    sendJson(response, 200, authPayload);
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || "Authentication request failed." });
  }
};
