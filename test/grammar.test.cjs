const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Registry, INITIAL } = require('vscode-textmate');
const onig = require('vscode-oniguruma');

test('TextMate grammar handles multiline comments, strings, builtins, results and annotations', async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner: p => new onig.OnigScanner(p), createOnigString: s => new onig.OnigString(s) }),
    loadGrammar: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '../syntaxes/chuchu.tmLanguage.json'), 'utf8'))
  });
  const grammar = await registry.loadGrammar('source.chuchu');
  let state = INITIAL;
  const tokens = line => { const result = grammar.tokenizeLine(line, state); state = result.ruleStack; return result.tokens.map(t => ({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes.join(' ') })); };
  assert(tokens('assign count as 2e-3').some(t => t.text === '2e-3' && t.scopes.includes('constant.numeric')));
  assert(tokens('show "// TODO: {"').some(t => t.text.includes('TODO') && t.scopes.includes('string.quoted')));
  assert(tokens('/* TODO: block').some(t => t.text === 'TODO:' && t.scopes.includes('storage.type.annotation')));
  assert(tokens('function hidden(x: int)').every(t => t.scopes.includes('comment.block')));
  tokens('*/');
  assert(tokens('show sqrt(9.0)').some(t => t.text === 'sqrt' && t.scopes.includes('support.function')));
  assert(tokens('function square(x: int) be int {').some(t => t.text === 'square' && t.scopes.includes('entity.name.function')));
  assert(tokens('show err<string>(8)').some(t => t.text === 'string' && t.scopes.includes('storage.type')));
  tokens('show "unterminated');
  assert(tokens('show 2').some(t => t.text === 'show' && t.scopes.includes('keyword.control')));
  registry.dispose();
});
test('manifest compiler matcher accepts actual Cheeku diagnostics and Windows drive letters', () => {
  const manifest = require('../package.json');
  const [message, location] = manifest.contributes.problemMatchers[0].pattern.map(p => new RegExp(p.regexp));
  assert.equal(message.exec("cheeku: error: Undefined variable 'missing'")[1], "Undefined variable 'missing'");
  assert.deepEqual(location.exec(' --> C:\\My Project\\main.chuchu:12:4').slice(1), ['C:\\My Project\\main.chuchu', '12', '4']);
  assert.deepEqual(location.exec('   --> /tmp/a b.chuchu:2:8').slice(1), ['/tmp/a b.chuchu', '2', '8']);
});
