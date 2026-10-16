const { Pool } = require("pg");

let pool;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw Object.assign(new Error("Supabase is not configured. Check the Vercel Supabase integration variables."), { status: 503 });
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
}

function getPool() {
  const connectionString = process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw Object.assign(new Error("PostgreSQL is not configured. Check the Vercel Postgres integration variables."), { status: 503 });
  }
  if (!pool) pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 });
  return pool;
}

async function getAuthenticatedUser(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    throw Object.assign(new Error("Sign in to access your saved materials."), { status: 401 });
  }

  const { url, anonKey } = getSupabaseConfig();
  let response;
  try {
    response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw Object.assign(new Error("Could not verify your Supabase session. Please retry."), { status: 502 });
  }
  if (!response.ok) {
    throw Object.assign(new Error("Your session has expired. Sign in again."), { status: 401 });
  }
  const user = await response.json();
  if (typeof user.id !== "string") {
    throw Object.assign(new Error("Supabase returned an invalid user session."), { status: 502 });
  }
  return user;
}

function getPoolForRequest() {
  return getPool();
}

module.exports = { getAuthenticatedUser, getPoolForRequest, getSupabaseConfig };
