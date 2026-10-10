import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { STUDY_ITEMS } from '../js/data.js';
import { audioSourceFor, playStudyItem, stopStudyAudio } from '../js/audio.js';

const directory = new URL('../assets/audio/', import.meta.url);
const manifestFile = new URL('generation-manifest.json', directory);
const readManifest = () => {
  assert.ok(existsSync(manifestFile), 'The generation manifest must ship with the audio');
  return JSON.parse(readFileSync(manifestFile, 'utf8'));
};

test('every study item uses its stable ID for bundled offline WAV playback', () => {
  for (const item of STUDY_ITEMS) {
    assert.equal(audioSourceFor(item), `assets/audio/${item.id}.wav`, item.id);
  }
  assert.equal(audioSourceFor({ id: 'dakuten-ga', audioKey: 'ga' }), 'assets/audio/dakuten-ga.wav');
  assert.equal(audioSourceFor({ audioKey: 'a' }), 'assets/audio/a.wav');
  assert.equal(audioSourceFor({}), null);
});

test('all 128 bundled clips are non-silent PCM WAVs at 24 kHz mono 16-bit', () => {
  assert.equal(STUDY_ITEMS.length, 128);
  for (const item of STUDY_ITEMS) {
    const path = new URL(`${item.id}.wav`, directory);
    assert.ok(existsSync(path), `${item.id} needs a local WAV`);
    const wav = readFileSync(path);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF', item.id);
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE', item.id);
    assert.equal(wav.readUInt32LE(4), wav.length - 8, item.id);
    let format;
    let samples;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const size = wav.readUInt32LE(offset + 4);
      const kind = wav.toString('ascii', offset, offset + 4);
      assert.ok(offset + 8 + size <= wav.length, `${item.id}: truncated ${kind}`);
      if (kind === 'fmt ') format = wav.subarray(offset + 8, offset + 8 + size);
      if (kind === 'data') samples = wav.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    assert.ok(format && samples, item.id);
    assert.equal(format.readUInt16LE(0), 1, item.id);
    assert.equal(format.readUInt16LE(2), 1, item.id);
    assert.equal(format.readUInt32LE(4), 24000, item.id);
    assert.equal(format.readUInt16LE(14), 16, item.id);
    assert.ok(samples.length >= 24000 * 2 * 0.2, `${item.id}: too short`);
    assert.ok(samples.length <= 24000 * 2 * 8, `${item.id}: too long`);
    let sum = 0;
    let peak = 0;
    for (let offset = 0; offset < samples.length; offset += 2) {
      const sample = samples.readInt16LE(offset);
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
    }
    assert.ok(peak > 400, `${item.id}: no audible signal`);
    assert.ok(peak < 32767, `${item.id}: clipped signal`);
    assert.ok(Math.sqrt(sum / (samples.length / 2)) > 100, `${item.id}: near-silence`);
  }
  assert.equal(readdirSync(directory).filter((name) => name.endsWith('.mp3')).length, 0);
});

test('manifest records one named voice, complete queries, source provenance and exact WAV hashes', () => {
  const manifest = readManifest();
  assert.equal(manifest.speaker.name, '四国めたん');
  assert.equal(manifest.speaker.styleName, 'ノーマル');
  assert.equal(typeof manifest.speaker.styleId, 'number');
  assert.match(manifest.generator.name, /VOICEVOX/);
  assert.match(manifest.generator.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.generator.sources.every((source) => source.url.startsWith('https://')));
  assert.deepEqual(manifest.items.map((item) => item.id).sort(), STUDY_ITEMS.map((item) => item.id).sort());
  for (const item of manifest.items) {
    assert.ok(item.sourceText && item.synthesisText, item.id);
    assert.ok(item.query.accent_phrases?.length, item.id);
    assert.equal(item.query.outputSamplingRate, 24000, item.id);
    assert.equal(item.query.outputStereo, false, item.id);
    const hash = createHash('sha256').update(readFileSync(new URL(`${item.id}.wav`, directory))).digest('hex');
    assert.equal(item.sha256, hash, item.id);
  }
});

