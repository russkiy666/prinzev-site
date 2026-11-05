/**
 * Сервер платформы «Продюсер с нуля» на Google Таблице.
 *
 * Листы создаются сами при первом запросе:
 *   Ученики              — коды доступа, имена, статус
 *   Сдачи заданий        — ответы учеников; куратор ставит статус, оценку и комментарий
 *   Вопросы              — вопросы с фото; куратор пишет ответ в колонку «Ответ куратора»
 *   Дневник              — задачи на день и отчёты
 *   Разборы недели       — итоги недели: появляются сами в воскресенье вечером (или в понедельник),
 *                          текст можно поправить прямо в таблице
 *   Прогресс             — пройденные уроки (служебный)
 *   Программа · уроки    — уроки по этапам: название, длительность, видео, описание, материалы
 *   Программа · задания  — задания этапов: что сделать, срок, критерии приёма
 *   Настройки            — название, цель на карте пути, имя и Telegram куратора
 *
 * Пароль админки задаётся при первом входе в админку и хранится в свойствах скрипта (ADMIN_KEY):
 * Расширения → Apps Script → Настройки проекта → Свойства скрипта.
 * BOT_KEY — секрет для бота, добавляется в свойства скрипта, когда подключаем бота.
 */
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PHOTO_FOLDER = 'Платформа обучения — фото';
const TZ = 'Europe/Moscow';
const T = {
  students:    { title: 'Ученики',        cols: ['Код', 'Имя', 'Telegram', 'Тариф / заметка', 'Выдан', 'Последний вход', 'Статус'] },
  submissions: { title: 'Сдачи заданий',  cols: ['ID', 'Код', 'Ученик', 'ID задания', 'Задание', 'Ответ ученика', 'Отправлено', 'Статус', 'Оценка', 'Комментарий куратора', 'Дата комментария'] },
  requests:    { title: 'Вопросы',        cols: ['ID', 'Код', 'Ученик', '№', 'Дата', 'Вопрос', 'Фото', 'Ответ куратора', 'Дата ответа'] },
  journal:     { title: 'Дневник',        cols: ['Код', 'Ученик', 'Дата', 'Задачи', 'Выполнено', 'Причины невыполнения', 'Задачи поставлены', 'Отчёт сдан', 'json', 'Состояние', 'Мотивация', 'Энергия'] },
  reviews:     { title: 'Разборы недели', cols: ['Код', 'Ученик', 'Неделя', 'Дней с отчётом', 'Вывод', 'Получилось', 'Фокус на неделю', 'Дата', 'Начало недели'] },
  progress:    { title: 'Прогресс',       cols: ['Код', 'Ученик', 'Обновлено', 'json'] },
  lessons:     { title: 'Программа · уроки',   cols: ['Этап', 'Название этапа', 'Цель этапа', 'ID урока', 'Урок', 'Минут', 'Формат', 'Видео (ссылка)', 'Описание урока', 'Материалы: «Название | ссылка», каждый с новой строки'] },
  ctasks:      { title: 'Программа · задания', cols: ['Этап', 'ID задания', 'Задание', 'Что сделать', 'Срок', 'Критерии приёма, каждый с новой строки'] },
  settings:    { title: 'Настройки',      cols: ['Параметр', 'Значение', 'Где видно'] }
};
const SUB_STATUS = ['На проверке', 'Принято', 'На доработке'];
const SETTING_KEYS = {
  'Название курса': 'title', 'Поток': 'cohort', 'Старт карты': 'start', 'Цель карты': 'goal', 'Подпись цели': 'goalNote',
  'Имя куратора': 'curator', 'Telegram куратора': 'curatorTg', 'Срок проверки, часов': 'reviewHours'
};
/* Стартовая программа: записывается в таблицу один раз, дальше её правят в листах «Программа · …» */
const SEED = {
  settings: [
    ['Название курса', 'Продюсер с нуля', 'Логотип и заголовки'],
    ['Поток', '', 'Подпись под названием в кабинете ученика, например «Поток №1»'],
    ['Старт карты', '0 ₽', 'Начало карты пути'],
    ['Цель карты', '200 000 ₽', 'Финиш карты пути'],
    ['Подпись цели', 'в месяц', 'Под суммой цели'],
    ['Имя куратора', 'Куратор', 'Подпись в ответах на задания и вопросы'],
    ['Telegram куратора', '@YakimovichI', 'Ссылка «Нет кода? Напиши куратору» на входе'],
    ['Срок проверки, часов', '48', 'Подсказки у заданий']
  ],
  lessons: [
    [1, "Фундамент", "Понять профессию и выбрать модель работы", "l1", "Кто такой продюсер и на чём он зарабатывает", 18, "Видео", "", "", ""],
    [1, "", "", "l2", "Модели работы: процент, фикс, партнёрство", 22, "Видео", "", "", ""],
    [1, "", "", "l3", "Карта запуска от идеи до продаж", 15, "Схема", "", "", ""],
    [2, "Поиск эксперта", "Найти и оценить экспертов для первого запуска", "l4", "Где искать экспертов: 6 каналов", 20, "Видео", "", "", ""],
    [2, "", "", "l5", "Как оценить блог: охваты, ER, доверие", 26, "Видео", "", "", ""],
    [2, "", "", "l6", "Первое сообщение эксперту", 14, "Практикум", "", "", ""],
    [3, "Продукт", "Распаковать эксперта и собрать продуктовую линейку", "l7", "Распаковка эксперта: 40 вопросов", 35, "Видео", "", "", ""],
    [3, "", "", "l8", "Продуктовая линейка: от трипваера до наставничества", 28, "Видео", "", "", ""],
    [3, "", "", "l9", "Ценообразование и тарифы", 24, "Видео", "", "", ""],
    [4, "Прогрев", "Подготовить аудиторию к продаже", "l10", "Сторителлинг в сторис", 30, "Видео", "", "", ""],
    [4, "", "", "l11", "Контент-план прогрева на 14 дней", 22, "Шаблон", "", "", ""],
    [4, "", "", "l12", "Вебинар или автоворонка", 27, "Видео", "", "", ""],
    [5, "Продажи", "Провести продажи и посчитать результат", "l13", "Скрипты отдела продаж", 33, "Видео", "", "", ""],
    [5, "", "", "l14", "Работа с возражениями", 25, "Практикум", "", "", ""],
    [5, "", "", "l15", "Аналитика запуска", 19, "Видео", "", "", ""],
    [6, "Масштаб", "Собрать команду и спланировать второй запуск", "l16", "Команда запуска: кого нанимать", 21, "Видео", "", "", ""],
    [6, "", "", "l17", "Повторные запуски", 18, "Видео", "", "", ""]
  ],
  ctasks: [
    [1, "t1", "Опиши свою модель работы", "Выбери модель (процент, фикс или партнёрство) и посчитай, сколько хочешь зарабатывать в первые 3 месяца.", "12 окт", "Выбрана одна модель и объяснено почему\nЕсть расчёт дохода на 3 месяца"],
    [2, "t2", "Таблица из 10 экспертов", "Найди 10 экспертов и оцени каждого по таблице из урока: ниша, охваты сторис, ER, наличие продукта.", "19 окт", "10 экспертов в таблице\nЗаполнены все столбцы\nВыделены топ-3 кандидата"],
    [2, "t3", "Напиши первое сообщение", "Составь сообщение эксперту из топ-3 и отправь. Приложи скриншот переписки.", "21 окт", "Сообщение по структуре из урока\nЕсть скриншот"],
    [3, "t4", "Проведи распаковку", "Проведи созвон-распаковку с экспертом по 40 вопросам и пришли конспект: боли аудитории, сильные стороны, смыслы.", "2 ноя", "Конспект по всем блокам\n5+ болей аудитории\n3 ключевых смысла для прогрева"],
    [3, "t5", "Собери линейку продуктов", "На основе распаковки предложи 3 продукта с ценами и форматом.", "6 ноя", "Три продукта разной цены\nОбоснование цены"],
    [4, "t6", "Контент-план прогрева", "Распиши прогрев на 14 дней: темы сторис, посты, прямые эфиры.", "13 ноя", "14 дней расписаны\nЕсть точки продажи"],
    [5, "t7", "5 созвонов и отчёт", "Проведи 5 продающих созвонов и заполни отчёт: конверсия, возражения, выводы.", "20 ноя", "5 созвонов\nТаблица конверсии"],
    [6, "t8", "План второго запуска", "Разбери свой первый запуск и составь план второго: цели, бюджет, команда.", "27 ноя", "Разбор цифр первого запуска\nПлан с датами"]
  ]
};

