// 名旋律コーパス。
//
// ここにあるのは「断片としてそのまま鳴らすための素材」ではない。
// extractPatterns.js が n-gram に刻んで統計を取るための母集団であり、
// 出力側に残るのは「音程の並び方の癖」だけで、どの曲かは分からなくなる。
//
// ■ 著作権について（最重要）
//   収録できるのはパブリックドメインの作品のみ。基準は次の2つだけ。
//     - 作曲者が 1955 年以前に没している（没後70年に余裕を持たせた線）
//     - または作曲者不明の伝承曲・民謡（died: null）
//   全エントリに composer / died を必ず持たせ、test/corpus.test.js が
//   機械的に監査する。迷ったものは収録しない。
//
// ■ 採譜について
//   記憶からの採譜であり、細部（特に装飾音・臨時記号）は正確ではない。
//   目的は語法の統計を取ることなので、輪郭・跳躍の位置・終止の形が
//   保たれていればよい。半音階（Für Elise の D♯ など）は最寄りの
//   スケール度数に丸めている。
//
// ■ 表記
//   deg    : スケール度数。1 = 主音、8 = 1オクターブ上の主音。
//            主音より下は 0（＝下の7度）, -1, -2 … と続く。
//            短調のエントリは自然短音階の度数（3 = 短3度）。
//   dur    : 拍数。4分音符 = 1.0。
//   region : 旋律の出自。地域ごとの語法差（音域の広さ・順次進行率）を
//            測るためのタグで、作曲者の属した伝統で分類する。
//            'italian' | 'latin' | 'japanese' | 'korean' | 'anglo'
//            | 'german-austrian' | 'french' | 'slavic' | 'other'
//
// ■ 構成
//   前半は器楽を含む古典の名旋律（初期の57曲）。
//   後半「歌もの・バラードの増補」は歌に寄せて足した分で、
//   ナポリ歌曲・タンゴ・パーラーソング・霊歌・唱歌・アジアの伝承を含む。

const n = (deg, dur) => ({ deg, dur });

// region に使える値。test/corpus.test.js が全エントリをこれで監査する。
// extractPatterns.js 側は実際に現れた region を拾って集計するので、
// ここに無い値を書くとテストで弾かれる。
export const REGIONS = [
  'anglo', 'french', 'german-austrian', 'italian', 'japanese',
  'korean', 'latin', 'other', 'slavic',
];

