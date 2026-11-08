import { builtins, Callable, keywords } from './catalog';
export interface Span { start: number; end: number }
export interface Token extends Span { text: string; kind: 'word' | 'number' | 'string' | 'comment' | 'newline' | 'punctuation'; closed?: boolean }
export interface Issue extends Span { message: string }
export interface Scope extends Span { parent?: Scope; functionBoundary?: boolean; closed?: boolean }
export interface SymbolInfo extends Span {
  name: string; kind: 'function' | 'variable' | 'parameter' | 'record' | 'field' | 'module'; type: string;
  selection: Span; scope: Scope; visibleFrom: number; callable?: Callable; fields?: SymbolInfo[]; exported?: boolean;
  modulePath?: string; initializer?: number; owner?: Analysis;
}
export interface Analysis { source: string; tokens: Token[]; code: Token[]; issues: Issue[]; scopes: Scope[]; symbols: SymbolInfo[]; pairs: Map<number, number>; annotations: Span[]; uri?: string; dependencies: Map<string, Analysis> }

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
      if (!/^(==|!=|<=|>=|[+*/=<>\-{}[\](),:.])$/.test(source.slice(start, i))) {
        issues.push({ start, end: i, message: `Unsupported character ${JSON.stringify(c)}.` });
      }
    }
  }
  return { tokens, issues };
}