/* ---------- таблица ---------- */
const HDR_ = {};
function sh_(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const t = T[key];
  let sh = ss.getSheetByName(t.title);
  if (sh && !HDR_[key]) { // лист создан старой версией: дописываем новые колонки в шапку
    HDR_[key] = 1;
    if (sh.getLastColumn() < t.cols.length) sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols]).setFontWeight('bold').setBackground('#EDF2FE').setFontColor('#0B1530');
  }
  if (!sh) {
    sh = ss.insertSheet(t.title);
    HDR_[key] = 1;
    sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols]).setFontWeight('bold').setBackground('#EDF2FE').setFontColor('#0B1530');
    sh.setFrozenRows(1);
    if (key === 'submissions') {
      sh.getRange('H2:H').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(SUB_STATUS, true).build());
      sh.getRange('I2:I').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 10).build());
    }
    if (key === 'students') sh.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['active', 'blocked'], true).build());
    if (key === 'journal') sh.hideColumns(9);
    if (key === 'progress') sh.hideColumns(t.cols.length);
    sh.getRange(1, 1, 1, t.cols.length).setWrap(true);
    if (SEED[key]) seed_(key, sh);
  }
  return sh;
}
function seed_(key, sh) {
  const rows = SEED[key], n = T[key].cols.length;
  if (key === 'lessons') { sh.getRange('D:D').setNumberFormat('@'); [60, 150, 220, 70, 300, 70, 100, 260, 360, 320].forEach((w, i) => sh.setColumnWidth(i + 1, w)); }
  if (key === 'ctasks') { sh.getRange('B:B').setNumberFormat('@'); sh.getRange('E:E').setNumberFormat('@'); [60, 90, 260, 420, 100, 360].forEach((w, i) => sh.setColumnWidth(i + 1, w)); }
  if (key === 'settings') { sh.getRange('B:B').setNumberFormat('@'); [220, 220, 420].forEach((w, i) => sh.setColumnWidth(i + 1, w)); }
  if (rows.length) sh.getRange(2, 1, rows.length, n).setValues(rows.map(r => r.slice(0, n))).setWrap(true).setVerticalAlignment('top');
}
function rows_(key) {
  const v = sh_(key).getDataRange().getValues();
  return v.slice(1).map((r, i) => ({ row: i + 2, v: r }));
}
function append_(key, arr) { sh_(key).appendRow(arr); }
function set_(key, row, col, val) { sh_(key).getRange(row, col).setValue(val); }
function str_(x) { return x instanceof Date ? Utilities.formatDate(x, TZ, 'dd.MM.yyyy, HH:mm') : String(x == null ? '' : x); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy, HH:mm'); }
const MON_ = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function ruDate_(d) { return +Utilities.formatDate(d, TZ, 'd') + ' ' + MON_[+Utilities.formatDate(d, TZ, 'M') - 1]; }
function short_() { return ruDate_(new Date()); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function lock_(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function cell_(v) { return v instanceof Date ? ruDate_(v) : String(v == null ? '' : v).trim(); }
function lines_(v) { return cell_(v).split('\n').map(s => s.replace(/^([•·\-–—*]|\d+[.)])\s*/, '').trim()).filter(Boolean); }
function plural_(n, f) { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b > 1 && b < 5 ? f[1] : f[2]; }
const norm_ = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/* «05.11.2026, 10:53» по Москве → Date */
function parseRu_(s) { const m = /(\d{2})\.(\d{2})\.(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], (+m[4] || 0) - 3, +m[5] || 0)) : null; }
/* даты дневника: ключи вида 2026-11-05 */
function addKey_(k, n) { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function wd_(k) { return (new Date(k + 'T12:00:00Z').getUTCDay() + 6) % 7; } // 0 — понедельник
function keyRu_(k) { const d = new Date(k + 'T12:00:00Z'); return d.getUTCDate() + ' ' + MON_[d.getUTCMonth()]; }

/* ---------- ученики ---------- */
function stud_(x) { return { row: x.row, code: cell_(x.v[0]), name: cell_(x.v[1]), tg: cell_(x.v[2]), note: cell_(x.v[3]), created: str_(x.v[4]), last: str_(x.v[5]), status: cell_(x.v[6]) || 'active' }; }
function student_(code) {
  const n = norm_(code); if (n.length < 6) return null;
  const r = rows_('students').find(x => norm_(x.v[0]) === n);
  return r ? stud_(r) : null;
}
function pubStudent_(s) { return { code: s.code, name: s.name, tg: s.tg, note: s.note, created: s.created, last: s.last, status: s.status }; }
function genCode_() {
  const used = new Set(rows_('students').map(x => norm_(x.v[0])));
  let c;
  do { c = ''; for (let i = 0; i < 8; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)]; } while (used.has(c));
  return c.slice(0, 4) + '-' + c.slice(4);
}
function issue_(tg, note) {
  return lock_(() => {
    const s = { code: genCode_(), name: '', tg: tg, note: note || '', created: now_(), last: '', status: 'active' };
    append_('students', [s.code, s.name, s.tg, s.note, s.created, s.last, s.status]);
    return s;
  });
}
/* отметка «последний вход» — не чаще раза в 30 минут, чтобы не писать в таблицу на каждое открытие */
function touch_(s) {
  const prev = parseRu_(s.last);
  if (!prev || Date.now() - prev.getTime() > 30 * 60000) { s.last = now_(); set_('students', s.row, 6, s.last); }
}

