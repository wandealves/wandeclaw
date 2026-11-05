import { Logger } from '../utils/Logger.js';

const POSTS_URL = 'https://api.linkedin.com/rest/posts';
const DEFAULT_TIMEOUT_MS = 30_000;
/** Hashtag (mantida como está) ou caractere reservado do formato `little`. */
const LITTLE_TOKEN = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}]+|[|{}@[\]()<>#\\*_~]/gu;

export interface LinkedInCredentials {
  accessToken: string;
  personUrn: string;
  apiVersion: string;
}

/**
 * `rejected`: o LinkedIn recusou (4xx), nada foi publicado e pode tentar de novo.
 * `ambiguous`: timeout, rede ou 5xx; o post pode ter saído, então não se repete sozinho.
 */
export class LinkedInPublishError extends Error {
  constructor(
    message: string,
    readonly kind: 'rejected' | 'ambiguous',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LinkedInPublishError';
  }
}

const logger = new Logger('LinkedIn');

/**
 * Publica posts de texto no perfil do usuário pela Posts API.
 */
export class LinkedInClient {
  constructor(
    private readonly credentials: LinkedInCredentials,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Retorna o link do post, ou `null` se o LinkedIn não informar o identificador. */
  async publish(text: string): Promise<string | null> {
    let response: Response;
    try {
      response = await this.fetchFn(POSTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credentials.accessToken}`,
          'Content-Type': 'application/json',
          'Linkedin-Version': this.credentials.apiVersion,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author: this.credentials.personUrn,
          commentary: LinkedInClient.escapeCommentary(text),
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      logger.error('Sem resposta do LinkedIn', error);
      throw new LinkedInPublishError('Sem resposta do LinkedIn.', 'ambiguous');
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      logger.error(`LinkedIn respondeu ${response.status}: ${detail}`);
      const kind = response.status >= 500 ? 'ambiguous' : 'rejected';
      throw new LinkedInPublishError(`LinkedIn respondeu ${response.status}.`, kind, response.status);
    }

    const urn = response.headers.get('x-restli-id');
    return urn ? `https://www.linkedin.com/feed/update/${urn}/` : null;
  }

  /** O `commentary` usa o formato `little`: reservados sem escape podem cortar o texto publicado. */
  static escapeCommentary(text: string): string {
    return text.replace(LITTLE_TOKEN, (token) => (token.length > 1 ? token : `\\${token}`));
  }
}
