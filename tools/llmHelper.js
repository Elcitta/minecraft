/**
 * LLM Helper — Lightweight Groq API client for bot intelligence.
 * Used as a fallback when heuristic block selection fails.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';

/**
 * Ask the LLM a question and get a text response.
 * @param {string} systemPrompt - System-level instructions
 * @param {string} userPrompt   - The actual question/context
 * @returns {string|null} The LLM response text, or null on failure
 */
async function askLLM(systemPrompt, userPrompt) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.error('[LLMHelper] No GROQ_API_KEY set — skipping LLM fallback');
        return null;
    }

    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.1,
                max_tokens: 100,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[LLMHelper] API error ${response.status}: ${errText}`);
            return null;
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        console.error(`[LLMHelper] Response: ${text}`);
        return text || null;
    } catch (err) {
        console.error(`[LLMHelper] Request failed: ${err.message}`);
        return null;
    }
}

module.exports = { askLLM };
