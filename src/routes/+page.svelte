<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";

  // --- UI 상태 ---
  let q = '';                      // 기본 키워드
  let days: 1|3|7|14 = 1;                // 기간
  let lang: 'kr'|'en' = 'kr';            // 언어
  let provider: 'auto'|'news' = 'auto';  // (선택) NewsAPI만 테스트 시 'news' 사용. 서버에서 ?provider=news 대응 가능하면 활용

  let loading = false;
  let error = '';
  let data: {
    articles: {
      id: string; title: string; url: string; source: string;
      publishedAt: string; lang: 'kr'|'en'; summary: string;
      sentiment: 'pos'|'neg'|'neu'; sentimentScore: number;
      keywords: string[]; relevance: number;
    }[];
    agg: {
      count: number; posRatio: number; negRatio: number;
      topKeywords: { word: string; count: number }[];
      timeline: { t: string; count: number; avgSent: number }[];
    };
    meta?: { aliases?: string[] };
  } | null = null;

  let hasSearched = false;

  const presets = [
    { label: 'USDKRW', value: 'USDKRW' },
    { label: '005930 (삼성전자)', value: '005930' },
    { label: 'AAPL', value: 'AAPL' },
    { label: '환율', value: '환율' }
  ];

  async function runSearch() {
    // 빈 검색어면 하단 영역을 표시하지 않음
    if (!q.trim()) {
      hasSearched = false;
      error = '';
      data = null;
      loading = false;
      return;
    }
    hasSearched = true;
    loading = true; error = '';
    try {
      const params = new URLSearchParams({
        q, days: String(days), lang
      });
      if (provider === 'news') params.set('provider', 'news'); // 옵션 B를 쓰는 경우만 적용
      const res = await fetch(`/api/news?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        error = json?.error || '불러오기에 실패했습니다.';
        data = null;
      } else {
        data = json;
      }
    } catch (e) {
      error = '네트워크 오류가 발생했습니다.';
      data = null;
    } finally {
      loading = false;
    }
  }

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    runSearch();
  }

  function sentimentBadgeClass(s: 'pos'|'neg'|'neu') {
    if (s === 'pos') return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    if (s === 'neg') return 'bg-rose-100 text-rose-700 border border-rose-200';
    return 'bg-slate-100 text-slate-700 border border-slate-200';
  }

  onMount(() => {
    // 초기 로드 시 자동 검색하지 않음
    // 필요하면 q가 미리 채워진 경우에만 자동 검색:
    // if (q.trim()) runSearch();
  });
</script>

<!-- 컨테이너 -->
<div class="mx-auto max-w-5xl p-4 md:p-6 space-y-6">

  <!-- 상단 헤더 -->
  <header class="flex items-center justify-between">
    <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">NEEEEEWS</h1>
    <div class="text-xs text-slate-500">
      <span class="hidden md:inline">v0.1 · </span>실험용 · 투자조언 아님
    </div>
  </header>

  <!-- ChatGPT 스타일 입력박스 + 옵션바 -->
  <section class="space-y-3">
    <form class="rounded-2xl border border-slate-200 shadow-sm">
      <div class="flex items-start gap-3 p-3 md:p-4">
        <!-- 키워드 입력 -->
        <div class="flex-1">
          <input
            class="w-full bg-transparent outline-none text-base md:text-lg placeholder:text-slate-400"
            type="text"
            bind:value={q}
            placeholder="무엇을 보고 싶나요? (예: USDKRW, 005930, AAPL, 환율…)"
            on:keydown={(e: KeyboardEvent) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runSearch();
              }
            }}
          />
        </div>
        <!-- 실행 버튼 -->
        <button
          class="shrink-0 rounded-xl px-4 py-2 bg-black text-white text-sm md:text-base hover:opacity-90 active:opacity-80 transition"
          type="button"
          on:click={runSearch}
          aria-label="검색"
        >
          검색
        </button>
      </div>

      <!-- 옵션 바 -->
      <div class="border-t border-slate-200 px-3 md:px-4 py-2.5 flex flex-wrap gap-2 items-center">
        <!-- 기간 -->
        <div class="flex items-center gap-1 text-sm">
          <span class="text-slate-500">기간</span>
          <div class="flex gap-1">
            {#each [1,3,7,14] as d}
              <button
                class={"px-2.5 py-1 rounded-lg border text-xs " + (days===d ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
                type="button"
                on:click={() => days = d as 1|3|7|14}
              >{d === 1 ? '오늘' : `${d}일`}</button>
            {/each}
          </div>
        </div>

        <!-- 언어 -->
        <div class="flex items-center gap-1 text-sm">
          <span class="text-slate-500">언어</span>
          <div class="flex gap-1">
            <button
              class={"px-2.5 py-1 rounded-lg border text-xs " + (lang==='kr' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
              type="button" on:click={() => lang='kr'}>KR</button>
            <button
              class={"px-2.5 py-1 rounded-lg border text-xs " + (lang==='en' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
              type="button" on:click={() => lang='en'}>EN</button>
          </div>
        </div>

        <!-- (선택) 프로바이더 -->
        <div class="flex items-center gap-1 text-sm">
          <span class="text-slate-500">소스</span>
          <div class="flex gap-1">
            <button
              class={"px-2.5 py-1 rounded-lg border text-xs " + (provider==='auto' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
              type="button" on:click={() => provider='auto'}>AUTO</button>
            <button
              class={"px-2.5 py-1 rounded-lg border text-xs " + (provider==='news' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
              type="button" on:click={() => provider='news'}>NewsAPI</button>
          </div>
        </div>

        <!-- 프리셋 -->
        <!-- <div class="ml-auto flex flex-wrap gap-1">
          {#each presets as p}
            <button
              class="px-2.5 py-1 rounded-lg border text-xs border-slate-200 text-slate-700 hover:bg-slate-50"
              type="button"
              title="프리셋 적용"
              on:click={() => { q = p.value; runSearch(); }}
            >{p.label}</button>
          {/each}
        </div> -->
      </div>
    </form>

    <!-- 힌트 -->
    <p class="text-xs text-slate-500">
      ⌨️ <span class="font-medium">Enter</span>로 검색, <span class="font-medium">Shift+Enter</span>는 줄바꿈.  |  예: <code class="bg-slate-100 rounded px-1">USDKRW</code>,
      <code class="bg-slate-100 rounded px-1">005930</code>, <code class="bg-slate-100 rounded px-1">AAPL</code>
    </p>
  </section>

  <!-- 요약 위젯 -->
  {#if hasSearched && data}
    <section class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="rounded-xl border border-slate-200 p-4">
        <div class="text-sm text-slate-500">기사 수</div>
        <div class="text-2xl font-semibold">{data.agg.count}</div>
      </div>
      <div class="rounded-xl border border-slate-200 p-4">
        <div class="text-sm text-slate-500">감성 비율</div>
        <div class="mt-2 space-y-2">
          <div>
            <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>긍정</span>
              <span>{Math.round((data.agg.posRatio || 0) * 100)}%</span>
            </div>
            <div class="h-2 rounded bg-slate-100 overflow-hidden">
              <div class="h-full bg-emerald-500" style={`width:${Math.round((data.agg.posRatio||0)*100)}%`}></div>
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>부정</span>
              <span>{Math.round((data.agg.negRatio || 0) * 100)}%</span>
            </div>
            <div class="h-2 rounded bg-slate-100 overflow-hidden">
              <div class="h-full bg-rose-500" style={`width:${Math.round((data.agg.negRatio||0)*100)}%`}></div>
            </div>
          </div>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 p-4">
        <div class="text-sm text-slate-500">TOP 키워드</div>
        <div class="mt-1 flex flex-wrap gap-1">
          {#if data.agg.topKeywords?.length}
            {#each data.agg.topKeywords.slice(0,8) as k}
              <span class="text-xs rounded-lg border border-slate-200 px-2 py-0.5 text-slate-700">#{k.word}</span>
            {/each}
          {:else}
            <span class="text-xs text-slate-400">없음</span>
          {/if}
        </div>
      </div>
    </section>
  {/if}

  <!-- 로딩 / 에러 / 빈 상태 -->
  {#if hasSearched}
    {#if loading}
      <section class="space-y-3">
        {#each Array(4) as _}
          <div class="rounded-xl border border-slate-200 p-4 animate-pulse">
            <div class="h-5 w-2/3 bg-slate-200 rounded mb-2"></div>
            <div class="h-4 w-1/3 bg-slate-200 rounded mb-3"></div>
            <div class="h-4 w-full bg-slate-200 rounded mb-1"></div>
            <div class="h-4 w-4/5 bg-slate-200 rounded"></div>
          </div>
        {/each}
      </section>
    {:else if error}
      <section class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
        {error}
      </section>
    {:else if data && data.articles.length === 0}
      <section class="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        새 기사가 없거나 검색 범위가 좁아요. 기간/언어/키워드를 바꿔보세요.
      </section>
    {/if}
  {/if}

  <!-- 카드 리스트 -->
  {#if hasSearched && data && data.articles.length}
    <section class="grid grid-cols-1 gap-3">
      {#each data.articles as a}
        <article class="rounded-2xl border border-slate-200 p-4 hover:shadow-sm transition">
          <a href={a.url} target="_blank" rel="noreferrer" class="block">
            <h3 class="text-lg md:text-xl font-semibold leading-snug hover:underline">{a.title}</h3>
          </a>
          <div class="mt-1 text-xs text-slate-500">
            {a.source} · {new Date(a.publishedAt).toLocaleString()}
          </div>
          <!-- 요약 -->
          {#if a.summary}
            <p class="mt-3 text-sm text-slate-800 leading-relaxed">{a.summary}</p>
          {/if}

          <!-- 메타: 감성/키워드 -->
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class={`text-[11px] px-2 py-0.5 rounded-md ${sentimentBadgeClass(a.sentiment)}`}>
              {a.sentiment.toUpperCase()} {a.sentimentScore?.toFixed(2)}
            </span>
            <span class="text-[11px] px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">
              Rel {a.relevance?.toFixed(2)}
            </span>
            {#each (a.keywords || []).slice(0,5) as k}
              <span class="text-[11px] px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">#{k}</span>
            {/each}
          </div>
        </article>
      {/each}
    </section>
  {/if}
</div>

<style>
  /* 모바일에서 입력 포커스시 깜빡임 줄이기 */
  input::-webkit-search-cancel-button { -webkit-appearance: none; }
</style>