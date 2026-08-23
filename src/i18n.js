/**
 * 表示文字列の多言語化。日本語・英語・中国語（簡体）。
 *
 * 文字列をここに集めてあるのは、翻訳のためだけではない。
 * UI の言い回しが1か所に並んでいると、
 * 「同じことを別の場所で違う言葉で言っている」がすぐ見つかる。
 *
 * ここに無いもの（音名・コードネーム・BPM）は翻訳しない。
 * C や Am7 は世界共通の記号で、訳すとかえって読めなくなる。
 */

export const LOCALES = [
  ['ja', '日本語'],
  ['en', 'English'],
  ['zh', '中文'],
];

const STORAGE_KEY = 'melodyGenerator.locale';
const DEFAULT_LOCALE = 'ja';

const MESSAGES = {
  ja: {
    'app.title': '無限ヒーリングピアノ',
    'app.description': '静かなピアノ曲を、途切れることなく生成し続けます。',
    'app.tagline': '無限ヒーリングピアノ',

    'transport.group': '再生操作',
    'transport.prev': '前の曲へ戻る',
    'transport.play': '再生する',
    'transport.pause': '停止する',
    'transport.next': '次の曲へ進む',

    'nowplaying.idle': '再生ボタンで、一曲目が生まれます',
    'song.bars': '{n}小節',
    'meta.sep': ' ・ ',

    'score.empty': '再生すると、ここに楽譜が出ます',
    'score.region': '楽譜（横にスクロールできます）',
    'score.failed': 'この曲の楽譜は表示できませんでした',
    'score.show': '楽譜を出す',
    'score.hide': '楽譜を隠す',

    'tools.label': '道具',
    'tool.score': '楽譜',
    'tool.settings': '設定',
    'tool.export': '保存',
    'tool.share': '共有',

    'sheet.close': '閉じる',
    'sheet.settings': '設定',
    'sheet.settingsNote': '変えた設定は、その場で鳴り直して反映されます。',
    'sheet.export': '保存',
    'sheet.exportNote':
      'MusicXML は MuseScore などで五線譜として開けます。MIDI は DAW で編集できます。',

    'settings.language': '言語',
    'settings.reset': '既定値に戻す',

    'group.sound': '音',
    'group.compose': '曲',
    'group.humanize': '演奏',

    'param.masterVolume': '音量',
    'param.instrument': '楽器',
    'param.mood': '曲の雰囲気',
    'param.tempoFeel': 'テンポ',
    'param.composerEngine': '作曲エンジン',
    'hint.composerEngine': '現行版を残したまま、新しい歌唱旋律エンジンと切り替えます',
    'hint.instrument': '曲の作りはそのまま、鳴らす楽器だけが変わります',
    'hint.mood': '長調と短調のどちらを多く引くか',

    'opt.mood.bright': '明るめ',
    'opt.mood.balanced': 'バランス',
    'opt.mood.wistful': '切なめ',
    'opt.tempo.slow': 'ゆっくり',
    'opt.tempo.normal': 'ふつう',
    'opt.tempo.flowing': '少し速め',
    'opt.engine.codex': 'Codex 試作版（不採用）',
    'opt.engine.codex2': 'Codex 第2版（選抜型）',
    'opt.engine.codex3': 'Codex 第3版（主題型）',
    'opt.engine.claude': 'Claude 現行版',

    'inst.piano': 'ピアノ',
    'inst.epiano': 'エレクトリックピアノ',
    'inst.harp': 'ハープ',
    'inst.guitar': 'ガットギター',
    'inst.koto': '箏（こと）',
    'inst.flute': '笛と箏',
    'inst.strings': '弦楽（擦弦とハープ）',
    'inst.santur': 'ダルシマー（打弦）',

    'status.copied': 'URL をコピーしました',
    'status.copyFail': 'コピーできませんでした。アドレス欄の URL を控えてください',
    'status.noSong': '再生すると、共有できる URL になります',
    'status.noPrev': 'これより前に聴いた曲はまだありません',
    'status.loading': 'データを読み込んでいます…',
    'status.loadFail':
      'データを読み込めませんでした（{message}）。ローカルサーバー経由で開いてください（npm start）。',
    'status.audioFail': '音声を初期化できませんでした: {message}',
    'status.playFail': '再生を開始できませんでした: {message}',
    'status.noData': 'データを読み込めていないため再生できません',
    'status.exportFail': '書き出せませんでした: {message}',

    'foot.algorithm': 'アルゴリズム解説',
    'foot.created': 'Created by Jounlai Cho (cho@heuron.com)',
    'foot.company': 'ヒューロン株式会社',
    'foot.built': 'Built with Anthropic Claude and OpenAI Codex',

    'key.major': '長調',
    'key.minor': '短調',
  },

  en: {
    'app.title': 'Endless Healing Piano',
    'app.description': 'Quiet piano music, composed continuously and never repeating.',
    'app.tagline': 'Endless Healing Piano',

    'transport.group': 'Playback controls',
    'transport.prev': 'Previous piece',
    'transport.play': 'Play',
    'transport.pause': 'Pause',
    'transport.next': 'Next piece',

    'nowplaying.idle': 'Press play — the first piece is composed on the spot',
    'song.bars': '{n} bars',
    'meta.sep': ' · ',

    'score.empty': 'The score appears here once playback starts',
    'score.region': 'Score (scrolls horizontally)',
    'score.failed': 'The score for this piece could not be drawn',
    'score.show': 'Show score',
    'score.hide': 'Hide score',

    'tools.label': 'Tools',
    'tool.score': 'Score',
    'tool.settings': 'Settings',
    'tool.export': 'Save',
    'tool.share': 'Share',

    'sheet.close': 'Close',
    'sheet.settings': 'Settings',
    'sheet.settingsNote': 'Changes apply at once — the piece restarts with the new setting.',
    'sheet.export': 'Save',
    'sheet.exportNote':
      'MusicXML opens as staff notation in MuseScore and similar. MIDI can be edited in a DAW.',

    'settings.language': 'Language',
    'settings.reset': 'Reset to defaults',

    'group.sound': 'Sound',
    'group.compose': 'Music',
    'group.humanize': 'Performance',

    'param.masterVolume': 'Volume',
    'param.instrument': 'Instrument',
    'param.mood': 'Mood',
    'param.tempoFeel': 'Tempo',
    'param.composerEngine': 'Composer',
    'hint.composerEngine': 'Switch between the original engine and the new vocal-phrase engine',
    'hint.instrument': 'Only the sound changes; the music itself stays the same',
    'hint.mood': 'How often major keys are drawn over minor',

    'opt.mood.bright': 'Brighter',
    'opt.mood.balanced': 'Balanced',
    'opt.mood.wistful': 'Wistful',
    'opt.tempo.slow': 'Slow',
    'opt.tempo.normal': 'Moderate',
    'opt.tempo.flowing': 'Flowing',
    'opt.engine.codex': 'Codex prototype (rejected)',
    'opt.engine.codex2': 'Codex v2 (critic-selected)',
    'opt.engine.codex3': 'Codex v3 (motif-led)',
    'opt.engine.claude': 'Claude original',

    'inst.piano': 'Piano',
    'inst.epiano': 'Electric piano',
    'inst.harp': 'Harp',
    'inst.guitar': 'Nylon-string guitar',
    'inst.koto': 'Koto',
    'inst.flute': 'Shakuhachi and koto',
    'inst.strings': 'Strings and harp',
    'inst.santur': 'Hammered dulcimer',

    'status.copied': 'URL copied',
    'status.copyFail': 'Could not copy. Please take the URL from the address bar.',
    'status.noSong': 'Start playback to get a shareable URL',
    'status.noPrev': 'Nothing played before this one yet',
    'status.loading': 'Loading data…',
    'status.loadFail':
      'Could not load the data ({message}). Please open it through a local server (npm start).',
    'status.audioFail': 'Could not start audio: {message}',
    'status.playFail': 'Could not start playback: {message}',
    'status.noData': 'Cannot play — the data has not loaded',
    'status.exportFail': 'Could not export: {message}',

    'foot.algorithm': 'How it works',
    'foot.created': 'Created by Jounlai Cho (cho@heuron.com)',
    'foot.company': 'Heuron Inc.',
    'foot.built': 'Built with Anthropic Claude and OpenAI Codex',

    'key.major': 'major',
    'key.minor': 'minor',
  },

  zh: {
    'app.title': '无限疗愈钢琴',
    'app.description': '不间断地生成安静的钢琴曲。',
    'app.tagline': '无限疗愈钢琴',

    'transport.group': '播放控制',
    'transport.prev': '上一首',
    'transport.play': '播放',
    'transport.pause': '暂停',
    'transport.next': '下一首',

    'nowplaying.idle': '按下播放键，第一首乐曲就此诞生',
    'song.bars': '{n}小节',
    'meta.sep': ' ・ ',

    'score.empty': '播放后，乐谱会显示在这里',
    'score.region': '乐谱（可横向滚动）',
    'score.failed': '无法显示这首乐曲的乐谱',
    'score.show': '显示乐谱',
    'score.hide': '隐藏乐谱',

    'tools.label': '工具',
    'tool.score': '乐谱',
    'tool.settings': '设置',
    'tool.export': '保存',
    'tool.share': '分享',

    'sheet.close': '关闭',
    'sheet.settings': '设置',
    'sheet.settingsNote': '更改会立即生效，乐曲将以新设置重新播放。',
    'sheet.export': '保存',
    'sheet.exportNote':
      'MusicXML 可用 MuseScore 等软件打开为五线谱，MIDI 可在 DAW 中编辑。',

    'settings.language': '语言',
    'settings.reset': '恢复默认',

    'group.sound': '声音',
    'group.compose': '乐曲',
    'group.humanize': '演奏',

    'param.masterVolume': '音量',
    'param.instrument': '乐器',
    'param.mood': '曲风',
    'param.tempoFeel': '速度',
    'param.composerEngine': '作曲引擎',
    'hint.composerEngine': '在原版与新的歌唱旋律引擎之间切换',
    'hint.instrument': '乐曲本身不变，只改变演奏的乐器',
    'hint.mood': '大调与小调的抽取比例',

    'opt.mood.bright': '明亮',
    'opt.mood.balanced': '均衡',
    'opt.mood.wistful': '忧伤',
    'opt.tempo.slow': '缓慢',
    'opt.tempo.normal': '适中',
    'opt.tempo.flowing': '稍快',
    'opt.engine.codex': 'Codex 试作版（未采用）',
    'opt.engine.codex2': 'Codex 第2版（筛选型）',
    'opt.engine.codex3': 'Codex 第3版（主题型）',
    'opt.engine.claude': 'Claude 原版',

    'inst.piano': '钢琴',
    'inst.epiano': '电钢琴',
    'inst.harp': '竖琴',
    'inst.guitar': '尼龙弦吉他',
    'inst.koto': '筝',
    'inst.flute': '尺八与筝',
    'inst.strings': '弦乐与竖琴',
    'inst.santur': '扬琴',

    'status.copied': '已复制链接',
    'status.copyFail': '复制失败，请从地址栏复制链接。',
    'status.noSong': '播放后即可获得可分享的链接',
    'status.noPrev': '此前还没有播放过其他乐曲',
    'status.loading': '正在加载数据…',
    'status.loadFail': '无法加载数据（{message}）。请通过本地服务器打开（npm start）。',
    'status.audioFail': '无法初始化音频：{message}',
    'status.playFail': '无法开始播放：{message}',
    'status.noData': '数据尚未加载，无法播放',
    'status.exportFail': '导出失败：{message}',

    'foot.algorithm': '旋律生成算法说明',
    'foot.created': 'Created by Jounlai Cho (cho@heuron.com)',
    'foot.company': 'Heuron 株式会社',
    'foot.built': 'Built with Anthropic Claude and OpenAI Codex',

    'key.major': '大调',
    'key.minor': '小调',
  },
};