test('pronunciation audit preserves isolated kana, contracted sounds and full rule examples', () => {
  const manifest = readManifest();
  const find = (id) => manifest.items.find((item) => item.id === id);
  const moras = (id) => find(id).query.accent_phrases.flatMap((phrase) => phrase.moras);
  assert.deepEqual(moras('ha').map(({ consonant, vowel }) => [consonant, vowel]), [['h', 'a']]);
  assert.deepEqual(moras('he').map(({ consonant, vowel }) => [consonant, vowel]), [['h', 'e']]);
  assert.deepEqual(moras('wo').map(({ consonant, vowel }) => [consonant, vowel]), [[null, 'o']]);
  assert.equal(moras('n')[0].vowel, 'N');
  assert.ok(moras('n')[0].vowel_length >= 0.18, 'isolated nasal must be long enough to hear');
  for (const item of STUDY_ITEMS.filter((item) => item.category === 'youon')) {
    assert.equal(moras(item.id).length, 1, `${item.id}: contracted sound is one mora`);
  }
  for (const item of STUDY_ITEMS.filter((item) => item.category === 'sokuon')) {
    assert.equal(find(item.id).sourceText, item.kana, item.id);
    if (/[っッ]/.test(item.kana)) assert.ok(moras(item.id).some((mora) => mora.vowel === 'cl'), item.id);
    assert.ok(moras(item.id).length > 1, item.id);
  }
  for (const item of STUDY_ITEMS.filter((item) => item.category === 'chouon')) {
    assert.equal(find(item.id).sourceText, item.kana, item.id);
    assert.ok(moras(item.id).some((mora, index, all) => index > 0 && mora.vowel.toLowerCase() === all[index - 1].vowel.toLowerCase() && !mora.consonant), item.id);
  }
});

test('local playback works with no speech service, and cancellation remains nonfatal', async () => {
  let source;
  let paused = false;
  const result = await playStudyItem(STUDY_ITEMS.at(-1), {
    manual: true,
    speechSynthesis: undefined,
    audioFactory: (path) => {
      source = path;
      return { play: async () => {}, pause: () => { paused = true; } };
    },
  });
  assert.equal(result.method, 'local');
  assert.equal(source, `assets/audio/${STUDY_ITEMS.at(-1).id}.wav`);
  stopStudyAudio();
  assert.equal(paused, true);
  let resolve;
  const pending = playStudyItem(STUDY_ITEMS[0], {
    manual: true,
    audioFactory: () => ({ play: () => new Promise((done) => { resolve = done; }), pause: () => {} }),
  });
  stopStudyAudio();
  resolve();
  assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
});

test('generator selects the named normal voice and protects kana readings', async () => {
  const generatorFile = new URL('../tools/generate-audio.mjs', import.meta.url);
  assert.ok(existsSync(generatorFile), 'A reproducible audio generator must be provided');
  const { selectSpeaker, pronunciationInputFor, prepareQuery } = await import(generatorFile.href);
  assert.deepEqual(selectSpeaker([
    { name: 'Other', styles: [{ name: 'ノーマル', id: 9 }] },
    { name: '四国めたん', speaker_uuid: 'voice-id', styles: [{ name: 'あまあま', id: 0 }, { name: 'ノーマル', id: 72 }] },
  ]), { name: '四国めたん', uuid: 'voice-id', styleName: 'ノーマル', styleId: 72 });
  assert.throws(() => selectSpeaker([]), /四国めたん/);
  assert.equal(pronunciationInputFor(STUDY_ITEMS.find((item) => item.id === 'ha')).synthesisText, 'ハ');
  assert.equal(pronunciationInputFor(STUDY_ITEMS.find((item) => item.id === 'he')).synthesisText, 'ヘ');
  assert.equal(pronunciationInputFor(STUDY_ITEMS.find((item) => item.id === 'wo')).synthesisText, 'オ');
  assert.equal(pronunciationInputFor(STUDY_ITEMS.find((item) => item.id === 'chouon-sensei')).synthesisText, "センセ'エ");
  const query = prepareQuery({ id: 'n', category: 'basic' }, {
    accent_phrases: [{ moras: [{ text: 'ン', consonant: null, vowel: 'N', vowel_length: 0.05 }] }],
  });
  assert.ok(query.accent_phrases[0].moras[0].vowel_length >= 0.18);
  assert.equal(query.outputSamplingRate, 24000);
  assert.equal(query.outputStereo, false);
});

test('generator audits complete expected phonemes for every study item before synthesis', async () => {
  const generatorFile = new URL('../tools/generate-audio.mjs', import.meta.url);
  const generator = await import(generatorFile.href);
  assert.equal(typeof generator.auditPhonemes, 'function');
  assert.throws(() => generator.auditPhonemes(STUDY_ITEMS.find((item) => item.id === 'ha'), {
    accent_phrases: [{ moras: [{ consonant: 'w', vowel: 'a' }] }],
  }), /ha.*expected ha.*wa/);
  const manifest = readManifest();
  for (const item of STUDY_ITEMS) {
    const generated = manifest.items.find((entry) => entry.id === item.id);
    assert.equal(generator.auditPhonemes(item, generated.query).status, 'passed', item.id);
    assert.equal(generated.phonemeAudit.status, 'passed', item.id);
  }
});
