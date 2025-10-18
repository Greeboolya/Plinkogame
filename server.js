const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const app = express();
const port = 3000;
require("dotenv").config();

// Новый токен Telegram-бота для Stars-оплаты
const TELEGRAM_BOT_TOKEN = "8401593144:AAHIzxiGfGlZ2GQ8h8Y6y-W_9ZPxqCupGIU";
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Карта для отслеживания успешных платежей (anti-duplicate)
const paidUsers = new Map();

// История операций (можно заменить на БД)
const transactions = [];

app.use(express.json());
app.use(cors());
// Статика для фронта
const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

// SPA-фоллбек: отдаём index.html для любых не-API маршрутов
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Обработка pre_checkout_query (Telegram Stars)
bot.on("pre_checkout_query", (query) => {
  // Проверка пользователя (можно добавить свою логику)
  if (!query.from || !query.from.id) {
    bot.answerPreCheckoutQuery(query.id, false, { error_message: "User not found" });
    return;
  }
  // Всегда разрешаем (можно добавить проверку баланса)
  bot.answerPreCheckoutQuery(query.id, true).catch(() => {
    console.error("answerPreCheckoutQuery failed");
  });
});

// Обработка успешных платежей
bot.on("message", (msg) => {
  if (msg.successful_payment) {
    const userId = msg.from.id;
    const payload = msg.successful_payment.invoice_payload;
    const chargeId = msg.successful_payment.telegram_payment_charge_id;
    const amount = msg.successful_payment.total_amount;
    const currency = msg.successful_payment.currency;

    // Проверка дубликата по payload
    if (transactions.find(t => t.payload === payload)) {
      console.log("[DUPLICATE] Payment already processed", payload);
      return;
    }

    // Проверка соответствия валюты
    if (currency !== "XTR") {
      console.log("[ERROR] Wrong currency", currency);
      return;
    }

    // Сохраняем успешную транзакцию
    transactions.push({
      userId,
      amount,
      currency,
      payload,
      chargeId,
      status: "completed",
      date: new Date().toISOString()
    });
    paidUsers.set(userId, chargeId);
    console.log(`[SUCCESS] Stars payment: user ${userId}, amount ${amount}, payload ${payload}`);
  }
});

// Handle the /status command
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const message = paidUsers.has(userId)
    ? "You have paid"
    : "You have not paid yet";
  bot.sendMessage(chatId, message);
});

// telegram stars /refund command
bot.onText(/\/refund/, async (msg) => {
  const userId = msg.from.id;

  if (!paidUsers.has(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "You have not paid yet, there is nothing to refund."
    );
  }

  const chargeId = paidUsers.get(userId);

  try {
    const form = {
      user_id: userId,
      telegram_payment_charge_id: chargeId,
    };

    const refundResponse = await bot._request("refundStarPayment", { form });

    if (refundResponse) {
      paidUsers.delete(userId);
      bot.sendMessage(msg.chat.id, "Your payment has been refunded.");
    } else {
      bot.sendMessage(msg.chat.id, "Refund failed. Please try again later.");
    }
  } catch (error) {
    console.error("Refund failed:", error);
    bot.sendMessage(msg.chat.id, "Refund failed. Please try again later.");
  }
});

bot.startPolling();

// API: Инициация пополнения Stars (создание invoice)
app.post("/api/createInvoiceLink", async (req, res) => {
  // Ожидаем: { telegramId, amount, payload }
  const { telegramId, amount, payload } = req.body;

  // Проверка входных данных
  if (!telegramId || !amount || !payload) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid amount" });
  }

  // Проверка пользователя (можно добавить свою логику)
  // Проверка баланса Stars через Bot API (опционально)

  // Формируем invoice для Telegram Stars
  const title = `Пополнение Stars: ${amount}`;
  const description = `Пополнение баланса Stars на ${amount}`;
  const label = `Stars (${amount})`;
  const providerToken = TELEGRAM_BOT_TOKEN;
  const currency = "XTR";

  try {
    const invoiceLink = await bot.createInvoiceLink(
      title,
      description,
      payload,
      providerToken,
      currency,
      [{ label, amount }]
    );
    res.json({ success: true, invoiceLink });
  } catch (error) {
    console.error("Error creating invoice link:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running at ${port}`);
});
