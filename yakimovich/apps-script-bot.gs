/**
 * Бот-воронка YAKIMOVICH на Google Apps Script. ОТДЕЛЬНЫЙ проект: никак не связан со скриптом и таблицей Сабиза.
 *
 * Что делает:
 *  1. Мини-апп шлёт сюда события: open (открыл), lesson (начал урок), watched (досмотрел / дошёл до записи)
 *     и саму заявку на бесплатную консультацию. Подлинность каждого запроса проверяется по initData Telegram.
 *  2. После заявки бот сразу присылает сообщение с кнопкой-ссылкой в закрытый канал.
 *  3. Дожим, если человек не посмотрел урок:
 *       через 30 минут после первого открытия — текст + кнопка «ЗАБРАТЬ УРОК!»
 *       через 2 часа — фото (лев «смерть в нищите») + кнопка «ЗАБРАТЬ УРОК!»
 *
 * Установка (один раз):
 *  1. script.google.com → новый проект → вставить этот файл.
 *  2. Настройки проекта → Свойства скрипта → BOT_TOKEN = токен бота из @BotFather.
 *  3. Выполнить функцию setup() (создаст таблицу «YAKIMOVICH · воронка» и минутный триггер).
 *  4. Развертывание → Новое развертывание → Веб-приложение, доступ «Все» → скопировать URL.
 *  5. URL вставить в SHEET_URL в yakimovich/index.html.
 *  Проверка текстов: выполнить preview() — бот пришлёт все три сообщения на PREVIEW_CHAT_ID (свойство скрипта) или первому в таблице.
 */
const MINI_APP_URL = 'https://russkiy666.github.io/prinzev-site/yakimovich/';
const CHANNEL_LINK = 'https://t.me/+MmiYGcS3dKQ4M2Fi';
const LION_URL = 'https://russkiy666.github.io/prinzev-site/yakimovich/media/lion-nishcheta.jpg';
const TZ = 'Europe/Moscow';
const MIN = 60 * 1000;
const D1 = 30 * MIN, D2 = 120 * MIN;          // когда слать дожимы после первого открытия
const D1_LATE = 110 * MIN, D2_LATE = 24 * 60 * MIN;   // слишком поздно — уже не шлём (например, если скрипт стоял)

/* ----- ТЕКСТЫ (потом можно править прямо здесь) ----- */
const TXT_BOOKED = 'заявка принята ✅\n\nпока смотрю свободное время для созвона, заходи в закрытый канал: там я разбираю, как выйти на первые 200.000 ₽ в онлайне';
const BTN_BOOKED = 'ЗАЙТИ В ЗАКРЫТЫЙ КАНАЛ';
const TXT_D1 = 'деньги любят быстрых\n\nзарабатывают те, кто первый хватается за возможность и доводит до конца\n\nбесплатный урок – одна из таких возможностей, через 3 часа доступ к уроку пропадет.';
const BTN_LESSON = 'ЗАБРАТЬ УРОК!';

const HEAD = ['ID Telegram', 'Имя', 'Telegram', 'Первое открытие', 'Начал урок', 'Досмотрел', 'Заявка', 'Дожим 30 мин', 'Дожим 2 ч', 'Сообщение после заявки', 'Возраст', 'Бюджет', 'Ответы (json)'];
const C = { uid: 1, name: 2, tg: 3, opened: 4, lesson: 5, watched: 6, booked: 7, d1: 8, d2: 9, bookedMsg: 10, age: 11, budget: 12, json: 13 };

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function sheet_() {
  const id = prop_('SHEET_ID');
  if (!id) throw new Error('Сначала выполни setup()');
  return SpreadsheetApp.openById(id).getSheetByName('Подписчики');
}
function now_() { return Date.now(); }
function stamp_(t) { return Utilities.formatDate(new Date(t), TZ, 'dd.MM.yyyy HH:mm:ss'); }
function parse_(s) { const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 3, +m[5], +m[6]) : 0; }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ----- проверка initData мини-аппа ----- */
function hex_(bytes) { return bytes.map(b => ('0' + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2)).join(''); }
function checkInit_(init) {
  try {
    const token = prop_('BOT_TOKEN'); if (!token || !init) return null;
    const pairs = String(init).split('&').map(p => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' '))]; });
    const hash = (pairs.find(p => p[0] === 'hash') || [])[1];
    const data = pairs.filter(p => p[0] !== 'hash').sort((a, b) => a[0] < b[0] ? -1 : 1).map(p => p[0] + '=' + p[1]).join('\n');
    const secret = Utilities.computeHmacSha256Signature(token, 'WebAppData');
    const sign = hex_(Utilities.computeHmacSha256Signature(data, secret));
    if (!hash || sign !== hash) return null;
    const u = JSON.parse((pairs.find(p => p[0] === 'user') || [])[1] || 'null');
    return u && u.id ? u : null;
  } catch (e) { return null; }
}

/* ----- таблица ----- */
function find_(sh, uid) {
  const n = sh.getLastRow(); if (n < 2) return 0;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(uid)) return i + 2;
  return 0;
}
function upsert_(sh, u) {
  let r = find_(sh, u.id);
  if (!r) {
    const row = new Array(HEAD.length).fill('');
    row[C.uid - 1] = String(u.id); row[C.name - 1] = [u.first_name, u.last_name].filter(Boolean).join(' ');
    row[C.tg - 1] = u.username ? '@' + u.username : '';
    sh.appendRow(row); r = sh.getLastRow();
  }
  return r;
}
function setIfEmpty_(sh, r, col, val) { if (!sh.getRange(r, col).getValue()) sh.getRange(r, col).setValue(val); }

