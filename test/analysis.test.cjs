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

test('dot access accepts the compiler module example without hiding other invalid characters', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const example = path.join(__dirname, '../../chuchu-core/examples/modules/main.chuchu');
  const source = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') :
    'use module math\nshow math.add(2, 3)\nassign origin as math.Point {\n x: 0\n y: 0\n}\nshow origin.x';
  assert.deepEqual(analyze(source).issues, []);
  assert(analyze(source + '\nshow @').issues.some(i => i.message.includes('Unsupported character')));
  assert.deepEqual(analyze('show 1.25\nshow 2e-3\nshow p.x').issues, []);
});
test('records resolve nested fields, copies, parameters, function results and initializer labels', () => {
  const source = `record Address { city: string }
record Person {
 name: string
 address: Address
}
function make(p: Person) be Person { return p }
assign city as "local"
assign p as Person {
 name: "Ali"
 address: Address { city: "Lahore" }
}
assign copy as p
reassign copy.address.city as "Karachi"
show make(p).name
show p.name
show city`;
  const model = analyze(source);
  const person = model.symbols.find(s => s.name === 'Person');
  const address = model.symbols.find(s => s.name === 'Address');
  assert.equal(resolve(model, at(model, 'city as "Karachi"')), address.fields[0]);
  assert.equal(resolve(model, at(model, 'city: "Lahore"')), address.fields[0]);
  assert.equal(resolve(model, at(model, 'name\nshow')), person.fields[0]);
  assert.equal(resolve(model, at(model, 'name', source.lastIndexOf('show p.'))), person.fields[0]);
  assert.equal(references(model, model.symbols.find(s => s.name === 'city')).length, 2);
  assert.deepEqual(require('../dist/analysis').memberCompletions(model, source.indexOf('name\nshow')), person.fields);
  assert.equal(resolve(model, at(model, 'Person)', source.indexOf('function'))), person);
});
test('member completions use the receiver type and respect local shadowing', () => {
  const source = `record Point { x: int }
record Label { text: string }
assign p as Point { x: 1 }
if true {
 assign p as Label { text: "hi" }
 show p.text
}
show p.x`;
  const model = analyze(source), { memberCompletions } = require('../dist/analysis');
  assert.deepEqual(memberCompletions(model, source.indexOf('text\n}')).map(s => s.name), ['text']);
  assert.deepEqual(memberCompletions(model, source.lastIndexOf('x')).map(s => s.name), ['x']);
  assert.equal(memberCompletions(model, source.indexOf('record')), undefined);
});
test('imports expose public members, qualified types, function signatures and nested record fields', () => {
  const { memberCompletions } = require('../dist/analysis');
  const math = analyze(`module math
export record Point { x: int }
export function add(a: int, b: int) be int { return a + b }
function secret() be int { return 0 }
record Private { hidden: int }`);
  const geometry = analyze(`module geometry
use module math
export function translate(p: math.Point, dx: int) be math.Point { return p }`);
  geometry.dependencies.set('math', math);
  const source = `use module geometry.math
use module geometry
assign origin as math.Point { x: 0 }
assign moved as geometry.translate(origin, 3)
show moved.x
show math.add(2, 3)
show math.secret()
show math.Private { hidden: 1 }`;
  const model = analyze(source);
  model.dependencies.set('math', math); model.dependencies.set('geometry', geometry);
  assert.equal(model.symbols.find(s => s.name === 'math').modulePath, 'geometry/math.chuchu');
  assert.deepEqual(memberCompletions(model, source.indexOf('Point {')).map(s => s.name), ['Point', 'add']);
  assert.equal(resolve(model, at(model, 'x\nshow')), math.symbols[0].fields[0]);
  assert.equal(resolve(model, at(model, 'secret()')), undefined);
  assert.equal(resolve(model, at(model, 'Private {')), undefined);
  assert.equal(callAt(model, source.indexOf('3)')).callable.name, 'translate');
  assert.equal(callAt(model, source.indexOf('3)')).argument, 1);
  assert.equal(resolve(model, at(model, 'Point {')).owner, math);
});
test('qualified calls never borrow built-in or unrelated local signatures', () => {
  const source = 'function add(x: int) be int { return x }\nshow missing.add(1\nshow missing.sqrt(9.0';
  const model = analyze(source);
  assert.equal(callAt(model, source.indexOf('1\n')), undefined);
  assert.equal(callAt(model, source.length), undefined);
  assert.equal(resolve(model, at(model, 'add(1')), undefined);
});
test('current built-in catalog includes length and file I/O signatures', () => {
  const { builtins, keywords } = require('../dist/catalog');
  assert(!builtins.some(b => b.name === 'len'));
  for (const name of ['length', 'read_file', 'try_read_file', 'write_file', 'try_write_file']) {
    const source = `assign value as ${name}(`;
    assert.equal(callAt(analyze(source), source.length).callable.name, name);
  }
  for (const keyword of ['declare', 'record', 'module', 'use', 'export']) { assert(keywords.includes(keyword)); }
});
test('declare introduces a variable for later statements', () => {
  const model = analyze('declare total\nreassign total as 1\nshow total');
  assert(model.symbols.some(s => s.name === 'total' && s.kind === 'variable'));
});