/* ---------- программа курса ---------- */
function mats_(v) {
  return cell_(v).split('\n').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.lastIndexOf('|');
    if (i < 0) return /^https?:\/\//i.test(s) ? ['', s] : [s, ''];
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  });
}
function course_() {
  const stages = [], fix = [];
  const at = n => { n = Math.max(1, Math.min(40, parseInt(n, 10) || 1)); while (stages.length < n) stages.push({ title: '', goal: '', lessons: [], tasks: [] }); return stages[n - 1]; };
  const L = rows_('lessons'), K = rows_('ctasks');
  const used = new Set();
  const nextId = (rows, col, p) => { let m = 0; rows.forEach(x => { const r = new RegExp('^' + p + '(\\d+)$').exec(cell_(x.v[col])); if (r) m = Math.max(m, +r[1]); }); return () => p + (++m); };
  const newL = nextId(L, 3, 'l'), newT = nextId(K, 1, 't');
  let stage = 1;
  L.forEach(x => {
    if (cell_(x.v[0])) stage = cell_(x.v[0]);
    const st = at(stage), title = cell_(x.v[4]);
    if (!st.title && cell_(x.v[1])) st.title = cell_(x.v[1]);
    if (!st.goal && cell_(x.v[2])) st.goal = cell_(x.v[2]);
    if (!title) return;
    let id = cell_(x.v[3]);
    if (!id || used.has(id)) { id = newL(); fix.push(['lessons', x.row, 4, id]); }
    used.add(id);
    st.lessons.push([id, title, Math.max(0, Math.round(Number(String(x.v[5]).replace(',', '.')) || 0)), cell_(x.v[6]) || 'Видео', cell_(x.v[7]), cell_(x.v[8]), mats_(x.v[9])]);
  });
  stage = 1;
  K.forEach(x => {
    if (cell_(x.v[0])) stage = cell_(x.v[0]);
    const title = cell_(x.v[2]); if (!title) return;
    let id = cell_(x.v[1]);
    if (!id || used.has(id)) { id = newT(); fix.push(['ctasks', x.row, 2, id]); }
    used.add(id);
    at(stage).tasks.push([id, title, cell_(x.v[3]), cell_(x.v[4]), lines_(x.v[5])]);
  });
  if (fix.length) lock_(() => fix.forEach(f => set_(f[0], f[1], f[2], f[3])));
  const settings = {};
  rows_('settings').forEach(x => { const k = SETTING_KEYS[cell_(x.v[0])]; if (k) settings[k] = cell_(x.v[1]); });
  const list = stages.filter(s => s.lessons.length || s.tasks.length);
  list.forEach((s, i) => { if (!s.title) s.title = 'Этап ' + (i + 1); });
  return { stages: list, settings: settings, curator: settings.curator || 'Куратор' };
}

