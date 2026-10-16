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
  }));
};
