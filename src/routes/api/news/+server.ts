// src/routes/api/news/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { NEWSAPI_KEY, BING_NEWS_KEY, BING_NEWS_DISABLE } from '$env/static/private';

/** ───────────────────────────────────────────────────────────────
 *  Types
 *  ─────────────────────────────────────────────────────────────── */
type Lang = 'kr' | 'en';

type News = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string; // ISO
  lang: Lang;
  summary: string;
  sentiment: 'pos' | 'neg' | 'neu';
  sentimentScore: number; // -1 ~ 1
  keywords: string[];
  relevance: number; // 0 ~ 1
};

type Aggregate = {
  count: number;
  posRatio: number; // 0 ~ 1
  negRatio: number; // 0 ~ 1
  topKeywords: { word: string; count: number }[];
  timeline: { t: string; count: number; avgSent: number }[]; // t: ISO hour/day
};

type Result = { articles: News[]; agg: Aggregate; meta?: { aliases?: string[]; [k: string]: any } };

/** ───────────────────────────────────────────────────────────────
 *  In-memory Cache (10~30분 캐시 권장)
 *  ─────────────────────────────────────────────────────────────── */
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const cache = new Map<string, { ts: number; data: Result }>();

function getCache(key: string): Result | null {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return v.data;
}
function setCache(key: string, data: Result) {
  cache.set(key, { ts: Date.now(), data });
}

/** ───────────────────────────────────────────────────────────────
 *  Alias Cache (동적 별칭 캐시)
 *  ─────────────────────────────────────────────────────────────── */
const ALIAS_CACHE_TTL_MS = 30 * 60 * 1000; // 30분
const aliasCache = new Map<string, { ts: number; aliases: string[] }>();

function getAliasCache(q: string): string[] | null {
  const v = aliasCache.get(q);
  if (!v) return null;
  if (Date.now() - v.ts > ALIAS_CACHE_TTL_MS) {
    aliasCache.delete(q);
    return null;
  }
  return v.aliases;
}
function setAliasCache(q: string, aliases: string[]) {
  aliasCache.set(q, { ts: Date.now(), aliases });
}

/** ───────────────────────────────────────────────────────────────
 *  Utilities: summarize / sentiment / keywords / relevance
 *  ─────────────────────────────────────────────────────────────── */

