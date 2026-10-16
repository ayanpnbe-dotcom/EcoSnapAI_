const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_CATEGORIES = new Set(["plastic", "paper", "metal", "glass", "organic", "hazardous", "unknown"]);
const COMPACT_PROMPT = `Review this waste-item photo for EcoSnapAI. Work in two steps: (1) note the visible evidence — object shape, labels or printed text, recycling symbols or codes, material cues, cleanliness, damage; (2) decide the classification from that evidence only. Return one JSON object only with exactly these fields: {"category":"plastic|paper|metal|glass|organic|hazardous|unknown","itemName":"short plain name","material":"visible material with uncertainty","confidence":0.0,"condition":"clean|soiled|damaged|unknown","needsReview":false,"hazardous":false,"action":"safe next step","preparation":"safe preparation","reuseOption":"safe reuse option or not suitable","explanation":"brief visible evidence"}.
Treat appearance as uncertain evidence, not proof. Never assert resin, composition, recyclability, contamination, or a hazard unless visually evident. If a recycling code or label is legible, let it guide the material and say so in the explanation. Set confidence below 0.6 and needsReview true when the image is blurry, dark, obscured, shows multiple items, or the material is ambiguous. Use unknown when unclear or obscured. Do not infer local rules or recycling outcomes; say requirements vary. For batteries, chemicals, e-waste, medical waste, sharps, leaks, or possible hazards, prioritize caution; never advise opening, testing, or handling them. Keep fields concise.`;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

function cleanText(value, fallback, maxLength = 600) {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength) || fallback;
}

function sanitizeUserContext(context) {
  const source = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  return {
    location: cleanText(source.location, "", 120),
    user_goal: cleanText(source.user_goal, "", 60),
    weight: cleanText(source.weight, "", 40),
    weight_unit: cleanText(source.weight_unit, "", 10),
    condition: cleanText(source.condition, "", 40),
    contents_or_previous_use: cleanText(source.contents_or_previous_use, "", 200),
    additional_notes: cleanText(source.additional_notes, "", 500),
  };
}

function buildDetailedAnalysisPrompt(userContext, trackingId, scannedAt) {
  return `You are the AI analysis engine for EcoSnapAI, a Smart Recycling Assistant. Analyze the uploaded image of one physical item and create a precise recycling report. The system supports computer vision, material-flow tracking, and personalized recycling recommendations.
Return valid JSON only. Do not include Markdown, explanations outside JSON, greetings, or generic recycling advice.
Core rules:
- Use only what is clearly visible in the image or supplied in USER_CONTEXT below. Never invent brand names, materials, weights, recycling rules, locations, environmental impact values, or hazardous properties.
- Separate every finding into one of: "confirmed", "estimated", "user_provided", or "needs_user_input".
- Include a confidence score from 0 to 100 for image-based findings.
- If essential information is unavailable, add a clear, short question to required_user_inputs instead of guessing. Ask only questions relevant to the detected item. Keep recommendations practical and specific.
- For local recycling instructions, require user location if it is not supplied. Only provide environmental calculations when weight and a valid calculation source are available; otherwise set calculation_status to requires_weight or requires_verified_source and leave calculations unavailable.
- If an estimate is visually reasonable, provide a range, label it estimated with estimate_basis stating the visual basis. Never provide a false exact number.
- item_summary.category MUST be exactly one of: plastic, paper, metal, glass, organic, hazardous, unknown.
- Calibrate confidence honestly: 90 or above only when the material is unmistakable from the image; 60-89 when likely but not certain; below 60 means uncertain — set report_status to requires_user_input or manual_review_recommended and ask for what is missing instead of guessing.
- required_user_inputs entries MUST use field names exactly from: location, user_goal, weight, weight_unit, condition, contents_or_previous_use, additional_notes. Only include entries for information that is genuinely needed.
- digital_twin_record.tracking_id MUST be "${trackingId}", current_status "scanned", and material_flow MUST start with {"stage":"scanned","timestamp":"${scannedAt}","details":"<short note>"}.
USER_CONTEXT: ${JSON.stringify(userContext)}
Return this exact JSON structure:
{"report_status":"complete | requires_user_input | manual_review_recommended","item_summary":{"item_name":{"value":"","evidence_type":"confirmed | estimated | user_provided | needs_user_input","confidence":0,"visual_evidence":""},"category":"","primary_recommendation":"","primary_recommendation_reason":""},"visual_analysis":{"visible_description":"","detected_text_or_symbols":[],"detected_components":[],"material_assessment":[{"material":"","part_of_item":"","evidence_type":"confirmed | estimated | needs_user_input","confidence":0,"visual_evidence":""}],"item_condition":{"value":"","evidence_type":"confirmed | user_provided | needs_user_input","confidence":0,"notes":""}},"classification":{"classifications":[{"type":"recyclable | reusable | biodegradable | compostable | hazardous | e_waste | general_waste","status":"yes | no | conditional | requires_verification","reason":"","confidence":0}],"separate_components_required":[],"safety_warnings":[]},"preparation_steps":[{"step":"","reason":"","required":true}],"disposal_or_reuse_guidance":{"recommended_action":"recycle | reuse | repair | donate | return | compost | dispose","instructions":[],"location_specific_guidance":"","location_guidance_status":"available | location_required | not_applicable","alternative_action":""},"weight_and_quantity":{"weight_value":null,"weight_unit":"","weight_source":"user_provided | image_estimate | needs_user_input","estimated_range":{"minimum":null,"maximum":null,"unit":""},"estimate_basis":"","confidence":0},"environmental_impact":{"calculation_status":"available | requires_weight | requires_verified_source | not_applicable","estimated_recoverable_material":"","impact_summary":"","assumptions":[],"data_source":""},"digital_twin_record":{"tracking_id":"${trackingId}","current_status":"scanned","material_flow":[{"stage":"scanned","timestamp":"${scannedAt}","details":""}],"traceability_notes":[]},"personalized_recommendations":[{"recommendation":"","reason":"","priority":"high | medium | low"}],"required_user_inputs":[{"field":"","question":"","why_needed":"","input_type":"text | number | select | location","options":[]}],"data_quality":{"confirmed_from_image":[],"estimated_from_image":[],"user_provided_data":[],"requires_user_input":[],"manual_review_reason":""}}`;
}

