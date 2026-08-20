export const CATEGORY_IDS = ['basic', 'dakuten', 'handakuten', 'youon', 'sokuon', 'chouon'];

export const CATEGORIES = {
  basic: { id: 'basic', label: '基础五十音', shortLabel: '五十音', type: 'kana' },
  dakuten: { id: 'dakuten', label: '浊音', shortLabel: '浊音', type: 'kana' },
  handakuten: { id: 'handakuten', label: '半浊音', shortLabel: '半浊音', type: 'kana' },
  youon: { id: 'youon', label: '拗音', shortLabel: '拗音', type: 'kana' },
  sokuon: { id: 'sokuon', label: '促音', shortLabel: '促音', type: 'rule' },
  chouon: { id: 'chouon', label: '长音', shortLabel: '长音', type: 'rule' },
};

const basicRows = [
  ['あ行', [['a','あ','ア'], ['i','い','イ'], ['u','う','ウ'], ['e','え','エ'], ['o','お','オ']]],
  ['か行', [['ka','か','カ'], ['ki','き','キ'], ['ku','く','ク'], ['ke','け','ケ'], ['ko','こ','コ']]],
  ['さ行', [['sa','さ','サ'], ['shi','し','シ'], ['su','す','ス'], ['se','せ','セ'], ['so','そ','ソ']]],
  ['た行', [['ta','た','タ'], ['chi','ち','チ'], ['tsu','つ','ツ'], ['te','て','テ'], ['to','と','ト']]],
  ['な行', [['na','な','ナ'], ['ni','に','ニ'], ['nu','ぬ','ヌ'], ['ne','ね','ネ'], ['no','の','ノ']]],
  ['は行', [['ha','は','ハ'], ['hi','ひ','ヒ'], ['fu','ふ','フ'], ['he','へ','ヘ'], ['ho','ほ','ホ']]],
  ['ま行', [['ma','ま','マ'], ['mi','み','ミ'], ['mu','む','ム'], ['me','め','メ'], ['mo','も','モ']]],
  ['や行', [['ya','や','ヤ'], ['yu','ゆ','ユ'], ['yo','よ','ヨ']]],
  ['ら行', [['ra','ら','ラ'], ['ri','り','リ'], ['ru','る','ル'], ['re','れ','レ'], ['ro','ろ','ロ']]],
  ['わ行', [['wa','わ','ワ'], ['wo','を','ヲ'], ['n','ん','ン']]],
];

export const BASIC_KANA = basicRows.flatMap(([group, entries]) => entries.map((entry) => [group, ...entry])).map(([group, romaji, hiragana, katakana], position) => ({
  id: romaji, index: position + 1, category: 'basic', group, romaji, hiragana, katakana, aliases: [], audioKey: romaji,
}));

const kanaItems = (category, rows) => rows.flatMap(([group, entries]) => entries.map(([key, hiragana, katakana, romaji = key, aliases = []]) => ({
  id: `${category}-${key}`, category, group, hiragana, katakana, romaji, aliases,
})));

export const DAKUTEN = kanaItems('dakuten', [
  ['が行', [['ga','が','ガ'], ['gi','ぎ','ギ'], ['gu','ぐ','グ'], ['ge','げ','ゲ'], ['go','ご','ゴ']]],
  ['ざ行', [['za','ざ','ザ'], ['ji','じ','ジ'], ['zu','ず','ズ'], ['ze','ぜ','ゼ'], ['zo','ぞ','ゾ']]],
  ['だ行', [['da','だ','ダ'], ['di','ぢ','ヂ','ji',['di']], ['du','づ','ヅ','zu',['du']], ['de','で','デ'], ['do','ど','ド']]],
  ['ば行', [['ba','ば','バ'], ['bi','び','ビ'], ['bu','ぶ','ブ'], ['be','べ','ベ'], ['bo','ぼ','ボ']]],
]);

export const HANDAKUTEN = kanaItems('handakuten', [
  ['ぱ行', [['pa','ぱ','パ'], ['pi','ぴ','ピ'], ['pu','ぷ','プ'], ['pe','ぺ','ペ'], ['po','ぽ','ポ']]],
]);