/* ---------- итоги недели ---------- */
function makeReview_(days, possible) {
  const rep = days.filter(e => e && e.reported);
  let tot = 0, ok = 0; const done = [], fails = [];
  rep.forEach(e => (e.tasks || []).forEach(t => { tot++; if (t.done) { ok++; done.push(t); } else fails.push(t); }));
  const unrep = days.filter(e => e && !e.reported).reduce((a, e) => a.concat(e.tasks || []), []);
  const moods = rep.map(e => e.mood).filter(m => m && m.mind && m.motivation && m.energy);
  const avg = k => moods.length ? Math.round(moods.reduce((a, m) => a + Number(m[k]), 0) / moods.length * 10) / 10 : null;
  const A = { mind: avg('mind'), motivation: avg('motivation'), energy: avg('energy') };
  const n = rep.length, P = Math.max(n, possible || 7), pct = tot ? Math.round(ok / tot * 100) : null;
  const S = [];
  if (!n) S.push('Задачи на неделю были, но вечерних отчётов не было, поэтому непонятно, что из них получилось.');
  else if (n === P) S.push('Ровный ритм: отчёт был каждый день, ' + n + ' из ' + P + '.');
  else if (n / P >= .7) S.push('Хороший ритм: отчёты ' + n + ' из ' + P + ' ' + (P % 10 === 1 && P % 100 !== 11 ? 'дня' : 'дней') + '.');
  else if (n / P >= .4) S.push('Ритм неровный: отчёты ' + n + ' из ' + P + ' дней.');
  else S.push('Отчётов мало: ' + n + ' из ' + P + ' дней, поэтому картина недели неполная.');
  if (tot) {
    const base = 'Выполнено ' + ok + ' из ' + tot + ' ' + plural_(tot, ['задачи', 'задач', 'задач']) + ' (' + pct + '%)';
    S.push(pct >= 80 ? base + ', это сильный результат.' : pct >= 50 ? base + ': хороший задел, но часть задач уходит на потом.' : base + ': задач ставится больше, чем успевается сделать.');
  }
  if (moods.length) {
    const f1 = x => String(x).replace('.', ',');
    const one = moods.every(m => m.all != null || (m.mind == m.motivation && m.motivation == m.energy));
    if (one) S.push('Средний заряд за неделю: ' + f1(A.mind) + ' из 10.');
    else S.push('В среднем за неделю: состояние ' + f1(A.mind) + ', мотивация ' + f1(A.motivation) + ', энергия ' + f1(A.energy) + ' из 10.');
    const low = one ? (A.mind <= 4.5 ? ['заряд'] : []) : [['состояние', A.mind], ['мотивация', A.motivation], ['энергия', A.energy]].filter(x => x[1] <= 4.5).map(x => x[0]);
    if (low.length) S.push((low.length > 1 ? 'Проседают ' + low.join(' и ') : 'Проседает ' + low[0]) + ': это главный риск следующей недели.');
    else if (moods.length >= 3) {
      const sum = m => Number(m.mind) + Number(m.motivation) + Number(m.energy);
      if (sum(moods[0]) - sum(moods[moods.length - 1]) >= 6) S.push('К концу недели самочувствие заметно просело.');
    }
  }
  const why = fails.filter(t => t.why && String(t.why).trim().length > 3).pop();
  if (why) S.push('Что мешало: «' + String(why.why).trim().replace(/[.!]+$/, '').slice(0, 140) + '».');

  const uniq = (arr, key) => { const seen = {}; return arr.filter(x => { const k = String(key(x)).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }); };
  const W = [];
  uniq(done.slice().reverse(), t => t.text).slice(0, 2).forEach(t => W.push(String(t.text)));
  if (n >= 5) W.push('Отчёты ' + n + ' из ' + P + ' дней: привычка работает');
  else if (pct !== null && pct >= 80) W.push('Выполнено ' + pct + '% задач');
  if (!W.length) W.push(n ? 'Неделя пройдена с отчётами, есть от чего отталкиваться' : 'Задачи на неделю поставлены, это первый шаг');

  const F = [];
  const stuck = uniq(fails.concat(unrep.filter(t => t.done !== true)).sort((a, b) => (b.tries || 1) - (a.tries || 1)), t => t.text);
  const finish = t => 'Доведи до конца: «' + String(t.text).slice(0, 90) + '»';
  if (stuck[0]) F.push(finish(stuck[0]));
  if ((A.energy !== null && A.energy <= 5) || (A.mind !== null && A.mind <= 5)) F.push('Запланируй восстановление: сон, прогулка, один спокойный вечер');
  else if (A.motivation !== null && A.motivation <= 5 && !(A.motivation === A.mind && A.mind === A.energy)) F.push('Вспомни, ради какой цели учишься, и каждый день делай одну задачу, которая к ней ведёт');
  if (n < P) F.push('Сдавай отчёт каждый вечер, хватит 2–3 строк');
  if (pct !== null && pct < 50 && tot >= 4) F.push('Ставь 2–3 главные задачи в день вместо длинного списка');
  if (stuck[1] && (stuck[1].tries || 1) >= 2) F.push(finish(stuck[1]));
  if (n >= 5 && pct !== null && pct >= 80) F.push('Подними планку: добавь одну задачу, которая ближе всего к первым деньгам');
  if (F.length < 2) F.push('Держи темп: утром 2–3 задачи, вечером короткий отчёт');
  return { done: n + ' из ' + P + ' ' + (P % 10 === 1 && P % 100 !== 11 ? 'дня' : 'дней'), summary: S.join(' '), wins: W.slice(0, 3), focus: F.slice(0, 3) };
}
/* Разбор появляется сам: в воскресенье с 20:00, если отчёт за воскресенье уже сдан, иначе с понедельника */
function ensureReview_(s, journal, reviewRows) {
  const now = new Date(), today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), hour = +Utilities.formatDate(now, TZ, 'H');
  const mon = addKey_(today, -wd_(today));
  const sundayReady = wd_(today) === 6 && hour >= 20 && journal[today] && journal[today].reported;
  const start = sundayReady ? mon : addKey_(mon, -7);
  const keys = [0, 1, 2, 3, 4, 5, 6].map(i => addKey_(start, i));
  const first = keys.findIndex(k => journal[k] && (journal[k].tasks || []).length);
  if (first < 0) return false;
  const label = keyRu_(keys[0]) + ' – ' + keyRu_(keys[6]);
  const has = rows => rows.some(x => cell_(x.v[0]) === s.code && (cell_(x.v[8]) === start || cell_(x.v[2]) === label));
  if (has(reviewRows)) return false;
  const older = Object.keys(journal).some(k => k < start && journal[k] && (journal[k].tasks || []).length);
  const r = makeReview_(keys.map(k => journal[k] || null), older ? 7 : 7 - first);
  return lock_(() => {
    if (has(rows_('reviews'))) return false;
    append_('reviews', [s.code, s.name, label, r.done, r.summary, r.wins.map(x => '• ' + x).join('\n'), r.focus.map(x => '• ' + x).join('\n'), short_(), "'" + start]);
    return true;
  });
}