function validateDetailedAnalysis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Gemini returned an unreadable detailed analysis."), { status: 502 });
  }
  const inputs = Array.isArray(value.required_user_inputs) ? value.required_user_inputs : [];
  const questions = inputs
    .filter((item) => item && typeof item.field === "string" && typeof item.question === "string")
    .slice(0, 8)
    .map((item) => ({
      field: item.field.slice(0, 60),
      question: item.question.slice(0, 300),
      why_needed: typeof item.why_needed === "string" ? item.why_needed.slice(0, 300) : "",
      input_type: ["text", "number", "select", "location"].includes(item.input_type) ? item.input_type : "text",
      options: Array.isArray(item.options)
        ? item.options.filter((option) => typeof option === "string").slice(0, 12).map((option) => option.slice(0, 120))
        : [],
    }));
  const reportStatus = ["complete", "requires_user_input", "manual_review_recommended"].includes(value.report_status)
    ? value.report_status
    : questions.length ? "requires_user_input" : "complete";
  const detailed = { ...value, report_status: reportStatus, required_user_inputs: questions };
  if (JSON.stringify(detailed).length > 40000) {
    throw Object.assign(new Error("Gemini returned an oversized detailed analysis."), { status: 502 });
  }
  return detailed;
}

function validateAnalysis(analysis) {
  if (!analysis || !ALLOWED_CATEGORIES.has(analysis.category)) {
    throw Object.assign(new Error("The model did not return a recognized material category."), { status: 502 });
  }
  const confidence = Number(analysis.confidence);
  const safeConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const hazardous = analysis.category === "hazardous" || analysis.hazardous === true;
  const needsReview = hazardous || analysis.category === "unknown" || safeConfidence < 0.6 || analysis.needsReview === true;
  const safeAction = hazardous
    ? "Potential hazard: do not put this in household recycling or general waste. Avoid handling damaged or leaking items and consult an appropriate local authority or authorized collection point."
    : needsReview
      ? "The image is not clear enough for a reliable identification. Check the item manually and consult your local waste service before disposal."
      : cleanText(analysis.action, "Check local guidance before disposing of this item.");

  return {
    category: needsReview && !hazardous ? "unknown" : analysis.category,
    itemName: cleanText(analysis.itemName, "Unidentified item", 100),
    material: cleanText(analysis.material, "Material not confirmed", 120),
    confidence: safeConfidence,
    condition: ["clean", "soiled", "damaged", "unknown"].includes(analysis.condition) ? analysis.condition : "unknown",
    needsReview,
    hazardous,
    action: safeAction,
    preparation: hazardous
      ? "Do not open, test, dismantle, or handle damaged or leaking items. Contact an appropriate local authority or authorized collection point."
      : cleanText(analysis.preparation, "Follow local authority guidance; no local rule has been verified."),
    reuseOption: hazardous
      ? "Do not reuse or repurpose a potentially hazardous item."
      : cleanText(analysis.reuseOption, "Consider safe reuse if the item is intact and suitable."),
    explanation: cleanText(analysis.explanation, "This is an AI-generated visual estimate, not a verified local recycling instruction."),
    caveat: "AI visual estimate only. Local disposal rules are not connected or verified. Hazardous items need cautious human review.",
  };
}