export const YOUON = kanaItems('youon', [
  ['k 系', [['kya','きゃ','キャ'], ['kyu','きゅ','キュ'], ['kyo','きょ','キョ']]],
  ['sh 系', [['sha','しゃ','シャ'], ['shu','しゅ','シュ'], ['sho','しょ','ショ']]],
  ['ch 系', [['cha','ちゃ','チャ'], ['chu','ちゅ','チュ'], ['cho','ちょ','チョ']]],
  ['n 系', [['nya','にゃ','ニャ'], ['nyu','にゅ','ニュ'], ['nyo','にょ','ニョ']]],
  ['h 系', [['hya','ひゃ','ヒャ'], ['hyu','ひゅ','ヒュ'], ['hyo','ひょ','ヒョ']]],
  ['m 系', [['mya','みゃ','ミャ'], ['myu','みゅ','ミュ'], ['myo','みょ','ミョ']]],
  ['r 系', [['rya','りゃ','リャ'], ['ryu','りゅ','リュ'], ['ryo','りょ','リョ']]],
  ['g 系', [['gya','ぎゃ','ギャ'], ['gyu','ぎゅ','ギュ'], ['gyo','ぎょ','ギョ']]],
  ['j 系', [['ja','じゃ','ジャ'], ['ju','じゅ','ジュ'], ['jo','じょ','ジョ']]],
  ['b 系', [['bya','びゃ','ビャ'], ['byu','びゅ','ビュ'], ['byo','びょ','ビョ']]],
  ['p 系', [['pya','ぴゃ','ピャ'], ['pyu','ぴゅ','ピュ'], ['pyo','ぴょ','ピョ']]],
]);

const ruleItem = (id, category, kana, romaji, focus, explanation, standardRomaji = null) => ({
  id: `${category}-${id}`, category, group: CATEGORIES[category].label, kana, romaji, focus, explanation, standardRomaji,
});

const sokuonExplanation = '小「っ / ッ」表示短暂停顿，并让后面的辅音重复。';
export const SOKUON = [
  ['kitte','きって','kitte','っ'], ['gakkou','がっこう','gakkou','っ'], ['kippu','きっぷ','kippu','っ'],
  ['zasshi','ざっし','zasshi','っ'], ['chotto','ちょっと','chotto','っ'], ['matte','まって','matte','っ'],
  ['kekkon','けっこん','kekkon','っ'], ['issho','いっしょ','issho','っ'], ['beddo','ベッド','beddo','ッ'],
  ['sakkaa','サッカー','sakkaa','ッ'], ['baggu','バッグ','baggu','ッ'], ['chiketto','チケット','chiketto','ッ'],
].map(([id, kana, romaji, focus]) => ruleItem(id, 'sokuon', kana, romaji, focus, sokuonExplanation));

const chouonExplanation = '长音让前一个音延长；片假名常用「ー」表示。';
export const CHOUON = [
  ['okaasan','おかあさん','okaasan','あ'], ['oneesan','おねえさん','oneesan','え'],
  ['koukou','こうこう','koukou','う'], ['sensei','せんせい','sensei','い'],
  ['koohii','コーヒー','koohii','ー','kōhī'], ['suupaa','スーパー','suupaa','ー','sūpā'],
  ['keeki','ケーキ','keeki','ー','kēki'], ['nooto','ノート','nooto','ー','nōto'],
  ['takushii','タクシー','takushii','ー'], ['juusu','ジュース','juusu','ー','jūsu'],
  ['meeru','メール','meeru','ー','mēru'], ['geemu','ゲーム','geemu','ー','gēmu'],
].map(([id, kana, romaji, focus, standard]) => ruleItem(id, 'chouon', kana, romaji, focus, chouonExplanation, standard));

export const STUDY_ITEMS = [...BASIC_KANA, ...DAKUTEN, ...HANDAKUTEN, ...YOUON, ...SOKUON, ...CHOUON];
export const KANA = BASIC_KANA;
export const itemById = (id) => STUDY_ITEMS.find((item) => item.id === id);
export const itemsByCategory = (category) => STUDY_ITEMS.filter((item) => item.category === category);

export const CONFUSING_PAIRS = [
  ['shi', 'tsu'], ['so', 'n'], ['nu', 'me'], ['re', 'wa'], ['ne', 're'], ['sa', 'ki'],
];
