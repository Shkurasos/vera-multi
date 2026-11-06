/**
 * CAPTCHA-провайдер для защиты регистрации от автоматического создания аккаунтов.
 *
 * В режиме разработки используется MockCaptchaProvider — клик по кнопке
 * «Я не робот» выдаёт фейковый токен, который бэкенд уже принимает
 * (см. Server/server.js: проверка captchaToken.length >= 10).
 *
 * Для продакшена замените реализацию на реального провайдера:
 * hCaptcha, reCAPTCHA v2/v3 или Cloudflare Turnstile.
 * Секретный ключ провайдера хранится ТОЛЬКО на сервере (Server/.env),
 * nooit в клиентском коде.
 */

export interface CaptchaProvider {
  /** Вернуть Promise с токеном (или null, если пользователь отменил). */
  execute(): Promise<string | null>;
  /** Сбросить состояние виджета. */
  reset(): void;
}

/** ---------- МОК-ПРОВАЙДЕР (разработка) ---------- */
class MockCaptchaProvider implements CaptchaProvider {
  private widgetId = 0;

  async execute(): Promise<string | null> {
    // Имитируем задержку реального провайдера (человек жмёт кнопку ~1–2 сек).
    await new Promise((r) => setTimeout(r, 1200));
    this.widgetId += 1;
    return `mock-captcha-token-${Date.now()}-${this.widgetId}`;
  }

  reset(): void {
    //nothing
  }
}

/** ---------- РЕАЛЬНЫЙ ПРОВАЙДЕР (заглушка под hCaptcha/reCAPTCHA/Turnstile) ---------- */
/*
Пример подключения reCAPTCHA v2:

import { ReCaptchaV2Provider } from './captcha.recaptcha'; // вы создаёте этот файл сами
export const captchaProvider = new ReCaptchaV2Provider('VITE_RECAPTCHA_SITE_KEY');

Пример подключения Cloudflare Turnstile:
export const captchaProvider = new TurnstileProvider(import.meta.env.VITE_TURNSTILE_SITE_KEY);
*/

export const captchaProvider: CaptchaProvider = new MockCaptchaProvider();

/**
 * Проверить токен на сервере.
 * В продакшене сервер должен вызывать API провайдера (siteverify) со своим секретным ключом.
 * Сейчас сервер принимает любой непустой токен длиной >= 10 символов (заглушка для разработки).
 */
export async function verifyCaptchaToken(token: string): Promise<boolean> {
  if (!token || token.length < 10) return false;
  // Здесь в будущем можно добавить реальную проверку через /api/captcha/verify
  return true;
}