const KNOWN = new Set(LOCALES.map(([code]) => code));
let current = DEFAULT_LOCALE;
const listeners = new Set();

/**
 * 使う言語を決める。優先順は URL の ?lang → 保存された選択 → ブラウザの設定。
 * 中国語は zh-Hans / zh-TW などいろいろな書き方で来るので、先頭2文字で見る。
 */
export function detectLocale() {
  try {
    const url = new URL(globalThis.location?.href ?? 'http://x/');
    const asked = url.searchParams.get('lang');
    if (asked && KNOWN.has(asked)) return asked;
  } catch (_) { /* location が無い環境 */ }
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved && KNOWN.has(saved)) return saved;
  } catch (_) { /* プライベートモード */ }
  const langs = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''];
  for (const raw of langs) {
    const head = String(raw ?? '').slice(0, 2).toLowerCase();
    if (KNOWN.has(head)) return head;
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return current;
}

/** 言語を切り替え、購読している側へ知らせる。保存できなくても切り替えは続ける。 */
export function setLocale(next) {
  const value = KNOWN.has(next) ? next : DEFAULT_LOCALE;
  if (value === current) return current;
  current = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch (_) { /* 保存できなくても表示は切り替わる */ }
  try {
    if (globalThis.document) globalThis.document.documentElement.lang = value;
  } catch (_) { /* DOM が無い環境 */ }
  for (const cb of listeners) {
    try {
      cb(value);
    } catch (err) {
      console.error('言語の切り替えに失敗しました', err);
    }
  }
  return current;
}

