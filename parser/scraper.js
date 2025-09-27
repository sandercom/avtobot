const puppeteer = require('puppeteer');

async function scrapeAvito(keyword, maxPrice, region = 'novosibirsk') {
  const query = `https://www.avito.ru/${region}?q=${encodeURIComponent(keyword)}`;
  console.log(`👉 Переход по ссылке: ${query}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(query, { waitUntil: 'domcontentloaded', timeout: 15000 });

    await page.waitForSelector('[data-marker="item"]', { timeout: 5000 });

    const previews = await page.evaluate(() => {
      return [...document.querySelectorAll('[data-marker="item"]')].map(node => {
        const title = node.querySelector('h3')?.innerText?.trim() || 'Без названия';
        const price = parseInt(node.querySelector('meta[itemprop="price"]')?.content || '0', 10);
        const url = node.querySelector('a[data-marker="item-title"]')?.href || '';

        const locationRaw = node.querySelector('[data-marker="item-address"]')?.innerText?.trim();

        let location = locationRaw;
        if (!locationRaw && url) {
          try {
            const match = new URL(url).pathname.split('/');
            location = match[1] || 'неизвестно';
          } catch (e) {
            location = 'неизвестно';
          }
        }

        return { title, price, url, location };
      });
    });

    const results = [];

    for (const ad of previews) {
      if (ad.price > maxPrice || !ad.url) continue;

      // 🔍 Фильтрация по региону из URL
      try {
        const pathParts = new URL(ad.url).pathname.split('/');
        const adRegion = pathParts[1]?.toLowerCase() || '';
        if (adRegion !== region.toLowerCase()) continue;
      } catch (e) {
        console.warn(`⚠️ Не удалось разобрать регион из URL: ${ad.url}`);
        continue;
      }

      // 🔧 Допарсинг деталей при необходимости
      if (ad.title === 'Без названия' || ad.location === 'неизвестно') {
        try {
          const detailPage = await browser.newPage();
          await detailPage.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

          if (ad.title === 'Без названия') {
            const titleDetail = await detailPage.evaluate(() => {
              return document.querySelector('h1[itemprop="name"]')?.innerText?.trim() || null;
            });
            if (titleDetail) ad.title = titleDetail;
          }

          if (ad.location === 'неизвестно') {
            const locationDetail = await detailPage.evaluate(() => {
              return document.querySelector('.style-item-address__string-wt61A')?.innerText?.trim() || null;
            });
            if (locationDetail) ad.location = locationDetail;
          }

          await detailPage.close();
        } catch (err) {
          console.warn(`⚠️ Не удалось получить детали для ${ad.url}: ${err.message}`);
        }
      }

      results.push(ad);
    }

    console.log(`🔍 Найдено ${results.length} подходящих объявлений:`);
    results.forEach(ad => {
      console.log(`- ${ad.title} | ${ad.price}₽ | ${ad.location} | ${ad.url}`);
    });

    return results;
  } catch (err) {
    console.error(`❌ Ошибка при парсинге Avito:`, err);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeAvito };
