import { builtins, Callable, keywords } from './catalog';
export interface Span { start: number; end: number }
export interface Token extends Span { text: string; kind: 'word' | 'number' | 'string' | 'comment' | 'newline' | 'punctuation'; closed?: boolean }
export interface Issue extends Span { message: string }
export interface Scope extends Span { parent?: Scope; functionBoundary?: boolean; closed?: boolean }
export interface SymbolInfo extends Span {
  name: string; kind: 'function' | 'variable' | 'parameter'; type: string;
  selection: Span; scope: Scope; visibleFrom: number; callable?: Callable;
}
export interface Analysis { source: string; tokens: Token[]; code: Token[]; issues: Issue[]; scopes: Scope[]; symbols: SymbolInfo[]; pairs: Map<number, number>; annotations: Span[] }

export function lex(source: string): { tokens: Token[]; issues: Issue[] } {
  const tokens: Token[] = [], issues: Issue[] = [];
  let i = 0;
  const add = (start: number, kind: Token['kind']) => tokens.push({ start, end: i, text: source.slice(start, i), kind });
  while (i < source.length) {
    const start = i, c = source[i];
    if (c === '\r' || c === '\n') { i += source.slice(i, i + 2) === '\r\n' ? 2 : 1; add(start, 'newline'); }
    else if (/\s/.test(c)) { i++; }
    else if (source.startsWith('//', i)) {
      while (i < source.length && !/[\r\n]/.test(source[i])) { i++; }
      add(start, 'comment');
    } else if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      i = close < 0 ? source.length : close + 2;
      add(start, 'comment');
      if (close < 0) { issues.push({ start, end: i, message: 'Unterminated block comment. Add */.' }); }
    } else if (c === '"') {
      i++;
      let closed = false;
      while (i < source.length && !/[\r\n]/.test(source[i])) {
        if (source[i] === '"') { i++; closed = true; break; }
        if (source[i] === '\\') {
          const escape = i++;
          if (i >= source.length || /[\r\n]/.test(source[i])) { break; }
          if (!'nrt\\"'.includes(source[i])) {
            issues.push({ start: escape, end: i + 1, message: 'Invalid string escape. Use \\n, \\r, \\t, \\\\, or \\".' });
          }
        } else if (source[i] === '\0') {
          issues.push({ start: i, end: i + 1, message: 'NUL characters are not supported in strings.' });
        }
        i++;
      }
      add(start, 'string');
      tokens[tokens.length - 1].closed = closed;
      if (!closed) { issues.push({ start, end: i, message: 'Unterminated string. Add a closing double quote.' }); }
    } else if (/[a-zA-Z_]/.test(c)) {
      i++;
      while (i < source.length && /[a-zA-Z_0-9]/.test(source[i])) { i++; }
      add(start, 'word');
    } else if (/[0-9]/.test(c)) {
      i += /^\d+(?:\.\d*)?(?:[eE][+-]?\d*)?/.exec(source.slice(i))![0].length;
      add(start, 'number');
      if (!Number.isFinite(Number(source.slice(start, i)))) {
        issues.push({ start, end: i, message: 'Invalid or non-finite numeric literal.' });
      }
    } else {
      i += /^(==|!=|<=|>=)/.test(source.slice(i)) ? 2 : 1;
      add(start, 'punctuation');
      if (!/^(==|!=|<=|>=|[+*/=<>\-{}[\](),:])$/.test(source.slice(start, i))) {
        issues.push({ start, end: i, message: `Unsupported character ${JSON.stringify(c)}.` });
      }
    }
  }
  return { tokens, issues };
}

