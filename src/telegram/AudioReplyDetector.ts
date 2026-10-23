/** Pedidos explícitos de resposta falada (texto já sem acentos e em minúsculas). */
const REQUESTS = [
  /\b(responda|responde|respondes|fala|fale|manda|mande|envia|envie|grava|grave)\b.{0,40}\b(em|por|com|num|via)\s+(audio|voz)\b/,
  /\bfale comigo\b/,
  /\bfala comigo\b/,
  /\bmensagem de voz\b/,
  /\bresposta (em|por) (audio|voz)\b/,
];

/** "sem áudio", "não precisa de voz", "nunca em áudio"... */
const NEGATION = /\b(sem|nao|nunca)\b.{0,30}\b(audio|voz)\b/;

/**
 * Detecta no texto do usuário um pedido explícito de resposta em áudio (RF-06).
 * Na dúvida (ex.: há negação), não pede áudio (EC-07).
 */
export class AudioReplyDetector {
  static detect(text: string | undefined): boolean {
    const normalized = AudioReplyDetector.normalize(text);
    if (!normalized || NEGATION.test(normalized)) return false;
    return REQUESTS.some((pattern) => pattern.test(normalized));
  }

  /** O usuário recusou explicitamente a resposta em áudio. */
  static declined(text: string | undefined): boolean {
    return NEGATION.test(AudioReplyDetector.normalize(text));
  }

  private static normalize(text: string | undefined): string {
    return (text ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }
}
