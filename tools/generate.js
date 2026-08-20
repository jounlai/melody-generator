// 2小節(8拍)のメロディー断片を大量に生成する。
// ここでの役割は「そこそこ筋の通った候補を、多様に、大量に」作ること。
// 美しさの選抜は後段の別モジュールが行う。
//
// 音符: { deg: 1〜15, beat: 0〜8, dur: 拍数, vel: 0〜1 }
// deg は通しスケール度数(1=トニック, 8=1oct上, 15=2oct上)。
// 乱数はすべて引数の rng を経由する(Math.random は使わない)。
//
// 設計の柱は4つ。優先順位の高い順に:
//   1. 旋律型  : パブリックドメインの名旋律125曲から抽出した語彙(FORMULAS)で組み立てる。
//                輪郭が合っていても中身が音楽の語彙になっていないと、
//                「ランダムな音程の並び」にしか聴こえない。
//   2. リズム  : 音価が均一だと、音程が何であろうと童謡にしか聴こえない。
//                1つの型のなかで長い音と短い音を混ぜ(3種類以上の音価)、
//                シンコペーション・休符・弱起・付点で拍から音をずらす。
//                密度は2小節6〜16音。
//   3. 動機    : 後半1小節を前半の平行移動(ゼクエンツ)や完全反復にする。
//                形が反復されて初めて「メロディー」として記憶される。
//   4. 大衆性  : ペンタトニック(五音音階)へ寄せる。J-POP・童謡・民謡を貫く
//                「口ずさめる」の核心。ただし旋律型の形のほうが優先。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randInt, pick, shuffle } from '../src/rng.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// パブリックドメインの名旋律125曲(1768音)から抽出した語彙。
// formulas = 度数オフセット列とコーパスでの出現回数、cadences = フレーズの終わり方。
// rhythmCells は使わない(上位が [1,1] [0.5,0.5] の等分割で、
// これを取り込むと音価が均一化して「童謡」に逆戻りする。取り込むのは音程の語彙だけ)。
export const PATTERNS = JSON.parse(
  readFileSync(resolve(HERE, 'data/patterns.json'), 'utf8'),
);

const BAR = 4;
const MIN_DEG = 1;
const MAX_DEG = 15;

// [開始拍, 長さ拍] の組を {b,d} へ。リズム表を読みやすく保つためだけの糖衣。
const cell = (pairs) => pairs.map(([b, d]) => ({ b, d }));

// 前半1小節(0〜4拍)の形をそのまま後半へコピーする。
// 「内部モチーフの反復」は曲としての求心力に直結するので、
// カタログの6〜7割をこの形で作る。
function mirror(bar) {
  return bar.concat(bar.map((n) => ({ b: n.b + BAR, d: n.d })));
}

// ---------------------------------------------------------------------------
// リズム型カタログ
// ---------------------------------------------------------------------------
// 「音程の長さが一定過ぎて童謡に聴こえる」を潰すのがこの表の役目。
// 8分音符が延々と並ぶ型・4分音符だけの型・等間隔の型は1つも置かない。
//
// 全型が満たす制約:
//   - b+d<=8 / 重ならない / 小節線をまたがない / 最短0.25拍(16分は型あたり2〜3音まで)
//   - 音価が3種類以上ある(同じ長さの音ばかりの型を作らない)
//   - 最長音価 ÷ 最短音価 >= 3 (2.0拍と0.5拍が同居するくらいの落差)
//   - 音数は2小節あたり6〜16音
// 表全体では シンコペーション40%以上 / 休符30%以上 / 弱起25%以上 /
// 付点(1.5+0.5, 0.75+0.25)を含む型6個以上。
//
// ★ 終わり方は3つの家系に分ける。以前は「最後の音は1.5拍以上」と決めていたが、
//   そうすると全断片が終止感を持ってしまい、2小節ごとに律儀に区切られて聴こえる。
//   組み立て側はフレーズ末とフレーズ途中で断片を選び分けるので、
//   「流して次へ渡す断片」がカタログに無いと、その仕組みが働かない。
//
//     流し型 (最後 0.5〜1拍)  35〜45% … フレーズ途中。次の小節へ流し込む
//     終止型 (最後 2.5〜4拍)  35〜45% … フレーズ末。伸ばして息を継ぐ
//     中間型 (最後 1.5〜2拍)  残り
//
//   モチーフ型(mirror)は1小節目の最後の音がそのまま断片の最後の音になるので、
//   終止型にするには小節の後半をまるごとロングトーンにするしかない。
//   4拍級の終止はモチーフ型では作れないため、通し型のほうに置く。

// 後半1小節が前半とまったく同じ形の型。ゼクエンツ・完全反復はここからしか引かない。
export const MOTIF_RHYTHMS = [
  // --- 流し型(最後 0.5〜1拍)。小節の終わりで止まらず、次へ渡す ---
  mirror(cell([[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [3.5, 0.5]])), // 10
  mirror(cell([[0, 0.5], [0.5, 1.5], [2, 0.5], [2.5, 0.5], [3, 1]])), // 10 シンコペ
  mirror(cell([[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]])), // 8 付点
  mirror(cell([[0, 2], [2, 0.5], [2.5, 0.5], [3, 1]])), // 8
  mirror(cell([[0.5, 0.5], [1, 1.5], [2.5, 0.5], [3, 1]])), // 8 弱起+休符
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5]])), // 10
  mirror(cell([[0, 0.75], [0.75, 0.25], [1, 1], [2, 1.5], [3.5, 0.5]])), // 10 付点+16分
  mirror(cell([[0, 1], [1.5, 0.5], [2, 1.5], [3.5, 0.5]])), // 8 休符
  mirror(cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 1.5], [3.5, 0.5]])), // 10 シンコペ
  mirror(cell([[0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5]])), // 8 弱起+休符
  mirror(cell([[0, 0.25], [1, 1], [2, 1.5], [3.5, 0.5]])), // 8 弱起+休符+16分
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 0.75], [1.75, 0.25], [2, 1], [3, 1]])), // 12 付点+16分
  mirror(cell([[0.5, 0.5], [1, 1.5], [2.5, 1]])), // 6 弱起+休符+シンコペ
  mirror(cell([[0, 0.5], [1, 1.5], [2.5, 1]])), // 6 弱起+休符+シンコペ
  mirror(cell([[0, 1.5], [1.5, 0.5], [2, 0.5], [2.5, 1]])), // 8 付点+シンコペ
  // --- 中間型(最後 1.5〜2拍) ---
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]])), // 8
  mirror(cell([[0, 1.5], [1.5, 0.5], [2, 2]])), // 6 付点
  mirror(cell([[0.5, 0.5], [1, 1], [2, 2]])), // 6 弱起+休符
  mirror(cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1.5]])), // 10 シンコペ
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 0.75], [1.75, 0.25], [2, 0.5], [2.5, 1.5]])), // 12 付点+シンコペ
  mirror(cell([[0.75, 0.25], [1, 1], [2, 0.5], [2.5, 1.5]])), // 8 弱起+休符+シンコペ+16分
  mirror(cell([[0.5, 0.25], [1, 1], [2, 0.5], [2.5, 1.5]])), // 8 弱起+休符+シンコペ+16分
  mirror(cell([[0, 0.5], [0.5, 1], [1.5, 1], [2.5, 1.5]])), // 8 シンコペ
  // --- 終止型(最後 2.5〜3拍)。小節の後半をまるごと伸ばす ---
  mirror(cell([[0, 0.5], [0.5, 1], [1.5, 2.5]])), // 6 シンコペ
  mirror(cell([[0, 1], [1, 0.5], [1.5, 2.5]])), // 6 シンコペ
  mirror(cell([[0, 0.25], [0.25, 0.75], [1, 3]])), // 6 16分
  mirror(cell([[0, 0.75], [0.75, 0.25], [1, 3]])), // 6 付点+16分
  mirror(cell([[0, 0.25], [0.5, 0.5], [1, 3]])), // 6 16分
  mirror(cell([[0, 1], [1.25, 0.25], [1.5, 2.5]])), // 6 シンコペ+16分
  mirror(cell([[0.5, 0.25], [1, 0.5], [1.5, 2.5]])), // 6 休符+シンコペ+16分
];

// 通しで書き下ろす型。最後の1音だけが家系を決めるので、途中はモチーフ型より自由。
export const FREE_RHYTHMS = [
  // --- 流し型(最後 0.5〜1拍) ---
  cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 1.5], [6.5, 0.5], [7, 1]]), // 11
  cell([[0, 1], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 1], [5.5, 0.5], [6, 1.5], [7.5, 0.5]]), // 10 シンコペ
  cell([[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 1.5], [4, 0.5], [4.5, 0.5], [5, 1],
    [6, 1.5], [7.5, 0.5]]), // 9 弱起+休符+シンコペ
  cell([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.75], [2.75, 0.25], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 0.5], [6, 1], [7, 1]]), // 13 付点+16分
  // --- 中間型(最後 1.5〜2拍) ---
  cell([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 0.5], [6, 0.5], [6.5, 1.5]]), // 13 シンコペ
  cell([[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 8 休符
  cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1], [3.5, 0.5],
    [4, 0.5], [4.5, 1], [5.5, 0.5], [6, 2]]), // 10 シンコペ
  cell([[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 9 弱起+休符
  // --- 終止型(最後 2.5〜4拍)。フレーズ末で本当に伸ばす ---
  cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 3]]), // 9
  cell([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.75], [2.75, 0.25], [3, 1],
    [4, 4]]), // 8 付点+16分
  cell([[0, 1], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1], [4, 0.5], [4.5, 0.5], [5, 3]]), // 8 シンコペ
  cell([[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1], [4, 1], [5, 3]]), // 7 弱起+休符
  cell([[0, 1.5], [1.5, 0.5], [2, 1], [3, 1], [4, 0.5], [4.5, 0.5], [5, 3]]), // 7 付点
  cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1], [3.5, 0.5],
    [4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 2.5]]), // 10 シンコペ
  cell([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 3]]), // 10
  cell([[0.75, 0.25], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 3]]), // 8 弱起+休符+16分
  cell([[0, 1], [1, 1], [2, 1.5], [3.5, 0.5], [4, 0.5], [4.5, 0.5], [5, 3]]), // 7 付点
  cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 1], [3, 0.75], [3.75, 0.25],
    [4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 2.5]]), // 10 付点+16分
  cell([[0, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1], [4, 0.5], [4.5, 0.5], [5, 3]]), // 8 休符+シンコペ
  cell([[0, 2], [2, 1], [3, 1], [4, 0.5], [4.5, 0.5], [5, 3]]), // 6
  cell([[0.5, 0.5], [1, 1.5], [2.5, 0.5], [3, 1], [4, 0.5], [4.5, 0.5], [5, 3]]), // 7 弱起+休符
];

export const RHYTHMS = [...MOTIF_RHYTHMS, ...FREE_RHYTHMS];

// ---------------------------------------------------------------------------
// リズム型カタログ（版2）— 70〜80年代の歌謡曲・ニューミュージック系バラード
//
// 版1の表は 1955 年以前の名旋律から取った統計の器で、次の3つが構造的に無い。
//
//   小節線をまたぐ音   0 / 51 型   ← 食いが1つも書けない
//   1型あたりの音数    平均 8.4 音  ← 音で埋まっていて間が無い
//   2拍以上の音        ごく少数     ← フレーズ末が伸びない
//
// この3つがこの時代のバラードの土台そのものなので、版2では表ごと書き直す。
// 表は最初から手書きで、曲から採ったものではない（版1も同じ）。
//
//   食いを持つ型  半分。3.5拍から鳴り出して小節線をまたぎ、次の小節の頭へ着く。
//                 splitBars がこの音を「次の小節の頭の音」として和声判定する。
//   間            音数を 6〜8 に落とし、休符と白玉で息を置く。
//   伸ばし        24型中22型が2拍以上の音を含む。フレーズ末が本当に伸びる。
//
// MOTIF_RHYTHMS_V2 は前半と後半の音数が等しい型（ゼクエンツ・反復を作る側が
// 前半の形をそのまま後半へ写すため、音数が揃っている必要がある）。
// 等分でない型は FREE_RHYTHMS_V2 として通しで書き下ろす側に回る。
// ---------------------------------------------------------------------------

// 前半と後半の音数が等しい型。内部反復とゼクエンツはここから作る。
const MOTIF_V2_SOURCE = [
  cell([[0, 1], [1, 0.5], [1.5, 1.5], [3.5, 1], [4.5, 0.5], [5, 1], [6, 1.5], [7.5, 0.5]]), // 食い
  cell([[0.5, 0.5], [1, 1], [2, 1], [3.5, 1], [4.5, 0.5], [5, 1.5], [6.5, 0.5], [7, 1]]), // 弱起+食い
  cell([[0, 2], [2, 1], [3.5, 1.5], [5, 1], [6, 1.5], [7.5, 0.5]]), // 白玉+食い
  cell([[0, 1.5], [1.5, 0.5], [2, 2], [4, 1.5], [5.5, 0.5], [6, 2]]), // 付点+伸ばし
  cell([[0, 1], [1, 0.5], [1.5, 1], [2.5, 1.5], [4, 1], [5, 0.5], [5.5, 1], [6.5, 1.5]]),
  cell([[0, 1.5], [1.5, 0.5], [2, 1], [3.5, 1], [4.5, 1.5], [6, 0.5], [6.5, 1], [7.5, 0.5]]), // 食い
  cell([[0, 0.5], [0.5, 1], [1.5, 1], [2.5, 1.5], [4, 0.5], [4.5, 1], [5.5, 1], [6.5, 1.5]]),
  cell([[0, 2], [2, 1.5], [3.5, 1], [4.5, 2], [6.5, 1], [7.5, 0.5]]), // 白玉+食い
  cell([[0.5, 1], [1.5, 1], [2.5, 0.5], [3.5, 1.5], [5, 1], [6, 1], [7, 0.5], [7.5, 0.5]]), // 弱起+食い
  cell([[0, 1], [1, 1], [2, 1.5], [3.5, 1.5], [5, 1], [6, 1], [7, 0.5], [7.5, 0.5]]), // 食い
  cell([[0, 0.5], [0.5, 1.5], [2, 1], [3, 1], [4, 0.5], [4.5, 1.5], [6, 1], [7, 1]]),
  cell([[0, 1.5], [1.5, 1], [2.5, 1], [3.5, 1], [4.5, 1.5], [6, 1], [7, 0.5], [7.5, 0.5]]), // 食い
];

