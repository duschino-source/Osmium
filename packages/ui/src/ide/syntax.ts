/**
 * Small, dependency-free syntax highlighter for the editor overlay.
 * It is deliberately forgiving: unterminated strings and comments still
 * color while the user is typing, and unknown languages render as plain text.
 */

export type TokenClass =
  'keyword' | 'string' | 'number' | 'comment' | 'type' | 'func' | 'attr' | 'property' | 'heading';

export interface Token {
  text: string;
  cls?: TokenClass;
}

export type Lang =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'css'
  | 'rust'
  | 'toml'
  | 'markdown'
  | 'yaml'
  | 'shell'
  | 'html'
  | 'plain';

const EXT_TO_LANG: Record<string, Lang> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  rs: 'rust',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'shell',
  cmd: 'shell',
  html: 'html',
  htm: 'html',
};

const LANG_LABELS: Record<Lang, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  json: 'JSON',
  css: 'CSS',
  rust: 'Rust',
  toml: 'TOML',
  markdown: 'Markdown',
  yaml: 'YAML',
  shell: 'Shell',
  html: 'HTML',
  plain: 'Plain Text',
};

export function languageFromPath(filePath: string): Lang {
  const name = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  if (name === 'Cargo.lock' || name === '.gitignore') return 'plain';
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  return EXT_TO_LANG[ext] ?? 'plain';
}

export function languageLabel(filePath: string): string {
  const lang = languageFromPath(filePath);
  const ext = (filePath.split('.').pop() ?? '').toLowerCase();
  if (lang === 'typescript' && ext === 'tsx') return 'TypeScript JSX';
  if (lang === 'javascript' && ext === 'jsx') return 'JavaScript JSX';
  return LANG_LABELS[lang];
}

type Rule = {
  re: RegExp;
  cls?: TokenClass;
  classify?: (word: string, rest: string) => TokenClass | undefined;
};

const sticky = (source: string, flags = ''): RegExp => new RegExp(source, `${flags}y`);

const words = (list: string): Set<string> => new Set(list.split(/\s+/).filter(Boolean));

const TS_KEYWORDS =
  words(`import export from default const let var function return if else for while do switch
  case break continue new class extends implements interface type enum async await try catch finally throw
  typeof instanceof in of as void null undefined true false this super static public private protected
  readonly abstract declare namespace module keyof satisfies yield delete get set infer is unknown never
  any string number boolean object symbol bigint`);

const RUST_KEYWORDS =
  words(`as async await break const continue crate dyn else enum extern false fn for if impl in
  let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while
  i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Some None Ok Err`);

const SHELL_KEYWORDS =
  words(`if then else elif fi for while do done case esac function return in echo cd export
  set unset local readonly exit param foreach switch break continue try catch finally`);

