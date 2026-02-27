/**
 * Vercel Serverless Function: proxy to OpenRouter API.
 * Key is read from process.env.OPENROUTER_API_KEY (set in Vercel Dashboard or .env.local).
 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(request) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: 'missing_api_key', message: 'OPENROUTER_API_KEY is not configured.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return new Response(
            JSON.stringify({ error: 'invalid_body', message: 'Request body must be valid JSON.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'X-Title': 'SoulGo Travel Diary AIGC'
        },
        body: JSON.stringify(body)
    });

    const text = await res.text();
    return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
    });
}