// 通しで書き下ろす型。前半と後半で音数が違ってよい。
const FREE_V2_SOURCE = [
  cell([[0, 1.5], [1.5, 0.5], [2, 1], [3.5, 1.5], [5, 0.5], [5.5, 0.5], [6, 2]]), // 食い
  cell([[0.5, 1], [1.5, 0.5], [2, 1.5], [3.5, 1], [4.5, 1], [5.5, 0.5], [6, 2]]), // 弱起+食い
  cell([[0, 1], [2, 0.5], [2.5, 0.5], [3.5, 1.5], [5, 1], [6, 2]]), // 間+食い
  cell([[0, 1.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 1], [4.5, 0.5], [5, 1], [6, 2]]), // 付点+食い
  cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 1], [3.5, 1.5], [5, 0.5], [5.5, 0.5], [6, 2]]), // 食い
  cell([[0, 1], [1, 0.5], [1.5, 0.5], [2, 1], [3.5, 1.5], [5, 3]]), // 食い+終止
  cell([[0, 1.5], [1.5, 1], [2.5, 0.5], [3.5, 1], [4.5, 1], [5.5, 0.5], [6, 2]]), // 食い
  cell([[0.75, 0.25], [1, 1], [2, 1], [3.5, 1.5], [5, 0.5], [5.5, 0.5], [6, 2]]), // 16分弱起+食い
  cell([[0, 1], [1, 1], [2, 0.5], [2.5, 0.5], [3.5, 1], [4.5, 1.5], [6, 2]]), // 食い
  cell([[0, 1], [1, 1], [2, 2], [4, 1], [5, 0.5], [5.5, 0.5], [6, 2]]),
  cell([[0.5, 0.5], [1, 1.5], [2.5, 0.5], [3, 1], [4, 1], [5, 3]]), // 弱起+終止
  cell([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2], [4, 0.5], [4.5, 0.5], [5, 3]]), // 同音連打+終止
  cell([[0, 2], [2, 0.5], [2.5, 0.5], [3, 1], [4, 2], [6, 1.5], [7.5, 0.5]]),
  cell([[0.5, 1], [1.5, 0.5], [2, 2], [4, 0.5], [4.5, 1], [5.5, 0.5], [6, 2]]), // 弱起
  cell([[0, 1], [1, 0.5], [1.5, 2.5], [4, 1], [5, 0.5], [5.5, 0.5], [6, 2]]),
  cell([[0, 0.5], [0.5, 1.5], [2, 1], [3, 1], [4, 1], [5, 0.5], [5.5, 2.5]]), // 終止
  cell([[0, 1.5], [1.5, 0.5], [2, 1], [3, 1], [4, 0.5], [4.5, 0.5], [5, 3]]), // 終止
  cell([[0, 2], [2, 1.5], [3.5, 0.5], [4, 1], [5, 0.5], [5.5, 2.5]]), // 終止
  cell([[0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5], [4, 2], [6, 1.5], [7.5, 0.5]]), // 弱起
  cell([[0, 1], [1, 1.5], [2.5, 0.5], [3, 1], [4, 2], [6, 2]]),

  // --- 流し型（最後が 0.5〜1拍）。フレーズ途中で止まらず次へ渡す ---
  // 組み立て側はフレーズ途中のスロットに「閉じない断片」を要求する。
  // ここが薄いと、2小節ごとに律儀に区切れて楽節が聴こえなくなる。
  cell([[0, 1.5], [1.5, 0.5], [2, 1], [3.5, 1.5], [5, 1], [6, 1], [7, 1]]), // 食い
  cell([[0, 2], [2, 1], [3.5, 1.5], [5, 1.5], [6.5, 0.5], [7, 1]]), // 食い
  cell([[0.5, 1], [1.5, 1], [2.5, 1], [4, 1.5], [5.5, 0.5], [6, 1], [7, 1]]), // 弱起+休符
  cell([[0, 1], [1, 0.5], [1.5, 1.5], [3.5, 1], [4.5, 1.5], [6, 1], [7, 1]]), // 食い
  cell([[0, 1.5], [1.5, 0.5], [2, 2], [4, 1], [5, 1.5], [6.5, 0.5], [7, 1]]),
  cell([[0, 0.5], [0.5, 1.5], [2, 1], [3.5, 1.5], [5, 1], [6, 1.5], [7.5, 0.5]]), // 食い
  cell([[0, 1], [1, 1.5], [2.5, 0.5], [3, 1], [4, 1.5], [5.5, 0.5], [6, 1], [7, 1]]),
  cell([[0.5, 0.5], [1, 1], [2, 1.5], [3.5, 1], [4.5, 1.5], [6, 1], [7, 1]]), // 弱起+食い
];

// 前半と後半の音数が等しいかで振り分ける。手で分類すると必ずずれるので機械で。
const barSplitAt = (r) => r.findIndex((n) => n.b >= BAR);
const isEvenHalves = (r) => {
  const i = barSplitAt(r);
  return i > 0 && i === r.length - i;
};

export const MOTIF_RHYTHMS_V2 = MOTIF_V2_SOURCE.filter(isEvenHalves);
export const FREE_RHYTHMS_V2 = [
  ...FREE_V2_SOURCE,
  // 等分でないものが混ざっていたら通し型へ回す（表を足したときの取りこぼし防止）
  ...MOTIF_V2_SOURCE.filter((r) => !isEvenHalves(r)),
];
export const RHYTHMS_V2 = [...MOTIF_RHYTHMS_V2, ...FREE_RHYTHMS_V2];

// リズム型の抽選。大衆的なメロディーは反復が多いので、
// 後半が前半と同形の型を優先的に引く(6〜7割)。
export const MOTIF_RATE = 0.65;