/* ---------- данные ученика ---------- */
function pull_(s, withCourse) {
  const code = s.code;
  const prog = rows_('progress').find(x => cell_(x.v[0]) === code);
  const journal = {};
  rows_('journal').filter(x => cell_(x.v[0]) === code).forEach(x => { try { journal[str_(x.v[2]).slice(0, 10)] = JSON.parse(x.v[8]); } catch (e) {} });
  const st = { 'Принято': 'accepted', 'На доработке': 'rework' };
  const submissions = rows_('submissions').filter(x => cell_(x.v[1]) === code).map(x => ({
    taskId: cell_(x.v[3]), answer: cell_(x.v[5]), sentAt: str_(x.v[6]), status: st[cell_(x.v[7])] || 'review', score: x.v[8] || '', comment: cell_(x.v[9]), commentAt: str_(x.v[10])
  }));
  const requests = rows_('requests').filter(x => cell_(x.v[1]) === code).map(x => ({
    id: x.v[0], num: x.v[3], date: cell_(x.v[4]), text: cell_(x.v[5]), photos: cell_(x.v[6]).split('\n').filter(Boolean),
    reply: cell_(x.v[7]), replyDate: str_(x.v[8]), status: cell_(x.v[7]) ? 'answered' : 'waiting'
  })).reverse();
  let revRows = rows_('reviews');
  try { if (ensureReview_(s, journal, revRows)) revRows = rows_('reviews'); } catch (e) {}
  const reviews = revRows.filter(x => cell_(x.v[0]) === code).map(x => ({
    week: cell_(x.v[2]), done: cell_(x.v[3]), summary: cell_(x.v[4]), wins: lines_(x.v[5]), focus: lines_(x.v[6]), date: cell_(x.v[7])
  })).reverse();
  let progress = null; try { progress = prog ? JSON.parse(prog.v[3]) : null; } catch (e) {}
  const res = { progress, journal, submissions, requests, reviews };
  if (withCourse) res.course = course_();
  return res;
}
function saveProgress_(s, data) {
  return lock_(() => {
    const json = JSON.stringify({ lessons: data.lessons || {}, current: data.current || '' });
    const r = rows_('progress').find(x => cell_(x.v[0]) === s.code);
    if (r) sh_('progress').getRange(r.row, 2, 1, 3).setValues([[s.name, now_(), json]]);
    else append_('progress', [s.code, s.name, now_(), json]);
  });
}
function saveDay_(s, date, e) {
  return lock_(() => {
    const tasks = (e.tasks || []);
    const list = tasks.map((t, i) => (i + 1) + '. ' + t.text).join('\n');
    const done = e.reported ? tasks.filter(t => t.done).length + ' из ' + tasks.length : '';
    const why = e.reported ? tasks.filter(t => t.done === false).map(t => '• ' + t.text + ' — ' + (t.why || '')).join('\n') : '';
    const m = e.mood || {};
    const vals = [s.code, s.name, "'" + date, list, done, why, e.planAt || '', e.reported ? (e.reportAt || 'да') : '', JSON.stringify(e), m.mind || '', m.motivation || '', m.energy || ''];
    const r = rows_('journal').find(x => cell_(x.v[0]) === s.code && str_(x.v[2]).slice(0, 10) === date);
    if (r) sh_('journal').getRange(r.row, 1, 1, vals.length).setValues([vals]);
    else append_('journal', vals);
  });
}
function savePhotos_(list, code) {
  if (!list || !list.length) return [];
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
  return list.slice(0, 5).map((d, i) => {
    const m = String(d).match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) return '';
    const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], code + '_' + Date.now() + '_' + i + '.jpg'));
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1200';
  }).filter(Boolean);
}

