const pool = require('./connection');

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function addUser(telegram_id, username) {
  await pool.execute(
    'INSERT IGNORE INTO users (telegram_id, username) VALUES (?, ?)',
    [telegram_id, username]
  );
}

async function addFilter(telegram_id, keyword, price, region) {
  await pool.execute(
    `INSERT INTO search_filters (user_id, keyword, max_price, region)
     VALUES (?, ?, ?, ?)`,
    [telegram_id, keyword, price, region]
  );
}

async function getFilters() {
  const [rows] = await pool.execute(
    `SELECT sf.id, sf.keyword, sf.max_price, sf.region, u.telegram_id
     FROM search_filters sf
     JOIN users u ON sf.user_id = u.telegram_id`
  );
  return rows;
}

async function adExists(url) {
  const normalizedUrl = normalizeUrl(url);
  const [rows] = await pool.execute(
    'SELECT id FROM ads WHERE url = ? LIMIT 1',
    [normalizedUrl]
  );
  return rows.length > 0;
}

async function saveAd(ad, filterId) {
  const normalizedUrl = normalizeUrl(ad.url);
  try {
    await pool.execute(
      `INSERT INTO ads (title, price, url, location, filter_id)
       VALUES (?, ?, ?, ?, ?)`,
      [ad.title, ad.price, normalizedUrl, ad.location, filterId]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.warn(`Объявление уже есть в базе: ${normalizedUrl}`);
    } else {
      throw err;
    }
  }
}

async function getUserFilters(telegram_id) {
  const [rows] = await pool.execute(
    `SELECT id, keyword, max_price, region
     FROM search_filters
     WHERE user_id = ?`,
    [telegram_id]
  );
  return rows;
}

async function getUserFiltersToCheck(telegram_id) {
  const [rows] = await pool.execute(
    `SELECT id, keyword, max_price, region, initialized
     FROM search_filters
     WHERE user_id = ?`,
    [telegram_id]
  );
  return rows;
}

async function markFilterInitialized(filterId) {
  await pool.execute(
    `UPDATE search_filters SET initialized = TRUE WHERE id = ?`,
    [filterId]
  );
}

async function deleteFilter(filterId) {
  await pool.execute(
    'DELETE FROM search_filters WHERE id = ?',
    [filterId]
  );
}

// НОВАЯ ФУНКЦИЯ для получения объявлений по фильтру
async function getAdsByFilterId(filterId) {
  const [rows] = await pool.execute(
    'SELECT title, price, location, url FROM ads WHERE filter_id = ? ORDER BY id DESC',
    [filterId]
  );
  return rows;
}

module.exports = {
  addUser,
  addFilter,
  getFilters,
  adExists,
  saveAd,
  getUserFilters,
  deleteFilter,
  getUserFiltersToCheck,
  markFilterInitialized,
  getAdsByFilterId  // <-- добавь эту функцию в экспорт
};
