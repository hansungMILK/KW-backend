import { beforeEach, describe, expect, it, vi } from 'vitest';

import { searchBlock } from './search-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiSearchModel: 'gpt-test-search',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        webSearchJson: vi.fn(async () => ({
            content: JSON.stringify({
                keywords: ['KTX'],
                articles: [
                    {
                        title: 'KTX 최신 이슈',
                        url: 'https://example.com/ktx',
                        source: 'Example',
                        sourceType: 'news',
                        confidence: 0.8,
                        summary: 'KTX 검색 결과',
                    },
                ],
                trendScore: 70,
            }),
            model: 'gpt-test-search',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        })),
    },
}));

const html = String.raw`<!doctype html>
<html lang="ko">
  <head>
    <meta property="og:title" content="마누스(Manus) AI Pro 연간 32,000원 (96% 할인) 특가 안내" />
    <meta property="article:published_time" content="2026-05-11T09:27:13+09:00" />
  </head>
  <body>
    <article>
      <h1>마누스(Manus) AI Pro 파격 특가!</h1>
      <p>기존 월 65,000원 수준의 Pro 요금제를 96% 할인된 연 32,000원에 구독했습니다.</p>
      <p>마누스는 단순 챗봇이 아니라 목표 달성을 위해 스스로 계획하고 실행하는 에이전틱 AI입니다.</p>
    </article>
  </body>
</html>`;

describe('searchBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }))
        );
    });

    it('uses a user-provided URL as the primary source instead of web search', async () => {
        const result = await searchBlock.execute({
            query: '쇼츠 만들어줘. https://tikongs.tistory.com/1463',
        });

        expect(openaiAdapter.webSearchJson).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledWith(
            'https://tikongs.tistory.com/1463',
            expect.objectContaining({ headers: expect.any(Object) })
        );
        expect(result.output).toMatchObject({
            collectionMode: 'url',
            primaryUrl: 'https://tikongs.tistory.com/1463',
            articles: [
                expect.objectContaining({
                    url: 'https://tikongs.tistory.com/1463',
                    primarySource: true,
                    sourcePriority: 1,
                    fullText: expect.stringContaining('96% 할인된 연 32,000원'),
                    keyClaims: expect.arrayContaining([expect.stringContaining('96% 할인된 연 32,000원')]),
                }),
            ],
        });
    });

    it('uses every user-provided URL as ordered primary sources', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                const body = url.includes('news.hada.io')
                    ? String.raw`<html><head><title>하네스 엔지니어링 우로보로스</title></head><body><article><p>우로보로스는 국산 하네스 엔지니어링 프로젝트로 소개되었습니다.</p><p>기술 설명과 공개 반응이 함께 정리되어 있습니다.</p></article></body></html>`
                    : String.raw`<html><head><title>국산 하네스 엔지니어링</title></head><body><article><p>국산 하네스 엔지니어링 사례를 설명합니다.</p><p>우로보로스 프로젝트의 배경과 특징을 다룹니다.</p></article></body></html>`;
                return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
            })
        );

        const result = await searchBlock.execute({
            query: '국산 하네스 엔지니어링, 우로보로스에 대하여 https://myip.co.kr/board/read.php?id=2070&table=tip&category1=etc&category2=etc https://news.hada.io/topic?id=27344',
        });

        expect(openaiAdapter.webSearchJson).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(result.output).toMatchObject({
            collectionMode: 'url',
            primaryUrl: 'https://myip.co.kr/board/read.php?id=2070&table=tip&category1=etc&category2=etc',
            articles: [
                expect.objectContaining({
                    url: 'https://myip.co.kr/board/read.php?id=2070&table=tip&category1=etc&category2=etc',
                    primarySource: true,
                    sourcePriority: 1,
                    fullText: expect.stringContaining('국산 하네스 엔지니어링'),
                }),
                expect.objectContaining({
                    url: 'https://news.hada.io/topic?id=27344',
                    primarySource: true,
                    sourcePriority: 2,
                    fullText: expect.stringContaining('우로보로스'),
                }),
            ],
        });
    });

    it('prefers article body regions over navigation and recommendation text', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        String.raw`<html><head><meta property="og:title" content="모수 와인 논란" /></head><body>
                          <nav>오피니언 정치 경제 스포츠 추천 기사</nav>
                          <article>
                            <h1>모수 와인 논란</h1>
                            <div class="article_body fs3" id="article_body" itemprop="articleBody">
                              <p>안성재 셰프가 모수 서울의 와인 빈티지 바꿔치기 논란에 사과했습니다.</p>
                              <p>고객은 2000년 빈티지를 주문했지만 2005년 빈티지를 받았다고 주장했습니다.</p>
                              <p>소믈리에는 실수를 알고도 즉시 알리지 않았고, 이후 직무에서 배제됐습니다.</p>
                            </div>
                            <aside>추천 기사와 광고 영역입니다.</aside>
                          </article>
                        </body></html>`,
                        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
                    )
            )
        );

        const result = await searchBlock.execute({
            query: '모수 논란 https://www.joongang.co.kr/article/25426209',
        });

        const article = (result.output['articles'] as Array<Record<string, unknown>>)[0];
        expect(article['fullText']).toContain('안성재 셰프가 모수 서울의 와인 빈티지 바꿔치기 논란에 사과했습니다');
        expect(article['fullText']).toContain('2000년 빈티지');
        expect(article['fullText']).not.toContain('오피니언 정치 경제');
        expect(article['fullText']).not.toContain('추천 기사와 광고');
        expect(article['keyClaims']).toEqual(expect.arrayContaining([expect.stringContaining('2000년 빈티지')]));
    });

    it('keeps web search for broad topics without a URL', async () => {
        const result = await searchBlock.execute({ query: 'KTX 예매가 어려워진 이유' });

        expect(openaiAdapter.webSearchJson).toHaveBeenCalledTimes(1);
        expect(result.output).toMatchObject({
            collectionMode: 'web_search',
            articles: [expect.objectContaining({ title: 'KTX 최신 이슈' })],
        });
    });
});