export const CORPUS = [
  // ---- Johann Sebastian Bach (1685-1750) ----
  {
    id: 'bach-air-g-string',
    title: 'Air on the G String (BWV 1068)',
    composer: 'Johann Sebastian Bach',
    died: 1750,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    // 持続音 → 4度上への跳躍 → 延々と順次下降。バロックの息の長い線。
    notes: [
      n(5, 3), n(5, 1), n(8, 2), n(7, 1), n(6, 1), n(5, 1.5),
      n(4, 0.5), n(3, 1), n(2, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'bach-jesu-joy',
    title: "Jesu, Joy of Man's Desiring (BWV 147)",
    composer: 'Johann Sebastian Bach',
    died: 1750,
    mode: 'major',
    region: 'german-austrian',
    meter: '9/8',
    // 8分音符が途切れず流れ続けるコラール。3度の跳躍を順次で埋め戻す典型。
    notes: [
      n(1, 0.5), n(2, 0.5), n(3, 0.5), n(5, 0.5), n(4, 0.5), n(3, 0.5),
      n(1, 0.5), n(3, 0.5), n(2, 0.5), n(1, 0.5), n(0, 0.5), n(1, 0.5),
      n(2, 0.5), n(3, 0.5), n(5, 0.5), n(4, 1),
    ],
  },
  {
    id: 'petzold-minuet-g',
    title: 'Minuet in G (BWV Anh.114)',
    // 長くバッハ作とされたが実際は Petzold 作。どちらにせよPD。
    composer: 'Christian Petzold',
    died: 1762,
    mode: 'major',
    region: 'german-austrian',
    meter: '3/4',
    notes: [
      n(5, 1), n(1, 0.5), n(2, 0.5), n(3, 0.5), n(4, 0.5), n(5, 1),
      n(1, 1), n(1, 1), n(6, 1), n(4, 0.5), n(5, 0.5), n(6, 0.5),
      n(7, 0.5), n(8, 1),
    ],
  },
  {
    id: 'pachelbel-canon',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    died: 1706,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    // 第1声部の入り。全音符級の順次下降だけで出来ている。
    notes: [
      n(3, 1), n(2, 1), n(1, 1), n(0, 1), n(-1, 1), n(-2, 1), n(-1, 1), n(0, 1),
      n(3, 0.5), n(2, 0.5), n(3, 0.5), n(5, 0.5), n(3, 0.5), n(2, 0.5), n(1, 1),
    ],
  },

  // ---- Wolfgang Amadeus Mozart (1756-1791) ----
  {
    id: 'mozart-ave-verum',
    title: 'Ave Verum Corpus (K.618)',
    composer: 'Wolfgang Amadeus Mozart',
    died: 1791,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    notes: [
      n(1, 2), n(1, 1), n(2, 0.5), n(3, 0.5), n(4, 2), n(3, 1),
      n(2, 1), n(5, 2), n(4, 1), n(3, 1), n(2, 2), n(1, 2),
    ],
  },
  {
    id: 'mozart-sonata-k545',
    title: 'Piano Sonata K.545, 1st mvt',
    composer: 'Wolfgang Amadeus Mozart',
    died: 1791,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    // 主和音の分散で登り、回音で折り返し、順次で降りる。古典派の教科書。
    notes: [
      n(1, 1), n(3, 1), n(5, 2), n(7, 1), n(8, 1), n(9, 1), n(8, 1),
      n(5, 2), n(4, 0.5), n(3, 0.5), n(2, 0.5), n(1, 0.5), n(0, 1), n(1, 1),
    ],
  },
  {
    id: 'mozart-lacrimosa',
    title: 'Lacrimosa (Requiem K.626)',
    composer: 'Wolfgang Amadeus Mozart',
    died: 1791,
    mode: 'minor',
    region: 'german-austrian',
    meter: '12/8',
    // 5度から半音刻みで登りつめる嘆きの線を、全音階に丸めたもの。
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5), n(4, 1),
      n(5, 1), n(6, 1), n(7, 0.5), n(8, 0.5), n(7, 1), n(6, 1), n(5, 2),
    ],
  },

  // ---- Ludwig van Beethoven (1770-1827) ----
  {
    id: 'beethoven-fur-elise',
    title: 'Für Elise (WoO 59)',
    composer: 'Ludwig van Beethoven',
    died: 1827,
    mode: 'minor',
    region: 'german-austrian',
    meter: '3/8',
    // D♯ は度数4に丸めている。後半は分散和音なので跳躍が連続する。
    notes: [
      n(5, 0.5), n(4, 0.5), n(5, 0.5), n(4, 0.5), n(5, 0.5), n(2, 0.5),
      n(4, 0.5), n(3, 0.5), n(1, 1), n(-4, 0.5), n(-2, 0.5), n(1, 0.5), n(2, 1),
    ],
  },
  {
    id: 'beethoven-moonlight-1',
    title: 'Piano Sonata Op.27-2 "Moonlight", 1st mvt',
    composer: 'Ludwig van Beethoven',
    died: 1827,
    mode: 'minor',
    region: 'german-austrian',
    meter: '2/2',
    // ほぼ同音反復。刺繍音ひとつで持たせて、最後だけ主音に降りる。
    notes: [
      n(5, 2), n(5, 1), n(5, 1), n(6, 2), n(5, 2), n(5, 1),
      n(6, 1), n(5, 2), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'beethoven-pathetique-2',
    title: 'Piano Sonata Op.13 "Pathétique", 2nd mvt',
    composer: 'Ludwig van Beethoven',
    died: 1827,
    mode: 'major',
    region: 'german-austrian',
    meter: '2/4',
    notes: [
      n(1, 1), n(3, 1), n(2, 0.5), n(1, 0.5), n(2, 1), n(3, 1),
      n(4, 1), n(3, 0.5), n(2, 0.5), n(1, 1), n(0, 1), n(1, 2),
    ],
  },
  {
    id: 'beethoven-ode-to-joy',
    title: 'Ode to Joy (Symphony No.9, 4th mvt)',
    composer: 'Ludwig van Beethoven',
    died: 1827,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    // 跳躍ゼロ。順次と同音だけで最も有名な旋律が成立している例。
    notes: [
      n(3, 1), n(3, 1), n(4, 1), n(5, 1), n(5, 1), n(4, 1), n(3, 1), n(2, 1),
      n(1, 1), n(1, 1), n(2, 1), n(3, 1), n(3, 1.5), n(2, 0.5), n(2, 2),
    ],
  },

  // ---- Franz Schubert (1797-1828) ----
  {
    id: 'schubert-ave-maria',
    title: 'Ave Maria (D.839)',
    composer: 'Franz Schubert',
    died: 1828,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    notes: [
      n(5, 1.5), n(5, 0.5), n(6, 1), n(5, 1), n(4, 0.5), n(5, 0.5), n(6, 1),
      n(8, 1), n(7, 0.5), n(6, 0.5), n(5, 1), n(4, 1), n(3, 0.5), n(2, 0.5), n(1, 2),
    ],
  },
  {
    id: 'schubert-standchen',
    title: 'Ständchen "Serenade" (D.957-4)',
    composer: 'Franz Schubert',
    died: 1828,
    mode: 'minor',
    region: 'german-austrian',
    meter: '3/4',
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(5, 1), n(4, 0.5),
      n(3, 0.5), n(2, 1), n(1, 1), n(2, 1), n(3, 1), n(2, 2),
    ],
  },

  // ---- Felix Mendelssohn (1809-1847) ----
  {
    id: 'mendelssohn-on-wings-of-song',
    title: 'Auf Flügeln des Gesanges (Op.34-2)',
    composer: 'Felix Mendelssohn',
    died: 1847,
    mode: 'major',
    region: 'german-austrian',
    meter: '6/8',
    notes: [
      n(3, 0.5), n(3, 0.5), n(3, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(2, 1), n(3, 0.5), n(5, 0.5), n(6, 1), n(5, 0.5), n(4, 0.5), n(3, 1.5),
    ],
  },

  // ---- Frédéric Chopin (1810-1849) ----
  {
    id: 'chopin-nocturne-9-2',
    title: 'Nocturne Op.9 No.2',
    composer: 'Frédéric Chopin',
    died: 1849,
    mode: 'major',
    region: 'slavic',
    meter: '12/8',
    // 5度で始まり刺繍音、オクターブへ跳んでから装飾的に降りる。
    notes: [
      n(5, 1.5), n(6, 0.5), n(5, 1), n(8, 1), n(7, 0.5), n(8, 0.5),
      n(6, 1), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1.5),
    ],
  },
  {
    id: 'chopin-prelude-28-4',
    title: 'Prelude Op.28 No.4',
    composer: 'Frédéric Chopin',
    died: 1849,
    mode: 'minor',
    region: 'slavic',
    meter: '2/2',
    // 旋律はほとんど動かない。動くのは下の和声だけ、という極端な例。
    notes: [
      n(5, 2), n(5, 1), n(5, 1), n(6, 1), n(5, 2), n(5, 1),
      n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 2), n(2, 1), n(1, 3),
    ],
  },
  {
    id: 'chopin-prelude-28-7',
    title: 'Prelude Op.28 No.7',
    composer: 'Frédéric Chopin',
    died: 1849,
    mode: 'major',
    region: 'slavic',
    meter: '3/4',
    notes: [
      n(5, 0.5), n(1, 1), n(2, 0.5), n(3, 1), n(5, 0.5), n(4, 1),
      n(3, 0.5), n(2, 1.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'chopin-etude-10-3',
    title: 'Étude Op.10 No.3 "Tristesse"',
    composer: 'Frédéric Chopin',
    died: 1849,
    mode: 'major',
    region: 'slavic',
    meter: '2/4',
    // 高音域に住む旋律。刺繍音を挟みながらじりじり頂点まで登る。
    notes: [
      n(5, 0.5), n(8, 1.5), n(7, 0.5), n(8, 0.5), n(9, 0.5), n(8, 1),
      n(9, 0.5), n(10, 1.5), n(9, 0.5), n(8, 1), n(7, 1), n(8, 2),
    ],
  },
  {
    id: 'chopin-nocturne-55-1',
    title: 'Nocturne Op.55 No.1',
    composer: 'Frédéric Chopin',
    died: 1849,
    mode: 'minor',
    region: 'slavic',
    meter: '4/4',
    notes: [
      n(5, 1), n(5, 0.5), n(5, 0.5), n(6, 1), n(5, 1), n(4, 0.5), n(3, 0.5),
      n(2, 1), n(1, 2), n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- Robert Schumann (1810-1856) ----
  {
    id: 'schumann-traumerei',
    title: 'Träumerei (Kinderszenen Op.15-7)',
    composer: 'Robert Schumann',
    died: 1856,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    // 弱起から和音の音を伝って10度上まで登り、そこから順次で降りる。
    notes: [
      n(5, 0.5), n(1, 1.5), n(3, 0.5), n(5, 1), n(8, 1), n(7, 0.5), n(6, 0.5),
      n(5, 1), n(4, 1), n(3, 0.5), n(4, 0.5), n(5, 1), n(4, 2),
    ],
  },

  // ---- Stephen Foster (1826-1864) ----
  {
    id: 'foster-beautiful-dreamer',
    title: 'Beautiful Dreamer',
    composer: 'Stephen Foster',
    died: 1864,
    mode: 'major',
    region: 'anglo',
    meter: '9/8',
    notes: [
      n(8, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(5, 1), n(3, 1), n(1, 2),
      n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- Jacques Offenbach (1819-1880) ----
  {
    id: 'offenbach-barcarolle',
    title: "Barcarolle (Les contes d'Hoffmann)",
    composer: 'Jacques Offenbach',
    died: 1880,
    mode: 'major',
    region: 'french',
    meter: '6/8',
    // 同じ揺れを2度繰り返してから解決する。舟歌の常套。
    notes: [
      n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(5, 1), n(6, 0.5), n(5, 0.5),
      n(3, 1), n(2, 1), n(3, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- Franz Liszt (1811-1886) ----
  {
    id: 'liszt-liebestraum-3',
    title: 'Liebestraum No.3 (S.541-3)',
    composer: 'Franz Liszt',
    died: 1886,
    mode: 'major',
    region: 'other',
    meter: '6/4',
    notes: [
      n(1, 1), n(2, 0.5), n(3, 0.5), n(5, 1), n(3, 1), n(2, 1), n(1, 1), n(3, 1),
      n(5, 1), n(6, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- Pyotr Ilyich Tchaikovsky (1840-1893) ----
  {
    id: 'tchaikovsky-barcarolle-june',
    title: 'Barcarolle "June" (The Seasons Op.37a)',
    composer: 'Pyotr Ilyich Tchaikovsky',
    died: 1893,
    mode: 'minor',
    region: 'slavic',
    meter: '4/4',
    notes: [
      n(3, 1), n(2, 0.5), n(1, 0.5), n(0, 1), n(1, 1), n(2, 1),
      n(3, 1), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'tchaikovsky-swan-lake',
    title: 'Swan Theme (Swan Lake Op.20)',
    composer: 'Pyotr Ilyich Tchaikovsky',
    died: 1893,
    mode: 'minor',
    region: 'slavic',
    meter: '4/4',
    // 長い保続の主音から、弧を描いて登って降りて主音へ戻る。
    notes: [
      n(1, 3), n(1, 1), n(3, 1), n(2, 0.5), n(1, 0.5), n(0, 1), n(1, 1),
      n(2, 1), n(3, 2), n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- Antonin Dvořák (1841-1904) ----
  {
    id: 'dvorak-largo-going-home',
    title: 'Largo (Symphony No.9 "From the New World", 2nd mvt)',
    composer: 'Antonín Dvořák',
    died: 1904,
    mode: 'major',
    region: 'slavic',
    meter: '4/4',
    // 五音音階。最後に主音の下の5度まで落ちるのがこの旋律の顔。
    notes: [
      n(3, 1), n(5, 1), n(5, 2), n(3, 1), n(2, 1), n(1, 2), n(1, 0.5),
      n(2, 0.5), n(3, 1), n(2, 1), n(1, 1), n(-1, 1), n(-2, 2),
    ],
  },

  // ---- Edvard Grieg (1843-1907) ----
  {
    id: 'grieg-solveigs-song',
    title: "Solveig's Song (Peer Gynt Op.55)",
    composer: 'Edvard Grieg',
    died: 1907,
    mode: 'minor',
    region: 'other',
    meter: '4/4',
    notes: [
      n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1), n(2, 0.5),
      n(3, 0.5), n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'grieg-morning-mood',
    title: 'Morning Mood (Peer Gynt Op.46)',
    composer: 'Edvard Grieg',
    died: 1907,
    mode: 'major',
    region: 'other',
    meter: '6/8',
    // 五音音階の波。同じ形を高い位置で繰り返す。
    notes: [
      n(3, 0.5), n(2, 0.5), n(1, 0.5), n(2, 0.5), n(3, 0.5), n(5, 0.5), n(3, 1), n(5, 1),
      n(8, 0.5), n(6, 0.5), n(5, 0.5), n(6, 0.5), n(8, 0.5), n(5, 0.5), n(3, 1),
    ],
  },

  // ---- Jules Massenet (1842-1912) ----
  {
    id: 'massenet-meditation-thais',
    title: 'Méditation (Thaïs)',
    composer: 'Jules Massenet',
    died: 1912,
    mode: 'major',
    region: 'french',
    meter: '4/4',
    notes: [
      n(5, 2), n(8, 1), n(7, 0.5), n(8, 0.5), n(9, 1), n(8, 1), n(7, 1),
      n(6, 1), n(5, 2), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- Claude Debussy (1862-1918) ----
  {
    id: 'debussy-clair-de-lune',
    title: 'Clair de lune (Suite bergamasque)',
    composer: 'Claude Debussy',
    died: 1918,
    mode: 'major',
    region: 'french',
    meter: '9/8',
    // 3度で落ちるため息を並べ、最後だけ主音まで滑らせる。
    notes: [
      n(5, 1.5), n(3, 1.5), n(2, 0.5), n(3, 0.5), n(5, 1), n(3, 1), n(2, 1),
      n(1, 1.5), n(2, 0.5), n(3, 1), n(5, 1), n(3, 1), n(1, 2),
    ],
  },
  {
    id: 'debussy-reverie',
    title: 'Rêverie (L.68)',
    composer: 'Claude Debussy',
    died: 1918,
    mode: 'major',
    region: 'french',
    meter: '4/4',
    notes: [
      n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(5, 1), n(6, 1), n(8, 2),
      n(7, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'debussy-arabesque-1',
    title: 'Arabesque No.1 (L.66)',
    composer: 'Claude Debussy',
    died: 1918,
    mode: 'major',
    region: 'french',
    meter: '4/4',
    notes: [
      n(5, 0.5), n(6, 0.5), n(8, 0.5), n(7, 0.5), n(6, 0.5), n(5, 0.5), n(3, 1),
      n(5, 0.5), n(6, 0.5), n(8, 1), n(9, 0.5), n(8, 0.5), n(6, 1), n(5, 2),
    ],
  },

  // ---- Camille Saint-Saëns (1835-1921) ----
  {
    id: 'saint-saens-the-swan',
    title: 'Le Cygne (Le Carnaval des animaux)',
    composer: 'Camille Saint-Saëns',
    died: 1921,
    mode: 'major',
    region: 'french',
    meter: '6/4',
    notes: [
      n(5, 1), n(8, 2), n(7, 0.5), n(6, 0.5), n(5, 1), n(6, 1), n(8, 1),
      n(7, 1), n(6, 2), n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- Gabriel Fauré (1845-1924) ----
  {
    id: 'faure-sicilienne',
    title: 'Sicilienne (Op.78)',
    composer: 'Gabriel Fauré',
    died: 1924,
    mode: 'minor',
    region: 'french',
    meter: '6/8',
    notes: [
      n(-3, 0.5), n(1, 1), n(0, 0.5), n(1, 0.5), n(2, 0.5), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(0, 0.5), n(1, 1.5), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1), n(1, 1.5),
    ],
  },
  {
    id: 'faure-apres-un-reve',
    title: 'Après un rêve (Op.7-1)',
    composer: 'Gabriel Fauré',
    died: 1924,
    mode: 'minor',
    region: 'french',
    meter: '3/4',
    notes: [
      n(1, 1), n(1, 0.5), n(3, 0.5), n(2, 1), n(1, 1), n(5, 1),
      n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1), n(0, 1), n(1, 2),
    ],
  },
  {
    id: 'faure-pavane',
    title: 'Pavane (Op.50)',
    composer: 'Gabriel Fauré',
    died: 1924,
    mode: 'minor',
    region: 'french',
    meter: '4/4',
    notes: [
      n(3, 0.5), n(2, 0.5), n(1, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(0, 1), n(1, 1), n(2, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },

  // ---- Giacomo Puccini (1858-1924) ----
  {
    id: 'puccini-o-mio-babbino-caro',
    title: 'O mio babbino caro (Gianni Schicchi)',
    composer: 'Giacomo Puccini',
    died: 1924,
    mode: 'major',
    region: 'italian',
    meter: '6/8',
    // 一息にオクターブへ跳び上がってから、ゆっくり降りてくる。
    notes: [
      n(3, 0.5), n(5, 0.5), n(8, 1.5), n(7, 0.5), n(6, 1), n(5, 1), n(6, 0.5),
      n(5, 0.5), n(3, 1), n(2, 1), n(3, 1), n(2, 0.5), n(1, 0.5), n(1, 2),
    ],
  },

  // ---- Erik Satie (1866-1925) ----
  {
    id: 'satie-gymnopedie-1',
    title: 'Gymnopédie No.1',
    composer: 'Erik Satie',
    died: 1925,
    mode: 'major',
    region: 'french',
    meter: '3/4',
    // 音価が極端に長い。1音あたりの情報量が少ないのがこの曲の語法。
    notes: [
      n(5, 3), n(4, 1.5), n(3, 1.5), n(5, 3), n(3, 1.5), n(2, 1.5), n(1, 3),
      n(0, 1.5), n(1, 1.5), n(3, 3), n(2, 1.5), n(1, 1.5), n(1, 3),
    ],
  },
  {
    id: 'satie-gnossienne-1',
    title: 'Gnossienne No.1',
    composer: 'Erik Satie',
    died: 1925,
    mode: 'minor',
    region: 'french',
    meter: 'free',
    notes: [
      n(5, 0.5), n(6, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1),
      n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 0.5), n(1, 0.5), n(0, 1), n(1, 2),
    ],
  },

  // ---- Edward Elgar (1857-1934) ----
  {
    id: 'elgar-salut-damour',
    title: "Salut d'Amour (Op.12)",
    composer: 'Edward Elgar',
    died: 1934,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(3, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(2, 0.5), n(1, 0.5),
      n(2, 1), n(3, 2), n(6, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'elgar-nimrod',
    title: 'Nimrod (Enigma Variations Op.36)',
    composer: 'Edward Elgar',
    died: 1934,
    mode: 'major',
    region: 'anglo',
    meter: '3/4',
    // 一度沈んでから登り直す。頂点を後ろに置く典型的な「感動の設計」。
    notes: [
      n(3, 1.5), n(2, 0.5), n(3, 1), n(4, 1), n(5, 2), n(4, 0.5), n(3, 0.5),
      n(5, 1), n(6, 1), n(8, 2), n(7, 1), n(6, 1), n(5, 2),
    ],
  },

  // ---- Maurice Ravel (1875-1937) ----
  {
    id: 'ravel-pavane-infante',
    title: 'Pavane pour une infante défunte',
    composer: 'Maurice Ravel',
    died: 1937,
    mode: 'major',
    region: 'french',
    meter: '4/4',
    notes: [
      n(3, 1), n(2, 1), n(3, 1), n(5, 1), n(3, 2), n(2, 1), n(1, 1),
      n(2, 1), n(3, 1), n(5, 2), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- 滝廉太郎 Rentarō Taki (1879-1903) ----
  {
    id: 'taki-kojo-no-tsuki',
    title: '荒城の月',
    composer: '滝廉太郎 (Rentarō Taki)',
    died: 1903,
    mode: 'minor',
    region: 'japanese',
    meter: '4/4',
    // 前半と後半が同じ形の平行移動。動機として極めて強い。
    notes: [
      n(1, 1), n(4, 1), n(5, 1), n(6, 1), n(5, 1), n(4, 1), n(5, 2),
      n(5, 1), n(6, 1), n(7, 1), n(8, 1), n(7, 1), n(6, 1), n(5, 2),
    ],
  },
  {
    id: 'taki-hana',
    title: '花',
    composer: '滝廉太郎 (Rentarō Taki)',
    died: 1903,
    mode: 'major',
    region: 'japanese',
    meter: '2/4',
    notes: [
      n(3, 0.5), n(3, 0.5), n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(2, 0.5),
      n(3, 0.5), n(5, 1), n(6, 1), n(5, 2), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- 中田章 Akira Nakada (1886-1931) ----
  {
    id: 'nakada-soshunfu',
    title: '早春賦',
    composer: '中田章 (Akira Nakada)',
    died: 1931,
    mode: 'major',
    region: 'japanese',
    meter: '6/8',
    notes: [
      n(3, 0.5), n(5, 0.5), n(8, 1.5), n(7, 0.5), n(6, 0.5), n(5, 1), n(3, 0.5),
      n(5, 0.5), n(6, 1), n(5, 0.5), n(3, 0.5), n(2, 1), n(1, 1.5),
    ],
  },

  // ---- 岡野貞一 Teiichi Okano (1878-1941) ----
  {
    id: 'okano-furusato',
    title: 'ふるさと',
    composer: '岡野貞一 (Teiichi Okano)',
    died: 1941,
    mode: 'major',
    region: 'japanese',
    meter: '3/4',
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(7, 1), n(7, 1), n(8, 1), n(7, 0.5),
      n(6, 0.5), n(5, 1), n(6, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'okano-oborozukiyo',
    title: '朧月夜',
    composer: '岡野貞一 (Teiichi Okano)',
    died: 1941,
    mode: 'major',
    region: 'japanese',
    meter: '3/4',
    notes: [
      n(1, 1), n(3, 1), n(5, 1), n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1),
      n(2, 1), n(1, 1), n(2, 1), n(3, 1), n(5, 1), n(3, 2),
    ],
  },
  {
    id: 'okano-haru-no-ogawa',
    title: '春の小川',
    composer: '岡野貞一 (Teiichi Okano)',
    died: 1941,
    mode: 'major',
    region: 'japanese',
    meter: '4/4',
    notes: [
      n(5, 0.5), n(5, 0.5), n(6, 0.5), n(5, 0.5), n(3, 1), n(2, 0.5), n(1, 0.5),
      n(2, 1), n(3, 0.5), n(5, 0.5), n(6, 0.5), n(5, 0.5), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- 成田為三 Tamezō Narita (1893-1945) ----
  {
    id: 'narita-hamabe-no-uta',
    title: '浜辺の歌',
    composer: '成田為三 (Tamezō Narita)',
    died: 1945,
    mode: 'major',
    region: 'japanese',
    meter: '6/8',
    notes: [
      n(1, 0.5), n(2, 0.5), n(3, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 0.5),
      n(2, 0.5), n(1, 1), n(2, 0.5), n(3, 0.5), n(5, 1), n(3, 0.5), n(2, 0.5), n(1, 1.5),
    ],
  },

  // ---- 伝承曲 / traditional (composer unknown) ----
  {
    id: 'trad-londonderry-air',
    title: 'Londonderry Air (Danny Boy)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 0.5), n(3, 1), n(4, 0.5), n(5, 1.5), n(8, 0.5), n(7, 0.5), n(6, 0.5),
      n(5, 1), n(3, 1), n(4, 0.5), n(5, 0.5), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-greensleeves',
    title: 'Greensleeves',
    composer: null,
    died: null,
    mode: 'minor',
    region: 'anglo',
    meter: '6/8',
    // 下行導音(0)を経由して主音へ戻る、ドリアの終止形。
    notes: [
      n(1, 0.5), n(3, 1), n(4, 0.5), n(5, 1), n(6, 0.5), n(5, 0.5), n(4, 1),
      n(2, 0.5), n(0, 1), n(1, 0.5), n(2, 1), n(3, 0.5), n(1, 1), n(1, 0.5),
      n(0, 1), n(1, 1.5),
    ],
  },
  {
    id: 'trad-amazing-grace',
    title: 'Amazing Grace (New Britain)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '3/4',
    // 完全な五音音階。前半と後半が同じ形で、終わりだけ上に開く。
    notes: [
      n(-2, 1), n(1, 2), n(3, 0.5), n(1, 0.5), n(3, 2), n(2, 1), n(1, 2),
      n(-1, 1), n(-2, 3), n(-2, 1), n(1, 2), n(3, 0.5), n(1, 0.5), n(3, 2),
      n(2, 1), n(5, 3),
    ],
  },
  {
    id: 'trad-auld-lang-syne',
    title: 'Auld Lang Syne (蛍の光)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(-2, 1), n(1, 1.5), n(1, 0.5), n(1, 1), n(3, 1), n(2, 1.5), n(1, 0.5),
      n(2, 1), n(3, 1), n(1, 1.5), n(1, 0.5), n(3, 1), n(5, 1), n(6, 3),
    ],
  },
  {
    id: 'trad-scarborough-fair',
    title: 'Scarborough Fair',
    composer: null,
    died: null,
    mode: 'minor',
    region: 'anglo',
    meter: '3/4',
    notes: [
      n(1, 1), n(1, 1), n(5, 2), n(5, 1), n(5, 1), n(2, 1), n(3, 1), n(2, 1),
      n(1, 3), n(1, 1), n(2, 1), n(3, 1), n(2, 1), n(1, 1), n(0, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-shenandoah',
    title: 'Shenandoah',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 1), n(1, 1), n(3, 1), n(5, 2), n(6, 1), n(5, 1), n(3, 1), n(1, 2),
      n(5, 1), n(6, 1), n(8, 2), n(6, 1), n(5, 1), n(3, 1), n(1, 3),
    ],
  },
  {
    id: 'trad-loch-lomond',
    title: 'Loch Lomond',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 0.5), n(1, 0.5), n(3, 1), n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1),
      n(1, 1), n(2, 0.5), n(3, 0.5), n(2, 1), n(1, 1), n(-2, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-sakura-sakura',
    title: 'さくらさくら',
    composer: null,
    died: null,
    mode: 'minor',
    region: 'japanese',
    meter: '4/4',
    // 都節。半音の刺繍音を2度繰り返してから下へ抜ける。
    notes: [
      n(1, 1), n(1, 1), n(2, 2), n(1, 1), n(1, 1), n(2, 2), n(1, 1), n(2, 1),
      n(3, 1), n(2, 1), n(1, 1), n(2, 1), n(1, 1), n(-1, 1), n(-2, 2),
    ],
  },
  // =========================================================================
  // 歌もの・バラードの増補
  //
  //   ここから下は「歌」に寄せて足した分。息継ぎがあり、跳躍が控えめで、
  //   フレーズの終わりで音を伸ばす旋律を優先している。
  //   狙いは「語りかけて始まり、頂点まで登りつめ、順次で降りて主音に着く」
  //   というバラードの語彙を厚くすること。
  //
  //   ■ ここでも収録基準は同じ（没年1955以下、または作曲者不明の伝承曲）。
  //     候補に挙がったが外したもの:
  //       - 'O sole mio ... 作曲は Eduardo di Capua(没1917)だが、2002年の
  //         イタリア判例で Alfredo Mazzucchi(没1972)が共作者と認定され、
  //         EU では権利が生きている。判断に迷うので入れない。
  //       - Cielito Lindo ... Quirino Mendoza y Cortés 没1957。基準超過。
  //       - Guantanamera ... José Fernández Díaz 没1971。基準超過。
  //       - 「オー・シャンゼリゼ」の原曲 Waterloo Road ... 1969年作。論外。
  //       - 梁田貞(没1959)・山田耕筰(没1965)の唱歌。基準超過。
  // =========================================================================

  // ---- ナポリ歌曲・イタリア歌曲 ----
  // 朗々と歌い上げる線。音域が広く、頂点への大跳躍を持つのが共通の癖。
  {
    id: 'cottrau-santa-lucia',
    title: 'Santa Lucia',
    composer: 'Teodoro Cottrau',
    died: 1879,
    mode: 'major',
    region: 'italian',
    meter: '3/8',
    notes: [
      n(3, 0.5), n(3, 0.5), n(3, 1), n(2, 0.5), n(1, 0.5), n(2, 1),
      n(3, 0.5), n(2, 0.5), n(1, 1), n(5, 1), n(4, 0.5), n(3, 0.5),
      n(2, 1), n(1, 1), n(2, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'denza-funiculi-funicula',
    title: 'Funiculì, Funiculà',
    composer: 'Luigi Denza',
    died: 1922,
    mode: 'major',
    region: 'italian',
    meter: '6/8',
    notes: [
      n(1, 0.5), n(1, 0.5), n(3, 1), n(2, 0.5), n(1, 0.5), n(3, 1),
      n(5, 0.5), n(5, 0.5), n(6, 0.5), n(5, 0.5), n(3, 1),
      n(2, 0.5), n(1, 0.5), n(2, 1), n(1, 1.5),
    ],
  },
  {
    id: 'dicapua-maria-mari',
    title: "Maria, Marì!",
    composer: 'Eduardo di Capua',
    died: 1917,
    mode: 'major',
    region: 'italian',
    meter: '4/4',
    // 3度から一気に6度上へ跳び上がって、あとは順次だけで降りてくる。
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 2), n(8, 2),
      n(7, 0.5), n(6, 0.5), n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'decurtis-torna-a-surriento',
    title: 'Torna a Surriento',
    composer: 'Ernesto De Curtis',
    died: 1937,
    mode: 'minor',
    region: 'italian',
    meter: '4/4',
    notes: [
      n(5, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1), n(1, 2),
      n(3, 0.5), n(4, 0.5), n(5, 1), n(8, 2), n(7, 0.5), n(6, 0.5),
      n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'decurtis-non-ti-scordar-di-me',
    title: 'Non ti scordar di me',
    composer: 'Ernesto De Curtis',
    died: 1937,
    mode: 'major',
    region: 'italian',
    meter: '4/4',
    notes: [
      n(3, 1), n(3, 0.5), n(4, 0.5), n(8, 2), n(7, 1), n(6, 1), n(5, 2),
      n(4, 1), n(3, 1), n(2, 1), n(1, 1), n(2, 1), n(3, 1), n(5, 1), n(8, 3),
    ],
  },
  {
    id: 'cardillo-core-ngrato',
    title: "Core 'ngrato (Catarì)",
    composer: 'Salvatore Cardillo',
    died: 1947,
    mode: 'minor',
    region: 'italian',
    meter: '4/4',
    // 語りかけるように主音まで降りきってから、6度上へ投げ上げる。
    notes: [
      n(5, 1), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
      n(1, 0.5), n(2, 0.5), n(3, 1), n(8, 2), n(7, 1), n(6, 1),
      n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'tosti-ideale',
    title: 'Ideale',
    composer: 'Francesco Paolo Tosti',
    died: 1916,
    mode: 'major',
    region: 'italian',
    meter: '4/4',
    notes: [
      n(1, 1), n(2, 0.5), n(3, 0.5), n(5, 1), n(3, 1), n(2, 1), n(1, 1),
      n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(3, 1), n(5, 1), n(8, 2),
      n(7, 1), n(6, 1), n(5, 2),
    ],
  },
  {
    id: 'tosti-a-vucchella',
    title: "'A vucchella",
    composer: 'Francesco Paolo Tosti',
    died: 1916,
    mode: 'major',
    region: 'italian',
    meter: '3/4',
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
      n(3, 1), n(5, 1), n(6, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'dichiara-la-spagnola',
    title: 'La Spagnola',
    composer: 'Vincenzo Di Chiara',
    died: 1937,
    mode: 'major',
    region: 'italian',
    meter: '4/4',
    notes: [
      n(5, 0.5), n(5, 0.5), n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(1, 1),
      n(2, 0.5), n(3, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1.5),
    ],
  },
  {
    id: 'verdi-la-donna-e-mobile',
    title: 'La donna è mobile (Rigoletto)',
    composer: 'Giuseppe Verdi',
    died: 1901,
    mode: 'major',
    region: 'italian',
    meter: '3/8',
    // 高い位置から2音ずつ降りてくる。跳躍が一つも無い。
    notes: [
      n(5, 0.5), n(5, 0.5), n(4, 0.5), n(4, 0.5), n(3, 1), n(3, 0.5), n(4, 0.5),
      n(5, 0.5), n(4, 0.5), n(3, 0.5), n(2, 1), n(2, 0.5), n(3, 0.5), n(4, 0.5),
      n(3, 0.5), n(2, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'verdi-libiamo',
    title: "Libiamo ne' lieti calici (La traviata)",
    composer: 'Giuseppe Verdi',
    died: 1901,
    mode: 'major',
    region: 'italian',
    meter: '3/8',
    notes: [
      n(5, 0.5), n(5, 1), n(4, 0.5), n(3, 1), n(3, 0.5), n(2, 0.5), n(1, 1),
      n(2, 0.5), n(3, 0.5), n(4, 1), n(3, 0.5), n(2, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'puccini-nessun-dorma',
    title: 'Nessun dorma (Turandot)',
    composer: 'Giacomo Puccini',
    died: 1924,
    mode: 'major',
    region: 'italian',
    meter: '4/4',
    // 語りかけ → 沈む → 最後にオクターブまで登って伸ばす(Vincerò!)。
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(2, 0.5), n(1, 0.5),
      n(2, 1), n(3, 1), n(5, 1), n(4, 1), n(3, 2), n(5, 1), n(6, 1), n(8, 3),
    ],
  },

  // ---- タンゴ・ラテン ----
  {
    id: 'iradier-la-paloma',
    title: 'La Paloma',
    composer: 'Sebastián Iradier',
    died: 1865,
    mode: 'major',
    region: 'latin',
    meter: '2/4',
    notes: [
      n(5, 0.5), n(5, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1),
      n(2, 0.5), n(3, 0.5), n(4, 1), n(3, 0.5), n(2, 0.5), n(1, 1),
      n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'serradell-la-golondrina',
    title: 'La Golondrina',
    composer: 'Narciso Serradell Sevilla',
    died: 1877,
    mode: 'major',
    region: 'latin',
    meter: '3/4',
    notes: [
      n(3, 1), n(3, 0.5), n(2, 0.5), n(1, 1), n(3, 1), n(5, 1.5), n(4, 0.5),
      n(3, 1), n(2, 1), n(1, 1), n(2, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'villoldo-el-choclo',
    title: 'El Choclo',
    composer: 'Ángel Villoldo',
    died: 1919,
    mode: 'minor',
    region: 'latin',
    meter: '2/4',
    // 同音の連打から順次で滑り降りる。タンゴの語り口。
    notes: [
      n(5, 0.5), n(5, 0.5), n(5, 0.5), n(5, 0.5), n(4, 1), n(3, 0.5), n(2, 0.5),
      n(1, 1), n(3, 0.5), n(3, 0.5), n(3, 0.5), n(3, 0.5), n(2, 1),
      n(1, 0.5), n(0, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'rosas-sobre-las-olas',
    title: 'Sobre las Olas',
    composer: 'Juventino Rosas',
    died: 1894,
    mode: 'major',
    region: 'latin',
    meter: '3/4',
    notes: [
      n(1, 1), n(3, 1), n(5, 1), n(8, 2), n(7, 1), n(6, 1), n(5, 2),
      n(4, 1), n(3, 1), n(2, 1), n(3, 1), n(2, 1), n(1, 3),
    ],
  },
  {
    id: 'gardel-por-una-cabeza',
    title: 'Por una Cabeza',
    composer: 'Carlos Gardel',
    died: 1935,
    mode: 'major',
    region: 'latin',
    meter: '4/4',
    notes: [
      n(5, 0.5), n(5, 0.5), n(6, 1), n(5, 0.5), n(3, 0.5), n(2, 1), n(1, 1),
      n(2, 0.5), n(3, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'gardel-el-dia-que-me-quieras',
    title: 'El día que me quieras',
    composer: 'Carlos Gardel',
    died: 1935,
    mode: 'major',
    region: 'latin',
    meter: '3/4',
    notes: [
      n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 1), n(5, 2), n(4, 1), n(3, 1),
      n(2, 2), n(3, 1), n(5, 1), n(8, 2), n(7, 1), n(6, 1), n(5, 1),
      n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'gardel-volver',
    title: 'Volver',
    composer: 'Carlos Gardel',
    died: 1935,
    mode: 'minor',
    region: 'latin',
    meter: '4/4',
    notes: [
      n(1, 0.5), n(1, 0.5), n(2, 0.5), n(3, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5),
      n(2, 1), n(1, 1), n(3, 0.5), n(4, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5),
      n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'matosrodriguez-la-cumparsita',
    title: 'La Cumparsita',
    composer: 'Gerardo Matos Rodríguez',
    died: 1948,
    mode: 'minor',
    region: 'latin',
    meter: '2/4',
    notes: [
      n(5, 0.5), n(4, 0.5), n(3, 0.5), n(2, 0.5), n(1, 1), n(1, 0.5), n(2, 0.5),
      n(3, 1), n(2, 0.5), n(1, 0.5), n(0, 1), n(1, 1),
      n(3, 0.5), n(2, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'lacalle-amapola',
    title: 'Amapola',
    composer: 'José María Lacalle García',
    died: 1937,
    mode: 'major',
    region: 'latin',
    meter: '4/4',
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(8, 1), n(7, 0.5), n(6, 0.5), n(5, 1),
      n(3, 1), n(5, 1), n(6, 1), n(8, 2), n(7, 1), n(6, 1), n(5, 2),
    ],
  },
  {
    id: 'ponce-estrellita',
    title: 'Estrellita',
    composer: 'Manuel M. Ponce',
    died: 1948,
    mode: 'major',
    region: 'latin',
    meter: '4/4',
    notes: [
      n(3, 1), n(5, 1), n(8, 2), n(7, 0.5), n(6, 0.5), n(5, 1), n(6, 1),
      n(5, 1), n(3, 1), n(2, 1), n(1, 1), n(2, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- 韓国の伝承 ----
  // 五音音階。3度の跳躍とその埋め戻しが交互に来るのが癖。
  {
    id: 'trad-arirang',
    title: '아리랑 (Arirang)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'korean',
    meter: '9/8',
    notes: [
      n(5, 1), n(6, 0.5), n(8, 1.5), n(9, 1), n(8, 0.5), n(6, 1), n(5, 1.5),
      n(5, 0.5), n(6, 0.5), n(8, 1), n(9, 1), n(8, 0.5), n(6, 0.5),
      n(5, 1), n(3, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-miryang-arirang',
    title: '밀양아리랑 (Miryang Arirang)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'korean',
    meter: '9/8',
    notes: [
      n(8, 1), n(8, 0.5), n(9, 0.5), n(8, 1), n(6, 1), n(5, 1), n(6, 1),
      n(5, 1), n(3, 1), n(5, 1), n(6, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-doraji-taryeong',
    title: '도라지타령 (Doraji Taryeong)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'korean',
    meter: '9/8',
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(8, 1), n(5, 1), n(5, 0.5), n(6, 0.5),
      n(8, 1), n(9, 1), n(8, 1), n(6, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-saeya-saeya',
    title: '새야 새야 (Saeya Saeya)',
    composer: null,
    died: null,
    mode: 'minor',
    region: 'korean',
    meter: '4/4',
    notes: [
      n(5, 1), n(5, 1), n(4, 1), n(3, 2), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
      n(3, 1), n(4, 1), n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- ドイツ・オーストリアのリート ----
  {
    id: 'schubert-der-lindenbaum',
    title: 'Der Lindenbaum "菩提樹" (D.911-5)',
    composer: 'Franz Schubert',
    died: 1828,
    mode: 'major',
    region: 'german-austrian',
    meter: '3/4',
    notes: [
      n(3, 0.5), n(3, 0.5), n(4, 1), n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1),
      n(3, 1), n(2, 0.5), n(3, 0.5), n(4, 1), n(3, 0.5), n(2, 0.5), n(1, 2),
    ],
  },
  {
    id: 'schubert-heidenroslein',
    title: 'Heidenröslein "野ばら" (D.257)',
    composer: 'Franz Schubert',
    died: 1828,
    mode: 'major',
    region: 'german-austrian',
    meter: '2/4',
    notes: [
      n(5, 0.5), n(5, 0.5), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 0.5), n(1, 1),
      n(2, 0.5), n(3, 0.5), n(4, 0.5), n(3, 0.5), n(2, 0.5), n(1, 1),
      n(3, 0.5), n(2, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'schubert-an-die-musik',
    title: 'An die Musik "楽に寄す" (D.547)',
    composer: 'Franz Schubert',
    died: 1828,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    notes: [
      n(1, 1), n(1, 1), n(3, 1), n(5, 1), n(4, 1), n(3, 0.5), n(2, 0.5),
      n(3, 1), n(2, 1), n(1, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'schumann-widmung',
    title: 'Widmung "献呈" (Op.25-1)',
    composer: 'Robert Schumann',
    died: 1856,
    mode: 'major',
    region: 'german-austrian',
    meter: '4/4',
    // 弱起でいきなり4度上へ投げ上げ、あとは順次で降りる。同じ弧を2度描く。
    notes: [
      n(5, 0.5), n(8, 1.5), n(7, 0.5), n(6, 0.5), n(5, 1), n(5, 0.5), n(6, 0.5),
      n(8, 1), n(7, 0.5), n(6, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5),
      n(2, 1), n(1, 1.5),
    ],
  },
  {
    id: 'brahms-wiegenlied',
    title: 'Wiegenlied "子守歌" (Op.49-4)',
    composer: 'Johannes Brahms',
    died: 1897,
    mode: 'major',
    region: 'german-austrian',
    meter: '3/4',
    // 3度上がって順次で戻る揺りかごを2回、そこから4度上へ登って降りてくる。
    notes: [
      n(3, 1), n(3, 1), n(5, 2), n(5, 1), n(4, 1), n(3, 2), n(3, 1), n(5, 1),
      n(8, 2), n(7, 1), n(6, 1), n(5, 2), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- フランス ----
  {
    id: 'martini-plaisir-damour',
    title: "Plaisir d'amour",
    composer: 'Jean-Paul-Égide Martini',
    died: 1816,
    mode: 'major',
    region: 'french',
    meter: '6/8',
    // 弱起から主和音を伝って5度まで登り、そこから順次だけで主音へ降りる。
    // 「登って、あとはひたすら降りる」というバラードの原型そのもの。
    notes: [
      n(-2, 0.5), n(1, 1.5), n(3, 0.5), n(5, 1), n(4, 0.5), n(3, 1),
      n(2, 0.5), n(1, 1), n(2, 0.5), n(3, 1), n(2, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'franck-panis-angelicus',
    title: 'Panis Angelicus "天使の糧"',
    composer: 'César Franck',
    died: 1890,
    mode: 'major',
    region: 'french',
    meter: '3/4',
    notes: [
      n(1, 1), n(2, 0.5), n(3, 0.5), n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 1),
      n(3, 1), n(8, 2), n(7, 1), n(6, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'bizet-habanera',
    title: "L'amour est un oiseau rebelle (Carmen)",
    composer: 'Georges Bizet',
    died: 1875,
    mode: 'minor',
    region: 'french',
    meter: '2/4',
    // 原曲は半音階の滑り降り。最寄りの度数に丸めると純粋な順次下降になる。
    notes: [
      n(5, 0.5), n(5, 0.5), n(4, 0.5), n(4, 0.5), n(3, 0.5), n(3, 0.5),
      n(2, 0.5), n(2, 0.5), n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 1),
      n(2, 0.5), n(1, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'satie-je-te-veux',
    title: 'Je te veux',
    composer: 'Erik Satie',
    died: 1925,
    mode: 'major',
    region: 'french',
    meter: '3/4',
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(8, 1), n(7, 1), n(6, 1), n(5, 1),
      n(6, 1), n(5, 1), n(3, 1), n(2, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- スラヴ ----
  {
    id: 'dvorak-songs-my-mother-taught-me',
    title: 'Songs My Mother Taught Me "我が母の教え給いし歌" (Op.55-4)',
    composer: 'Antonín Dvořák',
    died: 1904,
    mode: 'major',
    region: 'slavic',
    meter: '2/4',
    notes: [
      n(5, 1), n(8, 1.5), n(7, 0.5), n(6, 1), n(5, 1), n(4, 0.5), n(3, 0.5),
      n(2, 1), n(3, 1), n(2, 1), n(1, 1), n(2, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'tchaikovsky-none-but-the-lonely-heart',
    title: 'None but the Lonely Heart "ただ憧れを知る者だけが" (Op.6-6)',
    composer: 'Pyotr Ilyich Tchaikovsky',
    died: 1893,
    mode: 'minor',
    region: 'slavic',
    meter: '4/4',
    // 低いところで問いかけを2度繰り返し、3度目に6度上まで投げ上げる。
    notes: [
      n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 1), n(2, 1), n(1, 1), n(5, 1),
      n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1), n(3, 1), n(8, 2),
      n(7, 1), n(6, 1), n(5, 2),
    ],
  },
  {
    id: 'rachmaninoff-vocalise',
    title: 'Vocalise (Op.34-14)',
    composer: 'Sergei Rachmaninoff',
    died: 1943,
    mode: 'minor',
    region: 'slavic',
    meter: '4/4',
    notes: [
      n(5, 2), n(4, 1), n(3, 1), n(2, 2), n(1, 1), n(2, 1), n(3, 2),
      n(2, 1), n(1, 1), n(0, 1), n(1, 1), n(3, 1), n(2, 1), n(1, 3),
    ],
  },

  // ---- その他 ----
  {
    id: 'grieg-ich-liebe-dich',
    title: 'Jeg elsker Dig "君を愛す" (Op.5-3)',
    composer: 'Edvard Grieg',
    died: 1907,
    mode: 'major',
    region: 'other',
    meter: '4/4',
    notes: [
      n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
      n(3, 1), n(5, 1), n(6, 1), n(8, 2), n(7, 1), n(6, 1), n(5, 2),
    ],
  },

  // ---- アメリカ/英国のパーラーソング ----
  // ※ Old Folks at Home (Swanee River) は候補に挙がったが、記憶からの採譜に
  //    自信が持てず(冒頭の輪郭が曖昧)、跳躍の埋め戻し率も他と揃わなかったため
  //    収録していない。フォスターは以下の4曲で代表させる。
  {
    id: 'foster-jeanie-light-brown-hair',
    title: 'Jeanie with the Light Brown Hair',
    composer: 'Stephen Foster',
    died: 1864,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(-2, 0.5), n(1, 1), n(2, 0.5), n(3, 0.5), n(5, 1), n(5, 0.5), n(6, 0.5),
      n(5, 1), n(3, 1), n(2, 0.5), n(1, 0.5), n(2, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'foster-hard-times',
    title: 'Hard Times Come Again No More',
    composer: 'Stephen Foster',
    died: 1864,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 0.5), n(1, 0.5), n(2, 0.5), n(3, 0.5), n(5, 1), n(5, 0.5), n(3, 0.5),
      n(2, 1), n(1, 1), n(2, 0.5), n(3, 0.5), n(5, 1), n(3, 0.5), n(2, 0.5), n(1, 2),
    ],
  },
  {
    id: 'foster-my-old-kentucky-home',
    title: 'My Old Kentucky Home',
    composer: 'Stephen Foster',
    died: 1864,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(-2, 0.5), n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 1), n(3, 0.5), n(4, 0.5),
      n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(2, 1), n(1, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'bland-carry-me-back-to-old-virginny',
    title: 'Carry Me Back to Old Virginny',
    composer: 'James A. Bland',
    died: 1911,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 0.5), n(3, 0.5), n(5, 1), n(5, 0.5), n(6, 0.5), n(5, 1), n(3, 1),
      n(2, 0.5), n(1, 0.5), n(2, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'poulton-aura-lee',
    title: 'Aura Lee',
    composer: 'George R. Poulton',
    died: 1867,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    // 順次で登って弧を描き、順次で降りる。跳躍は3度がひとつだけ。
    notes: [
      n(1, 1), n(2, 1), n(3, 1), n(1, 1), n(2, 1), n(3, 1), n(5, 2),
      n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'bishop-home-sweet-home',
    title: 'Home! Sweet Home! (埴生の宿)',
    composer: 'Henry Rowley Bishop',
    died: 1855,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 1), n(3, 0.5), n(2, 0.5), n(1, 1),
      n(2, 1), n(3, 1), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'bayly-long-long-ago',
    title: 'Long, Long Ago (久しき昔)',
    composer: 'Thomas Haynes Bayly',
    died: 1839,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(3, 0.5), n(5, 0.5), n(5, 0.5), n(5, 0.5), n(6, 0.5), n(5, 0.5),
      n(4, 0.5), n(3, 0.5), n(2, 0.5), n(4, 0.5), n(4, 0.5), n(4, 0.5),
      n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'scott-annie-laurie',
    title: 'Annie Laurie',
    composer: 'Alicia Ann Scott',
    died: 1900,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 1), n(3, 0.5), n(2, 0.5), n(1, 1),
      n(5, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1), n(1, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- 黒人霊歌(伝承) ----
  // 五音音階のため跳躍が多い。順次で埋め戻さない下降が語法の一部。
  {
    id: 'trad-deep-river',
    title: 'Deep River',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 1), n(3, 1), n(5, 2), n(6, 1), n(5, 1), n(3, 1), n(1, 2), n(2, 1),
      n(3, 1), n(5, 1), n(6, 2), n(5, 1), n(3, 1), n(2, 1), n(1, 3),
    ],
  },
  {
    id: 'trad-swing-low-sweet-chariot',
    title: 'Swing Low, Sweet Chariot',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(5, 1), n(3, 1), n(5, 1), n(3, 0.5), n(1, 0.5), n(1, 2),
      n(1, 0.5), n(2, 0.5), n(3, 1), n(3, 0.5), n(2, 0.5), n(1, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-motherless-child',
    title: 'Sometimes I Feel Like a Motherless Child',
    composer: null,
    died: null,
    mode: 'minor',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 2), n(1, 1), n(3, 1), n(4, 2), n(3, 1), n(1, 2),
      n(1, 1), n(3, 1), n(4, 1), n(5, 2), n(4, 1), n(3, 1), n(1, 3),
    ],
  },
  {
    id: 'trad-nobody-knows',
    title: "Nobody Knows the Trouble I've Seen",
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(1, 1), n(2, 1), n(3, 1), n(5, 1), n(6, 1), n(5, 2), n(3, 1),
      n(2, 1), n(1, 2), n(3, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 3),
    ],
  },

  // ---- 英語圏の伝承 ----
  {
    id: 'trad-the-water-is-wide',
    title: 'The Water Is Wide (O Waly Waly)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '3/4',
    notes: [
      n(1, 1), n(3, 1), n(5, 2), n(6, 1), n(5, 1), n(3, 2), n(2, 1), n(1, 1),
      n(2, 1), n(3, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 3),
    ],
  },
  {
    id: 'trad-all-through-the-night',
    title: 'All Through the Night (Ar Hyd y Nos)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(5, 1), n(3, 1), n(1, 1), n(2, 1), n(3, 1), n(4, 1), n(3, 1), n(2, 2),
      n(2, 1), n(3, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 3),
    ],
  },
  {
    id: 'trad-the-ash-grove',
    title: 'The Ash Grove (Llwyn Onn)',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '3/4',
    notes: [
      n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 0.5), n(5, 1), n(5, 0.5), n(6, 0.5),
      n(8, 1), n(7, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(2, 1), n(1, 1.5),
    ],
  },
  {
    id: 'trad-last-rose-of-summer',
    title: 'The Last Rose of Summer',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(3, 0.5), n(3, 0.5), n(5, 1), n(5, 0.5), n(6, 0.5), n(8, 1),
      n(7, 0.5), n(6, 0.5), n(5, 1), n(3, 1), n(2, 0.5), n(1, 0.5),
      n(2, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-my-bonnie',
    title: 'My Bonnie Lies Over the Ocean',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '3/4',
    notes: [
      n(1, 1), n(3, 1), n(2, 1), n(1, 2), n(3, 1), n(5, 1), n(6, 2),
      n(5, 1), n(3, 1), n(1, 1), n(2, 1), n(3, 1), n(2, 2), n(1, 2),
    ],
  },
  {
    id: 'trad-red-river-valley',
    title: 'Red River Valley',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(-2, 0.5), n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 1), n(3, 0.5), n(2, 0.5),
      n(1, 1), n(2, 1), n(3, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-down-in-the-valley',
    title: 'Down in the Valley',
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '3/4',
    notes: [
      n(-2, 1), n(1, 1), n(2, 1), n(3, 2), n(2, 1), n(1, 1), n(2, 3),
      n(3, 1), n(2, 1), n(1, 1), n(0, 1), n(1, 3),
    ],
  },
  {
    id: 'trad-comin-thro-the-rye',
    title: "Comin' Thro' the Rye (故郷の空)",
    composer: null,
    died: null,
    mode: 'major',
    region: 'anglo',
    meter: '4/4',
    notes: [
      n(5, 1), n(3, 0.5), n(5, 0.5), n(6, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
      n(3, 1), n(5, 1), n(6, 0.5), n(5, 0.5), n(3, 1), n(2, 1), n(1, 2),
    ],
  },

  // ---- 日本の唱歌・古謡 ----
  {
    id: 'motoori-nanatsu-no-ko',
    title: '七つの子',
    composer: '本居長世 (Nagayo Motoori)',
    died: 1945,
    mode: 'major',
    region: 'japanese',
    meter: '4/4',
    notes: [
      n(3, 1), n(5, 1), n(6, 1), n(8, 1), n(6, 1), n(5, 2), n(3, 1),
      n(5, 1), n(6, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'motoori-akai-kutsu',
    title: '赤い靴',
    composer: '本居長世 (Nagayo Motoori)',
    died: 1945,
    mode: 'minor',
    region: 'japanese',
    meter: '4/4',
    notes: [
      n(1, 1), n(3, 1), n(4, 1), n(3, 1), n(1, 2), n(1, 1), n(3, 1),
      n(4, 1), n(5, 1), n(4, 1), n(3, 1), n(1, 2),
    ],
  },
  {
    id: 'okano-momiji',
    title: '紅葉',
    composer: '岡野貞一 (Teiichi Okano)',
    died: 1941,
    mode: 'major',
    region: 'japanese',
    meter: '4/4',
    notes: [
      n(3, 0.5), n(3, 0.5), n(4, 1), n(5, 0.5), n(5, 0.5), n(6, 1), n(5, 1),
      n(3, 0.5), n(5, 0.5), n(6, 1), n(5, 0.5), n(3, 0.5), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'koyama-natsu-wa-kinu',
    title: '夏は来ぬ',
    composer: '小山作之助 (Sakunosuke Koyama)',
    died: 1927,
    mode: 'major',
    region: 'japanese',
    meter: '4/4',
    notes: [
      n(3, 1), n(5, 1), n(6, 1), n(8, 1), n(6, 1), n(5, 1), n(3, 1), n(2, 1),
      n(1, 1), n(2, 1), n(3, 1), n(5, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'hirota-kutsu-ga-naru',
    title: '靴が鳴る',
    composer: '弘田龍太郎 (Ryūtarō Hirota)',
    died: 1952,
    mode: 'major',
    region: 'japanese',
    meter: '2/4',
    notes: [
      n(5, 0.5), n(5, 0.5), n(3, 0.5), n(5, 0.5), n(6, 1), n(5, 0.5), n(3, 0.5),
      n(2, 0.5), n(1, 0.5), n(2, 1), n(3, 0.5), n(2, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'hirota-hamachidori',
    title: '浜千鳥',
    composer: '弘田龍太郎 (Ryūtarō Hirota)',
    died: 1952,
    mode: 'minor',
    region: 'japanese',
    meter: '3/4',
    notes: [
      n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2), n(3, 1), n(4, 1),
      n(5, 1), n(4, 1), n(3, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'taki-hakone-hachiri',
    title: '箱根八里',
    composer: '滝廉太郎 (Rentarō Taki)',
    died: 1903,
    mode: 'minor',
    region: 'japanese',
    meter: '2/4',
    notes: [
      n(1, 0.5), n(1, 0.5), n(3, 1), n(2, 0.5), n(1, 0.5), n(0, 1), n(1, 1),
      n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1), n(2, 0.5), n(1, 0.5), n(1, 1.5),
    ],
  },
  {
    id: 'trad-etenraku-imayo',
    title: '越天楽今様',
    composer: null,
    died: null,
    mode: 'minor',
    region: 'japanese',
    meter: '4/4',
    notes: [
      n(5, 1), n(5, 1), n(4, 1), n(5, 1), n(7, 2), n(5, 1), n(4, 1),
      n(2, 1), n(1, 1), n(2, 1), n(4, 1), n(2, 1), n(1, 2),
    ],
  },
  {
    id: 'trad-edo-komoriuta',
    title: '江戸子守唄',
    composer: null,
    died: null,
    mode: 'minor',
    region: 'japanese',
    meter: '2/4',
    // 都節。動く幅がきわめて狭く、同じ場所で息をつく。
    notes: [
      n(5, 0.5), n(5, 0.5), n(4, 0.5), n(3, 0.5), n(4, 1), n(3, 0.5), n(2, 0.5),
      n(1, 1), n(1, 0.5), n(2, 0.5), n(3, 0.5), n(2, 0.5), n(1, 1.5),
    ],
  },
];

export default CORPUS;
