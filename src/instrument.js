/**
 * 楽器の組（アンサンブル）の唯一の定義。
 *
 * 曲そのものは楽器を知らない。compose.js が組むのは常に「標準の長調・短調の音」で、
 * ここで決まるのは**それを何で鳴らすか**だけである。だから楽器を変えても
 * 楽節構造も和音も転調も1ミリも動かず、同じ曲コードは同じ曲のまま鳴る。
 *
 *   key      設定に保存される値。曲コードにも載る
 *   label    画面に出す名前
 *   layers   声部ごとの音色。実体は synth.js の TIMBRES / PADS
 *   midi     書き出す MIDI の音色番号（General MIDI）
 *
 * 声部は melody（主旋律）/ accomp（伴奏の分散和音）/ bass / pad の4つ。
 * ベースをピアノに寄せてある組が多いのは、撥弦の低音は減衰が速すぎて
 * 土台が抜けるため。低音だけは伸びる楽器に持たせたほうが曲が立つ。
 */

export const INSTRUMENTS = [
  {
    key: 'piano',
    label: 'ピアノ',
    layers: { melody: 'piano', accomp: 'piano', bass: 'piano', pad: 'warm' },
    midi: { melody: 0, accomp: 0 },          // Acoustic Grand Piano
  },
  {
    key: 'epiano',
    label: 'エレクトリックピアノ',
    layers: { melody: 'epiano', accomp: 'epiano', bass: 'epiano', pad: 'warm' },
    midi: { melody: 4, accomp: 4 },          // Electric Piano 1
  },
  {
    key: 'harp',
    label: 'ハープ',
    layers: { melody: 'harp', accomp: 'harp', bass: 'piano', pad: 'air' },
    midi: { melody: 46, accomp: 46 },        // Orchestral Harp
  },
  {
    key: 'guitar',
    label: 'ガットギター',
    layers: { melody: 'guitar', accomp: 'guitar', bass: 'guitar', pad: 'warm' },
    midi: { melody: 24, accomp: 24 },        // Nylon String Guitar
  },
  {
    key: 'koto',
    label: '箏（こと）',
    layers: { melody: 'koto', accomp: 'koto', bass: 'piano', pad: 'air' },
    midi: { melody: 107, accomp: 107 },      // Koto
  },
  {
    key: 'flute',
    label: '笛と箏',
    layers: { melody: 'shakuhachi', accomp: 'koto', bass: 'piano', pad: 'air' },
    midi: { melody: 77, accomp: 107 },       // Shakuhachi / Koto
  },
  {
    key: 'strings',
    label: '弦楽（擦弦とハープ）',
    layers: { melody: 'strings', accomp: 'harp', bass: 'piano', pad: 'bowed' },
    midi: { melody: 110, accomp: 46 },       // Fiddle / Orchestral Harp
  },
  {
    key: 'santur',
    label: 'ダルシマー（打弦）',
    layers: { melody: 'santur', accomp: 'oud', bass: 'piano', pad: 'bowed' },
    midi: { melody: 15, accomp: 24 },        // Dulcimer / Nylon Guitar
  },
];

const BY_KEY = new Map(INSTRUMENTS.map((i) => [i.key, i]));

export const DEFAULT_INSTRUMENT = INSTRUMENTS[0];

/** 未知のキーはピアノへ落とす。設定が壊れていても曲は鳴らす。 */
export function resolveInstrument(key) {
  return BY_KEY.get(String(key ?? '')) ?? DEFAULT_INSTRUMENT;
}

/** settings.js の choice 用 [[値, 表示], ...] */
export function instrumentOptions() {
  return INSTRUMENTS.map((i) => [i.key, i.label]);
}

/** 声部 → 音色名。synth.js が発音のたびに引く。 */
export function layersFor(key) {
  return resolveInstrument(key).layers;
}

/**
 * 書き出す MIDI の音色番号（General MIDI のプログラム番号）。
 * 画面で鳴っている楽器に、GM のなかでいちばん近いものを当てる。
 */
export function midiProgramsFor(key) {
  const midi = resolveInstrument(key).midi;
  return { melody: midi?.melody ?? 0, accomp: midi?.accomp ?? 0 };
}
