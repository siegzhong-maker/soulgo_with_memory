/**
 * Vercel Serverless Function: generate structured travel memory summary + emotion.
 * Uses OpenRouter chat completions with a Mem0-style fact extraction prompt.
 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MEMORY_EXTRACTION_SYSTEM = `你是一个记忆抽取器，从宠物旅行日记中提取一条可检索的记忆摘要。
只输出 JSON：{"summary":"...","emotion":"..."}，不要其他文字。
summary 30～50 字，第一人称，描述宠物在该地的具体表现或感受；emotion 从 excited/tender/curious/nostalgic/calm 中选一。
只抽取具体行为/感受，可含当地特色；不抽取泛泛的模板句。`;

export async function POST(request) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: 'missing_api_key', message: 'OPENROUTER_API_KEY is not configured.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }

    let payload;
    try {
        payload = await request.json();
    } catch (e) {
        return new Response(
            JSON.stringify({ error: 'invalid_body', message: 'Request body must be valid JSON.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { diaryText, location, date, time_slot, personality, last_summary } = payload || {};

    if (!diaryText || !location || !date || !time_slot || !personality) {
        return new Response(
            JSON.stringify({
                error: 'missing_fields',
                message: 'diaryText, location, date, time_slot, personality are required.'
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const lines = [];
    lines.push(`日记：${diaryText}`);
    lines.push(`地点：${location} | 时间：${time_slot} | 性格：${personality}`);
    if (last_summary) {
        lines.push(`最近一次相关旅行记忆摘要：${last_summary}`);
    }
    lines.push('请抽取一条记忆。');
    const userContent = lines.join('\n');

    const model =
        process.env.OPENROUTER_MEMORY_MODEL ||
        process.env.OPENROUTER_MODEL_ID ||
        'google/gemini-2.0-flash-001';

    const body = {
        model,
        messages: [
            { role: 'system', content: MEMORY_EXTRACTION_SYSTEM },
            { role: 'user', content: userContent }
        ]
    };

    let upstream;
    try {
        upstream = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'X-Title': 'SoulGo Memory Summary'
            },
            body: JSON.stringify(body)
        });
    } catch (e) {
        return new Response(
            JSON.stringify({ error: 'network_error', message: e.message || String(e) }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const raw = await upstream.text();

    if (!upstream.ok) {
        return new Response(
            JSON.stringify({
                error: 'upstream_error',
                status: upstream.status,
                message: raw
            }),
            { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
        );
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        return new Response(
            JSON.stringify({ error: 'upstream_invalid_json', message: 'Failed to parse OpenRouter response.' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const content =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;

    if (!content || typeof content !== 'string') {
        return new Response(
            JSON.stringify({ error: 'empty_content', message: 'Model returned empty content.' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // 尝试从模型输出中提取 JSON（容错处理可能的前后说明文字）
    let jsonText = content.trim();
    try {
        const firstBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonText = jsonText.slice(firstBrace, lastBrace + 1);
        }
    } catch {
        // ignore and keep original
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (e) {
        return new Response(
            JSON.stringify({
                error: 'parse_error',
                message: 'Failed to parse model JSON output.',
                raw: content
            }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const summary = parsed && parsed.summary;
    const emotion = parsed && parsed.emotion;

    if (!summary || !emotion) {
        return new Response(
            JSON.stringify({
                error: 'missing_fields_in_model_output',
                message: 'Model output must contain summary and emotion.'
            }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
        JSON.stringify({ summary, emotion }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
}

