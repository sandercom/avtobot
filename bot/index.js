const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN not found in .env file!');
  process.exit(1);
}

console.log('✅ Token loaded, length:', token.length);
const bot = new TelegramBot(token, {polling: true});

#const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const userStates = {};
const lastHandled = {}; // { telegram_id: { keyword: timestamp } }

const {
  addUser,
  addFilter,
  getUserFilters,
  deleteFilter,
  getUserFiltersToCheck,
  adExists,
  saveAd,
  markFilterInitialized,
  getAdsByFilterId
} = require('../db/queries');

const { scrapeAvito } = require('../parser/scraper');

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: '➕ Добавить фильтр' }],
      [{ text: '🔍 Проверить объявления' }],
      [{ text: '📋 Мои фильтры' }, { text: '❌ Удалить фильтр' }],
      [{ text: '📢 Показать все объявления' }]
    ],
    resize_keyboard: true
  }
};

// === Команды ===

async function startHandler(msg) {
  const telegram_id = msg.from.id;
  const username = msg.from.username || '';
  try {
    await addUser(telegram_id, username);
    bot.sendMessage(
      msg.chat.id,
      'Добро пожаловать! Используйте меню или команды:\n' +
        '/addfilter, /checkads, /myfilters, /delfilter',
      mainKeyboard
    );
  } catch (err) {
    console.error('Ошибка при добавлении пользователя:', err);
    bot.sendMessage(msg.chat.id, 'Ошибка регистрации.');
  }
}

async function helpHandler(msg) {
  bot.sendMessage(
    msg.chat.id,
    'Команды:\n' +
      '/addfilter keyword, maxPrice, region — добавить фильтр\n' +
      '/checkads — проверить объявления\n' +
      '/myfilters — список фильтров\n' +
      '/delfilter — удалить фильтр',
    mainKeyboard
  );
}

async function addFilterHandler(msg, match) {
  const telegram_id = msg.from.id;
  const now = Date.now();

  if (!match[1]) {
    return bot.sendMessage(msg.chat.id, 'Введите фильтр в формате:\nmacbook, 40000, novosibirsk');
  }

  const parts = match[1].split(',').map(s => s.trim()).filter(Boolean);
  const keyword = parts[0];
  const priceStr = parts[1];
  const regionRaw = parts[2];

  if (!keyword) {
    return bot.sendMessage(msg.chat.id, 'Ключевое слово обязательно.');
  }

  if (lastHandled[telegram_id]?.[keyword] && now - lastHandled[telegram_id][keyword] < 5000) {
    return; // пропускаем повтор
  }

  let price = 0;
  if (priceStr) {
    price = parseInt(priceStr, 10);
    if (isNaN(price)) {
      return bot.sendMessage(msg.chat.id, 'Цена должна быть числом.');
    }
  }

  const region = regionRaw || 'novosibirsk';

  try {
    await addFilter(telegram_id, keyword, price, region);
    lastHandled[telegram_id] = lastHandled[telegram_id] || {};
    lastHandled[telegram_id][keyword] = now;

    bot.sendMessage(
      msg.chat.id,
      `✅ Фильтр добавлен:\n- Ключевое слово: ${keyword}\n- Цена: ${price ? price + '₽' : 'без ограничения'}\n- Регион: ${region}`
    );
  } catch (err) {
    console.error('Ошибка при добавлении фильтра:', err);
    bot.sendMessage(msg.chat.id, 'Ошибка при добавлении фильтра.');
  }
}

async function checkAdsHandler(msg) {
  const telegram_id = msg.from.id;
  try {
    const filters = await getUserFiltersToCheck(telegram_id);
    if (!filters.length) {
      return bot.sendMessage(msg.chat.id, 'У вас нет активных фильтров.');
    }

    for (const filter of filters) {
      const ads = await scrapeAvito(filter.keyword, filter.max_price, filter.region);
      let newCount = 0;

      for (const ad of ads) {
        const exists = await adExists(ad.url);
        if (!exists) {
          await saveAd(ad, filter.id);
          await bot.sendMessage(
            telegram_id,
            `🔎 <b>${filter.keyword}</b>\n<b>${ad.title}</b>\n💰 ${ad.price}₽\n📍 ${ad.location}\n👉 <a href="${ad.url}">Ссылка</a>`,
            { parse_mode: 'HTML' }
          );
          newCount++;
        }
      }

      if (!filter.initialized) {
        await markFilterInitialized(filter.id);
        if (newCount === 0) {
          await bot.sendMessage(telegram_id, `🔎 По фильтру "${filter.keyword}" пока ничего не найдено.`);
        }
      } else if (newCount === 0) {
        await bot.sendMessage(telegram_id, `🔁 По фильтру "${filter.keyword}" новых объявлений нет.`);
      }
    }
  } catch (err) {
    console.error('Ошибка при проверке объявлений:', err);
    bot.sendMessage(msg.chat.id, 'Ошибка при проверке объявлений.');
  }
}

async function myFiltersHandler(msg) {
  const filters = await getUserFilters(msg.from.id);
  if (!filters.length) {
    return bot.sendMessage(msg.chat.id, 'У вас нет фильтров.');
  }

  const text = filters.map(f =>
    `🔎 <b>${f.keyword}</b>\n📍 ${f.region}\n💰 ${f.max_price || 'без ограничения'} ₽`
  ).join('\n\n');

  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
}

