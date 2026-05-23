import type { ShortsRulepack } from './base-shorts-rulepack';

export const COUNTRYBALL_SHORTS_RULEPACK: ShortsRulepack = {
    id: 'countryball-shorts',
    label: '컨트리볼 상황극 쇼츠',
    triggerKeywords: [
        '컨트리볼',
        'countryball',
        'polandball',
        '폴란드볼',
        '국가볼',
        '국가 의인화',
        'shorts.countryball.v1',
    ],
    sourcePolicy: `Countryball source policy:
- Countryball mode is driven by the user's requested situation. It may be factual, fictional, hypothetical, satirical, or metaphorical.
- Do not require external sources for fictional or hypothetical reenactments.
- If a scene makes a specific factual claim about a real event, date, number, policy, person, or institution, put that claim in factualClaim and include sourceRefs or evidenceRefs.
- Never present a dramatizedAction as factual evidence. Separate the reenactment from the factual claim.`,
    searchPrompt: `Countryball search policy:
- If the user asks for a real historical/current event, collect concise sources for the factual spine.
- If the request is fictional/hypothetical or the user only asks for a countryball format, return minimal context and do not invent factual citations.
- Preserve user-requested countries, sides, roles, and situation labels.`,
    contentPrompt: `Countryball situation reenactment content rules:
- This mode is not just dialogue. It is a short situation skit where countryball characters reenact the user's requested situation.
- Preserve the user's requested situation even when it is fictional or hypothetical.
- Structure each scene as a reenactment beat: setup, tension, action, reaction, twist, consequence, or takeaway.
- Use countryball characters as roles in the skit. Dialogue is allowed, but every line must serve the situation being reenacted.
- Required extra scene fields:
  - characters: [{ countryCode, roleInScene, expression, pose }]
  - dramatizedAction: the skit action happening in this scene
  - dialogueLines: [{ speaker, text, emotion, captionStyle, durationSec }]
  - factualClaim: only when the scene states a real-world fact
  - evidenceRefs: source ids only when factualClaim is present
- dialogueLines must be short skit lines, not exposition. Use max 2 dialogue lines per scene.
- speaker must identify the countryball character or role, such as "한국볼", "일본볼", "KR", or "JP"; do not use narrator as speaker.
- Every scene still needs dramatizedAction. Dialogue cannot replace the drawable action beat.
- Use claimType "hypothetical", "opinion", or "joke" for fictional/satirical/user-imagined situations without factual claims.
- Keep imagePrompt focused on the reenacted action, countryball cast, expressions, props, and background. Do not write generic explainer visuals.`,
    imagePrompt: `Countryball visual rules:
- Render round flag-faced countryball characters with expressive eyes, simple arms, and clear emotional poses.
- The image should show the reenacted situation, not only two balls talking.
- Use props, maps, documents, uniforms, tables, artifacts, or scene backgrounds that make the requested situation readable.
- Avoid hateful stereotypes, ethnic caricatures, slurs, or making an entire nationality look subhuman or inferior.
- Keep text overlays short; final title and subtitles still belong to the compositor.`,
    analysisPrompt: `Countryball quality rules:
- Check that each scene reenacts the requested situation through countryball characters.
- Check that factualClaim/evidenceRefs are separated from dramatizedAction/dialogueLines.
- Check that dialogueLines use speaker/text objects, stay under 2 lines per scene, and remain short enough for Shorts pacing.
- Reject scenes that are only dialogue without a concrete dramatizedAction.
- Reject slurs, dehumanizing language, and claims that a whole country, people, ethnicity, or nationality is inherently inferior, dirty, stupid, criminal, or evil.
- Do not reject fictional/hypothetical countryball skits just because sourceRefs are empty.
- Reject unsupported factual claims only when the scene actually claims a real-world fact.`,
};