export function analyze(source: string, uri?: string): Analysis {
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
  const model: Analysis = { source, tokens, code, issues, scopes, symbols: [], pairs, annotations: [], uri, dependencies: new Map() };
  const compact = (a: number, b: number) => code.slice(a, b).filter(t => t.kind !== 'newline').map(t => t.text).join('');
  const next = (i: number) => { while (code[i]?.kind === 'newline') { i++; } return i; };
  for (let i = 0; i < code.length; i++) {
    if (code[i].text === 'use' && code[i + 1]?.text === 'module') {
      let end = i + 2;
      while (code[end]?.kind === 'word' || code[end]?.text === '.') { end++; }
      const parts = code.slice(i + 2, end).filter(t => t.kind === 'word');
      const name = parts.at(-1);
      if (name) { model.symbols.push({ name: name.text, kind: 'module', type: 'module', selection: name,
        start: code[i].start, end: code[end - 1].end, scope: root, visibleFrom: 0, modulePath: parts.map(t => t.text).join('/') + '.chuchu' }); }
    }
    if (code[i].text !== 'record' || code[i + 1]?.kind !== 'word' || code[i + 2]?.text !== '{') { continue; }
    const scope = braceScopes.get(i + 2);
    if (!scope || scope.parent !== root) { continue; }
    const close = pairs.get(i + 2) ?? code.length;
    const fields: SymbolInfo[] = [];
    for (let f = next(i + 3); f < close; f = next(f + 1)) {
      if (code[f]?.kind !== 'word' || code[f + 1]?.text !== ':') { continue; }
      let end = f + 2;
      while (end < close && code[end].kind !== 'newline') { end++; }
      const type = compact(f + 2, end);
      if (end > f + 2) { model.annotations.push({ start: code[f + 1].end, end: code[end - 1].end }); }
      fields.push({ name: code[f].text, kind: 'field', type, selection: code[f], start: code[f].start,
        end: code[end - 1].end, scope, visibleFrom: 0 });
      f = end - 1;
    }
    model.symbols.push({ name: code[i + 1].text, kind: 'record', type: code[i + 1].text, fields,
      selection: code[i + 1], start: code[i].start, end: scope.end, scope: root, visibleFrom: 0, exported: code[i - 1]?.text === 'export' });
  }
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
      exported: code[i - 1]?.text === 'export', callable: { name: name.text, parameters, result: type, description: 'User-defined Chuchu function.' } });
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
      initializer: i + 3, scope: scopeAt(model, name.start), start: code[i].start, end: visibleFrom, visibleFrom });
  }
  for (let i = 0; i < code.length; i++) {
    if (code[i].text !== 'declare' || code[i + 1]?.kind !== 'word') { continue; }
    const name = code[i + 1];
    let end = i + 2;
    while (end < code.length && code[end].kind !== 'newline' && code[end].text !== '}') { end++; }
    const visibleFrom = code[end]?.start ?? source.length;
    // No initializer: the type comes from the first `reassign`, which the editor does not infer.
    model.symbols.push({ name: name.text, kind: 'variable', type: 'inferred', selection: name,
      scope: scopeAt(model, name.start), start: code[i].start, end: visibleFrom, visibleFrom });
  }
  for (const symbol of model.symbols) {
    symbol.owner = model;
    for (const field of symbol.fields ?? []) { field.owner = model; }
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
  const result = model.symbols.filter(s => ['function', 'record', 'module'].includes(s.kind));
  let scope: Scope | undefined = scopeAt(model, offset);
  const seen = new Set<string>();
  while (scope) {
    for (const symbol of model.symbols.filter(s => (s.kind === 'variable' || s.kind === 'parameter') && s.scope === scope && s.visibleFrom <= offset).reverse()) {
      if (!seen.has(symbol.name)) { result.push(symbol); seen.add(symbol.name); }
    }
    if (scope.functionBoundary) { break; }
    scope = scope.parent;
  }
  return result;
}
export function visibleSymbols(model: Analysis, offset: number): SymbolInfo[] { return available(model, offset); }
interface TypeRef { record: SymbolInfo }
function recordType(model: Analysis, name: string): TypeRef | undefined {
  const parts = name.split('.');
  const owner = parts.length === 2 ? model.dependencies.get(parts[0]) : model;
  const record = owner?.symbols.find(s => s.kind === 'record' && s.name === parts.at(-1) && (owner === model || s.exported));
  return record ? { record } : undefined;
}
function typeOf(symbol: SymbolInfo, seen = new Set<SymbolInfo>()): TypeRef | undefined {
  if (seen.has(symbol)) { return undefined; }
  seen.add(symbol);
  const owner = symbol.owner!;
  if (symbol.kind === 'record') { return { record: symbol }; }
  if (symbol.type !== 'inferred') { return recordType(owner, symbol.type); }
  if (symbol.initializer === undefined) { return undefined; }
  let end = symbol.initializer;
  // Follow a simple value/call/initializer chain, without evaluating expressions.
  if (owner.code[end]?.text === '(') { end = owner.pairs.get(end) ?? end; }
  while (true) {
    const next = owner.code[end + 1];
    if (next?.text === '.' && owner.code[end + 2]?.kind === 'word') { end += 2; continue; }
    if (next?.text === '(' || next?.text === '{') {
      const close = owner.pairs.get(end + 1);
      if (close !== undefined) { end = close; continue; }
    }
    break;
  }
  const value = expressionSymbol(owner, end, seen);
  return value ? typeOf(value, seen) : undefined;
}
function members(symbol: SymbolInfo, seen = new Set<SymbolInfo>()): SymbolInfo[] {
  if (symbol.kind === 'module') {
    return symbol.owner?.dependencies.get(symbol.name)?.symbols.filter(s => s.exported) ?? [];
  }
  return typeOf(symbol, seen)?.record.fields ?? [];
}
function expressionSymbol(model: Analysis, index: number, seen = new Set<SymbolInfo>()): SymbolInfo | undefined {
  const token = model.code[index];
  if (!token) { return undefined; }
  if (token.text === ')' || token.text === '}') {
    const open = model.pairs.get(index);
    if (open === undefined) { return undefined; }
    if (token.text === ')' && (model.code[open - 1]?.kind !== 'word')) {
      return expressionSymbol(model, index - 1, seen);
    }
    return expressionSymbol(model, open - 1, seen);
  }
  if (token.kind !== 'word') { return undefined; }
  if (model.code[index - 1]?.text === '.') {
    const receiver = expressionSymbol(model, index - 2, seen);
    return receiver ? members(receiver, seen).find(s => s.name === token.text) : undefined;
  }
  const call = model.code[index + 1]?.text === '(';
  const type = model.code[index + 1]?.text === '{';
  return available(model, token.start).find(s => s.name === token.text &&
    (call ? s.kind === 'function' : type ? s.kind === 'record' : s.kind !== 'function'));
}
export function memberCompletions(model: Analysis, offset: number): SymbolInfo[] | undefined {
  const index = model.code.findLastIndex(t => t.start < offset && t.kind !== 'newline');
  let dot = index;
  if (model.code[index]?.kind === 'word') { dot--; }
  if (model.code[dot]?.text !== '.') { return undefined; }
  const receiver = expressionSymbol(model, dot - 1);
  return receiver ? members(receiver) : [];
}
export function resolve(model: Analysis, token: Token): SymbolInfo | undefined {
  const declaration = model.symbols.flatMap(s => [s, ...(s.fields ?? [])]).find(s => s.selection.start === token.start);
  if (declaration) { return declaration; }
  if (token.kind !== 'word' || keywords.includes(token.text)) { return undefined; }
  const index = model.code.findIndex(t => t.start === token.start);
  if (model.annotations.some(s => s.start <= token.start && token.end <= s.end)) {
    if (model.code[index - 1]?.text === '.') { return expressionSymbol(model, index); }
    return model.symbols.find(s => s.kind === 'record' && s.name === token.text) ??
      model.symbols.find(s => s.kind === 'module' && s.name === token.text);
  }
  // Record initializer labels are fields, never same-named local variables.
  if (model.code[index + 1]?.text === ':') {
    const open = [...model.pairs].filter(([a, b]) => a < b && a < index && index < b && model.code[a].text === '{')
      .sort(([a], [b]) => b - a)[0]?.[0];
    const record = open === undefined ? undefined : expressionSymbol(model, open - 1);
    return record?.kind === 'record' ? record.fields?.find(s => s.name === token.text) : undefined;
  }
  if (model.code[index - 1]?.text === '<' && model.code[index - 2]?.text === 'err') { return undefined; }
  return expressionSymbol(model, index);
}
export function references(model: Analysis, symbol: SymbolInfo): Token[] {
  return model.tokens.filter(t => t.kind === 'word' && t.text === symbol.name && resolve(model, t) === symbol);
}
export function callAt(model: Analysis, offset: number): { callable: Callable; argument: number } | undefined {
  if (isText(model, offset)) { return undefined; }
  const stack: { text: string; name?: string; symbol?: SymbolInfo; qualified?: boolean; argument: number }[] = [];
  const code = model.code.filter(t => t.start < offset && t.kind !== 'newline');
  for (let i = 0; i < code.length; i++) {
    const t = code[i];
    if (['(', '[', '{'].includes(t.text) && t.kind === 'punctuation') {
      let name = code[i - 1]?.kind === 'word' ? code[i - 1].text : undefined;
      if (code[i - 1]?.text === '>' && code[i - 3]?.text === '<' && code[i - 4]?.text === 'err') { name = 'err'; }
      if (code[i - 2]?.text === 'function') { name = undefined; }
      const qualified = code[i - 2]?.text === '.';
      const token = code[i - 1];
      const symbol = token ? resolve(model, token) : undefined;
      stack.push({ text: t.text, name: t.text === '(' ? name : undefined, symbol, qualified, argument: 0 });
    } else if ([')', ']', '}'].includes(t.text) && t.kind === 'punctuation') { stack.pop(); }
    else if (t.text === ',' && t.kind === 'punctuation') { const top = stack.at(-1); if (top) { top.argument++; } }
  }
  const call = [...stack].reverse().find(c => c.name);
  if (!call?.name) { return undefined; }
  const callable = call.symbol?.callable ?? (!call.qualified ? builtins.find(b => b.name === call.name) : undefined);
  return callable ? { callable, argument: call.argument } : undefined;
}
