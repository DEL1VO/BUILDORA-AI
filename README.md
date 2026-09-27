# OK-Mobile — бекенд Telegram-бота

Раньше приложение слало сообщения в Telegram напрямую из браузера с токеном бота в открытом виде, и код подтверждения всегда уходил в один и тот же чат администратора — бот физически не мог понять, какой пользователь регистрируется. Этот сервер решает обе проблемы:

- токен бота больше не лежит в клиентском коде;
- каждый пользователь один раз нажимает `/start` и делится номером телефона в Telegram → сервер запоминает `номер → chat_id`;
- дальше коды подтверждения уходят точно в чат этого пользователя, а не администратору.

## Что внутри

- `server.js` — сам бот (слушает `/start` и номер телефона) + HTTP API для приложения.
- `package.json` — зависимости.
- `.env.example` — пример переменных окружения.

## Установка

```bash
cd okmobile-bot-backend
npm install
cp .env.example .env
```

1. Откройте `.env` и задайте `BACKEND_API_KEY` — длинный случайный секрет (например `openssl rand -hex 32`).
2. Скачайте ключ сервисного аккаунта Firebase: **Firebase Console → ⚙️ Настройки проекта → Service accounts → Generate new private key**. Сохраните файл как `serviceAccountKey.json` рядом с `server.js` (этот файл никогда не должен попасть в публичный репозиторий).
3. Запуск:

```bash
npm start
```

Сервер поднимет long-polling бота и HTTP API на порту из `.env` (по умолчанию 3000).

## Куда деплоить

Боту нужен постоянно работающий процесс (long polling), поэтому обычные serverless-функции (Vercel, Netlify Functions) не подойдут напрямую. Подходят:

- **Railway / Render / Fly.io** — просто подключить репозиторий, задать переменные окружения и `serviceAccountKey.json` как секретный файл;
- обычный **VPS** с `pm2 start server.js` для автоперезапуска;
- как альтернатива long polling — переключить бота на **webhook** (Telegram сам стучится на ваш HTTPS-адрес), если хостинг серверлесс-совместимый — это отдельная небольшая правка в `server.js` (замена `polling: true` на `bot.setWebHook(...)` и роут `POST /bot<token>`).

## Как переключить приложение на этот бекенд

Сейчас `OK-Mobile.html` слал коды в Telegram напрямую с фронтенда. Чтобы использовать бекенд, замените в HTML-файле:

**Было** (прямой вызов Telegram API из браузера, токен виден всем):
```js
async function tgSend(text){
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {...});
}
```

**Станет** (вызов вашего бекенда, токен спрятан на сервере):
```js
const BACKEND_URL = "https://ваш-домен-бекенда.com";
const BACKEND_KEY = "тот же секрет, что в .env BACKEND_API_KEY";

async function sendCodeViaBackend(phone, code, fio, purpose){
  const r = await fetch(`${BACKEND_URL}/api/send-code`, {
    method: "POST",
    headers: {"Content-Type":"application/json", "x-api-key": BACKEND_KEY},
    body: JSON.stringify({phone, code, fio, purpose})
  });
  return r.json(); // { linked: true/false, sent: true }
}
```

Логика на экране регистрации/сброса пароля: после того как пользователь нажал «Продолжить» и открылся бот, можно раз в 2 секунды опрашивать `GET /api/link-status?phone=...` (с тем же заголовком `x-api-key`), и как только `linked: true` — вызывать `sendCodeViaBackend`, показывая пользователю «Ждём подтверждения в Telegram…», пока это не произойдёт.

Готов внести эту правку прямо в `OK-Mobile.html` и опубликовать обновлённую версию — скажите, и я подключу бекенд к приложению.

## Безопасность

- `x-api-key` защищает API от случайных посторонних запросов, но так как вызов идёт из браузера, ключ технически виден в сетевых запросах любому, кто откроет DevTools. Для полной защиты добавьте ограничение по домену (CORS whitelist уже настроен через `cors()`, сузьте `origin`) и/или rate-limiting (например, пакет `express-rate-limit`).
- Никогда не публикуйте `serviceAccountKey.json` и `.env` в открытый репозиторий — добавьте их в `.gitignore`.
