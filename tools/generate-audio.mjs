import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDY_ITEMS } from '../js/data.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCES = [
  { name: 'VOICEVOX CORE C API', version: '0.17.0', url: 'https://github.com/VOICEVOX/voicevox_core/releases/download/0.17.0/voicevox_core-windows-x64-0.17.0.zip', sha256: '5a116b73fe338d36e63ae651279246f5968d0866a73780209c5f7b43c9692216' },
  { name: 'VOICEVOX voice model 0.vvm', version: '0.17.0', url: 'https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.17.0/0.vvm', sha256: 'ecd35374d4182cd883cba5040376f7f888cc6ba248b1c2f4cea07cdb34bb1318' },
  { name: 'VOICEVOX ONNX Runtime CPU', version: '1.23.2', url: 'https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.23.2/voicevox_onnxruntime-win-x64-1.23.2.tgz', sha256: '1bf9635d1c0ffd4e7345e0f628cecbabde65782c73c5051d52a52e7edf7ce11c' },
  { name: 'Open JTalk UTF-8 dictionary', version: '1.11', url: 'https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz', sha256: 'fe6ba0e43542cef98339abdffd903e062008ea170b04e7e2a35da805902f382a' },
];

export function selectSpeaker(speakers) {
  const speaker = speakers.find((entry) => entry.name === '四国めたん');
  const style = speaker?.styles.find((entry) => entry.name === 'ノーマル');
  if (!style) throw new Error('四国めたん / ノーマル was not found in /speakers');
  return { name: speaker.name, uuid: speaker.speaker_uuid, styleName: style.name, styleId: style.id };
}

export function pronunciationInputFor(item) {
  const sourceText = item.hiragana ?? item.kana ?? item.katakana;
  const synthesisText = item.id === 'chouon-sensei' ? "センセ'エ" : (item.id === 'wo' ? 'オ' : (item.katakana ?? item.kana));
  const overrides = [];
  if (item.katakana) overrides.push('Use katakana for isolated kana to avoid grammatical particle readings.');
  if (item.id === 'wo') overrides.push('Modern standard Japanese を is pronounced /o/.');
  if (item.id === 'n') overrides.push('Hold the isolated moraic nasal for at least 0.25 seconds.');
  if (item.id === 'chouon-sensei') overrides.push('Use explicit AquesTalk-style kana to teach the standard long /e/ reading of せんせい; dictionary text analysis otherwise returns /seNsei/.');
  return { sourceText, synthesisText, isKana: item.id === 'chouon-sensei', overrides };
}

const RULE_PHONEMES = {
  'sokuon-kitte': 'ki cl te', 'sokuon-gakkou': 'ga cl ko o', 'sokuon-kippu': 'ki cl pu',
  'sokuon-zasshi': 'za cl shi', 'sokuon-chotto': 'cho cl to', 'sokuon-matte': 'ma cl te',
  'sokuon-kekkon': 'ke cl ko N', 'sokuon-issho': 'i cl sho', 'sokuon-beddo': 'be cl do',
  'sokuon-sakkaa': 'sa cl ka a', 'sokuon-baggu': 'ba cl gu', 'sokuon-chiketto': 'chi ke cl to',
  'chouon-okaasan': 'o ka a sa N', 'chouon-oneesan': 'o ne e sa N', 'chouon-koukou': 'ko o ko o',
  'chouon-sensei': 'se N se e', 'chouon-koohii': 'ko o hi i', 'chouon-suupaa': 'su u pa a',
  'chouon-keeki': 'ke e ki', 'chouon-nooto': 'no o to', 'chouon-takushii': 'ta ku shi i',
  'chouon-juusu': 'ju u su', 'chouon-meeru': 'me e ru', 'chouon-geemu': 'ge e mu',
};

export function auditPhonemes(item, query) {
  const expected = RULE_PHONEMES[item.id]?.split(' ') ?? [item.id === 'wo' ? 'o' : item.id === 'n' ? 'N' : item.romaji];
  const actual = query.accent_phrases.flatMap((phrase) => phrase.moras).map((mora) => `${mora.consonant ?? ''}${mora.vowel === 'N' ? 'N' : mora.vowel.toLowerCase()}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${item.id}: expected ${expected.join(' ')}, got ${actual.join(' ')}`);
  return { status: 'passed', expected, actual };
}