export function pickRhythm(rng, tables = null) {
  const motif = tables?.motif ?? MOTIF_RHYTHMS;
  const free = tables?.free ?? FREE_RHYTHMS;
  return rng() < MOTIF_RATE ? pick(rng, motif) : pick(rng, free);
}

// ---------------------------------------------------------------------------
// 旋律型ライブラリ(コーパス由来)
// ---------------------------------------------------------------------------
// 最初の音からの度数オフセットで持つ。こうすると任意の高さに置ける。
// 中身は名旋律125曲から抽出した490型で、順次進行と刺繍音が上位を占める
// (コーパス実測: 2度 69.1% / 3度 18.3% / 4度以上 4.1%)。
//
// 生の出現回数をそのまま重みにすると、最頻の [0,-1,-2](186回)だけで
// 抽選の4分の1を占めてしまい、語彙が増えたのにかえって単調になる。
// そこで3段構えで散らす:
//   1. 長さ(3〜6音)を先に決める。決め方はリズム型が要求する音数に合わせる
//      (ちょうど埋まる長さを優先し、埋まらない長さは引かない)。
//   2. 重みは平方根で圧縮する(186 -> 13.6、22 -> 4.7)。
//   3. 同じ型は1断片に2回使わない(ゼクエンツ・完全反復は形の反復そのものなので対象外)。

const sqrtWeight = (w) => Math.sqrt(Math.max(w, 1));

function toFormula(p) {
  return {
    id: p.steps.join(','),
    steps: p.steps,
    weight: p.weight,
    eff: sqrtWeight(p.weight), // 抽選に使う実効重み
    len: p.steps.length,
    fall: p.steps.reduce((a, b) => a + b, 0), // 総和。-3 以下なら「長い下降形」
  };
}

// コーパスに無いが手放せない型。コーパスの音程は最大でも5度で、
// 6度以上の上行跳躍が1つも無い。跳躍上行から順次下降で埋め戻す形('sigh')は
// 「泣ける」断片の中核なので、この4つだけは手書きのまま残す。
// 重みはコーパスの中位に合わせて、語彙全体を歪ませない程度にする。
const LEAP_FORMULAS = [
  { steps: [0, 5, 4, 3, 2], weight: 16 }, // 6度上行 -> 順次下降
  { steps: [0, 7, 6, 5], weight: 12 }, // オクターブ上行 -> 下降
  { steps: [0, 2, 4, 7], weight: 9 }, // 分散和音でオクターブまで届く
  { steps: [0, 2, 4, 2], weight: 9 },
];

export const CORPUS_FORMULAS = PATTERNS.formulas.map(toFormula);
export const FORMULAS = [...CORPUS_FORMULAS, ...LEAP_FORMULAS.map(toFormula)];

// フレーズを閉じるための型。2小節目を「着地」で終える経路で使う。
// コーパスの終止形は下降で着地する形が支配的で、これが「閉じた」感じを作る。
export const CADENCES = PATTERNS.cadences.map(toFormula);

// 「舞い上がり」の型。4度以上の上行跳躍で頂点に届き、そこから順次で降りてくる形。
// [0,3,2,1] が Can't Help Falling in Love 型、Hey Jude の "better" もこの系統で、
// 「感動する瞬間」はほぼこの形が作っている(コーパス125曲中189回検出)。
export const SOARS = (PATTERNS.soars ?? []).map(toFormula);

// 長さ別の索引。層化抽選のために先に作っておく。
const BY_LEN = new Map();
for (const f of FORMULAS) {
  if (!BY_LEN.has(f.len)) BY_LEN.set(f.len, []);
  BY_LEN.get(f.len).push(f);
}
export const FORMULA_LENGTHS = [...BY_LEN.keys()].sort((a, b) => a - b);
const MIN_FORMULA_LEN = FORMULA_LENGTHS[0];

// 度数列にコーパスの型が(相対形で)含まれるかを判定するための索引。
const CORPUS_KEYS = new Set(CORPUS_FORMULAS.map((f) => f.id));

/** 度数列 degs のどこかにコーパス由来の旋律型が現れるか */
export function containsFormula(degs) {
  if (!Array.isArray(degs)) return false;
  for (let i = 0; i < degs.length; i++) {
    for (const len of FORMULA_LENGTHS) {
      if (i + len > degs.length) break;
      let key = '0';
      for (let k = 1; k < len; k++) key += `,${degs[i + k] - degs[i]}`;
      if (CORPUS_KEYS.has(key)) return true;
    }
  }
  return false;
}

// 「ちょうど埋まる長さ」を優先する度合い。型の切れ目とフレーズの切れ目が
// 揃っていないと、途中で言いかけて止めたように聴こえる。
const EXACT_BIAS = 3;

/**
 * 残り room 音を埋めるのに使ってよい型の長さを1つ選ぶ。
 * - room ちょうど: そこで型が終わってフレーズが閉じる
 * - 残りが3音以上になる長さ: 次も型で埋められる
 * どちらも無ければ null(呼び出し側が最短の型を途中で切って埋める)。
 */
function pickLength(rng, room) {
  const exact = [];
  const chain = [];
  for (const len of FORMULA_LENGTHS) {
    if (len > room) break;
    if (len === room) exact.push(len);
    else if (room - len + 1 >= MIN_FORMULA_LEN) chain.push(len);
  }
  if (exact.length === 0 && chain.length === 0) return null;

  let r = rng() * (exact.length * EXACT_BIAS + chain.length);
  for (const len of exact) {
    r -= EXACT_BIAS;
    if (r < 0) return len;
  }
  for (const len of chain) {
    r -= 1;
    if (r < 0) return len;
  }
  return exact[0] ?? chain[chain.length - 1];
}

/** 実効重みで1つ引く。allow が全部を弾いたら null(乱数は消費しない)。 */
function weightedPick(rng, list, allow) {
  let total = 0;
  for (const f of list) if (allow(f)) total += f.eff;
  if (total <= 0) return null;

  let r = rng() * total;
  let last = null;
  for (const f of list) {
    if (!allow(f)) continue;
    last = f;
    r -= f.eff;
    if (r < 0) return f;
  }
  return last; // 浮動小数の取りこぼし
}

/**
 * 制約つきで型を1つ引く。制約は「効くなら効かせる」で、
 * 全部弾いてしまうときだけ順に外す(候補ゼロで生成が止まるほうが害が大きい)。
 * 乱数の消費は pickLength の1回 + weightedPick の1回で固定。
 */
function drawFormula(rng, room, state) {
  const len = pickLength(rng, room);
  const bucket = BY_LEN.get(len ?? MIN_FORMULA_LEN);
  const fresh = (f) => !state.used.has(f.id);
  const rising = (f) => f.fall > -3;

  return weightedPick(rng, bucket, (f) => fresh(f) && (!state.banDescent || rising(f)))
    ?? weightedPick(rng, bucket, fresh)
    ?? weightedPick(rng, bucket, () => true);
}

