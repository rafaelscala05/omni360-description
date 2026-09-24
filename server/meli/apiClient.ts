import { MELI_API_BASE } from './config';
import { getValidAccessToken } from './oauth';
import { retryDelayMs, sanitizeError } from './utils';
import { acquireMeliSlot, reportMeliResponse } from './rateLimit';
import { recordMeliApiCall } from './operations';

export class MeliApiClient {
  constructor(private readonly uid: string) {}

  async get<T>(path: string, options: { allowNotFound?: boolean } = {}): Promise<T | null> {
    return this.request<T>('GET', path, options);
  }

  private async request<T>(
    method: 'GET',
    path: string,
    options: { allowNotFound?: boolean },
    attempt = 0,
    refreshed = false,
  ): Promise<T | null> {
    const accessToken = await getValidAccessToken(this.uid, refreshed);
    const endpoint = path.split('?')[0];
    const releaseSeller = await acquireMeliSlot(this.uid);
    const releaseApplication = await acquireMeliSlot('__application__');
    const release = () => { releaseApplication(); releaseSeller(); };
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(`${MELI_API_BASE}${path}`, {
        method,
        headers: { accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      release();
      recordMeliApiCall(this.uid, endpoint, 0, Date.now() - startedAt, attempt > 0);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, null)));
        return this.request<T>(method, path, options, attempt + 1, refreshed);
      }
      throw new Error(`Falha de rede na API MELI: ${sanitizeError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
    release();
    const retryAfterMs = retryDelayMs(attempt, response.headers.get('retry-after'));
    reportMeliResponse(this.uid, response.status, response.status === 429 ? retryAfterMs : 0);
    reportMeliResponse('__application__', response.status, response.status === 429 ? retryAfterMs : 0);
    recordMeliApiCall(this.uid, endpoint, response.status, Date.now() - startedAt, attempt > 0);

    if ((response.status === 401 || response.status === 403) && !refreshed) {
      return this.request<T>(method, path, options, attempt, true);
    }
    if (response.status === 404 && options.allowNotFound) return null;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return this.request<T>(method, path, options, attempt + 1, refreshed);
    }

    const text = await response.text();
    const payload = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (response.status === 206) {
      console.warn('[meli] resposta parcial', {
        endpoint: path.split('?')[0],
        contentMissing: response.headers.get('x-content-missing') || null,
      });
    }
    if (!(response.ok || response.status === 206)) {
      const message = typeof payload === 'object' && payload
        ? (payload as any).message || (payload as any).error
        : null;
      throw Object.assign(new Error(message || `Mercado Livre respondeu ${response.status}`), {
        status: response.status,
        endpoint: path.split('?')[0],
      });
    }
    return payload as T;
  }
}
