import test from 'node:test';
import assert from 'node:assert/strict';
import {
  degToSemitone, degToMidi, parseChord, chordPitchClasses,
  isChordTone, chordVoicing, bassMidi, CHORD_VOCAB,
  splitBars, fitsBar, hasSuspension, nearestChordToneDeg,
} from '../src/theory.js';

test('degToSemitone: メジャースケール', () => {
  assert.equal(degToSemitone(1, 'major'), 0);
  assert.equal(degToSemitone(3, 'major'), 4);
  assert.equal(degToSemitone(7, 'major'), 11);
  assert.equal(degToSemitone(8, 'major'), 12);
  assert.equal(degToSemitone(15, 'major'), 24);
});

test('degToSemitone: 自然的短音階は3度・6度・7度が半音低い', () => {
  assert.equal(degToSemitone(3, 'minor'), 3);
  assert.equal(degToSemitone(6, 'minor'), 8);
  assert.equal(degToSemitone(7, 'minor'), 10);
  assert.equal(degToSemitone(8, 'minor'), 12);
});

test('degToMidi はトニックMIDIを起点にする', () => {
  assert.equal(degToMidi(1, 'major', 60), 60);
  assert.equal(degToMidi(5, 'major', 60), 67);
  assert.equal(degToMidi(8, 'minor', 57), 69);
});

