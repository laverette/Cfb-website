/**
 * Recent ESPN team news. Cached per team so a week board does not refetch
 * once per player. This is a headline feed, not the stale injuries endpoint.
 */
const { SITE, cachedEspnGet } = require("./http");
const { resolveEspnTeamId } = require("./resolve");

const NEWS_TTL_MS = 45 * 60 * 1000;

function normalizeArticles(payload) {
  const rows = Array.isArray(payload?.articles) ? payload.articles : [];
  return rows
    .map((article) => ({
      headline: article.headline || article.title || "",
      description: article.description || article.summary || "",
      published: article.published || article.lastModified || null,
      sourceUrl: article.links?.web?.href || article.link?.href || null,
      categories: (article.categories || [])
        .map((c) => c?.description || c?.displayName || "")
        .filter(Boolean),
    }))
    .filter((article) => article.headline);
}

async function getTeamNews(team, { signal } = {}) {
  if (!team) return [];
  const teamId = await resolveEspnTeamId(team);
  if (!teamId) return [];
  const url = `${SITE}/news?team=${teamId}&limit=30`;
  const { value } = await cachedEspnGet(`espn:news:${teamId}`, NEWS_TTL_MS, url, { signal });
  return normalizeArticles(value);
}

module.exports = {
  getTeamNews,
  normalizeArticles,
};