async function handleDeleteFilterStep1(msg) {
  const filters = await getUserFilters(msg.from.id);
  if (!filters.length) {
    return bot.sendMessage(msg.chat.id, 'У вас нет фильтров для удаления.');
  }

  const inlineKeyboard = filters.map(f => [{
    text: `${f.keyword} (${f.region})`,
    callback_data: `deletefilter_${f.id}`
  }]);

  bot.sendMessage(msg.chat.id, 'Выберите фильтр для удаления:', {
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

async function handleShowAllAdsStep1(msg) {
  const filters = await getUserFilters(msg.from.id);
  if (!filters.length) {
    return bot.sendMessage(msg.chat.id, 'У вас нет фильтров.');
  }

  const inlineKeyboard = filters.map(f => [{
    text: `${f.keyword} (${f.region})`,
    callback_data: `showads_${f.id}`
  }]);

  bot.sendMessage(msg.chat.id, 'Выберите фильтр, чтобы посмотреть все объявления:', {
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

// === Callback handler ===
bot.on('callback_query', async (query) => {
  const msg = query.message;
  const data = query.data;

  if (data.startsWith('deletefilter_')) {
    const filterId = data.replace('deletefilter_', '');
    try {
      await deleteFilter(filterId);
      bot.editMessageText('Фильтр удалён ✅', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
    } catch (err) {
      console.error('Ошибка при удалении фильтра:', err);
      bot.editMessageText('Ошибка при удалении фильтра.', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
    }
  } else if (data.startsWith('showads_')) {
    const filterId = data.replace('showads_', '');
    try {
      const ads = await getAdsByFilterId(filterId);
      if (!ads.length) {
        return bot.editMessageText('Объявления отсутствуют.', {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      }

      let adsText = ads.map(ad =>
        `🔹 <b>${ad.title}</b>\n💰 ${ad.price}₽\n📍 ${ad.location}\n👉 <a href="${ad.url}">Ссылка</a>`
      ).join('\n\n');

      if (adsText.length > 4000) {
        adsText = adsText.slice(0, 4000) + '\n\n...и ещё объявления.';
      }

      bot.editMessageText(`Объявления по фильтру:\n\n${adsText}`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (err) {
      console.error('Ошибка при выводе объявлений:', err);
      bot.editMessageText('Ошибка при загрузке объявлений.', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
    }
  }
});

// === Команды ===
bot.onText(/\/start/, startHandler);
bot.onText(/\/help/, helpHandler);
bot.onText(/\/addfilter(?: (.+))?/, addFilterHandler);
bot.onText(/\/checkads/, checkAdsHandler);
bot.onText(/\/myfilters/, myFiltersHandler);
bot.onText(/\/delfilter/, handleDeleteFilterStep1);

// === Сообщения ===
bot.on('message', async (msg) => {
  if (msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const text = msg.text;

  if (userStates[userId] === 'awaiting_filter_input') {
    userStates[userId] = null;

    const now = Date.now();
    const parts = text.split(',').map(s => s.trim()).filter(Boolean);
    const keyword = parts[0];
    const priceStr = parts[1];
    const regionRaw = parts[2];

    if (!keyword) {
      return bot.sendMessage(msg.chat.id, 'Ключевое слово обязательно. Введите фильтр заново:');
    }

    if (lastHandled[userId]?.[keyword] && now - lastHandled[userId][keyword] < 5000) {
      return;
    }

    let price = 0;
    if (priceStr) {
      price = parseInt(priceStr, 10);
      if (isNaN(price)) {
        return bot.sendMessage(msg.chat.id, 'Цена должна быть числом. Введите фильтр заново:');
      }
    }

    const region = regionRaw || 'novosibirsk';

    try {
      await addFilter(userId, keyword, price, region);
      lastHandled[userId] = lastHandled[userId] || {};
      lastHandled[userId][keyword] = now;

      return bot.sendMessage(
        msg.chat.id,
        `✅ Фильтр добавлен:\n- Ключевое слово: ${keyword}\n- Цена: ${price ? price + '₽' : 'без ограничения'}\n- Регион: ${region}`,
        mainKeyboard
      );
    } catch (err) {
      console.error('Ошибка при добавлении фильтра:', err);
      return bot.sendMessage(msg.chat.id, 'Произошла ошибка при добавлении фильтра.');
    }
  }

  // Меню кнопок
  if (text === '➕ Добавить фильтр') {
    userStates[userId] = 'awaiting_filter_input';
    return bot.sendMessage(msg.chat.id, 'Введите фильтр в формате:\nmacbook, 40000, novosibirsk');
  } else if (text === '🔍 Проверить объявления') {
    return checkAdsHandler(msg);
  } else if (text === '📋 Мои фильтры') {
    return myFiltersHandler(msg);
  } else if (text === '❌ Удалить фильтр') {
    return handleDeleteFilterStep1(msg);
  } else if (text === '📢 Показать все объявления') {
    return handleShowAllAdsStep1(msg);
  }
});

module.exports = bot;