export function analyze(source: string): Analysis {
  const { tokens, issues } = lex(source);
  // Newlines in block comments also separate statements in the compiler.
  const code = tokens.flatMap(t => t.kind !== 'comment' ? [t] : /[\r\n]/.test(t.text) ? [{ ...t, kind: 'newline' as const }] : []);
  const root: Scope = { start: 0, end: source.length };
  const scopes = [root], scopeStack = [root], delimiters: number[] = [], pairs = new Map<number, number>();
  const braceScopes = new Map<number, Scope>();
  const closing: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  code.forEach((t, i) => {
    if (t.kind !== 'punctuation') { return; }
    if ('([{'.includes(t.text)) {
      delimiters.push(i);
      if (t.text === '{') {
        const scope: Scope = { start: t.start, end: source.length, parent: scopeStack.at(-1) };
        scopes.push(scope); scopeStack.push(scope); braceScopes.set(i, scope);
      }
    } else if (closing[t.text]) {
      const open = delimiters.at(-1);
      if (open === undefined || code[open].text !== closing[t.text]) {
        issues.push({ ...t, message: `Unmatched ${t.text}.` });
      } else {
        delimiters.pop(); pairs.set(open, i); pairs.set(i, open);
        if (t.text === '}') { const scope = scopeStack.pop()!; scope.end = t.end; scope.closed = true; }
      }
    }
  });
  for (const i of delimiters) { issues.push({ ...code[i], message: `Unclosed ${code[i].text}.` }); }
  const model: Analysis = { source, tokens, code, issues, scopes, symbols: [], pairs, annotations: [] };
  const compact = (a: number, b: number) => code.slice(a, b).filter(t => t.kind !== 'newline').map(t => t.text).join('');
  const next = (i: number) => { while (code[i]?.kind === 'newline') { i++; } return i; };
  for (let i = 0; i < code.length; i++) {
    if (code[i].text !== 'function' || code[i + 1]?.kind !== 'word' || code[i + 2]?.text !== '(') { continue; }
    const endParams = pairs.get(i + 2);
    if (endParams === undefined) { continue; }
    const be = next(endParams + 1);
    if (code[be]?.text !== 'be') { continue; }
    let body = be + 1;
    while (body < code.length && code[body].text !== '{' && code[body].kind !== 'newline') { body++; }
    const scope = braceScopes.get(body);
    if (!scope || scope.parent !== root) { continue; }
    scope.functionBoundary = true;
    const name = code[i + 1], parameters: string[] = [];
    let p = next(i + 3);
    while (p < endParams) {
      let end = p;
      while (end < endParams && code[end].text !== ',') { end++; }
      if (code[p]?.kind === 'word' && code[p + 1]?.text === ':') {
        const type = compact(p + 2, end);
        model.annotations.push({ start: code[p + 1].end, end: code[end - 1].end });
        parameters.push(`${code[p].text}: ${type}`);
        model.symbols.push({ ...code[p], name: code[p].text, kind: 'parameter', type, selection: code[p], scope, visibleFrom: scope.start });
      }
      p = next(end + 1);
    }
    const type = compact(be + 1, body);
    model.annotations.push({ start: code[be].end, end: code[body].start });
    model.symbols.push({ name: name.text, kind: 'function', type, start: code[i].start, end: scope.end,
      selection: name, scope: root, visibleFrom: 0,
      callable: { name: name.text, parameters, result: type, description: 'User-defined Chuchu function.' } });
  }
  for (let i = 0; i < code.length; i++) {
    if (code[i].text !== 'assign' || code[i + 1]?.kind !== 'word' || code[i + 2]?.text !== 'as') { continue; }
    const name = code[i + 1];
    let end = i + 3;
    while (end < code.length && code[end].kind !== 'newline' && code[end].text !== '}') {
      const paired = pairs.get(end);
      end = paired !== undefined && paired > end ? paired + 1 : end + 1;
    }
    const visibleFrom = code[end]?.start ?? source.length;
    model.symbols.push({ name: name.text, kind: 'variable', type: 'inferred', selection: name,
      scope: scopeAt(model, name.start), start: code[i].start, end: visibleFrom, visibleFrom });
  }
  return model;
}
export function scopeAt(model: Analysis, offset: number): Scope {
  return model.scopes.findLast(s => s.start <= offset && (offset < s.end || (offset === s.end && !s.closed))) ?? model.scopes[0];
}
export function tokenAt(model: Analysis, offset: number): Token | undefined {
  return model.tokens.find(t => t.start <= offset && offset < t.end);
}
export function isText(model: Analysis, offset: number): boolean {
  return model.tokens.some(t => (t.kind === 'comment' || t.kind === 'string') && t.start < offset &&
    (offset < t.end || (offset === t.end && (t.kind === 'comment' ? t.text.startsWith('//') || !t.text.endsWith('*/') : !t.closed))));
}
function available(model: Analysis, offset: number): SymbolInfo[] {
  const result = model.symbols.filter(s => s.kind === 'function');
  let scope: Scope | undefined = scopeAt(model, offset);
  const seen = new Set<string>();
  while (scope) {
    for (const symbol of model.symbols.filter(s => s.kind !== 'function' && s.scope === scope && s.visibleFrom <= offset).reverse()) {
      if (!seen.has(symbol.name)) { result.push(symbol); seen.add(symbol.name); }
    }
    if (scope.functionBoundary) { break; }
    scope = scope.parent;
  }
  return result;
}
export function visibleSymbols(model: Analysis, offset: number): SymbolInfo[] { return available(model, offset); }
export function resolve(model: Analysis, token: Token): SymbolInfo | undefined {
  if (model.annotations.some(s => s.start <= token.start && token.end <= s.end)) { return undefined; }
  const declaration = model.symbols.find(s => s.selection.start === token.start);
  if (declaration) { return declaration; }
  if (token.kind !== 'word' || keywords.includes(token.text)) { return undefined; }
  const index = model.code.findIndex(t => t.start === token.start);
  // Type annotations and function call names belong to a different namespace.
  if (model.code[index - 1]?.text === ':' || model.code[index - 1]?.text === 'be') { return undefined; }
  if (model.code[index - 1]?.text === '<' && model.code[index - 2]?.text === 'err') { return undefined; }
  const call = model.code[index + 1]?.text === '(';
  return available(model, token.start).find(s => s.name === token.text && (s.kind === 'function') === call);
}
export function references(model: Analysis, symbol: SymbolInfo): Token[] {
  return model.tokens.filter(t => t.kind === 'word' && t.text === symbol.name && resolve(model, t) === symbol);
}
export function callAt(model: Analysis, offset: number): { callable: Callable; argument: number } | undefined {
  if (isText(model, offset)) { return undefined; }
  const stack: { text: string; name?: string; argument: number }[] = [];
  const code = model.code.filter(t => t.start < offset && t.kind !== 'newline');
  for (let i = 0; i < code.length; i++) {
    const t = code[i];
    if (['(', '[', '{'].includes(t.text) && t.kind === 'punctuation') {
      let name = code[i - 1]?.kind === 'word' ? code[i - 1].text : undefined;
      if (code[i - 1]?.text === '>' && code[i - 3]?.text === '<' && code[i - 4]?.text === 'err') { name = 'err'; }
      if (code[i - 2]?.text === 'function') { name = undefined; }
      stack.push({ text: t.text, name: t.text === '(' ? name : undefined, argument: 0 });
    } else if ([')', ']', '}'].includes(t.text) && t.kind === 'punctuation') { stack.pop(); }
    else if (t.text === ',' && t.kind === 'punctuation') { const top = stack.at(-1); if (top) { top.argument++; } }
  }
  const call = [...stack].reverse().find(c => c.name);
  if (!call?.name) { return undefined; }
  const callable = builtins.find(b => b.name === call.name) ?? model.symbols.find(s => s.kind === 'function' && s.name === call.name)?.callable;
  return callable ? { callable, argument: call.argument } : undefined;
}
