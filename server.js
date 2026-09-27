require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

/* ========================= FIREBASE ========================= */
// Download this file from: Firebase console → Project settings →
// Service accounts → Generate new private key. Place it next to server.js.
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

/* ========================= TELEGRAM BOT ========================= */
const BOT_TOKEN = process.env.TG_BOT_TOKEN;
if (!BOT_TOKEN) { console.error('TG_BOT_TOKEN is missing in .env'); process.exit(1); }
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Normalizes any phone input to the app's format: +992XXXXXXXXX
function normalizePhone(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00992')) d = d.slice(2);
  else if (d.startsWith('8992')) d = d.slice(1);
  if (!d.startsWith('992')) d = '992' + d.replace(/^0+/, '');
  return '+' + d;
}

async function linkPhoneToChat(phone, msg) {
  await db.collection('telegramLinks').doc(phone).set({
    chatId: msg.chat.id,
    telegramUserId: msg.from.id,
    telegramUsername: msg.from.username || null,
    firstName: msg.from.first_name || null,
    linkedAt: Date.now(),
  });
}

// /start — greet and ask the user to share their phone number
bot.onText(/\/start/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    'Добро пожаловать в OK-Mobile Бухгалтерия! 👋\n\n' +
    'Чтобы получать коды подтверждения прямо сюда, поделитесь своим номером телефона кнопкой ниже.',
    {
      reply_markup: {
        keyboard: [[{ text: '📱 Поделиться номером телефона', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
});

// User tapped "share phone number"
bot.on('contact', async (msg) => {
  const contact = msg.contact;
  if (contact.user_id && msg.from && contact.user_id !== msg.from.id) {
    await bot.sendMessage(msg.chat.id, 'Пожалуйста, отправьте свой собственный номер телефона, а не чужой контакт.');
    return;
  }
  const phone = normalizePhone(contact.phone_number);
  await linkPhoneToChat(phone, msg);
  await bot.sendMessage(msg.chat.id,
    `✅ Готово! Номер ${phone} привязан к вашему Telegram.\n\n` +
    'Вернитесь в приложение OK-Mobile и нажмите «Продолжить» — код придёт прямо сюда.',
    { reply_markup: { remove_keyboard: true } }
  );
});

// Fallback: user typed the phone number manually instead of sharing contact
bot.on('message', async (msg) => {
  if (msg.contact || (msg.text && msg.text.startsWith('/start'))) return;
  const text = (msg.text || '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length <= 12) {
    const phone = normalizePhone(text);
    await linkPhoneToChat(phone, msg);
    await bot.sendMessage(msg.chat.id, `✅ Номер ${phone} привязан к вашему Telegram. Возвращайтесь в приложение и нажмите «Продолжить».`);
  }
});

bot.on('polling_error', (err) => console.error('Telegram polling error:', err.message));

/* ========================= HTTP API for the app ========================= */
const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.BACKEND_API_KEY;
function checkKey(req, res, next) {
  if (!API_KEY || req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Frontend polls this right after opening the bot, to know when to unlock the code field.
app.get('/api/link-status', checkKey, async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const doc = await db.collection('telegramLinks').doc(phone).get();
  res.json({ linked: doc.exists });
});

// Sends a verification code to the Telegram chat linked to this phone.
// purpose: "register" | "reset"
app.post('/api/send-code', checkKey, async (req, res) => {
  const { phone, code, fio, purpose } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });
  const doc = await db.collection('telegramLinks').doc(phone).get();
  if (!doc.exists) return res.json({ linked: false });
  const text = purpose === 'reset'
    ? `🔐 Код для сброса пароля OK-Mobile: <b>${code}</b>\nЕсли вы не запрашивали сброс — проигнорируйте сообщение.`
    : `🆕 Код подтверждения OK-Mobile${fio ? ' для ' + fio : ''}: <b>${code}</b>`;
  await bot.sendMessage(doc.data().chatId, text, { parse_mode: 'HTML' });
  res.json({ linked: true, sent: true });
});

// Generic notification to a specific user (e.g. "sale confirmed", "low stock", etc.)
app.post('/api/notify', checkKey, async (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error: 'phone and text required' });
  const doc = await db.collection('telegramLinks').doc(phone).get();
  if (!doc.exists) return res.json({ linked: false });
  await bot.sendMessage(doc.data().chatId, text, { parse_mode: 'HTML' });
  res.json({ sent: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OK-Mobile bot backend running on port ${PORT}`));