test('parseChord: 転回形と品質を分解する', () => {
  assert.deepEqual(parseChord('I'), { flat: false, rootDeg: 1, minor: false, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('vi'), { flat: false, rootDeg: 6, minor: true, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('V/3'), { flat: false, rootDeg: 5, minor: false, quality: '', inversion: 3 });
  assert.deepEqual(parseChord('IVM7'), { flat: false, rootDeg: 4, minor: false, quality: 'M7', inversion: 0 });
  assert.deepEqual(parseChord('bVII'), { flat: true, rootDeg: 7, minor: false, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('Vsus4'), { flat: false, rootDeg: 5, minor: false, quality: 'sus4', inversion: 0 });
});

test('parseChord: 解釈できない記号は例外', () => {
  assert.throws(() => parseChord('X'), /unparsable|unknown/);
});

test('chordPitchClasses: Cメジャーキーでの実音', () => {
  assert.deepEqual(chordPitchClasses('I', 'major'), [0, 4, 7]);       // C E G
  assert.deepEqual(chordPitchClasses('vi', 'major'), [0, 4, 9]);      // A C E
  assert.deepEqual(chordPitchClasses('iv', 'major'), [0, 5, 8]);      // F Ab C
  assert.deepEqual(chordPitchClasses('bVI', 'major'), [0, 3, 8]);     // Ab C Eb
  assert.deepEqual(chordPitchClasses('V7', 'major'), [2, 5, 7, 11]);  // G B D F
  assert.deepEqual(chordPitchClasses('Vsus4', 'major'), [0, 2, 7]);   // G C D
});

test('chordPitchClasses: マイナーキーの V は導音を含む', () => {
  // Aマイナー相当。V = E G# B
  assert.deepEqual(chordPitchClasses('V', 'minor'), [2, 7, 11]);
  assert.deepEqual(chordPitchClasses('VI', 'minor'), [0, 3, 8]);
});

test('isChordTone は非和声音を弾く', () => {
  assert.equal(isChordTone(3, 'major', 'I'), true);
  assert.equal(isChordTone(4, 'major', 'I'), false);
  assert.equal(isChordTone(10, 'major', 'I'), true);   // 1オクターブ上の3度
  assert.equal(isChordTone(7, 'minor', 'V'), false);   // 自然的短音階の7度はV(導音)に含まれない
});

test('chordVoicing は転回形の最低音を反映する', () => {
  assert.deepEqual(chordVoicing('I', 'major', 60, 48), [48, 52, 55]);
  // 第1転回形は3度が最低音になる
  const v = chordVoicing('I/3', 'major', 60, 48);
  assert.equal(v.length, 3);
  assert.equal(v[0] % 12, 4);
  assert.ok(v[0] >= 48 && v[0] < 60);
});

test('bassMidi は指定した最低音域に収まる', () => {
  const b = bassMidi('V/3', 'major', 60, 36);
  assert.ok(b >= 36 && b < 48, `範囲外: ${b}`);
});

test('CHORD_VOCAB の全記号が解釈できる', () => {
  for (const mode of ['major', 'minor']) {
    assert.ok(CHORD_VOCAB[mode].length >= 15);
    for (const sym of CHORD_VOCAB[mode]) {
      assert.doesNotThrow(() => chordPitchClasses(sym, mode), `解釈できない: ${sym}`);
    }
  }
});

// ---------------------------------------------------------------------------
// CHORD_VOCAB の並び（melodies.json の適合データはこの配列の添字で保存されている）
//
// ここが動くと、全断片の「どのコードに乗るか」が別のコードを指す。
// 追加は必ず末尾へ append すること。このテストが落ちたら、データ側ではなく
// theory.js の並べ替えを疑う。
// ---------------------------------------------------------------------------

const VOCAB_HEAD_MAJOR = [
  'I', 'IM7', 'I/3', 'I/5', 'ii', 'ii7', 'iii', 'iii7',
  'IV', 'IVM7', 'IV/3', 'iv', 'V', 'V7', 'V/3', 'Vsus4',
  'vi', 'vi7', 'bVI', 'bVII',
];

const VOCAB_HEAD_MINOR = [
  'i', 'i7', 'i/3', 'i/5', 'isus4', 'III', 'IIIM7', 'iv',
  'iv7', 'iv/3', 'v', 'v7', 'V', 'V7', 'VI', 'VIM7',
  'VI/3', 'VII',
];

test('CHORD_VOCAB: 初版の並び（major の先頭20個）が1つも動いていない', () => {
  assert.deepEqual(CHORD_VOCAB.major.slice(0, 20), VOCAB_HEAD_MAJOR);
  // 添字そのものも確認する（slice の比較だけだと先頭に足された場合を見逃さないため）。
  VOCAB_HEAD_MAJOR.forEach((sym, i) => {
    assert.equal(CHORD_VOCAB.major[i], sym, `major[${i}] が ${CHORD_VOCAB.major[i]}（期待 ${sym}）`);
  });
});

test('CHORD_VOCAB: 初版の並び（minor の先頭18個）が1つも動いていない', () => {
  assert.deepEqual(CHORD_VOCAB.minor.slice(0, 18), VOCAB_HEAD_MINOR);
  VOCAB_HEAD_MINOR.forEach((sym, i) => {
    assert.equal(CHORD_VOCAB.minor[i], sym, `minor[${i}] が ${CHORD_VOCAB.minor[i]}（期待 ${sym}）`);
  });
});

test('CHORD_VOCAB に重複が無い', () => {
  for (const mode of ['major', 'minor']) {
    const v = CHORD_VOCAB[mode];
    assert.equal(new Set(v).size, v.length, `${mode} に重複がある`);
  }
});

test('CHORD_VOCAB の全記号が例外なく解釈でき、和音として成立する', () => {
  for (const mode of ['major', 'minor']) {
    for (const sym of CHORD_VOCAB[mode]) {
      assert.doesNotThrow(() => parseChord(sym), `parseChord できない: ${sym}`);
      const pcs = chordPitchClasses(sym, mode);
      assert.ok(pcs.length >= 3, `${sym}: 構成音が ${pcs.length} 個しかない`);
      assert.ok(pcs.length <= 5, `${sym}: 構成音が ${pcs.length} 個もある`);
      for (const pc of pcs) assert.ok(pc >= 0 && pc < 12, `${sym}: ピッチクラスが範囲外 ${pc}`);
      const voicing = chordVoicing(sym, mode, 60, 48);
      assert.equal(new Set(voicing).size, voicing.length, `${sym}: ボイシングに同音がある`);
      const b = bassMidi(sym, mode, 60, 36);
      assert.ok(b >= 36 && b < 48, `${sym}: ベースが範囲外 ${b}`);
    }
  }
});

// ---------------------------------------------------------------------------
// セカンダリードミナント
//
// 「その度数を根音とする長三和音＋短7度」。Cメジャーの III7 なら E-G#-B-D で、
// 音階外の G# が入る。これが名曲のバラードで胸が締めつけられる瞬間の正体。
// ---------------------------------------------------------------------------

// SD の根音が対象の完全5度上にあり、SD の第3音が対象の根音の半音下（導音）になっているか。
function resolvesTo(sdSymbol, targetSymbol, mode) {
  const sd = chordPitchClasses(sdSymbol, mode);
  const sdRoot = ((chordSemitonesOf(sdSymbol, mode)[0] % 12) + 12) % 12;
  const sdThird = ((chordSemitonesOf(sdSymbol, mode)[1] % 12) + 12) % 12;
  const targetRoot = ((chordSemitonesOf(targetSymbol, mode)[0] % 12) + 12) % 12;
  return {
    fifthAbove: (targetRoot + 7) % 12 === sdRoot,
    leadingTone: (targetRoot + 11) % 12 === sdThird,
    size: sd.length,
  };
}

// chordSemitones は公開されているが、転回前の並び（根音・第3音・第5音・第7音）が要る。
function chordSemitonesOf(symbol, mode) {
  const c = parseChord(symbol);
  const root = degToSemitone(c.rootDeg, mode) - (c.flat ? 1 : 0);
  const third = c.minor ? 3 : 4;
  return [root, root + third, root + 7];
}

test('III7 (V/vi) は Cメジャーで E-G#-B-D になる', () => {
  // E=4, G#=8, B=11, D=2。G# は音階外＝セカンダリードミナントの証拠。
  assert.deepEqual(chordPitchClasses('III7', 'major'), [2, 4, 8, 11]);
  const r = resolvesTo('III7', 'vi', 'major');
  assert.ok(r.fifthAbove, 'III7 の根音が vi の完全5度上ではない');
  assert.ok(r.leadingTone, 'III7 の第3音が vi の導音ではない');
  // 音階外の音をちょうど1つ含む。
  const scale = new Set([0, 2, 4, 5, 7, 9, 11]);
  const outside = chordPitchClasses('III7', 'major').filter((pc) => !scale.has(pc));
  assert.deepEqual(outside, [8], `音階外の音が ${outside} になっている`);
});

test('VI7 は V/ii として正しい（Cメジャーで A-C#-E-G）', () => {
  assert.deepEqual(chordPitchClasses('VI7', 'major'), [1, 4, 7, 9]);
  const r = resolvesTo('VI7', 'ii', 'major');
  assert.ok(r.fifthAbove, 'VI7 の根音が ii の完全5度上ではない');
  assert.ok(r.leadingTone, 'VI7 の第3音が ii の導音ではない');
});

test('I7 は V/IV として [0, 4, 7, 10]（C-E-G-Bb）', () => {
  assert.deepEqual(chordPitchClasses('I7', 'major'), [0, 4, 7, 10]);
  const r = resolvesTo('I7', 'IV', 'major');
  assert.ok(r.fifthAbove, 'I7 の根音が IV の完全5度上ではない');
  assert.ok(r.leadingTone, 'I7 の第3音が IV の導音ではない');
});

test('II7 (V/V) と VII7 (V/iii) も属七の形をしている', () => {
  assert.deepEqual(chordPitchClasses('II7', 'major'), [0, 2, 6, 9]);   // D F# A C
  assert.deepEqual(chordPitchClasses('VII7', 'major'), [3, 6, 9, 11]); // B D# F# A
  for (const [sd, target] of [['II7', 'V'], ['VII7', 'iii']]) {
    const r = resolvesTo(sd, target, 'major');
    assert.ok(r.fifthAbove, `${sd} の根音が ${target} の完全5度上ではない`);
    assert.ok(r.leadingTone, `${sd} の第3音が ${target} の導音ではない`);
  }
});

test('短調のセカンダリードミナント II7 / VII7 / IV7', () => {
  for (const [sd, target] of [['II7', 'v'], ['VII7', 'III'], ['IV7', 'VII']]) {
    const r = resolvesTo(sd, target, 'minor');
    assert.equal(r.size, 4, `${sd}: 4和音ではない`);
    assert.ok(r.fifthAbove, `${sd} の根音が ${target} の完全5度上ではない`);
    assert.ok(r.leadingTone, `${sd} の第3音が ${target} の導音ではない`);
  }
});

test('大文字ローマ数字 + 7 は長三和音＋短7度（短三和音の7thにならない）', () => {
  for (const [mode, sym] of [['major', 'III7'], ['major', 'VI7'], ['major', 'II7'],
    ['major', 'VII7'], ['major', 'I7'], ['minor', 'II7'], ['minor', 'VII7'], ['minor', 'IV7']]) {
    const semis = chordSemitonesOf(sym, mode);
    assert.equal(semis[1] - semis[0], 4, `${sym}: 第3音が長3度ではない`);
    assert.equal(chordPitchClasses(sym, mode).length, 4, `${sym}: 4和音ではない`);
  }
});

// ---------------------------------------------------------------------------
// テンション（9th）と第3転回形
// ---------------------------------------------------------------------------

test('ii9 は5音で9度を含む（マイナー9th）', () => {
  const pcs = chordPitchClasses('ii9', 'major');
  assert.equal(pcs.length, 5, `ii9 が ${pcs.length} 音`);
  // D F A C E。9度は E（根音Dの全音上）。
  assert.deepEqual(pcs, [0, 2, 4, 5, 9]);
  assert.deepEqual(parseChord('ii9').quality, '9');
  const ninth = (2 + 14) % 12;                     // 根音D + 14半音 = E
  assert.ok(pcs.includes(ninth), 'ii9 に9度が入っていない');
  assert.ok(pcs.includes((2 + 3) % 12), 'ii9 が短三和音になっていない');
  assert.ok(pcs.includes((2 + 10) % 12), 'ii9 に短7度が入っていない');
});

test('V9 は5音で9度を含む（属九）', () => {
  const pcs = chordPitchClasses('V9', 'major');
  assert.equal(pcs.length, 5, `V9 が ${pcs.length} 音`);
  assert.deepEqual(pcs, [2, 5, 7, 9, 11]);         // G B D F A
  const ninth = (7 + 14) % 12;                     // 根音G + 14半音 = A
  assert.ok(pcs.includes(ninth), 'V9 に9度が入っていない');
  assert.ok(pcs.includes((7 + 4) % 12), 'V9 が長三和音になっていない');
  assert.ok(pcs.includes((7 + 10) % 12), 'V9 に短7度が入っていない');
});

test('iv9 は短調のサブドミナントマイナー9th', () => {
  const pcs = chordPitchClasses('iv9', 'minor');
  assert.equal(pcs.length, 5);
  assert.ok(pcs.includes((5 + 3) % 12), 'iv9 が短三和音になっていない');
  assert.ok(pcs.includes((5 + 14) % 12), 'iv9 に9度が入っていない');
});

test('V/7 は第3転回形で、最低音が7th（Cメジャーなら F）', () => {
  const voicing = chordVoicing('V/7', 'major', 60, 48);
  assert.equal(voicing.length, 4, 'V/7 が4和音になっていない');
  const lowest = voicing[0];
  // V の根音は G(7)。その短7度上 = F(5)。
  assert.equal(((lowest % 12) + 12) % 12, 5, `最低音が F ではない (${lowest})`);
  // 最低音が構成音の中でいちばん低く、他の3音（G B D）が上に乗る。
  assert.deepEqual([...voicing].sort((a, b) => a - b), voicing);
  assert.deepEqual(
    voicing.slice(1).map((m) => ((m % 12) + 12) % 12).sort((a, b) => a - b),
    [2, 7, 11],
  );
  assert.deepEqual(chordPitchClasses('V/7', 'major'), chordPitchClasses('V7', 'major'));
  assert.equal(((bassMidi('V/7', 'major', 60, 36) % 12) + 12) % 12, 5);
});

test('i/7 は i7 の第3転回形（Cマイナーなら Bb が最低音）', () => {
  const voicing = chordVoicing('i/7', 'minor', 60, 48);
  assert.equal(voicing.length, 4);
  assert.equal(((voicing[0] % 12) + 12) % 12, 10, 'i/7 の最低音が短7度ではない');
  assert.deepEqual(chordPitchClasses('i/7', 'minor'), chordPitchClasses('i7', 'minor'));
});

test('追加した転回形は狙った音が最低音になる', () => {
  const pcOf = (sym, mode) => ((bassMidi(sym, mode, 60, 36) % 12) + 12) % 12;
  assert.equal(pcOf('ii/3', 'major'), 5);      // Dm/F
  assert.equal(pcOf('vi/3', 'major'), 0);      // Am/C
  assert.equal(pcOf('iii/3', 'major'), 7);     // Em/G
  assert.equal(pcOf('IM7/3', 'major'), 4);     // CM7/E
  assert.equal(pcOf('IVM7/3', 'major'), 9);    // FM7/A
  assert.equal(pcOf('III/3', 'minor'), 7);     // Eb/G
  assert.equal(pcOf('VII/3', 'minor'), 2);     // Bb/D
  assert.equal(pcOf('iv/5', 'minor'), 0);      // Fm/C
});

const N = (deg, beat, dur, vel = 0.7) => ({ deg, beat, dur, vel });

test('splitBars は2小節に分け、beatを小節内ローカルに直す', () => {
  const [a, b] = splitBars([N(1, 0, 2), N(3, 2, 2), N(5, 4, 2), N(8, 6, 2)]);
  assert.deepEqual(a.map((n) => [n.deg, n.beat]), [[1, 0], [3, 2]]);
  assert.deepEqual(b.map((n) => [n.deg, n.beat]), [[5, 0], [8, 2]]);
});

test('splitBars: 小節線をまたぐ音は、次の小節の頭の音として扱う', () => {
  // 食いは「次の小節の頭が半拍早く出た」音なので、和声も次の小節で見る。
  const [a, b] = splitBars([
    { deg: 1, beat: 0, dur: 1 },
    { deg: 5, beat: 3.5, dur: 1 },   // 3.5〜4.5。小節線をまたぐ
    { deg: 3, beat: 5, dur: 1 },
  ]);
  assert.deepEqual(a.map((n) => n.beat), [0], 'またぐ音が前の小節に残っている');
  assert.equal(b.length, 2);
  assert.deepEqual({ deg: b[0].deg, beat: b[0].beat, dur: b[0].dur, anticipates: b[0].anticipates },
    { deg: 5, beat: 0, dur: 0.5, anticipates: true });
  assert.deepEqual({ deg: b[1].deg, beat: b[1].beat }, { deg: 3, beat: 1 });
});

test('splitBars: またがない音の扱いは従来どおり', () => {
  // 版1の断片にはまたぐ音が1つも無いので、ここが変わると既存の曲が変わる。
  const [a, b] = splitBars([
    { deg: 1, beat: 0, dur: 1 },
    { deg: 2, beat: 3.5, dur: 0.5 },  // ちょうど小節線で終わる＝またがない
    { deg: 3, beat: 4, dur: 4 },
  ]);
  assert.deepEqual(a.map((n) => [n.beat, n.dur]), [[0, 1], [3.5, 0.5]]);
  assert.deepEqual(b.map((n) => [n.beat, n.dur]), [[0, 4]]);
  assert.ok(a.every((n) => n.anticipates === undefined));
});

test('fitsBar: 強拍がコードトーンなら適合', () => {
  assert.equal(fitsBar([N(1, 0, 2), N(5, 2, 2)], 'major', 'I'), true);
});

test('fitsBar: 強拍の非和声音が解決しなければ不適合', () => {
  assert.equal(fitsBar([N(4, 0, 2), N(6, 2, 2)], 'major', 'I'), false);
});

test('fitsBar: 強拍の非和声音でも順次下降で解決すれば適合', () => {
  assert.equal(fitsBar([N(4, 0, 1), N(3, 1, 1), N(1, 2, 2)], 'major', 'I'), true);
});

test('fitsBar: コードトーンが1つもなければ不適合', () => {
  assert.equal(fitsBar([N(2, 0, 0.5), N(4, 0.5, 0.5), N(6, 1, 0.5), N(2, 1.5, 0.5)], 'major', 'I'), false);
});

test('fitsBar: 空の小節は常に適合', () => {
  assert.equal(fitsBar([], 'major', 'V7'), true);
});

test('hasSuspension: 小節頭の非和声音が順次下降で解決すれば真', () => {
  // Iの上で4度→3度（4-3の掛留）
  assert.equal(hasSuspension([N(4, 0, 1.5), N(3, 1.5, 2.5)], 'major', 'I'), true);
});

test('hasSuspension: 小節頭がコードトーンなら偽', () => {
  assert.equal(hasSuspension([N(3, 0, 1.5), N(2, 1.5, 2.5)], 'major', 'I'), false);
});

test('hasSuspension: 上行で解決するものは掛留とみなさない', () => {
  assert.equal(hasSuspension([N(4, 0, 1.5), N(5, 1.5, 2.5)], 'major', 'I'), false);
});

test('nearestChordToneDeg は指定度数に最も近いコードトーンを返す', () => {
  assert.equal(nearestChordToneDeg('I', 'major', 4), 3);
  assert.equal(nearestChordToneDeg('I', 'major', 6), 5);
  assert.ok(isChordTone(nearestChordToneDeg('V7', 'major', 9), 'major', 'V7'));
});
