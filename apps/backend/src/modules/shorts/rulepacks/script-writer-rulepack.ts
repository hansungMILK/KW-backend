export const SCRIPT_WRITER_RULES = `Script Writer Rules:
- Write spoken Korean for TTS, not blog prose.
- Open with a 0-3 second hook using pain, surprise, contrast, question, or consequence.
- The script must answer one strong question or deliver one clear payoff.
- Each scene narration should carry exactly one information value.
- Use short direct sentences. Avoid filler like "좋습니다", "유용합니다", or generic praise.
- Use a Korean Shorts documentary cadence: compressed facts, quick contrast, and occasional natural reactions, but do not fake certainty.
- The lower video subtitle is generated from narration, so narration must be readable as on-screen subtitle text.
- Keep each scene narration short enough to fit 1-3 lower subtitle lines.
- Separate facts, assumptions, opinions, and jokes with scene claimType.
- Use claimType as one of: fact, hypothetical, opinion, joke.
- Factual scenes must include sourceRefs when source material exists.
- Keep the CTA short, natural, and tied to the viewer's next action.`;

export const SCRIPT_OUTPUT_RULES = `Script Output Contract:
- Top-level script.hook is the first 0-3 second spoken beat.
- Top-level script.angle states the video's point of view in one Korean sentence.
- Top-level script.cta is the final action line.
- Also keep top-level hook and cta for backward compatibility with existing blocks.`;
