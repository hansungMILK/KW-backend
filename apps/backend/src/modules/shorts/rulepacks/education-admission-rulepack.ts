import type { ShortsRulepack } from './base-shorts-rulepack';

export const EDUCATION_ADMISSION_RULEPACK: ShortsRulepack = {
    id: 'education-admission',
    label: '입시정보 쇼츠',
    triggerKeywords: [
        '입시',
        '대입',
        '수능',
        '정시',
        '수시',
        '학생부',
        '학종',
        '내신',
        '논술',
        '대학',
        '모집요강',
        '입학처',
    ],
    sourcePolicy: `Primary official sources: Ministry of Education (moe.go.kr), ADIGA/대입정보포털 (adiga.kr), KICE/한국교육과정평가원 (kice.re.kr), KCUE/한국대학교육협의회 (kcue.or.kr), and official university admission pages. News and blogs are secondary context only.`,
    searchPrompt: `Admission source policy:
- Prefer official sources in this order: moe.go.kr, adiga.kr, kice.re.kr, kcue.or.kr, official university admission pages.
- News/blog/community sources may be used only as secondary context.
- For each source, include title, url, source, publishedAt when available, sourceType, confidence, and summary.
- Deadlines, admission type names, scores, ratios, and official schedule claims require an official source.
- If an exact official source is unavailable, say the claim needs verification.`,
    contentPrompt: `Admission content rules:
- Audience: Korean students and parents.
- Tone: fast, practical, clear, not fearmongering.
- Mark claims as 확정, 예상, or 확인 필요 when relevant.
- Never say 무조건, 100%, 합격 보장, or similar certainty.
- Each scene must include sourceRefs pointing to the source ids or source names used for that scene.
- Use short captions similar to viral Korean educational Shorts, but keep factual claims grounded.`,
    imagePrompt: `Admission visual rules:
- Use Korean school, classroom, calendar, score report, counseling, application checklist, university campus, and graph metaphors.
- Korean title/caption inside GPT-image-2 frames is allowed, but keep it short.
- Do not put detailed deadlines, exact scores, long tables, or URL text inside the image.
- If using a source label, keep it short like "기준: 대입정보포털".`,
    analysisPrompt: `Admission fact-check rules:
- Flag definitive dates, scores, ratios, admission schedules, or official policy claims without official sourceRefs.
- Flag fearmongering or guaranteed-outcome phrasing.
- Flag captions or visualText that are too long to render reliably inside a Shorts image.
- Official-source backed claims can pass; secondary-only claims should be softened.`,
};