/** 断片1件ぶんの抽選状態。同じ型の再利用と下降形の連続をここで見張る。 */
export function newDrawState() {
  return { used: new Set(), banDescent: false };
}

/**
 * 旋律型をつないで長さ n の相対度数列(先頭 0)を作る。
 * 型を継ぎ足すときは前の型の終点を次の型の起点として共有する。
 * 返り値の used は採用した型の id(統計とテスト用)。
 */
export function formulaLine(rng, n, state = newDrawState()) {
  const rel = [0];
  const used = [];
  let guard = 0;

  while (rel.length < n && guard++ < 6) {
    const room = n - rel.length + 1; // 起点を共有するぶん +1
    const f = drawFormula(rng, room, state);
    used.push(f.id);
    state.used.add(f.id);
    // 長い下降形を1つ使ったら、この断片ではもう引かない。
    // 下降しかしない断片は、どれだけ語彙が正しくても退屈になる。
    if (f.fall <= -3) state.banDescent = true;
    const base = rel[rel.length - 1];
    for (let i = 1; i < f.steps.length && rel.length < n; i++) {
      rel.push(base + f.steps[i] - f.steps[0]);
    }
  }
  // 保険(型が尽きるほど長いリズムは無いが、念のため順次で埋める)
  while (rel.length < n) rel.push(rel[rel.length - 1] + (rel.length % 2 === 0 ? 1 : -1));

  const line = rel.slice(0, n);
  if (line[line.length - 1] - line[0] <= -3) state.banDescent = true;
  return { rel: line, used };
}

/**
 * 終止形で閉じる長さ n の相対度数列。
 * 終止形は必ず「最後の4音」に置く。フレーズが閉じたかどうかは着地で決まるので、
 * 音数が足りなければ頭を削り、余るぶんは手前を旋律型で埋める。
 * 下降形の連続禁止はここには効かせない(終止形は下降で着地するのが本来の姿)。
 */
export function cadenceLine(rng, n, state = newDrawState()) {
  const cad = weightedPick(rng, CADENCES, (f) => !state.used.has(f.id))
    ?? weightedPick(rng, CADENCES, () => true);
  const steps = cad.steps;
  const id = `cad:${cad.id}`;
  state.used.add(cad.id);

  if (n <= steps.length) {
    const tail = steps.slice(steps.length - n);
    const base = tail[0];
    return { rel: tail.map((s) => s - base), used: [id] };
  }

  const head = formulaLine(rng, n - steps.length + 1, state);
  const base = head.rel[head.rel.length - 1];
  const rel = head.rel.concat(steps.slice(1).map((s) => base + s - steps[0]));
  return { rel, used: [...head.used, id] };
}

/**
 * 舞い上がる長さ n の相対度数列。
 * 跳び上がってから降りてくるまでが1つの身振りなので、型は途中で切らずに
 * 「頭を削る」ほうを選ぶ……のではなく、ここでは逆に末尾を削る。
 * 跳躍(型の頭)を落とすと舞い上がりでなくなるためで、
 * 音数が足りないときは降りる音を諦める(それでも「跳んで、降り始める」形は残る)。
 * 余るぶんは手前を旋律型で埋め、跳ぶ直前まで助走させる。
 */
export function soarLine(rng, n, state = newDrawState()) {
  const soar = weightedPick(rng, SOARS, (f) => !state.used.has(f.id))
    ?? weightedPick(rng, SOARS, () => true);
  const steps = soar.steps;
  const id = `soar:${soar.id}`;
  state.used.add(soar.id);

  // 跳躍と、その直後の下降1音までは最低限必要(3音)。
  if (n <= steps.length) {
    return { rel: steps.slice(0, n), used: [id] };
  }

  const head = formulaLine(rng, n - steps.length + 1, state);
  const base = head.rel[head.rel.length - 1];
  const rel = head.rel.concat(steps.slice(1).map((s) => base + s - steps[0]));
  return { rel, used: [...head.used, id] };
}

// ---------------------------------------------------------------------------
// 輪郭テンプレート(旋律型を使わない経路)
// ---------------------------------------------------------------------------

// 0.0〜1.0 に正規化した高さの推移。線形補間して使う。
export const CONTOUR_SHAPE = {
  arch: [0, 0.4, 1.0, 0.6, 0.1],
  descend: [1.0, 0.7, 0.45, 0.2, 0.0],
  ascend: [0.0, 0.25, 0.5, 0.75, 1.0],
  wave: [0.3, 0.9, 0.2, 0.8, 0.3],
  question: [0.2, 0.5, 0.35, 0.7, 0.6],
  answer: [0.6, 0.8, 0.5, 0.3, 0.0],
};

const CONTOUR_NAMES = Object.keys(CONTOUR_SHAPE);

// ---------------------------------------------------------------------------
// ペンタトニック
// ---------------------------------------------------------------------------

// スケール度数(1〜7)で表したペンタトニック。
export const PENTA_DEGS = {
  major: [1, 2, 3, 5, 6], // 4 と 7 を使わない
  minor: [1, 3, 4, 5, 7], // 2 と 6 を使わない
};
const PENTA_SET = {
  major: new Set(PENTA_DEGS.major),
  minor: new Set(PENTA_DEGS.minor),
};

// 歌い出し・着地として安定する度数(主和音の構成音)。
const STABLE_SET = new Set([1, 3, 5]);
const STABLE_STARTS = [3, 5, 8, 10]; // 度数3〜10のうち {1,3,5} に当たるもの

// 音階外の音を寄せる先。第1候補は半音距離が近い側。
// major: 4は3へ(半音1つ下)、7は8へ(半音1つ上)。minor: 2は3へ、6は5へ。
const SNAP_MOVES = {
  major: { 4: [-1, 1], 7: [1, -1] },
  minor: { 2: [1, -1], 6: [-1, 1] },
};

// 生成の配分。30%は7音すべてを使う断片として残す(陰影と多様性のため)。
export const PENTA_RATES = { major: 0.45, minor: 0.25, none: 0.3 };

/** 'major' | 'minor' | null をこの配分で引く */
export function drawPenta(rng) {
  const r = rng();
  if (r < PENTA_RATES.major) return 'major';
  if (r < PENTA_RATES.major + PENTA_RATES.minor) return 'minor';
  return null;
}

function clampDeg(deg) {
  return Math.min(MAX_DEG, Math.max(MIN_DEG, deg));
}

function scaleDeg(deg) {
  return ((((deg - 1) % 7) + 7) % 7) + 1;
}

/** deg がスケール度数の集合 allowed に含まれるか */
function inSet(deg, allowed) {
  return allowed.has(scaleDeg(deg));
}