export function onLocaleChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 文字列を引く。`{name}` を vars で差し替える。
 * 訳が無いキーは日本語へ、それも無ければキーそのものを返す
 * （画面が空白になるより、キーが見えたほうが直せる）。
 */
export function t(key, vars) {
  const table = MESSAGES[current] ?? MESSAGES[DEFAULT_LOCALE];
  const text = table[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// 調名の綴り。日本語だけが音名を訳す（ハニホヘトイロ）。
const JP_LETTER = { C: 'ハ', D: 'ニ', E: 'ホ', F: 'ヘ', G: 'ト', A: 'イ', B: 'ロ' };

/**
 * 調の名前。'Bb' + 'major' から、その言語での呼び方を作る。
 *
 *   ja  変ロ長調
 *   en  B♭ major
 *   zh  降B大调
 */
export function keyLabel(tonicName, mode) {
  const name = String(tonicName ?? 'C');
  const letter = name[0];
  const sign = name.length > 1 ? name[1] : '';
  const quality = t(mode === 'minor' ? 'key.minor' : 'key.major');

  if (current === 'ja') {
    const prefix = sign === '#' ? '嬰' : sign === 'b' ? '変' : '';
    return `${prefix}${JP_LETTER[letter] ?? letter}${quality}`;
  }
  if (current === 'zh') {
    const prefix = sign === '#' ? '升' : sign === 'b' ? '降' : '';
    return `${prefix}${letter}${quality}`;
  }
  const pretty = sign === '#' ? '♯' : sign === 'b' ? '♭' : '';
  return `${letter}${pretty} ${quality}`;
}

/**
 * data-i18n / data-i18n-attr が付いた要素へ訳を流し込む。
 *
 *   <span data-i18n="tool.score">楽譜</span>
 *   <button data-i18n-attr="aria-label:transport.next">
 *
 * HTML 側に日本語を書いたまま属性を足せるので、印付けを1つずつ確かめられる。
 */
export function applyI18n(root = globalThis.document) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(/\s*,\s*/)) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
  const title = root.querySelector?.('title[data-i18n-title]');
  if (title) title.textContent = t(title.dataset.i18nTitle);
}
