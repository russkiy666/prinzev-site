/**
 * Бэкенд платформы «Продюсер с нуля» на Google Таблице.
 *
 * Установка (один раз):
 * 1. Создать Google Таблицу → Расширения → Apps Script → вставить этот файл.
 * 2. Настройки проекта → Свойства скрипта: ADMIN_KEY = пароль админки, BOT_KEY = секрет для бота.
 * 3. Развернуть → Новое развёртывание → Веб-приложение: «Выполнять от моего имени», доступ «Все».
 * 4. Скопировать URL веб-приложения в CONFIG.API_URL в kurs/index.html.
 *
 * Лист «Ученики» создаётся сам: код | имя | telegram | тариф | выдан | последний вход | статус
 */
const SHEET = 'Ученики';
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(['code', 'name', 'tg', 'note', 'created', 'last', 'status']);
    sh.setFrozenRows(1);
  }
  return sh;
}
function rows_() {
  const v = sheet_().getDataRange().getValues();
  return v.slice(1).map((r, i) => ({ row: i + 2, code: r[0], name: r[1], tg: r[2], note: r[3], created: r[4], last: r[5], status: r[6] }));
}
function pub_(s) { return { code: s.code, name: s.name, tg: s.tg, note: s.note, created: String(s.created), last: String(s.last), status: s.status }; }
function now_() { return Utilities.formatDate(new Date(), 'Europe/Moscow', 'dd.MM.yyyy, HH:mm'); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function genCode_(existing) {
  let c;
  do {
    c = '';
    for (let i = 0; i < 8; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)];
    c = c.slice(0, 4) + '-' + c.slice(4);
  } while (existing.has(c));
  return c;
}
function issue_(tg, note) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const all = rows_();
    const code = genCode_(new Set(all.map(s => s.code)));
    const s = { code, name: '', tg, note: note || '', created: now_(), last: '', status: 'active' };
    sheet_().appendRow([s.code, s.name, s.tg, s.note, s.created, s.last, s.status]);
    return s;
  } finally { lock.releaseLock(); }
}

function doPost(e) {
  let d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Неверный запрос' }); }
  const isAdmin = d.key && d.key === prop_('ADMIN_KEY');
  const sh = sheet_();

  switch (d.action) {
    case 'verify': {
      const s = rows_().find(x => x.code === d.code);
      if (!s) return out_({ ok: false, error: 'Код не найден. Проверь, что ввёл его без ошибок.' });
      if (s.status !== 'active') return out_({ ok: false, error: 'Доступ по этому коду приостановлен. Напиши куратору.' });
      s.last = now_(); sh.getRange(s.row, 6).setValue(s.last);
      return out_({ ok: true, student: pub_(s) });
    }
    case 'setName': {
      const s = rows_().find(x => x.code === d.code);
      if (!s || s.status !== 'active') return out_({ ok: false, error: 'Код не найден' });
      const name = String(d.name || '').trim().slice(0, 40);
      if (name.length < 2) return out_({ ok: false, error: 'Слишком короткое имя' });
      sh.getRange(s.row, 2).setValue(name); s.name = name;
      return out_({ ok: true, student: pub_(s) });
    }
    case 'adminCheck':
      return out_(isAdmin ? { ok: true } : { ok: false, error: 'Неверный пароль' });
    case 'list':
      if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
      return out_({ ok: true, students: rows_().map(pub_).reverse() });
    case 'create':
      if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
      return out_({ ok: true, student: pub_(issue_(String(d.tg || ''), String(d.note || ''))) });
    case 'toggle': {
      if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
      const s = rows_().find(x => x.code === d.code);
      if (!s) return out_({ ok: false, error: 'Код не найден' });
      sh.getRange(s.row, 7).setValue(s.status === 'active' ? 'blocked' : 'active');
      return out_({ ok: true });
    }
    // Для бота: выдать код после оплаты. Бот шлёт {action:'botIssue', botKey, tg, note}
    case 'botIssue':
      if (!d.botKey || d.botKey !== prop_('BOT_KEY')) return out_({ ok: false, error: 'Нет доступа' });
      return out_({ ok: true, student: pub_(issue_(String(d.tg || ''), String(d.note || 'Выдан ботом'))) });
  }
  return out_({ ok: false, error: 'Неизвестное действие' });
}