/* ---------- кабинет куратора ---------- */
function json_(v) { try { return JSON.parse(v); } catch (e) { return null; } }
function adminData_() {
  const studs = rows_('students').map(x => { const s = stud_(x); delete s.row; return s; });
  const subs = rows_('submissions').map(x => ({ id: String(x.v[0]), code: cell_(x.v[1]), name: cell_(x.v[2]), taskId: cell_(x.v[3]), task: cell_(x.v[4]), answer: cell_(x.v[5]), sentAt: str_(x.v[6]), status: cell_(x.v[7]) || 'На проверке', score: x.v[8], comment: cell_(x.v[9]) }));
  const reqs = rows_('requests').map(x => ({ id: String(x.v[0]), code: cell_(x.v[1]), name: cell_(x.v[2]), num: x.v[3], date: cell_(x.v[4]), text: cell_(x.v[5]), photos: cell_(x.v[6]).split('\n').filter(Boolean), reply: cell_(x.v[7]), replyDate: str_(x.v[8]) }));
  const prog = {}; rows_('progress').forEach(x => { const p = json_(x.v[3]); if (p) prog[cell_(x.v[0])] = p; });
  const jr = {}; rows_('journal').forEach(x => { const c = cell_(x.v[0]); (jr[c] = jr[c] || []).push({ date: str_(x.v[2]).slice(0, 10), entry: json_(x.v[8]) || { tasks: [] } }); });
  const latest = {}, prev = {};
  subs.forEach(s => { const k = s.code + '|' + s.taskId; if (latest[k] && latest[k].comment) prev[k] = latest[k]; latest[k] = s; });
  const last = Object.keys(latest).map(k => Object.assign({}, latest[k], prev[k] ? { prevComment: prev[k].comment, prevStatus: prev[k].status } : {}));
  const students = studs.map(st => {
    const mine = last.filter(s => s.code === st.code);
    const days = (jr[st.code] || []).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 7);
    return Object.assign(st, {
      lessons: Object.keys((prog[st.code] || {}).lessons || {}).length,
      lessonIds: Object.keys((prog[st.code] || {}).lessons || {}),
      accepted: mine.filter(s => s.status === 'Принято').length,
      review: mine.filter(s => s.status === 'На проверке').length,
      rework: mine.filter(s => s.status === 'На доработке').length,
      tasks: mine.map(s => ({ id: s.taskId, status: s.status, score: s.score })),
      avgScore: (function () { const sc = mine.map(s => Number(s.score)).filter(n => n > 0); return sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length * 10) / 10 : null; })(),
      days: days
    });
  }).reverse();
  return {
    students: students,
    pending: last.filter(s => s.status === 'На проверке').reverse(),
    questions: reqs.filter(r => !r.reply).reverse(),
    answered: reqs.filter(r => r.reply).slice(-20).reverse(),
    course: course_()
  };
}