/* ----- Telegram ----- */
function tg_(method, payload) {
  const token = prop_('BOT_TOKEN');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  let j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
  return { ok: !!j.ok, code: res.getResponseCode(), desc: j.description || '' };
}
function lessonKb_() { return { inline_keyboard: [[{ text: BTN_LESSON, web_app: { url: MINI_APP_URL } }]] }; }
function sendBooked_(chat) { return tg_('sendMessage', { chat_id: chat, text: TXT_BOOKED, reply_markup: { inline_keyboard: [[{ text: BTN_BOOKED, url: CHANNEL_LINK }]] } }); }
function sendD1_(chat) { return tg_('sendMessage', { chat_id: chat, text: TXT_D1, reply_markup: lessonKb_() }); }
function sendD2_(chat) { return tg_('sendPhoto', { chat_id: chat, photo: LION_URL, reply_markup: lessonKb_() }); }
/* результат отправки → что записать в ячейку: время или причина */
function mark_(r) { return r.ok ? stamp_(now_()) : (r.code === 403 ? 'заблокировал бота' : 'ошибка: ' + r.desc.slice(0, 60)); }

/* ----- вход: события и заявки мини-аппа ----- */
function doGet() { return out_({ ok: true, service: 'yakimovich-bot' }); }
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const u = checkInit_(d.init);
    if (!u) return out_({ ok: false, error: 'initData' });
    const sh = sheet_(), r = upsert_(sh, u), t = stamp_(now_());
    if (d.type === 'event') {
      if (d.ev === 'open') setIfEmpty_(sh, r, C.opened, t);
      if (d.ev === 'lesson') { setIfEmpty_(sh, r, C.opened, t); setIfEmpty_(sh, r, C.lesson, t); }
      if (d.ev === 'watched') { setIfEmpty_(sh, r, C.opened, t); setIfEmpty_(sh, r, C.watched, t); }
      return out_({ ok: true });
    }
    /* заявка на консультацию */
    setIfEmpty_(sh, r, C.opened, t); setIfEmpty_(sh, r, C.watched, t); setIfEmpty_(sh, r, C.booked, t);
    if (d.q1) {
    sh.getRange(r, C.age).setValue(String(d.q1)); sh.getRange(r, C.budget).setValue(String(d.budget || ''));
    sh.getRange(r, C.json).setValue(JSON.stringify({ q2: d.q2, q3: d.q3, q4: d.q4, pain: d.pain, work: d.work, cur: d.cur, low: d.low }));
    }
    if (!sh.getRange(r, C.bookedMsg).getValue()) sh.getRange(r, C.bookedMsg).setValue(mark_(sendBooked_(u.id)));
    return out_({ ok: true });
  } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
  finally { try { lock.releaseLock(); } catch (x) {} }
}

/* ----- дожим: запускается каждую минуту ----- */
function tick() {
  const sh = sheet_(), n = sh.getLastRow(); if (n < 2) return;
  const rows = sh.getRange(2, 1, n - 1, HEAD.length).getValues(), t = now_();
  rows.forEach((v, i) => {
    const r = i + 2, opened = parse_(v[C.opened - 1]);
    if (!opened || v[C.watched - 1] || v[C.booked - 1]) return;     // уже посмотрел или записался — не дожимаем
    const age = t - opened;
    if (!v[C.d1 - 1] && age >= D1) sh.getRange(r, C.d1).setValue(age <= D1_LATE ? mark_(sendD1_(v[C.uid - 1])) : 'пропущен');
    if (!v[C.d2 - 1] && age >= D2) sh.getRange(r, C.d2).setValue(age <= D2_LATE ? mark_(sendD2_(v[C.uid - 1])) : 'пропущен');
  });
}

/* ----- установка и проверка ----- */
function setup() {
  if (!prop_('BOT_TOKEN')) throw new Error('Добавь BOT_TOKEN в Настройки проекта → Свойства скрипта');
  let id = prop_('SHEET_ID');
  if (!id) { id = SpreadsheetApp.create('YAKIMOVICH · воронка').getId(); PropertiesService.getScriptProperties().setProperty('SHEET_ID', id); }
  const ss = SpreadsheetApp.openById(id);
  let sh = ss.getSheetByName('Подписчики');
  if (!sh) { sh = ss.getSheets()[0]; sh.setName('Подписчики'); }
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  ScriptApp.getProjectTriggers().filter(x => x.getHandlerFunction() === 'tick').forEach(x => ScriptApp.deleteTrigger(x));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  return ss.getUrl();
}
function preview() {
  let chat = prop_('PREVIEW_CHAT_ID');
  if (!chat) { const sh = sheet_(); if (sh.getLastRow() > 1) chat = sh.getRange(2, 1).getValue(); }
  if (!chat) throw new Error('Нет получателя: открой мини-апп в боте или задай PREVIEW_CHAT_ID');
  return [sendBooked_(chat), sendD1_(chat), sendD2_(chat)];
}
