const puppeteer = require('puppeteer');

async function scrapeAvito(keyword, maxPrice, region = 'novosibirsk') {
  const query = `https://www.avito.ru/${region}?q=${encodeURIComponent(keyword)}`;
  console.log(`👉 Переход по ссылке: ${query}`);

  // Используем прокси, если задано в переменной окружения
  const proxy = process.env.PROXY_SERVER;
  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy}`);
    console.log('Используется прокси:', proxy);
  }
  const browser = await puppeteer.launch({
    headless: false,
    args: launchArgs
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(query, { waitUntil: 'domcontentloaded', timeout: 40000 });

    // 🔧 ИСПРАВЛЕНИЕ: Заменяем waitForTimeout на waitFor
    await page.waitFor(3000); // Ждём 3 секунды для полной загрузки

    await page.waitForSelector('[data-marker="item"]', { timeout: 10000 });

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
          await detailPage.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

          // 🔧 ИСПРАВЛЕНИЕ: Добавляем небольшую задержку для детальной страницы
          await detailPage.waitFor(2000);

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