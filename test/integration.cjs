const assert = require('node:assert/strict');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension('chuchu-lang.chuchu-vscode');
  assert(extension, 'extension discovered');
  const source = 'assign outer as 3\nfunction square(x: int) be int {\n return x * x\n}\nshow square(outer)\nshow sqrt(9.0)\n';
  const document = await vscode.workspace.openTextDocument({ language: 'chuchu', content: source });
  await vscode.window.showTextDocument(document);
  await extension.activate();
  const position = text => document.positionAt(source.indexOf(text));
  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, position('square(outer)'));
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].range.start.line, 1);
  const atWordEnd = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, document.positionAt(source.indexOf('outer)') + 5));
  assert.equal(atWordEnd.length, 1);
  assert.equal(atWordEnd[0].range.start.line, 0);
  const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', document.uri, position('outer'));
  assert.equal(refs.length, 2);
  const completion = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, position('outer)'));
  assert(completion.items.some(i => i.label === 'outer'));
  assert(completion.items.some(i => i.label === 'parse_int'));
  const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position('sqrt'));
  assert(hover.some(h => h.contents.some(c => c.value.replaceAll('&nbsp;', ' ').includes('Square root'))), JSON.stringify(hover));
  const signatures = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', document.uri, document.positionAt(source.indexOf('9.0')));
  assert.equal(signatures.signatures[0].label, 'sqrt(x: float) be float');
  const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
  assert(symbols.some(s => s.name === 'square'));
  const folds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', document.uri);
  assert(folds.some(f => f.start === 1 && f.end === 2));
  const malformed = await vscode.workspace.openTextDocument({ language: 'chuchu', content: 'if true {\nshow "bad\\q"' });
  // Open-document events publish diagnostics synchronously.
  assert(vscode.languages.getDiagnostics(malformed.uri).some(d => d.message.includes('Unclosed')));
  // Exercise relative imports and field providers against real files, including unsaved dependencies.
  {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chuchu modules '));
    try {
      const mathUri = vscode.Uri.file(path.join(directory, 'math.chuchu'));
      const mathSource = 'module math\nexport record Point {\n x: int\n y: int\n}\nexport function add(a: int, b: int) be int { return a + b }\nfunction secret() be int { return 0 }\n';
      const entrySource = 'use module math\nassign origin as math.Point {\n x: 0\n y: 0\n}\nshow math.add(2, 3)\nshow origin.x\nshow length("hi")\n';
      const entryUri = vscode.Uri.file(path.join(directory, 'main.chuchu'));
      await fs.writeFile(mathUri.fsPath, mathSource);
      await fs.writeFile(entryUri.fsPath, entrySource);
      const entry = await vscode.workspace.openTextDocument(entryUri);
      await vscode.window.showTextDocument(entry);
      assert.deepEqual(vscode.languages.getDiagnostics(entryUri), []);
      const pos = text => entry.positionAt(entrySource.indexOf(text));
      const members = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', entryUri, pos('add(2'));
      assert(members.items.some(i => i.label === 'Point'));
      assert(members.items.some(i => i.label === 'add'));
      assert(!members.items.some(i => i.label === 'secret' || i.label === 'sqrt'));
      const fields = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', entryUri, pos('x\nshow'));
      assert(fields.items.some(i => i.label === 'x'));
      assert(fields.items.some(i => i.label === 'y'));
      const definition = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', entryUri, pos('add(2'));
      assert.equal(definition[0].uri.toString(), mathUri.toString());
      assert.equal(definition[0].range.start.line, 5);
      const fieldDefinition = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', entryUri, pos('x\nshow'));
      assert.equal(fieldDefinition[0].uri.toString(), mathUri.toString());
      assert.equal(fieldDefinition[0].range.start.line, 2);
      const signature = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', entryUri, pos('3)'));
      assert.equal(signature.signatures[0].label, 'add(a: int, b: int) be int');
      assert.equal(signature.activeParameter, 1);
      const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', entryUri, pos('x\nshow'));
      assert(hover.some(h => h.contents.some(c => c.value.includes('x: int'))));
      const outline = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', mathUri);
      assert(outline.some(s => s.name === 'Point' && s.children.some(c => c.name === 'x')));
      const dependency = await vscode.workspace.openTextDocument(mathUri);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(mathUri, dependency.positionAt(mathSource.length), '\nexport function twice(x: int) be int { return x * 2 }\n');
      await vscode.workspace.applyEdit(edit);
      const updated = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', entryUri, pos('add(2'));
      assert(updated.items.some(i => i.label === 'twice'), 'unsaved imported declarations are visible');
      console.log('Module integration: dot diagnostics, public completions, field navigation, imported signatures, record outline, and unsaved dependency updates passed.');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  if (process.env.CHUCHU_COMPILER) {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chuchu VSCode $ test '));
    const uri = vscode.Uri.file(path.join(directory, 'hello (test).chuchu'));
    const settings = vscode.workspace.getConfiguration('chuchu');
    const previous = settings.inspect('compilerPath').globalValue;
    const runBuild = async command => {
      let disposable;
      const finished = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { disposable.dispose(); reject(new Error('Build task timed out')); }, 30000);
        disposable = vscode.tasks.onDidEndTaskProcess(event => {
          if (event.execution.task.definition.type !== 'chuchu') return;
          clearTimeout(timeout); disposable.dispose(); resolve(event);
        });
      });
      try { await vscode.commands.executeCommand(command); return await finished; }
      finally { disposable.dispose(); }
    };
    try {
      await settings.update('compilerPath', process.env.CHUCHU_COMPILER, vscode.ConfigurationTarget.Global);
      await fs.writeFile(path.join(directory, 'math.chuchu'), 'module math\nexport function add(a: int, b: int) be int { return a + b }\n');
      await fs.writeFile(uri.fsPath, 'use module math\nshow math.add(4, 5)\n');
      const saved = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(saved);
      const normal = await runBuild('chuchu.build');
      assert.equal(normal.exitCode, 0, require('node:util').inspect(normal, {depth: 5}));
      const executable = path.join(directory, '.chuchu', 'build', 'hello (test)' + (process.platform === 'win32' ? '.exe' : ''));
      assert.equal(execFileSync(executable, { encoding: 'utf8' }).trim(), '9');
      await settings.update('compilerPath', path.relative(directory, process.env.CHUCHU_COMPILER), vscode.ConfigurationTarget.Global);
      assert.equal((await runBuild('chuchu.buildDebug')).exitCode, 0);
      await fs.access(path.join(directory, '.chuchu', 'build', 'hello (test)-debug' + (process.platform === 'win32' ? '.exe' : '')));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(saved.positionAt(0), saved.positionAt(saved.getText().length)), 'show missing\n');
      await vscode.workspace.applyEdit(edit);
      assert.equal((await runBuild('chuchu.build')).exitCode, 1);
      const deadline = Date.now() + 5000;
      while (!vscode.languages.getDiagnostics(uri).some(d => d.source === 'cheeku') && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(vscode.languages.getDiagnostics(uri).some(d => d.message.includes('Undefined variable')));
      console.log('Cheeku build integration: release, debug, paths with spaces, dirty-file save, and compiler Problems diagnostics passed.');
    } finally {
      await settings.update('compilerPath', previous, vscode.ConfigurationTarget.Global);
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  console.log('VS Code integration: activation, definitions, references, completion, hover, signatures, symbols, folding, and diagnostics passed.');
};