/* ---------- точка входа ---------- */
function doGet() { return out_({ ok: true, service: 'kurs' }); }

function doPost(e) {
  let d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Неверный запрос' }); }
  const adminKey = prop_('ADMIN_KEY');
  const isAdmin = !!d.key && !!adminKey && d.key === adminKey;
  const need = () => {
    const s = student_(d.code);
    if (!s) return { err: out_({ ok: false, error: 'Такого кода нет. Проверь буквы и цифры или напиши куратору.', reason: 'not_found' }) };
    if (s.status !== 'active') return { err: out_({ ok: false, error: 'Доступ по этому коду приостановлен. Напиши куратору.', reason: 'blocked' }) };
    return { s };
  };
  try {
    switch (d.action) {
      case 'verify': { const r = need(); if (r.err) return r.err; r.s.last = now_(); set_('students', r.s.row, 6, r.s.last); return out_({ ok: true, student: pubStudent_(r.s) }); }
      case 'setName': {
        const r = need(); if (r.err) return r.err;
        const name = String(d.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        if (name.length < 2) return out_({ ok: false, error: 'Слишком короткое имя' });
        set_('students', r.s.row, 2, name); r.s.name = name;
        return out_({ ok: true, student: pubStudent_(r.s) });
      }
      case 'pull': {
        const r = need(); if (r.err) return r.err;
        touch_(r.s);
        return out_(Object.assign({ ok: true, student: pubStudent_(r.s) }, pull_(r.s, !!d.withCourse)));
      }
      case 'saveProgress': { const r = need(); if (r.err) return r.err; saveProgress_(r.s, d.data || {}); return out_({ ok: true }); }
      case 'saveDay': { const r = need(); if (r.err) return r.err; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) return out_({ ok: false, error: 'Неверная дата' }); saveDay_(r.s, String(d.date), d.entry || {}); return out_({ ok: true }); }
      case 'submitTask': {
        const r = need(); if (r.err) return r.err;
        const answer = String(d.answer || '').trim().slice(0, 5000);
        if (!answer) return out_({ ok: false, error: 'Пустой ответ' });
        const sentAt = now_();
        lock_(() => append_('submissions', [Date.now(), r.s.code, r.s.name, String(d.taskId || ''), String(d.task || '').slice(0, 200), answer, sentAt, 'На проверке', '', '', '']));
        return out_({ ok: true, sentAt: sentAt });
      }
      case 'sendRequest': {
        const r = need(); if (r.err) return r.err;
        const text = String(d.text || '').trim().slice(0, 5000);
        if (!text) return out_({ ok: false, error: 'Напиши вопрос' });
        const photos = savePhotos_(d.photos, r.s.code);
        const req = lock_(() => {
          const num = rows_('requests').filter(x => cell_(x.v[1]) === r.s.code).reduce((m, x) => Math.max(m, Number(x.v[3]) || 0), 0) + 1;
          const q = { id: Date.now(), num: num, date: short_(), text: text, photos: photos, status: 'waiting', reply: '' };
          append_('requests', [q.id, r.s.code, r.s.name, q.num, q.date, q.text, photos.join('\n'), '', '']);
          return q;
        });
        return out_({ ok: true, request: req });
      }

      case 'adminCheck':
        if (!adminKey) { // первый вход: введённый пароль становится паролем админки
          if (String(d.key || '').length < 6) return out_({ ok: false, error: 'Придумай пароль от 6 символов' });
          PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', String(d.key));
          return out_({ ok: true, created: true });
        }
        return out_(isAdmin ? { ok: true } : { ok: false, error: 'Неверный пароль' });
      case 'list':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        return out_({ ok: true, students: rows_('students').map(x => pubStudent_(stud_(x))).reverse() });
      case 'create':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        return out_({ ok: true, student: pubStudent_(issue_(String(d.tg || '').slice(0, 64), String(d.note || '').slice(0, 200))) });
      case 'toggle': {
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        const s = student_(d.code); if (!s) return out_({ ok: false, error: 'Код не найден' });
        set_('students', s.row, 7, s.status === 'active' ? 'blocked' : 'active');
        return out_({ ok: true });
      }
      case 'adminData':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        return out_(Object.assign({ ok: true }, adminData_()));
      case 'review': {
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        const r = rows_('submissions').find(x => String(x.v[0]) === String(d.id));
        if (!r) return out_({ ok: false, error: 'Сдача не найдена' });
        const score = Number(d.score) >= 1 && Number(d.score) <= 10 ? Number(d.score) : '';
        sh_('submissions').getRange(r.row, 8, 1, 4).setValues([[d.status === 'accepted' ? 'Принято' : 'На доработке', score, String(d.comment || '').slice(0, 3000), now_()]]);
        return out_({ ok: true });
      }
      case 'reply': {
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        const r = rows_('requests').find(x => String(x.v[0]) === String(d.id));
        if (!r) return out_({ ok: false, error: 'Вопрос не найден' });
        const text = String(d.text || '').trim().slice(0, 5000);
        if (!text) return out_({ ok: false, error: 'Пустой ответ' });
        sh_('requests').getRange(r.row, 8, 1, 2).setValues([[text, now_()]]);
        return out_({ ok: true });
      }
      case 'saveReview':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        append_('reviews', [d.code, d.name || '', d.week, d.done, d.summary, (d.wins || []).map(x => '• ' + x).join('\n'), (d.focus || []).map(x => '• ' + x).join('\n'), short_(), '']);
        return out_({ ok: true });
      case 'botIssue':
        if (!d.botKey || d.botKey !== prop_('BOT_KEY')) return out_({ ok: false, error: 'Нет доступа' });
        return out_({ ok: true, student: pubStudent_(issue_(String(d.tg || ''), String(d.note || 'Выдан ботом'))) });
    }
    return out_({ ok: false, error: 'Неизвестное действие' });
  } catch (err) {
    return out_({ ok: false, error: 'Ошибка сервера: ' + err.message });
  }
}

/* Запустить один раз вручную: создаёт все листы и запрашивает доступы */
function setup() {
  Object.keys(T).forEach(sh_);
  const first = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Лист1') || SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (first && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(first);
  DriveApp.getRootFolder();
}
