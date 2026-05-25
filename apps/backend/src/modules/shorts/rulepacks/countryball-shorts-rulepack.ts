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
- Do not force a fixed plot pattern such as crisis -> reversal -> foreign shock. Choose the scene, countries, tension, and ending that fit the user's topic.
- Structure each scene as a skit beat with a clear purpose: setup, tension, action, reaction, twist, consequence, or takeaway.
- Do not write narrator-only explainer scenes. The default surface is countryball action plus fast character dialogue.
- Do not default to source-attribution prose such as "공식 지표에 따르면", "보도에 따르면", or "연구에 따르면". Countryball mode should show the requested idea through skit action unless the user explicitly asks for sourced reporting.
- Put the user's concrete requested nouns and situation labels into captions, dialogue, dramatizedAction, and imagePrompt so the skit does not drift into generic explanation.
- The fun comes from what countryballs do on screen: panicking, bragging, running, pointing, carrying props, getting shocked, lining up, throwing objects, ordering food, hiding, bargaining, or reacting.
- Use countryball characters as roles in the skit. Dialogue is allowed, but every line must serve the situation being reenacted.
- Follow the reference countryball Shorts final-frame grammar: persistent black top title band, middle information/evidence comic panel, and lower large countryball reaction stage.
- The video compositor owns the final title/subtitle overlays. Do not ask the image model to bake final-video title bands or lower subtitle bands into the artwork.
- The middle panel should carry the situation with documents, newspaper cards, charts, arrows, maps, factories, money bags, timelines, warning boards, reports, or scene-specific props.
- The lower stage should carry the fun with exaggerated countryball eyes, sweat, tears, smirk, panic, pointing, holding papers, or arguing.
- Include one short punchy Korean dialogue/reaction caption per scene when useful; it should feel like bold yellow text with black outline.
- Required extra scene fields:
  - scenePurpose: why this scene exists
  - location: the skit location
  - visualTone: comedy|serious|panic|awkward|satirical|historical|news-like|chaotic|calm
  - characters: [{ countryCode, roleInScene, expression, pose }]
  - screenAction: the visible skit action happening in this scene
  - dramatizedAction: the skit action happening in this scene
  - dialogueLines: [{ country, line, tone, voiceRole, captionEmphasis?, pauseAfterMs?, speaker, text, emotion, delivery, meaning, captionStyle, durationSec }]
  - expressionChanges: eye/face changes that sell the beat
  - sfx: short sound-effect labels
  - editBeat: cut/zoom/silence/BGM instruction
  - narratorLine: null by default; only title-like opening, time jump, or ending meta caption may use { text, voiceRole: "narrator_short" }
  - factualClaim: only when the scene states a real-world fact
  - evidenceRefs: source ids only when factualClaim is present
- dialogueLines must be short skit lines, not exposition. Most active scenes should use 2-4 fast lines; final/static/reaction cuts may use one line.
- Use role-based voiceRole values: main_tired, main_confident, rival_smug, rival_angry, neutral_serious, panic_high, old_teacher, narrator_short.
- speaker must identify the countryball character or role, such as "한국볼", "일본볼", "KR", or "JP"; do not use narrator as speaker.
- Every scene still needs dramatizedAction. Dialogue cannot replace the drawable action beat.
- Use claimType "hypothetical", "opinion", or "joke" for fictional/satirical/user-imagined situations without factual claims.
- Keep imagePrompt focused on the reenacted action, countryball cast, expressions, props, and background. Do not write generic explainer visuals.`,
    imagePrompt: `Countryball visual rules:
- Render round flag-faced countryball characters with expressive eyes, simple arms, and clear emotional poses.
- The image should show the reenacted situation, not only two balls talking.
- Match the reference central artwork layout: upper/middle information/evidence panel and lower foreground countryball reaction stage.
- Leave final black/yellow top title and yellow caption overlays to the compositor.
- Use dense visual proof props: documents, newspaper cards, charts, arrows, maps, factories, money bags, timelines, warning boards, reports, or scene-specific objects.
- Keep visual space for one short bold yellow Korean dialogue/reaction caption with black outline near the countryballs when the scene needs a punchline.
- Use props, maps, documents, uniforms, tables, artifacts, or scene backgrounds that make the requested situation readable.
- Avoid hateful stereotypes, ethnic caricatures, slurs, or making an entire nationality look subhuman or inferior.
- Keep text overlays short; final title and subtitles still belong to the compositor.`,
    analysisPrompt: `Countryball quality rules:
- Check that each scene reenacts the requested situation through countryball characters.
- Check that factualClaim/evidenceRefs are separated from dramatizedAction/dialogueLines.
- Do not request "공식 지표에 따르면", "보도에 따르면", citations, or source-attribution softening for user-requested countryball skits.
- Check that user-requested concrete nouns and situation labels appear in the skit action/dialogue/captions, not only in metadata.
- Check that dialogueLines use country/line plus speaker/text objects and remain short enough for Shorts pacing.
- Check that scenePurpose, visualTone, expressionChanges, sfx, and editBeat exist so the scene is not a plain explanation.
- Reject scenes that are only dialogue without a concrete dramatizedAction.
- Reject scripts that are mostly narrator-only explanation instead of action beats and countryball character dialogue.
- Reject slurs, dehumanizing language, and claims that a whole country, people, ethnicity, or nationality is inherently inferior, dirty, stupid, criminal, or evil.
- Do not reject fictional/hypothetical countryball skits just because sourceRefs are empty.
- Do not block countryball skits only because sourceRefs/evidenceRefs are empty.`,
};
