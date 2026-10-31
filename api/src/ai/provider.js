export function createProvider(config, fetchImpl = fetch) {
  return {
    name: config.provider,
    async complete({ system, user }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
      const payload = { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: config.maxOutputTokens, temperature: 0.2 };
      try {
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
          response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
          if (![429,502,503].includes(response.status) || attempt) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        if (!response.ok) throw new Error(response.status === 429 ? 'provider_rate_limited' : response.status >= 500 ? 'provider_unavailable' : 'provider_rejected');
        const raw = await response.text();
        if (raw.length > 200000) throw new Error('provider_response_too_large');
        let data; try { data = JSON.parse(raw); } catch { throw new Error('provider_invalid_response'); }
        const answer = data?.choices?.[0]?.message?.content;
        if (typeof answer !== 'string' || !answer.trim()) throw new Error('provider_invalid_response');
        return { answer: answer.slice(0, 12000), inputTokens: Number.isInteger(data.usage?.prompt_tokens) ? data.usage.prompt_tokens : null, outputTokens: Number.isInteger(data.usage?.completion_tokens) ? data.usage.completion_tokens : null };
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('provider_timeout');
        if (['provider_rate_limited','provider_unavailable','provider_rejected','provider_response_too_large','provider_invalid_response'].includes(error.message)) throw error;
        throw new Error('provider_network_error');
      } finally { clearTimeout(timer); }
    }
  };
}