/** deg から dir 方向へ探して、最初に見つかる allowed の音を返す(無ければ null) */
function nextInSet(deg, dir, allowed) {
  for (let d = deg + dir; d >= MIN_DEG && d <= MAX_DEG; d += dir) {
    if (inSet(d, allowed)) return d;
  }
  return null;
}

/**
 * 度数列を allowed(スケール度数の集合)へ寄せる。
 * 寄せた結果うまれた同音連打はほどく(同音連打は減点対象)。
 * moves は「スケール度数 -> 移動候補」。無ければ近い側から総当たりで探す。
 */
function snapToSet(degs, allowed, moves) {
  const out = degs.slice();

  for (let i = 0; i < out.length; i++) {
    if (inSet(out[i], allowed)) continue;

    const prev = i > 0 ? out[i - 1] : null;
    const options = [];
    const mv = moves && moves[scaleDeg(out[i])];
    if (mv) {
      for (const m of mv) options.push(out[i] + m);
    } else {
      // 近い順に候補を並べる(同距離なら下側を先に)
      for (let r = 1; r <= 7; r++) options.push(out[i] - r, out[i] + r);
    }

    let chosen = null;
    let fallback = null;
    for (const cand of options) {
      if (cand < MIN_DEG || cand > MAX_DEG || !inSet(cand, allowed)) continue;
      if (fallback === null) fallback = cand;
      if (cand === prev) continue; // 同音連打は作らない
      chosen = cand;
      break;
    }
    out[i] = chosen ?? fallback ?? out[i];
  }

  for (let i = 1; i < out.length; i++) {
    if (out[i] !== out[i - 1]) continue;
    if (degs[i] === degs[i - 1]) continue; // もともと同音なら触らない
    const dir = degs[i] > degs[i - 1] ? 1 : -1;
    const alt = nextInSet(out[i], dir, allowed) ?? nextInSet(out[i], -dir, allowed);
    if (alt !== null) out[i] = alt;
  }

  return out;
}

/** 度数列をペンタトニックへスナップする */
export function snapToPenta(degs, kind) {
  const allowed = PENTA_SET[kind];
  if (!allowed) return degs.slice();
  return snapToSet(degs, allowed, SNAP_MOVES[kind]);
}

/** ペンタトニックから外れている音の数 */
function offPentaCount(degs, kind) {
  if (!kind) return 0;
  const set = PENTA_SET[kind];
  let n = 0;
  for (const d of degs) if (!set.has(scaleDeg(d))) n++;
  return n;
}

/**
 * 旋律型を作ったあとのスナップ。
 * ずれる音が3音以上になるとき(型が大きく崩れるとき)はスナップを諦める。
 * 形のほうが優先で、ペンタトニックは形を壊してまで取りに行かない。
 */
const SNAP_TOLERANCE = 2;

function snapKeepingShape(degs, kind) {
  if (!kind) return degs.slice();
  if (offPentaCount(degs, kind) > SNAP_TOLERANCE) return degs.slice();
  return snapToPenta(degs, kind);
}

// ---------------------------------------------------------------------------
// 度数列(輪郭ベース)
// ---------------------------------------------------------------------------

// shape を t(0〜1)で線形補間する。
function lerpShape(shape, t) {
  const u = Math.min(1, Math.max(0, t));
  const x = u * (shape.length - 1);
  const i = Math.min(Math.floor(x), shape.length - 2);
  return shape[i] + (shape[i + 1] - shape[i]) * (x - i);
}

// 跳躍(5度以上)の直後に同方向へ3以上動くのを潰す。
// 跳躍の連発は最も強い減点対象なので、生成時点で反転させておく。
function smoothLeaps(degs) {
  for (let i = 1; i < degs.length - 1; i++) {
    const d1 = degs[i] - degs[i - 1];
    if (Math.abs(d1) < 5) continue;
    const d2 = degs[i + 1] - degs[i];
    if (Math.abs(d2) < 3 || Math.sign(d2) !== Math.sign(d1)) continue;
    degs[i + 1] = clampDeg(degs[i] - d2);
  }
  return degs;
}

/**
 * 輪郭テンプレートに沿った長さ n の度数列を作る。
 * opts: { lo, span } 省略時は lo=randInt(1,6), span=randInt(3,10)。
 *
 * 補間値をそのまま丸めるのではなく、目標へ「歩いて」寄せる。
 * 単純な丸めだと音数が増えたときに同じ音が並んで線が止まり、
 * 「音程が並んでいるだけ」に聴こえる。常に動く線にするのが要点。
 */
export function buildDegrees(rng, contour, n, opts = {}) {
  const shape = CONTOUR_SHAPE[contour] || CONTOUR_SHAPE.arch;
  const lo = opts.lo === undefined ? randInt(rng, 1, 6) : opts.lo;
  const span = opts.span === undefined ? randInt(rng, 3, 10) : opts.span;

  const degs = [];
  let prev = null;
  let dir = 1;

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    // jitter は ±0.3。大きく振ると輪郭が溶けて形が記憶に残らない。
    const target = clampDeg(Math.round(lo + lerpShape(shape, t) * span + (rng() - 0.5) * 0.6));

    if (prev === null) {
      degs.push(target);
      prev = target;
      continue;
    }

    const diff = target - prev;
    let next;
    if (diff === 0) {
      // 目標に居座る区間は刺繍音で動かす。たまに3度動かして単調な往復を崩す。
      next = prev + dir * (rng() < 0.3 ? 2 : 1);
    } else if (Math.abs(diff) <= 2) {
      next = target;
    } else if (rng() < 0.25) {
      next = target; // 一気に跳ぶ(sigh の種)
    } else {
      next = prev + Math.sign(diff) * 2; // ふだんは2度ずつ寄せる
    }

    next = clampDeg(next);
    if (next === prev) next = clampDeg(prev + (prev >= MAX_DEG ? -1 : 1));
    dir = next > prev ? -1 : 1; // 刺繍音は向きを交互に
    degs.push(next);
    prev = next;
  }

  return smoothLeaps(degs);
}

// スナップ → 跳躍ならし → 再スナップ。
// 跳躍ならしは音階外の音を作りうるので、最後にもう一度寄せる。
function pentaize(degs, kind) {
  if (!kind) return degs.slice();
  return snapToPenta(smoothLeaps(snapToPenta(degs, kind)), kind);
}

// ---------------------------------------------------------------------------
// 置き場所(開始音)の決定
// ---------------------------------------------------------------------------

/**
 * 相対度数列 rel を実際の度数に置くときの開始音を選ぶ。
 * - 1〜15 に収まること(収まらない置き方はそもそも候補にしない)
 * - want に近いこと(want は「3〜10、6割は安定音」で引いた希望)
 * - ペンタトニックから外れる音が少ないこと(型を崩さずに音階へ寄せるため)
 * - endStable なら最後の音が {1,3,5} に着地すること
 */
