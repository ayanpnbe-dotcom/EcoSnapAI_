const { getAuthenticatedUser, getPoolForRequest } = require("../lib/supabase");

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
    if (size > 4 * 1024 * 1024) throw Object.assign(new Error("Saved records exceed the 4 MB request limit."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

module.exports = async function handler(request, response) {
  if (!["GET", "PUT"].includes(request.method)) {
    response.setHeader("Allow", "GET, PUT");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const user = await getAuthenticatedUser(request);
    const pool = getPoolForRequest();
    if (request.method === "GET") {
      const result = await pool.query(
        "SELECT records FROM public.user_material_records WHERE user_id = $1",
        [user.id],
      );
      sendJson(response, 200, { records: result.rows[0]?.records || [] });
      return;
    }

    if (!String(request.headers["content-type"] || "").includes("application/json")) {
      sendJson(response, 415, { error: "Send this request as application/json." });
      return;
    }
    const input = await readJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Array.isArray(input.records) || input.records.length > 10000 ||
      input.records.some((record) => !record || typeof record !== "object" ||
        Array.isArray(record) || typeof record.id !== "string" ||
        record.id.length < 1 || record.id.length > 100)) {
      sendJson(response, 400, { error: "Saved records must be an array of material records with valid IDs." });
      return;
    }
    const encoded = JSON.stringify(input.records);
    if (Buffer.byteLength(encoded, "utf8") > 3 * 1024 * 1024) {
      sendJson(response, 413, { error: "Saved records exceed the 3 MB storage limit." });
      return;
    }
    await pool.query(
      `INSERT INTO public.user_material_records (user_id, records, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE
       SET records = EXCLUDED.records, updated_at = now()`,
      [user.id, encoded],
    );
    sendJson(response, 200, { saved: true, count: input.records.length });
  } catch (error) {
    if (error.code === "42P01") {
      sendJson(response, 503, { error: "Database table is missing. Apply database/schema.sql in the Supabase SQL Editor." });
      return;
    }
    console.error("EcoSnapAI database request failed.", error.code || error.status || "unknown");
    sendJson(response, error.status || 500, { error: error.status ? error.message : "Could not access saved records. Check the database configuration." });
  }
};
