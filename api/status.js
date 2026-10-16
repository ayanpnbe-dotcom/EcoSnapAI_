module.exports = function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.statusCode = 405;
    response.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }
  response.statusCode = 200;
  response.end(JSON.stringify({
    provider: "Google Gemini",
    model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
    configured: Boolean(process.env.GEMINI_API_KEY),
    databaseConfigured: Boolean(
      (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL) &&
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    ),
  }));
};