export function prepareQuery(item, input) {
  const query = structuredClone(input);
  query.speedScale = 0.9;
  query.volumeScale = 0.8;
  query.prePhonemeLength = 0.08;
  query.postPhonemeLength = 0.12;
  query.outputSamplingRate = 24000;
  query.outputStereo = false;
  if (!['sokuon', 'chouon'].includes(item.category)) {
    for (const phrase of query.accent_phrases) {
      for (const mora of phrase.moras) {
        // A lone study syllable needs an audible vowel, including normally devoiced vowels.
        if (/^[AIUEO]$/.test(mora.vowel)) mora.vowel = mora.vowel.toLowerCase();
        mora.vowel_length = Math.max(mora.vowel_length, item.id === 'n' ? 0.25 : 0.19);
      }
    }
    if (query.kana) query.kana = query.kana.replaceAll('_', '');
  }
  return query;
}

export function inspectWave(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt32LE(4) !== wav.length - 8) throw new Error('Invalid RIFF/WAVE');
  let format;
  let samples;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (offset + 8 + size > wav.length) throw new Error('Truncated WAV chunk');
    const kind = wav.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ') format = wav.subarray(offset + 8, offset + 8 + size);
    if (kind === 'data') samples = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!format || !samples || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 24000 || format.readUInt16LE(14) !== 16) throw new Error('Expected PCM mono 24 kHz 16-bit WAV');
  let sum = 0;
  let peak = 0;
  for (let offset = 0; offset < samples.length; offset += 2) {
    const sample = samples.readInt16LE(offset);
    sum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const durationSeconds = samples.length / 48000;
  const rms = Math.sqrt(sum / (samples.length / 2));
  if (durationSeconds < 0.2 || durationSeconds > 8 || rms < 100 || peak < 400 || peak >= 32767) throw new Error('Silent, clipped or implausibly long/short audio');
  return { sampleRate: 24000, channels: 1, bitsPerSample: 16, durationSeconds, peak, rms };
}