function safeFailure(status) {
  if (status === 429) return { status: 429, error: "Gemini quota or rate limit reached. Please retry later." };
  if (status === 503) return { status: 503, error: "Gemini is temporarily unavailable. Please retry shortly." };
  if (status === 504) return { status: 504, error: "Gemini request timed out. Please retry shortly." };
  return { status: 502, error: "Gemini analysis failed. Please retry or review the item manually." };
}

async function callGemini(prompt, image, maxOutputTokens, timeoutMs = 30000, temperature = 0.2) {
  const apiKey = process.env.GEMINI_API_KEY;
  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const models = [...new Set([primaryModel, "gemini-3.5-flash-lite"])];
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });

  let lastStatus = 502;
  for (const model of models) {
    let response;
    try {
      response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature, responseMimeType: "application/json", maxOutputTokens },
        }),
      });
    } catch (error) {
      lastStatus = error.name === "TimeoutError" || error.name === "AbortError" ? 504 : 502;
      console.error("Gemini request failed with status", lastStatus);
      continue;
    }

    if (response.ok) {
      let payload;
      try {
        payload = await response.json();
      } catch {
        console.error("Gemini request failed with status", 502);
        throw Object.assign(new Error("Gemini returned an invalid response."), { status: 502 });
      }
      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();
      if (!text) {
        console.error("Gemini request failed with status", 502);
        throw Object.assign(new Error("Gemini returned an empty response."), { status: 502 });
      }
      try {
        return { result: JSON.parse(text), model };
      } catch {
        console.error("Gemini request failed with status", 502);
        throw Object.assign(new Error("Gemini returned an unreadable response."), { status: 502 });
      }
    }

    lastStatus = response.status;
    console.error("Gemini request failed with status", lastStatus);
    if (![404, 429, 500, 502, 503].includes(lastStatus)) break;
  }

  const failure = safeFailure(lastStatus);
  throw Object.assign(new Error(failure.error), { status: failure.status });
}

function validateImage(input) {
  const mimeType = input?.mimeType;
  const base64 = input?.image;
  if (!ALLOWED_MIME_TYPES.has(mimeType) || typeof base64 !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw Object.assign(new Error("Provide a valid PNG, JPEG or WebP image encoded as base64."), { status: 400 });
  }
  const imageBytes = Buffer.from(base64, "base64");
  if (!imageBytes.length || imageBytes.length > IMAGE_LIMIT_BYTES ||
      imageBytes.toString("base64") !== base64) {
    throw Object.assign(new Error("Image must be valid and no larger than 5 MB."), { status: 400 });
  }
  const isJpeg = imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff;
  const isPng = imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = imageBytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    imageBytes.subarray(8, 12).toString("ascii") === "WEBP";
  if ((mimeType === "image/jpeg" && !isJpeg) || (mimeType === "image/png" && !isPng) ||
      (mimeType === "image/webp" && !isWebp)) {
    throw Object.assign(new Error("The image contents do not match the selected file type."), { status: 400 });
  }
  return { mimeType, base64: imageBytes.toString("base64") };
}

async function analyze(image, context) {
  const trackingId = `ECO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const scannedAt = new Date().toISOString();
  const imagePayload = { mimeType: image.mimeType, base64: image.base64 };
  const compactPromise = callGemini(COMPACT_PROMPT, imagePayload, 600, 30000, 0.1);
  const detailedPromise = callGemini(
    buildDetailedAnalysisPrompt(sanitizeUserContext(context), trackingId, scannedAt),
    imagePayload,
    4096,
    30000,
  ).then(
    (result) => ({ detailed: validateDetailedAnalysis(result.result), model: result.model }),
    () => ({ detailed: null, model: null }),
  );
  const [modelResponse, detailedOutcome] = await Promise.all([compactPromise, detailedPromise]);
  return {
    analysis: validateAnalysis(modelResponse.result),
    model: modelResponse.model,
    detailed: detailedOutcome.detailed,
    detailedModel: detailedOutcome.model,
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  console.log("analyze request received");
  let input;
  try {
    input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch {
    sendJson(response, 400, { error: "Request body must be valid JSON." });
    return;
  }
  let image;
  try {
    image = validateImage(input);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Provide a valid image." });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("missing GEMINI_API_KEY");
    sendJson(response, 500, { error: "Photo analysis is not configured on the server." });
    return;
  }
  try {
    const result = await analyze(image, input.context);
    console.log("analysis completed");
    sendJson(response, 200, result);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const safeError = status === 400
      ? error.message || "Invalid analysis request."
      : status === 429 || status === 503 || status === 504
        ? error.message
        : "Gemini analysis failed. Please retry or review the item manually.";
    sendJson(response, status, { error: safeError });
  }
};
