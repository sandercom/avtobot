const puppeteer = require('puppeteer');

async function scrapeAvito(keyword, maxPrice, region = 'novosibirsk') {
  // Добавляем параметр для сортировки по дате и фильтр частников
  const query = `https://www.avito.ru/${region}?q=${encodeURIComponent(keyword)}&s=104&user=1`;
  console.log(`👉 Переход по ссылке: ${query}`);
  console.log(`🎯 Поиск последних объявлений от частников`);

  // Используем прокси, если задано в переменной окружения
  const proxy = process.env.PROXY_SERVER;
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=VizDisplayCompositor',
    '--disable-dev-shm-usage'
  ];

  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy}`);
    console.log('Используется прокси:', proxy);
  }

  const browser = await puppeteer.launch({
    headless: true, // меняем на true для стабильности
    args: launchArgs
  });

  try {
    const page = await browser.newPage();

    // Улучшаем маскировку под реального пользователя
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    // Скрываем WebDriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    console.log('🌐 Загружаем страницу...');
    await page.goto(query, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Увеличиваем время ожидания и добавляем проверки
    console.log('⏳ Ожидаем загрузки контента...');

    // Пробуем разные селекторы для объявлений
    const selectors = [
      '[data-marker="item"]',
      '.iva-item-root-_lk9K', // альтернативный селектор
      '[data-marker*="item"]',
      '.items-items-kAJAg .iva-item-root-_lk9K'
    ];

    let adsFound = false;
    for (const selector of selectors) {
      try {
        console.log(`🔍 Пробуем селектор: ${selector}`);
        await page.waitForSelector(selector, { timeout: 10000 });
        console.log(`✅ Селектор найден: ${selector}`);
        adsFound = true;
        break;
      } catch (e) {
        console.log(`❌ Селектор не найден: ${selector}`);
      }
    }

    if (!adsFound) {
      // Делаем скриншот для диагностики
      await page.screenshot({ path: 'debug-page.png' });
      console.log('📸 Сделал скриншот debug-page.png для диагностики');

      // Проверяем, не заблокировал ли нас Avito
      const pageContent = await page.content();
      if (pageContent.includes('доступ ограничен') ||
      pageContent.includes('blocked') ||
      pageContent.includes('captcha')) {
        throw new Error('Avito заблокировал доступ. Возможно, нужен прокси или капча');
      }

      // Пробуем получить хотя бы какой-то контент
      console.log('🔄 Пробуем получить данные через evaluate...');
    }

    const previews = await page.evaluate(() => {
      // Пробуем разные селекторы для поиска объявлений
      const selectors = [
        '[data-marker="item"]',
        '.iva-item-root-_lk9K',
        '[class*="iva-item-root"]',
        '[data-marker*="item"]'
      ];

      let ads = [];

      for (const selector of selectors) {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length > 0) {
          console.log(`Найдено объявлений с селектором ${selector}: ${nodes.length}`);
          ads = Array.from(nodes).map(node => {
            try {
              const title = node.querySelector('h3')?.innerText?.trim() ||
              node.querySelector('[itemprop="name"]')?.innerText?.trim() ||
              'Без названия';

              const priceText = node.querySelector('meta[itemprop="price"]')?.content ||
              node.querySelector('[data-marker="item-price"]')?.innerText?.replace(/\D/g, '') ||
              '0';
              const price = parseInt(priceText, 10);

              const urlElem = node.querySelector('a[data-marker="item-title"]') ||
              node.querySelector('a[href*="/avito.ru/"]');
              const url = urlElem?.href || '';

              const dateText = node.querySelector('[data-marker="item-date"]')?.innerText?.trim() || '';

              // Проверяем, является ли продавец частником
              const sellerText = node.querySelector('[data-marker="item-seller"]')?.innerText || '';
              const isPrivate = !sellerText.includes('Компания') && !sellerText.includes('компания');

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

              return {
                title,
                price,
                url,
                location,
                date: dateText,
                isPrivate: isPrivate,
                timestamp: new Date().getTime()
              };
            } catch (error) {
              console.error('Ошибка при парсинге объявления:', error);
              return null;
            }
          }).filter(ad => ad !== null);

          if (ads.length > 0) break;
        }
      }

      return ads;
    });

    console.log(`📊 Найдено объявлений на странице: ${previews.length}`);

    // Фильтруем только частников
    const privateAds = previews
      .filter(ad => ad.isPrivate && ad.price > 0 && ad.url && ad.price <= maxPrice)
      .sort((a, b) => {
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return 0;
    });

    const results = [];

    for (const ad of privateAds) {
      // 🔍 Фильтрация по региону из URL
      try {
        const pathParts = new URL(ad.url).pathname.split('/');
        const adRegion = pathParts[1]?.toLowerCase() || '';
        if (adRegion !== region.toLowerCase()) continue;
      } catch (e) {
        console.warn(`⚠️ Не удалось разобрать регион из URL: ${ad.url}`);
        continue;
      }

      results.push(ad);
    }

    // Сортируем результаты по дате (сначала самые свежие)
    results.sort((a, b) => {
      const dateA = parseDate(a.date);
      const dateB = parseDate(b.date);
      return dateB - dateA;
    });

    console.log(`🔍 Найдено ${results.length} подходящих объявлений от частников:`);
    results.forEach((ad, index) => {
      console.log(`\n${index + 1}. 📅 ${ad.date || 'Дата не указана'}`);
      console.log(`   🏷️  ${ad.title}`);
      console.log(`   💰 ${ad.price}₽`);
      console.log(`   📍 ${ad.location}`);
      console.log(`   🔗 ${ad.url}`);
    });

    return results;
  } catch (err) {
    console.error(`❌ Ошибка при парсинге Avito:`, err.message);
    console.error('Stack:', err.stack);
    return [];
  } finally {
    await browser.close();
  }
}

// Функция для парсинга даты из текста Avito
function parseDate(dateText) {
  if (!dateText) return new Date(0);

  const now = new Date();
  const lowerText = dateText.toLowerCase();

  if (lowerText.includes('сегодня')) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (lowerText.includes('вчера')) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return yesterday;
  }

  const match = dateText.match(/(\d{1,2})\s+([а-я]+)/i);
  if (match) {
    const day = parseInt(match[1]);
    const monthStr = match[2].toLowerCase();
    const months = {
      'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
      'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
      'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11
    };

    if (months[monthStr] !== undefined) {
      const adDate = new Date(now.getFullYear(), months[monthStr], day);
      if (adDate > now) {
        adDate.setFullYear(now.getFullYear() - 1);
      }
      return adDate;
    }
  }

  return new Date(0);
}

module.exports = { scrapeAvito };