// This small bridge uses only Python's standard library and the official C API.
// It stays in ignored tmp/; the application never calls a synthesis server.
export const CORE_ADAPTER = String.raw`import ctypes as c
import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

base = pathlib.Path(sys.argv[1]).resolve()
lib = c.CDLL(str(base / "voicevox_core-windows-x64-0.17.0/lib/voicevox_core.dll"))

class OrtOptions(c.Structure):
    _fields_ = [("filename", c.c_char_p)]
class InitOptions(c.Structure):
    _fields_ = [("acceleration_mode", c.c_int32), ("cpu_num_threads", c.c_uint16)]
class LoadOptions(c.Structure):
    _fields_ = [("on_existing", c.c_int32)]
class SynthesisOptions(c.Structure):
    _fields_ = [("enable_interrogative_upspeak", c.c_bool)]

def bind(name, args, result=c.c_int32):
    fn = getattr(lib, name)
    fn.argtypes, fn.restype = args, result
    return fn

get_version = bind("voicevox_get_version", [], c.c_char_p)
error_message = bind("voicevox_error_result_to_message", [c.c_int32], c.c_char_p)
load_ort = bind("voicevox_onnxruntime_load_once", [OrtOptions, c.POINTER(c.c_void_p)])
new_jtalk = bind("voicevox_open_jtalk_rc_new", [c.c_char_p, c.POINTER(c.c_void_p)])
new_synth = bind("voicevox_synthesizer_new", [c.c_void_p, c.c_void_p, InitOptions, c.POINTER(c.c_void_p)])
open_model = bind("voicevox_voice_model_file_open", [c.c_char_p, c.POINTER(c.c_void_p)])
load_model = bind("voicevox_synthesizer_load_voice_model", [c.c_void_p, c.c_void_p, LoadOptions])
model_metas = bind("voicevox_voice_model_file_create_metas_json", [c.c_void_p], c.c_void_p)
create_query = bind("voicevox_synthesizer_create_audio_query", [c.c_void_p, c.c_char_p, c.c_uint32, c.POINTER(c.c_void_p)])
create_kana_query = bind("voicevox_synthesizer_create_audio_query_from_kana", [c.c_void_p, c.c_char_p, c.c_uint32, c.POINTER(c.c_void_p)])
synthesis = bind("voicevox_synthesizer_synthesis", [c.c_void_p, c.c_char_p, c.c_uint32, SynthesisOptions, c.POINTER(c.c_size_t), c.POINTER(c.c_void_p)])
free_json = bind("voicevox_json_free", [c.c_void_p], None)
free_wav = bind("voicevox_wav_free", [c.c_void_p], None)

def check(result):
    if result:
        raise RuntimeError(error_message(result).decode("utf-8"))

def take_json(pointer):
    try:
        return json.loads(c.string_at(pointer).decode("utf-8"))
    finally:
        free_json(pointer)

ort, jtalk, synth, model = (c.c_void_p() for _ in range(4))
check(load_ort(OrtOptions(str(base / "voicevox_onnxruntime-win-x64-1.23.2/lib/voicevox_onnxruntime.dll").encode()), c.byref(ort)))
check(new_jtalk(str(base / "open_jtalk_dic_utf_8-1.11").encode(), c.byref(jtalk)))
check(new_synth(ort, jtalk, InitOptions(1, 4), c.byref(synth)))
check(open_model(str(base / "0.vvm").encode(), c.byref(model)))
check(load_model(synth, model, LoadOptions(0)))
speakers = take_json(model_metas(model))
version = get_version().decode()

class Handler(BaseHTTPRequestHandler):
    def respond(self, value, content_type="application/json"):
        data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/speakers": self.respond(speakers)
        elif path == "/version": self.respond(version)
        elif path == "/engine_manifest": self.respond({"name": "VOICEVOX CORE", "version": version, "model_version": "0.17.0", "bridge": "Python stdlib ctypes C API adapter"})
        else: self.send_error(404)
    def do_POST(self):
        try:
            url = urlparse(self.path)
            parameters = parse_qs(url.query)
            style = int(parameters["speaker"][0])
            if url.path == "/audio_query":
                pointer = c.c_void_p()
                query_fn = create_kana_query if parameters.get("is_kana", ["false"])[0] == "true" else create_query
                check(query_fn(synth, parameters["text"][0].encode("utf-8"), style, c.byref(pointer)))
                self.respond(take_json(pointer))
            elif url.path == "/synthesis":
                length, pointer = c.c_size_t(), c.c_void_p()
                query = self.rfile.read(int(self.headers["Content-Length"]))
                check(synthesis(synth, query, style, SynthesisOptions(False), c.byref(length), c.byref(pointer)))
                try: self.respond(c.string_at(pointer, length.value), "audio/wav")
                finally: free_wav(pointer)
            else: self.send_error(404)
        except Exception as error:
            data = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
    def log_message(self, *args): pass

print("VOICEVOX CORE " + version + " ready on 127.0.0.1:" + sys.argv[2], flush=True)
HTTPServer(("127.0.0.1", int(sys.argv[2])), Handler).serve_forever()
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--prepare-core-adapter')) {
    const destination = resolve(root, 'tmp/voicevox/core-server.py');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, CORE_ADAPTER, 'utf8');
    console.log('Prepared tmp/voicevox/core-server.py; see assets/audio/README.md to start it.');
    return;
  }
  const valueFor = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  const endpoint = valueFor('--engine-url', 'http://127.0.0.1:50022');
  const request = async (path, options) => {
    const response = await fetch(`${endpoint}${path}`, options);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`);
    return response;
  };
  const speaker = selectSpeaker(await (await request('/speakers')).json());
  const engine = await (await request('/engine_manifest')).json();
  const version = await (await request('/version')).json();
  if (engine.name !== 'VOICEVOX CORE' || version !== '0.17.0') throw new Error('This pinned generation recipe requires VOICEVOX CORE 0.17.0');
  const output = resolve(root, 'assets/audio');
  await mkdir(output, { recursive: true });
  const manifest = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    credit: 'VOICEVOX:四国めたん',
    generator: { name: engine.name, version, modelVersion: '0.17.0', bridge: engine.bridge, sources: SOURCES },
    speaker,
    audioFormat: { sampleRate: 24000, channels: 1, bitsPerSample: 16, encoding: 'PCM WAV' },
    pronunciationReview: { method: 'All query moras and phonemes checked against the study catalog; signal and file structure checked for every clip.', listening: 'Human listening was not performed; synthetic speech may retain unnatural prosody.' },
    items: [],
  };
  for (const item of STUDY_ITEMS) {
    const input = pronunciationInputFor(item);
    const parameters = new URLSearchParams({ text: input.synthesisText, speaker: speaker.styleId.toString(), is_kana: input.isKana.toString() });
    const originalQuery = await (await request(`/audio_query?${parameters}`, { method: 'POST' })).json();
    const query = prepareQuery(item, originalQuery);
    const phonemeAudit = auditPhonemes(item, query);
    const response = await request(`/synthesis?speaker=${speaker.styleId}&enable_interrogative_upspeak=false`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
    });
    const wav = Buffer.from(await response.arrayBuffer());
    const statistics = inspectWave(wav);
    await writeFile(resolve(output, `${item.id}.wav`), wav);
    manifest.items.push({ id: item.id, category: item.category, ...input, overrides: [...input.overrides, ...(!['sokuon', 'chouon'].includes(item.category) ? ['Voice isolated vowels and hold them for at least 0.19 seconds.'] : [])], originalQuery, query, phonemeAudit, ...statistics, sha256: createHash('sha256').update(wav).digest('hex') });
    console.log(`${manifest.items.length}/${STUDY_ITEMS.length} ${item.id} (${statistics.durationSeconds.toFixed(2)}s)`);
  }
  await writeFile(resolve(output, 'generation-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('Generated all study audio; run node --test tests/offline-audio.test.mjs.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