function placeStart(rel, want, kind, endStable = false) {
  const min = Math.min(...rel);
  const max = Math.max(...rel);
  const lo = Math.max(MIN_DEG, MIN_DEG - min);
  const hi = Math.min(MAX_DEG, MAX_DEG - max);
  if (lo > hi) return clampDeg(want); // 15度に収まらない形は諦めてクランプ

  let best = null;
  for (let s = lo; s <= hi; s++) {
    const last = s + rel[rel.length - 1];
    const cost = offPentaCount(rel.map((r) => s + r), kind) * 3
      + Math.abs(s - want)
      + (endStable && !STABLE_SET.has(scaleDeg(last)) ? 8 : 0);
    if (best === null || cost < best.cost) best = { s, cost };
  }
  return best.s;
}

/** 歌い出しの希望。度数3〜10、6割は安定音 {1,3,5}。 */
function drawStart(rng) {
  return rng() < 0.6 ? pick(rng, STABLE_STARTS) : randInt(rng, 3, 10);
}

// ---------------------------------------------------------------------------
// ゼクエンツ(平行移動)
// ---------------------------------------------------------------------------

export const SEQ_OFFSETS = [-2, -1, 1, 2];

// オフセット off で平行移動してもペンタトニックに留まるスケール度数の集合。
// 例: major で off=+1 なら {1,2,5}(1→2, 2→3, 5→6)。
// 先にこの集合へ寄せてから平行移動すれば、前後半とも音階内で、
// かつ全音が同じオフセットになる = 動機として完全なゼクエンツになる。
function seqSet(kind, off) {
  const set = PENTA_SET[kind];
  const out = new Set();
  for (const s of set) {
    const moved = ((((s - 1 + off) % 7) + 7) % 7) + 1;
    if (set.has(moved)) out.add(s);
  }
  return out;
}

// 輪郭テンプレートの後半が前半より高いか低いか。
// ゼクエンツを上へ動かすか下へ動かすかをこれで決める。
function shapeDirection(contour) {
  const shape = CONTOUR_SHAPE[contour] || CONTOUR_SHAPE.arch;
  return lerpShape(shape, 0.75) >= lerpShape(shape, 0.25) ? 1 : -1;
}

/**
 * 前半 head を平行移動して後半にするオフセットを選ぶ。
 * 1〜15 に収まり、できればペンタトニックから外れないもの。
 * 同条件なら輪郭テンプレートの向きに合うものを先に採る。
 */
