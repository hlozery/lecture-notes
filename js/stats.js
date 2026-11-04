// Statistiques par note et tirage pondéré vers les notes difficiles.
const RECENT = 6;

// entry = { n: essais, e: erreurs, t: temps moyen (ms, bonnes réponses), r: derniers résultats (1 = raté) }
export function recordAnswer(stats, key, ok, ms) {
  const s = stats[key] || (stats[key] = { n: 0, e: 0, t: 0, r: [] });
  s.n++;
  if (!ok) s.e++;
  if (ok) s.t = s.t ? Math.round(s.t * 0.7 + ms * 0.3) : Math.round(ms);
  s.r.push(ok ? 0 : 1);
  if (s.r.length > RECENT) s.r.shift();
}

export function recentErrorRate(s) {
  return s && s.r.length ? s.r.reduce((a, b) => a + b, 0) / s.r.length : 0;
}

export function accuracy(s) {
  return s && s.n ? 1 - s.e / s.n : null;
}

export function weightFor(s, limitMs) {
  if (!s) return 1.5; // jamais vue : un peu plus souvent pour tout couvrir
  let w = 1 + 3 * recentErrorRate(s);
  if (limitMs && s.t > limitMs * 0.6) w += 0.5;
  return w;
}

export function pickWeighted(pool, stats, prevKey, limitMs, rng = Math.random) {
  const candidates = pool.length > 1 ? pool.filter((p) => p.key !== prevKey) : pool;
  const weights = candidates.map((p) => weightFor(stats[p.key], limitMs));
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    x -= weights[i];
    if (x < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// Clés des éléments les plus ratés récemment (au moins une erreur récente), filtrables par clé.
export function hardest(stats, count = 10, keep = () => true) {
  return Object.entries(stats)
    .filter(([key, s]) => keep(key) && recentErrorRate(s) > 0)
    .sort(([, a], [, b]) => recentErrorRate(b) - recentErrorRate(a) || b.e - a.e)
    .slice(0, count)
    .map(([key]) => key);
}
