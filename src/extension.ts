import * as vscode from 'vscode';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { analyze, Analysis, callAt, isText, references, resolve, Span, SymbolInfo, tokenAt, visibleSymbols } from './analysis';
import { builtins, keywordHelp, keywords, signature, types } from './catalog';

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'chuchu' };
  const cache = new Map<string, { version: number; model: Analysis }>();
  const modelFor = (document: vscode.TextDocument): Analysis => {
    const key = document.uri.toString(), entry = cache.get(key);
    if (entry?.version === document.version) { return entry.model; }
    const model = analyze(document.getText());
    cache.set(key, { version: document.version, model });
    return model;
  };
  const range = (document: vscode.TextDocument, span: Span) => new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
  const detail = (symbol: SymbolInfo) => symbol.callable ? signature(symbol.callable) : `${symbol.name}: ${symbol.type === 'inferred' ? 'inferred by Cheeku' : symbol.type}`;
  const diagnostics = vscode.languages.createDiagnosticCollection('chuchu');
  const update = (document: vscode.TextDocument) => {
    if (document.languageId !== 'chuchu') { cache.delete(document.uri.toString()); diagnostics.delete(document.uri); return; }
    const enabled = vscode.workspace.getConfiguration('chuchu', document.uri).get<boolean>('diagnostics.enable', true);
    diagnostics.set(document.uri, enabled ? modelFor(document).issues.map(issue => {
      const diagnostic = new vscode.Diagnostic(range(document, issue), issue.message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'chuchu'; return diagnostic;
    }) : []);
  };
  context.subscriptions.push(diagnostics,
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument(event => update(event.document)),
    vscode.workspace.onDidCloseTextDocument(document => { cache.delete(document.uri.toString()); diagnostics.delete(document.uri); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('chuchu.diagnostics')) { vscode.workspace.textDocuments.forEach(update); } }),
    { dispose: () => cache.clear() }
  );
  vscode.workspace.textDocuments.forEach(update);

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    provideCompletionItems(document, position) {
      const model = modelFor(document), offset = document.offsetAt(position);
      if (isText(model, offset)) { return []; }
      const items: vscode.CompletionItem[] = [];
      for (const word of [...keywords, ...types]) {
        const item = new vscode.CompletionItem(word, types.includes(word) ? vscode.CompletionItemKind.TypeParameter : vscode.CompletionItemKind.Keyword);
        item.documentation = keywordHelp[word]; items.push(item);
      }
      for (const builtin of builtins) {
        if (builtin.name === 'err') { continue; }
        const item = new vscode.CompletionItem(builtin.name, vscode.CompletionItemKind.Function);
        item.detail = signature(builtin); item.documentation = builtin.description;
        items.push(item);
      }
      for (const symbol of visibleSymbols(model, offset)) {
        const item = new vscode.CompletionItem(symbol.name, symbol.kind === 'function' ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Variable);
        item.detail = detail(symbol); item.sortText = `0${symbol.name}`; items.push(item);
      }
      return items;
    }
  }));
  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    provideHover(document, position) {
      const model = modelFor(document), token = tokenAt(model, document.offsetAt(position));
      if (!token || token.kind !== 'word') { return; }
      const symbol = resolve(model, token), builtin = builtins.find(b => b.name === token.text);
      const markdown = new vscode.MarkdownString();
      if (symbol) { markdown.appendCodeblock(detail(symbol), 'chuchu'); }
      else if (builtin) { markdown.appendCodeblock(signature(builtin), 'chuchu'); markdown.appendMarkdown('\n\n'); markdown.appendText(builtin.description); }
      else if (keywordHelp[token.text]) { markdown.appendText(keywordHelp[token.text]); }
      else { return; }
      return new vscode.Hover(markdown, range(document, token));
    }
  }));
  context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(selector, {
    provideSignatureHelp(document, position) {
      const call = callAt(modelFor(document), document.offsetAt(position));
      if (!call) { return; }
      const info = new vscode.SignatureInformation(signature(call.callable), call.callable.description);
      info.parameters = call.callable.parameters.map(p => new vscode.ParameterInformation(call.callable.optional ? `[${p}]` : p));
      const help = new vscode.SignatureHelp();
      help.signatures = [info]; help.activeSignature = 0;
      help.activeParameter = Math.min(call.argument, Math.max(0, info.parameters.length - 1));
      return help;
    }
  }, '(', ','));
  const symbolAt = (document: vscode.TextDocument, position: vscode.Position) => {
    const model = modelFor(document), offset = document.offsetAt(position);
    let token = tokenAt(model, offset);
    if (token?.kind !== 'word') {
      const previous = tokenAt(model, offset - 1);
      if (previous?.kind === 'word' && previous.end === offset) { token = previous; }
    }
    return { model, symbol: token ? resolve(model, token) : undefined };
  };
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
    provideDefinition(document, position) {
      const { symbol } = symbolAt(document, position);
      return symbol ? new vscode.Location(document.uri, range(document, symbol.selection)) : undefined;
    }
  }));
  context.subscriptions.push(vscode.languages.registerReferenceProvider(selector, {
    provideReferences(document, position, options) {
      const { model, symbol } = symbolAt(document, position);
      return symbol ? references(model, symbol).filter(t => options.includeDeclaration || t.start !== symbol.selection.start)
        .map(t => new vscode.Location(document.uri, range(document, t))) : [];
    }
  }));
  context.subscriptions.push(vscode.languages.registerDocumentHighlightProvider(selector, {
    provideDocumentHighlights(document, position) {
      const { model, symbol } = symbolAt(document, position);
      return symbol ? references(model, symbol).map(t => new vscode.DocumentHighlight(range(document, t))) : [];
    }
  }));
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, {
    provideDocumentSymbols(document) {
      const model = modelFor(document);
      const make = (s: SymbolInfo) => new vscode.DocumentSymbol(s.name, detail(s), s.kind === 'function' ? vscode.SymbolKind.Function : vscode.SymbolKind.Variable,
        range(document, s), range(document, s.selection));
      const functions = model.symbols.filter(s => s.kind === 'function');
      const result = functions.map(s => {
        const symbol = make(s);
        symbol.children = model.symbols.filter(child => child.kind !== 'function' && child.start > s.selection.end && child.end <= s.end).map(make);
        return symbol;
      });
      result.push(...model.symbols.filter(s => s.kind === 'variable' && !functions.some(f => f.start < s.start && s.end <= f.end)).map(make));
      return result;
    }
  }));
  context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(selector, {
    provideFoldingRanges(document) {
      const model = modelFor(document), folds: vscode.FoldingRange[] = [];
      for (const [open, close] of model.pairs) {
        if (open > close || model.code[open].text !== '{') { continue; }
        const start = document.positionAt(model.code[open].start).line, end = document.positionAt(model.code[close].start).line;
        if (end > start) { folds.push(new vscode.FoldingRange(start, end - 1)); }
      }
      for (const t of model.tokens.filter(t => t.kind === 'comment' && t.text.startsWith('/*'))) {
        const start = document.positionAt(t.start).line, end = document.positionAt(t.end).line;
        if (end > start) { folds.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Comment)); }
      }
      return folds;
    }
  }));

  async function build(debug: boolean): Promise<void> {
    if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('Trust this workspace before running the Cheeku compiler.'); return; }
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'chuchu' || document.uri.scheme !== 'file') {
      await vscode.window.showInformationMessage('Open a saved .chuchu file to build.'); return;
    }
    if (document.isDirty && !await document.save()) { return; }
    try {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const resolutionBase = folder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
      // Current VS Code restricts terminal cwd to the home directory in an empty workspace.
      // All source/output arguments remain absolute; relative compiler settings use resolutionBase.
      const cwd = folder?.uri.fsPath ?? homedir();
      let compiler = vscode.workspace.getConfiguration('chuchu', document.uri).get<string>('compilerPath', 'cheeku').trim();
      if (!compiler) { throw new Error('Set chuchu.compilerPath to the Cheeku executable.'); }
      if (!path.isAbsolute(compiler) && /[/\\]/.test(compiler)) { compiler = path.resolve(resolutionBase, compiler); }
      const outputDirectory = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), '.chuchu', 'build'));
      await vscode.workspace.fs.createDirectory(outputDirectory);
      const stem = path.basename(document.uri.fsPath, '.chuchu');
      const output = path.join(outputDirectory.fsPath, `${stem}${debug ? '-debug' : ''}${process.platform === 'win32' ? '.exe' : ''}`);
      const task = new vscode.Task({ type: 'chuchu', file: document.uri.fsPath, debug }, folder ?? vscode.TaskScope.Global,
        debug ? 'Build current file for debugging' : 'Build current file', 'Chuchu',
        new vscode.ProcessExecution(compiler, [document.uri.fsPath, debug ? '--debug' : '-O2', '-o', output], { cwd }), ['$chuchu']);
      task.group = vscode.TaskGroup.Build;
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true };
      await vscode.tasks.executeTask(task);
    } catch (error) { await vscode.window.showErrorMessage(`Chuchu build failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  context.subscriptions.push(vscode.commands.registerCommand('chuchu.build', () => build(false)),
    vscode.commands.registerCommand('chuchu.buildDebug', () => build(true)));
}