// 간단 추출 요약 (1~2문장)
function summarize(raw: string, maxSent = 2): string {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const sents = text.match(/[^.!?。！？]+[.!?。！？]?/g) || [text];
  const score = (s: string) =>
    (/\d/.test(s) ? 1 : 0) + // 숫자 포함 가중
    (/[A-Z가-힣][a-z가-힣]+/.test(s) ? 1 : 0) + // 고유명사(느슨)
    Math.min(s.length / 80, 1); // 길이 보정

  return sents
    .map((s) => ({ s: s.trim(), w: score(s) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, maxSent)
    .map((x) => x.s)
    .join(' ');
}

// 초경량 감성 사전
const POS_WORDS = ['호조', '개선', '상향', '강세', '확대', '증가', '호재', 'surge', 'beat', 'rally', 'grow', 'record', 'profit'];
const NEG_WORDS = ['부진', '하향', '약세', '축소', '감소', '악재', 'slump', 'miss', 'fall', 'decline', 'loss', 'warning'];

function sentiment(text: string): { label: 'pos' | 'neg' | 'neu'; score: number } {
  const t = (text || '').toLowerCase();
  if (!t) return { label: 'neu', score: 0 };
  const pos = POS_WORDS.reduce((a, w) => a + (t.includes(w.toLowerCase()) ? 1 : 0), 0);
  const neg = NEG_WORDS.reduce((a, w) => a + (t.includes(w.toLowerCase()) ? 1 : 0), 0);
  const score = (pos - neg) / Math.max(1, pos + neg);
  const label: 'pos' | 'neg' | 'neu' = score > 0.1 ? 'pos' : score < -0.1 ? 'neg' : 'neu';
  return { label, score };
}

// 매우 단순 키워드 추출 (제목 위주, stopwords/banwords 제거)
const STOPWORDS = new Set([
  // EN
  'the','a','an','and','or','to','of','for','on','in','at','by','with','from','as',
  'is','are','was','were','be','been','it','its','this','that','these','those','over',
  // KR 조사/불용어
  '은','는','이','가','을','를','의','에','에서','와','과','및','도','으로','보다','보다도',
  '했다','했다는','대해','등','및','중','또','또한','하지만','그러나','그리고','올해','내년','작년'
]);

// 상투어/잡음 제거용 금지어
const BANWORDS = new Set([
  // 한국어 상투어
  '속보','단독','종합','영상','포토','기자','앵커','오늘','어제','내일','현장',
  '사진','인터뷰','중계','전문','해설','칼럼','사설','사설/칼럼',
  // 영어 상투어
  'breaking','exclusive','opinion','analysis','column','editorial','watch','video',
  'photo','live','update','updates'
]);

// 통화쌍 소형 사전 (표현 변형 포함 — 필요시 확장)
const CURRENCY_PAIR_ALIASES: Record<string, string[]> = {
  USDKRW: ['USD/KRW','달러/원','원/달러','원화','달러','환율','달러-원','USDKRW'],
  USDJPY: ['USD/JPY','달러/엔','엔/달러','엔화','달러-엔','USDJPY'],
  EURUSD: ['EUR/USD','유로/달러','달러/유로','유로화','유로-달러','EURUSD'],
  USDCNY: ['USD/CNY','달러/위안','위안/달러','위안화','달러-위안','USDCNY'],
  EURKRW: ['EUR/KRW','유로/원','원/유로','유로화','유로-원','EURKRW'],
  JPYKRW: ['JPY/KRW','엔/원','원/엔','엔화','엔-원','JPYKRW'],
  CNYKRW: ['CNY/KRW','위안/원','원/위안','위안화','위안-원','CNYKRW']
};

function extractKeywords(title: string, max = 8): string[] {
  const tokens = (title || '')
    .replace(/[^\p{L}\p{N}\s\-_.:/%]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w.toLowerCase()));

  const freq = new Map<string, number>();
  for (const w of tokens) {
    if (BANWORDS.has(w.toLowerCase())) continue;
    if (/^[\d._%]+$/.test(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

// ── 동적 별칭 파이프라인 (규칙 + 공출현 PMI)
function ruleBasedAliases(q: string): string[] {
  const out = new Set<string>();
  const clean = q.trim();

  // 통화쌍 ABCXYZ
  if (/^[A-Z]{6}$/.test(clean)) {
    const base = clean.slice(0, 3), quote = clean.slice(3);
    out.add(`${base}/${quote}`);
    out.add(`${base}-${quote}`);
    out.add(`${base}${quote}`);
    const dict = CURRENCY_PAIR_ALIASES[clean];
    if (dict) dict.forEach((d) => out.add(d));
  }

  // 숫자 6자리: KRX 가정
  if (/^\d{6}$/.test(clean)) {
    out.add(clean);
  }

  // 일반 변형
  out.add(clean);
  out.add(clean.toLowerCase());
  out.add(clean.toUpperCase());
  out.add(clean.replace(/[-_/:\s]+/g, ''));
  out.add(clean.replace(/[-_/:\s]+/g, '/'));
  return [...out].filter(Boolean);
}

type ArticleLite = { title: string; summary?: string };

function extractCandidatePhrases(articles: ArticleLite[]): string[] {
  const freq = new Map<string, number>();
  const push = (w: string) => {
    const k = w.trim();
    if (!k) return;
    if (k.length < 2 || k.length > 30) return;
    if (/^[\d._%]+$/.test(k)) return;
    if (STOPWORDS.has(k.toLowerCase())) return;
    if (BANWORDS.has(k.toLowerCase())) return;
    freq.set(k, (freq.get(k) || 0) + 1);
  };

  const tokenize = (text: string) =>
    (text || '')
      .replace(/[^\p{L}\p{N}._%/:\-\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);

  for (const a of articles) {
    const s = `${a.title || ''} ${a.summary || ''}`;
    const toks = tokenize(s);
    for (const t of toks) {
      if (/[A-Z][A-Za-z0-9._-]+/.test(t) || /[가-힣]{2,}/.test(t) || /[A-Za-z0-9]+[%]/.test(t)) {
        push(t);
      }
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 500)
    .map(([w]) => w);
}

function calcPMIAliases(q: string, articles: ArticleLite[], candidates: string[], window = 280) {
  const N = articles.length || 1;
  let docWithQ = 0;
  const candDocCount = new Map<string, number>();
  const coDocCount = new Map<string, number>();
  const contains = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase());

  for (const a of articles) {
    const text = `${a.title || ''} ${a.summary || ''}`.slice(0, window);
    const hasQ = contains(text, q);
    if (hasQ) docWithQ++;
    for (const c of candidates) {
      const hasC = contains(text, c);
      if (hasC) candDocCount.set(c, (candDocCount.get(c) || 0) + 1);
      if (hasQ && hasC) coDocCount.set(c, (coDocCount.get(c) || 0) + 1);
    }
  }

  const pQ = docWithQ / N || 1e-9;
  return candidates.map((c) => {
    const pC = (candDocCount.get(c) || 0) / N || 1e-9;
    const pQC = (coDocCount.get(c) || 0) / N || 1e-12;
    const pmi = Math.log(pQC / (pQ * pC));
    return { term: c, pmi, co: coDocCount.get(c) || 0, freq: candDocCount.get(c) || 0 };
  })
  .filter(x => x.co >= 1)
  .sort((a, b) => (b.pmi + Math.log(1 + b.co)) - (a.pmi + Math.log(1 + a.co)));
}

function generateAliases(q: string, articles: ArticleLite[], topN = 12): string[] {
  const cached = getAliasCache(q);
  if (cached) return cached;

  const base = new Set(ruleBasedAliases(q));
  const candidates = extractCandidatePhrases(articles);
  const ranked = calcPMIAliases(q, articles, candidates);

  for (const r of ranked) {
    if (base.size >= topN) break;
    if (r.term.toLowerCase() === q.toLowerCase()) continue;
    base.add(r.term);
  }
  const out = [...base].slice(0, topN);
  setAliasCache(q, out);
  return out;
}

function dynamicRelevance(title: string, q: string, aliases: string[]): number {
  const t = (title || '').toLowerCase();
  const keys = new Set([q.toLowerCase(), ...aliases.map(a => a.toLowerCase())]);
  let hits = 0;
  keys.forEach(k => { if (k && t.includes(k)) hits++; });
  const denom = Math.max(1, Math.floor(keys.size / 2));
  return Math.min(1, hits / denom);
}

// ───────────────────────────────────────────────────────────────
// Query‑aware Targeted Sentiment (검색어 지향 감성)
// ───────────────────────────────────────────────────────────────
const POS_CUES = new Set([...POS_WORDS, '호실적','사상최대','돌파','승인','인상','증익','상향조정','수주','계약','배당증가','턴어라운드','호재']);
const NEG_CUES = new Set([...NEG_WORDS, '비판','논란','우려','경고','과열','고발','소송','징계','규제','리콜','적자','감산','감익','하향조정','부정']);

// 특정 도메인(은행권 등) 키워드가 q와 직접 연계되지 않았을 때 신호를 약화/무시하기 위한 세트
const BANK_TERMS = new Set(['은행','은행권','금융권','이자장사','금리장사','시중은행','저축은행']);

// 간단 토큰화 (소문자, 공백/구두점 분리, 인덱스 유지)
function tokenizeWithIndex(text: string): { tok: string; i: number }[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%./:\-\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((tok, i) => ({ tok, i }));
}

function includesAny(s: string, terms: string[]) {
  const t = s.toLowerCase();
  for (const k of terms) if (k && t.includes(k.toLowerCase())) return true;
  return false;
}

/**
 * 검색어/별칭과의 근접창(window)에서만 감성 집계
 * - window: ±W 토큰(기본 12)
 * - 거리 가중치: 1/(1+d)
 * - 은행 전용 부정(이자장사 등)은 타깃 근처에 q/alias가 없으면 무시
 */
function targetedSentiment(text: string, q: string, aliases: string[], W = 12): { label: 'pos'|'neg'|'neu'; score: number } {
  const tokens = tokenizeWithIndex(text);
  if (!tokens.length) return { label: 'neu', score: 0 };

  const keys = [q, ...aliases].map((x) => x.toLowerCase());
  const centers: number[] = [];
  for (const t of tokens) {
    if (includesAny(t.tok, keys)) centers.push(t.i);
  }
  // 타깃이 문장에 전혀 없으면 글로벌 감성으로 fallback
  if (!centers.length) return sentiment(text);

  let num = 0;  // 가중합 (pos: +, neg: -)
  let den = 0;  // 가중치 합

  for (const c of centers) {
    for (let j = Math.max(0, c - W); j <= Math.min(tokens.length - 1, c + W); j++) {
      const d = Math.abs(j - c);
      const w = 1 / (1 + d); // 거리 가중치
      const tok = tokens[j].tok;

      // 은행권 이슈 토큰은 타깃 근거 없이 기사 전반 비판을 끌어오지 않도록 억제
      if (BANK_TERMS.has(tok)) continue;

      if (POS_CUES.has(tok)) {
        num += 1 * w; den += w;
      } else if (NEG_CUES.has(tok)) {
        num -= 1 * w; den += w;
      }
    }
  }

  if (den === 0) return { label: 'neu', score: 0 };

  const raw = num / den; // -1..1 경향
  // 극단값 완화
  const score = Math.max(-1, Math.min(1, raw * 0.85));
  const label: 'pos'|'neg'|'neu' = score > 0.15 ? 'pos' : score < -0.15 ? 'neg' : 'neu';
  return { label, score };
}

/** ───────────────────────────────────────────────────────────────
 *  Provider Implementations
 *  ─────────────────────────────────────────────────────────────── */

async function fetchFromNewsAPI(q: string, lang: Lang, fromISO: string): Promise<News[]> {
  if (!NEWSAPI_KEY) return [];
  const language = lang === 'kr' ? 'ko' : 'en';
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q', q);
  url.searchParams.set('language', language);
  url.searchParams.set('from', fromISO);
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', '50');
  url.searchParams.set('apiKey', NEWSAPI_KEY);

  const r = await fetch(url, { headers: { 'User-Agent': 'SvelteKit-NewsFetcher/1.0' } });
  if (!r.ok) throw new Error(`NewsAPI failed: ${r.status}`);
  const json = await r.json();

  const arr = (json.articles || []) as any[];
  return arr.map((a, idx) => {
    const title: string = a.title || '';
    const desc: string = a.description || '';
    const content: string = a.content || '';
    const body = [desc, content].filter(Boolean).join(' ');
    const sum = summarize(body || title, 2);
    const sent = sentiment(title + ' ' + body);
    const kws = extractKeywords(title);
    const rel = 0; // relevance는 이후 동적 별칭으로 재계산

    const publishedAt = a.publishedAt ? new Date(a.publishedAt).toISOString() : new Date().toISOString();

    return {
      id: `newsapi-${idx}-${publishedAt}`,
      title,
      url: a.url,
      source: a.source?.name || 'Unknown',
      publishedAt,
      lang,
      summary: sum,
      sentiment: sent.label,
      sentimentScore: Number(sent.score.toFixed(3)),
      keywords: kws,
      relevance: rel
    } satisfies News;
  });
}

async function fetchFromBing(q: string, lang: Lang, days: number): Promise<News[]> {
  if (!BING_NEWS_KEY) return [];
  const mkt = lang === 'kr' ? 'ko-KR' : 'en-US';
  const freshness = days <= 1 ? 'Day' : days <= 3 ? 'Week' : 'Month';

  const url = new URL('https://api.bing.microsoft.com/v7.0/news/search');
  url.searchParams.set('q', q);
  url.searchParams.set('mkt', mkt);
  url.searchParams.set('freshness', freshness);
  url.searchParams.set('count', '50');
  url.searchParams.set('sortBy', 'Date');

  const r = await fetch(url, {
    headers: { 'Ocp-Apim-Subscription-Key': BING_NEWS_KEY, 'User-Agent': 'SvelteKit-NewsFetcher/1.0' }
  });
  if (!r.ok) throw new Error(`Bing News failed: ${r.status}`);
  const json = await r.json();

  const arr = (json.value || []) as any[];
  return arr.map((a: any, idx: number) => {
    const title: string = a.name || '';
    const desc: string = a.description || '';
    const sum = summarize(desc || title, 2);
    const sent = sentiment(title + ' ' + desc);
    const kws = extractKeywords(title);
    const rel = 0; // relevance는 이후 동적 별칭으로 재계산

    const publishedAt = a.datePublished ? new Date(a.datePublished).toISOString() : new Date().toISOString();

    return {
      id: `bing-${idx}-${publishedAt}`,
      title,
      url: a.url,
      source: a.provider?.[0]?.name || 'Bing',
      publishedAt,
      lang,
      summary: sum,
      sentiment: sent.label,
      sentimentScore: Number(sent.score.toFixed(3)),
      keywords: kws,
      relevance: rel
    } as News;
  });
}

/** ───────────────────────────────────────────────────────────────
 *  Aggregation
 *  ─────────────────────────────────────────────────────────────── */
function aggregate(articles: News[], days: number): Aggregate {
  const count = articles.length;
  const negCount = articles.filter((a) => a.sentiment === 'neg').length;
  const posCount = articles.filter((a) => a.sentiment === 'pos').length;
  const posRatio = count ? posCount / count : 0;
  const negRatio = count ? negCount / count : 0;

  // 키워드 빈도
  const kwMap = new Map<string, number>();
  for (const a of articles) {
    a.keywords.forEach((k) => kwMap.set(k, (kwMap.get(k) || 0) + 1));
  }
  const topKeywords = [...kwMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, cnt]) => ({ word, count: cnt }));

  // 타임라인: days<=1이면 시간단위, 아니면 일단위
  const bucketByHour = days <= 1;
  const buckets = new Map<string, { count: number; sumSent: number }>();
  for (const a of articles) {
    const d = new Date(a.publishedAt);
    const key = bucketByHour
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).toISOString()
      : new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const cur = buckets.get(key) || { count: 0, sumSent: 0 };
    buckets.set(key, { count: cur.count + 1, sumSent: cur.sumSent + a.sentimentScore });
  }
  const timeline = [...buckets.entries()]
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([t, v]) => ({ t, count: v.count, avgSent: Number((v.sumSent / Math.max(1, v.count)).toFixed(3)) }));

  return {
    count,
    posRatio: Number(posRatio.toFixed(3)),
    negRatio: Number(negRatio.toFixed(3)),
    topKeywords,
    timeline
  };
}

/** ───────────────────────────────────────────────────────────────
 *  Handler
 *  ─────────────────────────────────────────────────────────────── */
export const GET: RequestHandler = async ({ url, fetch }) => {
  const q = (url.searchParams.get('q') || 'USDKRW').trim();
  const days = Math.max(1, Math.min(14, Number(url.searchParams.get('days')) || 3));
  const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'kr') as Lang;

  const cacheKey = `${q}:${days}:${lang}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }
    });
  }

  // fromISO for NewsAPI
  const fromISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Provider 선택: NEWSAPI → BING → (없으면 501)
  const sources: News[][] = [];
  try {
    if (NEWSAPI_KEY) sources.push(await fetchFromNewsAPI(q, lang, fromISO));
  } catch (e) {
    console.error(e);
  }
  if(!BING_NEWS_DISABLE){
    try {
        if (BING_NEWS_KEY) sources.push(await fetchFromBing(q, lang, days));
    } catch (e) {
        console.error(e);
    }
  }

  const merged = sources.flat();

  const hasNews = !!NEWSAPI_KEY;
  const hasBing = !!BING_NEWS_KEY && !BING_NEWS_DISABLE;

  if (!hasNews && !hasBing) {
    return new Response(
      JSON.stringify({ error: 'No news providers configured. Set NEWSAPI_KEY (or BING_NEWS_KEY).' }),
      { status: 501, headers: { 'content-type': 'application/json' } }
    );
  }

  if (!merged.length) {
    const empty = { articles: [], agg: aggregate([], days), meta: { aliases: [] } };
    return new Response(JSON.stringify(empty), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }
    });
  }

  // 중복 제거 (url 기준)
  const uniqMap = new Map<string, News>();
  merged.forEach((a) => {
    if (!a.url) return;
    if (!uniqMap.has(a.url)) uniqMap.set(a.url, a);
  });
  let articles = [...uniqMap.values()];

  // 동적 별칭 생성 (샘플 100건 기반)
  const aliasSample = articles.slice(0, 100).map(a => ({ title: a.title, summary: a.summary }));
  const aliases = generateAliases(q, aliasSample);

  // relevance 재계산
  for (const a of articles) {
    a.relevance = dynamicRelevance(a.title, q, aliases);
  }

  // 타깃 감성으로 덮어쓰기 (모든 기사 대상)
  for (const a of articles) {
    const text = `${a.title || ''} ${a.summary || ''}`;
    const ts = targetedSentiment(text, q, aliases);
    // 관련도 가중 (0.2~1.0)으로 보수화
    const w = Math.max(0.2, Math.min(1, a.relevance || 0));
    const s = ts.score * (0.6 + 0.4 * w);
    a.sentiment = s > 0.15 ? 'pos' : s < -0.15 ? 'neg' : 'neu';
    a.sentimentScore = Number(s.toFixed(3));
  }

  // 관련도 필터(느슨): relevance ≥ 0.2 또는 제목에 q 포함
  articles = articles
    .filter((a) => a.relevance >= 0.2 || a.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // 상위 60개 제한
  articles = articles.slice(0, 60);

  const agg = aggregate(articles, days);
  const result: Result = { articles, agg, meta: { aliases } };
  setCache(cacheKey, result);

  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }
  });
};