const identifierRule = (keywords: Set<string>, typeByCase = true): Rule => ({
  re: sticky('[A-Za-z_$][\\w$]*'),
  classify: (word, rest) => {
    if (keywords.has(word)) return 'keyword';
    if (typeByCase && /^[A-Z]/.test(word)) return 'type';
    if (/^\s*\(/.test(rest)) return 'func';
    return undefined;
  },
});

const COMMON_STRINGS: Rule[] = [
  { re: sticky('"(?:[^"\\\\\\n]|\\\\.)*"?'), cls: 'string' },
  { re: sticky("'(?:[^'\\\\\\n]|\\\\.)*'?"), cls: 'string' },
];

const NUMBER: Rule = {
  re: sticky('\\b(?:0x[\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?)\\b'),
  cls: 'number',
};

const RULES: Record<Exclude<Lang, 'plain'>, Rule[]> = {
  typescript: [
    { re: sticky('//[^\\n]*'), cls: 'comment' },
    { re: sticky('/\\*[\\s\\S]*?(?:\\*/|$)'), cls: 'comment' },
    ...COMMON_STRINGS,
    { re: sticky('`(?:[^`\\\\]|\\\\[\\s\\S])*`?'), cls: 'string' },
    NUMBER,
    identifierRule(TS_KEYWORDS),
  ],
  javascript: [
    { re: sticky('//[^\\n]*'), cls: 'comment' },
    { re: sticky('/\\*[\\s\\S]*?(?:\\*/|$)'), cls: 'comment' },
    ...COMMON_STRINGS,
    { re: sticky('`(?:[^`\\\\]|\\\\[\\s\\S])*`?'), cls: 'string' },
    NUMBER,
    identifierRule(TS_KEYWORDS),
  ],
  json: [
    { re: sticky('"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:)'), cls: 'property' },
    { re: sticky('"(?:[^"\\\\\\n]|\\\\.)*"?'), cls: 'string' },
    { re: sticky('-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'), cls: 'number' },
    { re: sticky('\\b(?:true|false|null)\\b'), cls: 'keyword' },
  ],
  css: [
    { re: sticky('/\\*[\\s\\S]*?(?:\\*/|$)'), cls: 'comment' },
    ...COMMON_STRINGS,
    { re: sticky('@[\\w-]+'), cls: 'keyword' },
    { re: sticky('--?[a-zA-Z][\\w-]*(?=\\s*:)'), cls: 'property' },
    { re: sticky('#[\\da-fA-F]{3,8}\\b'), cls: 'number' },
    { re: sticky('-?\\d*\\.?\\d+(?:px|rem|em|%|ms|s|vh|vw|deg|fr|ch)?\\b'), cls: 'number' },
    { re: sticky('[a-zA-Z-]+(?=\\s*\\()'), cls: 'func' },
  ],
  rust: [
    { re: sticky('//[^\\n]*'), cls: 'comment' },
    { re: sticky('/\\*[\\s\\S]*?(?:\\*/|$)'), cls: 'comment' },
    { re: sticky('#!?\\[[^\\]\\n]*\\]?'), cls: 'attr' },
    ...COMMON_STRINGS.slice(0, 1),
    { re: sticky("'[a-z_]+\\b(?!')"), cls: 'attr' },
    { re: sticky("'(?:[^'\\\\\\n]|\\\\.)'"), cls: 'string' },
    { re: sticky('[A-Za-z_]\\w*!'), cls: 'func' },
    NUMBER,
    identifierRule(RUST_KEYWORDS),
  ],
  toml: [
    { re: sticky('#[^\\n]*'), cls: 'comment' },
    { re: sticky('^\\s*\\[\\[?[^\\]\\n]+\\]\\]?', 'm'), cls: 'type' },
    { re: sticky('^[\\w."-]+(?=\\s*=)', 'm'), cls: 'property' },
    ...COMMON_STRINGS,
    { re: sticky('\\b(?:true|false)\\b'), cls: 'keyword' },
    NUMBER,
  ],
  markdown: [
    { re: sticky('^#{1,6}[^\\n]*', 'm'), cls: 'heading' },
    { re: sticky('```[^\\n]*'), cls: 'comment' },
    { re: sticky('`[^`\\n]+`'), cls: 'string' },
    { re: sticky('\\[[^\\]\\n]*\\]\\([^)\\n]*\\)'), cls: 'func' },
    { re: sticky('^\\s*(?:[-*+]|\\d+\\.)\\s', 'm'), cls: 'attr' },
    { re: sticky('\\*\\*[^*\\n]+\\*\\*'), cls: 'keyword' },
  ],
  yaml: [
    { re: sticky('#[^\\n]*'), cls: 'comment' },
    { re: sticky('^\\s*-?\\s*[\\w."/-]+(?=\\s*:)', 'm'), cls: 'property' },
    ...COMMON_STRINGS,
    { re: sticky('\\b(?:true|false|null|yes|no)\\b'), cls: 'keyword' },
    NUMBER,
  ],
  shell: [
    { re: sticky('#[^\\n]*'), cls: 'comment' },
    ...COMMON_STRINGS,
    { re: sticky('\\$\\{?[\\w:]+\\}?'), cls: 'attr' },
    { re: sticky('--?[a-zA-Z][\\w-]*'), cls: 'property' },
    NUMBER,
    identifierRule(SHELL_KEYWORDS, false),
  ],
  html: [
    { re: sticky('<!--[\\s\\S]*?(?:-->|$)'), cls: 'comment' },
    { re: sticky('</?[A-Za-z][\\w-]*'), cls: 'keyword' },
    { re: sticky('[\\w:-]+(?==)'), cls: 'attr' },
    ...COMMON_STRINGS,
  ],
};

/** Past this size we skip highlighting so typing stays instant. */
export const HIGHLIGHT_LIMIT_CHARS = 200_000;

export function highlight(code: string, lang: Lang): Token[] {
  if (lang === 'plain' || code.length === 0 || code.length > HIGHLIGHT_LIMIT_CHARS) {
    return [{ text: code }];
  }

  const rules = RULES[lang];
  const tokens: Token[] = [];
  let plainStart = 0;
  let i = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) tokens.push({ text: code.slice(plainStart, end) });
  };

  while (i < code.length) {
    let matched = false;
    for (const rule of rules) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(code);
      if (!m || m[0].length === 0) continue;

      let cls = rule.cls;
      if (rule.classify) {
        cls = rule.classify(m[0], code.slice(i + m[0].length, i + m[0].length + 24));
        if (!cls) {
          // An identifier with no color: consume it as plain so it is not re-scanned mid-word.
          i += m[0].length;
          matched = true;
          break;
        }
      }
      flushPlain(i);
      tokens.push({ text: m[0], cls });
      i += m[0].length;
      plainStart = i;
      matched = true;
      break;
    }
    if (!matched) i += 1;
  }
  flushPlain(code.length);
  return tokens;
}
