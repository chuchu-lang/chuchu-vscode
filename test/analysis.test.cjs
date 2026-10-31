const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze, tokenAt, resolve, references, visibleSymbols, callAt, isText } = require('../dist/analysis');
const at = (model, text, from = 0) => tokenAt(model, model.source.indexOf(text, from));

test('strings and non-nesting comments shield keywords and delimiters', () => {
  const model = analyze('assign text as "🌍 // { /*"\n/* function ghost() { */\nshow text // }\n');
  assert.deepEqual(model.issues, []);
  assert.deepEqual(model.symbols.map(s => s.name), ['text']);
  assert.equal(model.scopes.length, 1);
  assert.equal(references(model, model.symbols[0]).length, 2);
});
test('shadow initializers resolve the outer variable and subsequent reads use the inner variable', () => {
  const source = 'assign x as 10\nif true {\n assign x as x + 20\n show x\n}\nshow x';
  const model = analyze(source), [outer, inner] = model.symbols;
  assert.equal(resolve(model, at(model, 'x +')), outer);
  assert.equal(resolve(model, at(model, 'x\n}')), inner);
  assert.equal(resolve(model, at(model, 'x', source.lastIndexOf('show'))), outer);
  assert.equal(references(model, outer).length, 3);
  assert.equal(references(model, inner).length, 2);
});
test('variables are not visible before declarations or in their own initializer', () => {
  const model = analyze('show missing\nassign missing as missing + 1\nshow missing');
  assert.equal(resolve(model, at(model, 'missing')), undefined);
  assert.equal(resolve(model, at(model, 'missing +')), undefined);
  assert.equal(references(model, model.symbols[0]).length, 2);
});
test('functions support forward calls, recursion, typed parameters, and isolated local scope', () => {
  const source = 'assign global as 5\nshow twice(2)\nfunction twice(x: int) be int {\n assign local as x\n show global\n return twice(local)\n}\nshow local';
  const model = analyze(source), fn = model.symbols.find(s => s.name === 'twice');
  assert.equal(references(model, fn).length, 3);
  assert.equal(resolve(model, at(model, 'global', source.indexOf('show global'))), undefined);
  assert.equal(resolve(model, at(model, 'local', source.lastIndexOf('show'))), undefined);
  const names = visibleSymbols(model, source.indexOf('return')).map(s => s.name);
  assert.deepEqual(new Set(names), new Set(['twice', 'x', 'local']));
});
test('separate function and variable namespaces', () => {
  const model = analyze('function value(x: int) be int { return x }\nassign value as 3\nshow value\nshow value(2)');
  const variable = model.symbols.find(s => s.kind === 'variable');
  const fn = model.symbols.find(s => s.kind === 'function');
  assert.equal(references(model, variable).length, 2);
  assert.equal(references(model, fn).length, 2);
});
test('multiline arrays do not end a declaration early', () => {
  const model = analyze('assign values as [\n1,\n2\n]\nshow values');
  assert.equal(references(model, model.symbols[0]).length, 2);
  assert.equal(visibleSymbols(model, model.source.indexOf('2')).length, 0);
});
test('newlines inside comments separate declarations as in the compiler', () => {
  const model = analyze('assign first as 1 /* line\ncomment */ assign second as first\nshow second');
  assert.deepEqual(model.symbols.map(s => s.name), ['first', 'second']);
  assert.equal(references(model, model.symbols[0]).length, 2);
});
test('signature help counts arguments through nested calls, arrays, and strings', () => {
  const source = 'show max(sum([1, 2]), min(3, 4))';
  const model = analyze(source);
  assert.equal(callAt(model, source.indexOf('2')).callable.name, 'sum');
  assert.equal(callAt(model, source.indexOf('2')).argument, 0);
  assert.equal(callAt(model, source.indexOf('min')).argument, 1);
  assert.equal(callAt(model, source.indexOf('4')).callable.name, 'min');
  assert.equal(callAt(model, source.indexOf('4')).argument, 1);
  assert.equal(callAt(analyze('show err<string>(8'), 18).callable.name, 'err');
  assert.equal(callAt(analyze('show input("hello, '), 19), undefined);
});
test('lexical diagnostics use UTF-16 offsets and handle CRLF, invalid escapes and incomplete input', () => {
  const source = 'show "🌍"\r\nshow "bad\\q"\r\nif true {\r\nshow "oops';
  const model = analyze(source);
  assert.equal(model.issues.length, 3);
  assert.equal(model.issues.find(i => i.message.startsWith('Invalid string')).start, source.indexOf('\\q'));
  assert(model.issues.some(i => i.message.startsWith('Unclosed {')));
  assert(model.issues.some(i => i.message.startsWith('Unterminated string')));
});
test('completion context excludes comment and string interiors, including incomplete text', () => {
  for (const source of ['// assign ', '/* assign ', 'show "hello ']) {
    assert.equal(isText(analyze(source), source.length), true);
  }
  assert.equal(isText(analyze('show "hello"'), 12), false);
  assert.equal(isText(analyze('/* done */ '), 11), false);
});
test('delimiter diagnostics ignore strings and comments and report mismatches', () => {
  const model = analyze('show "}"\n// [\nshow (1 + 2]\n/* open');
  assert(model.issues.some(i => i.message === 'Unmatched ].'));
  assert(model.issues.some(i => i.message === 'Unclosed (.'));
  assert(model.issues.some(i => i.message.startsWith('Unterminated block comment')));
});
test('type annotations are not variable references even though type names may be variable names', () => {
  const model = analyze('assign int as 5\nfunction convert(x: result<int>) be result<int> { return x }\nshow err<int>(8)\nshow int');
  const variable = model.symbols.find(s => s.kind === 'variable');
  assert.equal(references(model, variable).length, 2);
});
test('completion stays suppressed after an escaped quote in an incomplete string', () => {
  const source = 'show "oops\\"';
  assert.equal(isText(analyze(source), source.length), true);
});
test('completion at EOF retains the scope of unfinished blocks', () => {
  const source = 'assign global as 1\nfunction local(x: int) be int {\n assign value as x\n';
  const names = visibleSymbols(analyze(source), source.length).map(s => s.name);
  assert.deepEqual(new Set(names), new Set(['local', 'x', 'value']));
  const closed = 'if true { assign inside as 1 }';
  assert.equal(visibleSymbols(analyze(closed), closed.length).length, 0);
});