function chooseShift(rng, head, kind, dir) {
  const order = shuffle(rng, SEQ_OFFSETS)
    .sort((a, b) => (Math.sign(b) === dir ? 1 : 0) - (Math.sign(a) === dir ? 1 : 0));

  let fallback = 0;
  let found = false;
  for (const off of order) {
    const moved = head.map((d) => d + off);
    if (moved.some((d) => d < MIN_DEG || d > MAX_DEG)) continue;
    if (!found) {
      fallback = off;
      found = true;
    }
    if (offPentaCount(moved, kind) === 0) return off;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// 掛留・強弱
// ---------------------------------------------------------------------------

// 掛留の種: 頭の音を次の音の1つ上に置き換える。
// 後段で「2-1 で解決する掛留」として検出・加点される最重要要素。
// ペンタトニックから外れる音が入りうるが、掛留は「泣ける」の中核なので優先する。
function seedSuspension(degs, at) {
  const next = at + 1;
  if (next >= degs.length) return false;
  const cand = degs[next] + 1;
  if (cand > MAX_DEG) return false;
  degs[at] = cand;
  return true;
}

// 高い音ほどやや強く。0.55〜0.85 に収める。
function velocityFor(rng, deg, minDeg, maxDeg) {
  const range = maxDeg - minDeg;
  const t = range === 0 ? 0.5 : (deg - minDeg) / range;
  const v = 0.55 + t * 0.3 + (rng() - 0.5) * 0.04;
  return Math.round(Math.min(0.85, Math.max(0.55, v)) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// 候補1件
// ---------------------------------------------------------------------------

// 組み立て経路の配分。
//   soar    : 舞い上がり(跳んで頂点に届き、順次で降りる)。クライマックス用。
//   formula : 旋律型の連結。断片の主力。
//   contour : 輪郭テンプレート。多様性のために残す。
export const ROUTE_RATES = { soar: 0.1, formula: 0.55, contour: 0.35 };

// 旋律型から組み立てる経路の割合(soar も旋律型を使うので合算)。
export const FORMULA_RATE = ROUTE_RATES.soar + ROUTE_RATES.formula;

export function drawRoute(rng) {
  const r = rng();
  if (r < ROUTE_RATES.soar) return 'soar';
  if (r < ROUTE_RATES.soar + ROUTE_RATES.formula) return 'formula';
  return 'contour';
}

// 旋律型経路で、2小節目をどう作るか。
export const BAR2_RATES = { sequence: 0.4, repeat: 0.15, cadence: 0.3, other: 0.15 };

export function drawBar2Mode(rng) {
  const r = rng();
  if (r < BAR2_RATES.sequence) return 'sequence';
  if (r < BAR2_RATES.sequence + BAR2_RATES.repeat) return 'repeat';
  if (r < BAR2_RATES.sequence + BAR2_RATES.repeat + BAR2_RATES.cadence) return 'cadence';
  return 'other';
}

// 輪郭ベース経路の内訳。
export const PATH_RATES = { repeat: 0.15, sequence: 0.35, free: 0.5 };

export function drawPath(rng) {
  const r = rng();
  if (r < PATH_RATES.repeat) return 'repeat';
  if (r < PATH_RATES.repeat + PATH_RATES.sequence) return 'sequence';
  return 'free';
}

// --- 旋律型から2小節を組む ---
function formulaCandidate(rng, kind, contour, wantSus, tables) {
  const mode = drawBar2Mode(rng);
  const paired = mode === 'sequence' || mode === 'repeat';
  const rhythm = paired ? pick(rng, tables?.motif ?? MOTIF_RHYTHMS) : pickRhythm(rng, tables);

  const split = rhythm.findIndex((r) => r.b >= BAR);
  const n1 = split < 0 ? rhythm.length : split;
  const n2 = rhythm.length - n1;

  // 1小節目: 旋律型を継ぎ足して埋め、跳躍の連続だけならしてから音階へ寄せる。
  // state は断片1件ぶんの抽選状態(同じ型の再利用禁止・下降形の連続禁止)を持ち回る。
  const state = newDrawState();
  const first = formulaLine(rng, n1, state);
  const used = first.used.slice();
  const start = placeStart(first.rel, drawStart(rng), kind);
  let head = snapKeepingShape(smoothLeaps(first.rel.map((r) => r + start)), kind);

  let degs;
  let shift = null;
  if (paired && n2 === n1) {
    shift = mode === 'repeat' ? 0 : chooseShift(rng, head, kind, shapeDirection(contour));
    // 掛留は平行移動の前に前半へ仕込む。後から両小節に別々に入れると
    // 平行関係が崩れて「動機」でなくなる。
    if (wantSus && head.length >= 2) {
      const cand = head[1] + 1;
      const moved = cand + shift;
      if (cand <= MAX_DEG && moved >= MIN_DEG && moved <= MAX_DEG) head[0] = cand;
    }
    degs = head.concat(head.map((d) => d + shift));
  } else {
    // 2小節目は着地(終止形)か、別の型。前の音から近いところに置く。
    const endStable = mode === 'cadence';
    const second = endStable ? cadenceLine(rng, n2, state) : formulaLine(rng, n2, state);
    used.push(...second.used);
    const near = clampDeg(head[head.length - 1] + (endStable ? 1 : randInt(rng, -1, 2)));
    const tailStart = placeStart(second.rel, near, kind, endStable);
    const tail = second.rel.map((r) => r + tailStart);
    degs = head.concat(snapKeepingShape(smoothLeaps(tail), kind));
    if (wantSus) {
      seedSuspension(degs, 0);
      if (n1 > 0 && n2 > 0) seedSuspension(degs, n1);
    }
  }

  return { rhythm, degs, used, path: `formula:${mode}` };
}

// --- 舞い上がりの断片を組む ---
// 「4度以上跳び上がって頂点に届き、そこから順次で降りてくる」だけを狙う経路。
// 頂点は断片に1回しか置かない(2回鳴ると、届いた瞬間の一回性が消える)。
// 曲のクライマックスで使うので、6〜7割は高いところ(度数12以上)へ届かせる。
export const SOAR_HIGH_RATE = 0.65;

function soarCandidate(rng, kind, contour, wantSus, tables) {
  // 完全反復は頂点が2回鳴るので使わない。終止形で閉じるか、別の型を続ける。
  const mode = rng() < 0.55 ? 'cadence' : 'other';
  const rhythm = pickRhythm(rng, tables);
  const split = rhythm.findIndex((r) => r.b >= BAR);
  const n1 = split < 0 ? rhythm.length : split;
  const n2 = rhythm.length - n1;
  const state = newDrawState();

  // 舞い上がりは1小節目に置く。2小節目は降りてきた先から着地させる。
  // (2小節目に置くと、跳んだ直後に断片が終わって降り切れない)
  const first = soarLine(rng, n1, state);
  const used = first.used.slice();

  // 跳ぶ前の音をどこに置くか。高く置くほど頂点が高くなる。
  const want = rng() < SOAR_HIGH_RATE
    ? MAX_DEG - Math.max(...first.rel) - randInt(rng, 0, 2) // 天井いっぱいまで届かせる
    : drawStart(rng);
  const start = placeStart(first.rel, clampDeg(want), kind);
  // smoothLeaps は「同じ向きの跳躍が続く」ときだけ効く。舞い上がりは跳んだ直後が
  // 下降なので形は保たれ、助走から続けて跳んでしまう事故だけがならされる。
  const head = snapKeepingShape(smoothLeaps(first.rel.map((r) => r + start)), kind);

  const endStable = mode === 'cadence';
  const second = endStable ? cadenceLine(rng, n2, state) : formulaLine(rng, n2, state);
  used.push(...second.used);
  // 2小節目は頂点より下に置く。頂点に並ぶと「届いた一回」が消える。
  const near = clampDeg(head[head.length - 1] - randInt(rng, 0, 2));
  const tailStart = placeStart(second.rel, near, kind, endStable);
  const tail = second.rel.map((r) => r + tailStart);
  const degs = head.concat(snapKeepingShape(smoothLeaps(tail), kind));
  if (wantSus && n1 > 0 && n2 > 0) seedSuspension(degs, n1);

  return { rhythm, degs, used, path: `soar:${mode}` };
}

// --- 輪郭テンプレートから2小節を組む(多様性の担保) ---
function contourCandidate(rng, kind, contour, wantSus, tables) {
  const mode = drawPath(rng);

  if (mode === 'free') {
    const rhythm = pickRhythm(rng, tables);
    const degs = pentaize(buildDegrees(rng, contour, rhythm.length), kind);
    if (wantSus) {
      seedSuspension(degs, 0);
      const barTwo = rhythm.findIndex((r) => r.b >= BAR);
      if (barTwo > 0) seedSuspension(degs, barTwo);
    }
    return { rhythm, degs, used: [], path: `contour:${mode}` };
  }

  const rhythm = pick(rng, tables?.motif ?? MOTIF_RHYTHMS);
  // 前半の音数は小節線で数える。版1の型は mirror で作ってあるので length/2 と
  // 一致し、従来と同じ値になる。版2は等分でも mirror ではないので、こちらが正。
  const half = rhythm.findIndex((r) => r.b >= BAR);
  const lo = randInt(rng, 2, 7);
  const span = randInt(rng, 2, 6);
  const raw = buildDegrees(rng, contour, half, { lo, span });
  const order = shuffle(rng, SEQ_OFFSETS);

  let head = pentaize(raw, kind);
  let shift = 0;
  if (mode === 'sequence') {
    for (const off of order) {
      // 平行移動しても音階内に留まる集合へ先に寄せる = 完全なゼクエンツ
      const cand = kind ? snapToSet(raw, seqSet(kind, off), null) : raw.slice();
      if (cand.every((d) => d + off >= MIN_DEG && d + off <= MAX_DEG)) {
        head = cand;
        shift = off;
        break;
      }
    }
  }

  if (wantSus && head.length >= 2) {
    const cand = head[1] + 1;
    const moved = cand + shift;
    if (cand <= MAX_DEG && moved >= MIN_DEG && moved <= MAX_DEG) head[0] = cand;
  }

  return {
    rhythm,
    degs: head.concat(head.map((d) => d + shift)),
    used: [],
    path: `contour:${mode}`,
  };
}

export function generateCandidate(rng, tables = null) {
  const kind = drawPenta(rng);
  const route = drawRoute(rng);
  const contour = pick(rng, CONTOUR_NAMES);
  const wantSus = rng() < 0.35;

  const build = { soar: soarCandidate, formula: formulaCandidate, contour: contourCandidate }[route];
  const built = build(rng, kind, contour, wantSus, tables);
  const useFormula = route !== 'contour';

  const degs = built.degs.map(clampDeg);
  const minDeg = Math.min(...degs);
  const maxDeg = Math.max(...degs);
  const notes = built.rhythm.map((r, i) => ({
    deg: degs[i],
    beat: r.b,
    dur: r.d,
    vel: velocityFor(rng, degs[i], minDeg, maxDeg),
  }));

  return {
    notes,
    contour,
    penta: kind,
    path: built.path,
    source: useFormula ? 'formula' : 'contour',
    route,
    formulas: built.used,
  };
}
