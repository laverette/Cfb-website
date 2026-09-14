/**
 * GET /api/logo?src=https://a.espncdn.com/i/teamlogos/ncaa/500/333.png
 * Same-origin proxy so html2canvas can embed ESPN logos in saved images.
 */
const ALLOWED_HOST = /(^|\.)espncdn\.com$/i;

function bad(status, message) {
  return {
    statusCode: status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
    body: message,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return bad(405, "Method not allowed");
  }

  const src = String((event.queryStringParameters || {}).src || "").trim();
  if (!src) return bad(400, "src is required");

  let parsed;
  try {
    parsed = new URL(src);
  } catch {
    return bad(400, "Invalid src");
  }
  if (parsed.protocol !== "https:") return bad(400, "Invalid src");
  if (!ALLOWED_HOST.test(parsed.hostname)) return bad(400, "Host not allowed");

  try {
    const resp = await fetch(parsed.toString(), {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (!resp.ok) return bad(resp.status, "Logo fetch failed");
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") || "image/png";
    if (!/^image\//i.test(contentType)) return bad(415, "Not an image");
    return {
      statusCode: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400",
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("logo-proxy:", err);
    return bad(502, "Logo fetch failed");
  }
};
