const cron = require('node-cron');
const { scrapeAvito } = require('../parser/scraper');
const { getFilters, adExists, saveAd } = require('../db/queries');
const bot = require('../bot/index');

// Каждые 10 минут
cron.schedule('*/10 * * * *', async () => {
  console.log('⏱ Запуск cron-задачи: проверка фильтров');

  try {
    const filters = await getFilters();

    for (const filter of filters) {
      console.log(`🔍 Проверка фильтра: "${filter.keyword}", до ${filter.max_price}₽, регион: ${filter.region}`);

      const ads = await scrapeAvito(filter.keyword, filter.max_price, filter.region);
      console.log(`🔎 Найдено ${ads.length} объявлений по фильтру "${filter.keyword}"`);

      for (const ad of ads) {
        const exists = await adExists(ad.url);
        if (!exists) {
          await saveAd(ad, filter.id);
          console.log(`📤 Новое объявление отправлено пользователю ${filter.telegram_id}: ${ad.url}`);

          await bot.sendMessage(
            filter.telegram_id,
            `🔎 Найдено новое объявление:\n\n<b>${ad.title}</b>\n💰 <b>${ad.price}₽</b>\n📍 ${ad.location}\n👉 <a href="${ad.url}">Ссылка на объявление</a>`,
            { parse_mode: 'HTML' }
          );
        }
      }
    }
  } catch (err) {
    console.error('❌ Ошибка при выполнении cron-задачи:', err);
  }
});
