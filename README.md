<img src="chuchu-extension-icon.png" alt="Chuchu logo" width="128" height="128">

# Chuchu Language for VS Code

Language support for [Chuchu](https://github.com/chuchu-lang/chuchu-core), built against compiler main, including records, modules/imports, dot access, and file I/O. Requires VS Code 1.96 or newer.

## Features

- `.chuchu` file recognition and TextMate syntax highlighting for keywords, numeric literals, strings, escapes, comments, types, results, records, modules, built-ins, functions, and dot access.
- Comment toggling, bracket matching, automatic pairs, indentation, and folding.
- Snippets for declarations, deferred declarations (`declare`), reassignment, functions, conditionals, loops, input, result handling, records, imports/exports, and file I/O.
- Completions for keywords, types, all current built-ins, and visible document symbols.
- Completion after `.` for record fields and public imported functions/records, including nested fields and record-returning calls.
- Hover documentation and function signature help, including nested calls and `err<T>(code)`.
- Go to Definition, Find All References, occurrence highlighting, and document outline.
- Live lexical diagnostics for invalid characters, escapes, strings, numeric literals, comments, and unmatched delimiters.
- Build commands using Cheeku, with compiler errors in the Problems panel.

Go to Definition follows record fields and relative module imports across files. Imported member completion, hover, and signatures use exported declarations and include unsaved edits in open dependencies. Find All References and occurrence highlighting search the current document.

Navigation understands block shadowing, declaration order, parameter scope, forward function calls, and functions that cannot capture top-level variables. Language features run locally in the extension host and work without an installed compiler.

## Install

Download or build `chuchu-vscode-0.1.5.vsix`, then select **Extensions → … → Install from VSIX…** in VS Code. Alternatively:

```sh
code --install-extension chuchu-vscode-0.1.5.vsix
```

Open any `.chuchu` file. See [examples/features.chuchu](examples/features.chuchu) for a sample.

## Build a program

Build [Cheeku from source with its host toolchain](https://github.com/chuchu-lang/chuchu-core#native-build-and-platform-status). The compiler does not need a published release; point the extension at the executable produced by your local build.

For sibling checkouts of `chuchu-core` and `chuchu-vscode`, opening `chuchu-vscode` in VS Code uses the checked-in `.vscode/settings.json`:

```json
{
  "chuchu.compilerPath": "../chuchu-core/target/release/cheeku"
}
```

When opening the parent `chuchu-org` folder instead, set `chuchu.compilerPath` to `./chuchu-core/target/release/cheeku` in that folder's `.vscode/settings.json`. For a different workspace or a standalone file, use the absolute path to your local compiler. To use a debug compiler build, replace `target/release` with `target/debug`. A release compiler can produce both normal and debug programs.

On Windows, append `.exe` to the compiler filename, or use an escaped path such as `"C:\\tools\\cheeku.exe"`. Supply only the executable path, without surrounding shell quotes or extra arguments. Paths containing directories are resolved relative to the file's workspace folder, or its source directory when no workspace folder is open. A bare name is resolved through PATH.

Open a saved `.chuchu` file and use the editor's build button or the Command Palette:

- **Chuchu: Build Current File** compiles with `-O2`.
- **Chuchu: Build Current File for Debugging** compiles with `--debug` (O0 and native debug information).

The command saves pending edits and writes the executable to `.chuchu/build/<source-name>` beside the source file, with a `-debug` suffix for debug builds and `.exe` on Windows. Add `.chuchu/` to your project's `.gitignore`. The terminal shows compiler output; located compiler errors also appear in Problems. Run the compiled executable in your terminal. Native debugging requires an appropriate debugger extension and launch configuration; see [Chuchu's debugging guide](https://github.com/chuchu-lang/chuchu-core/blob/main/DEBUGGING.md).

Build commands require a trusted workspace and a local filesystem. Editing features are available in Restricted Mode and virtual workspaces. Compiler execution uses a process task with separate arguments, so file paths are passed directly without shell interpolation.

## Settings and current limits

| Setting | Default | Purpose |
| --- | --- | --- |
| `chuchu.compilerPath` | `cheeku` | Compiler executable name or path |
| `chuchu.diagnostics.enable` | `true` | Enable live lexical and delimiter diagnostics |

The editor analyzer tolerates incomplete code. It does not implement Cheeku's complete parser, type checker, or runtime checks. Build for authoritative syntax and type diagnostics. Variables remain labeled “inferred by Cheeku”. For field completion, the editor follows simple record initializers, copies, typed parameters, and function return annotations; it does not perform full type inference. Imports resolve relative to the importing file, including dotted paths such as `use module geometry.math`. Missing or invalid imports are reported by compiler builds. Automatic formatting, rename, and a bundled debugger are not included.

## Develop and verify

Use Node.js 22 or newer:

```sh
npm ci
npm test
npm run test:integration
npm run package
```

Open this repository in VS Code and press **F5** to launch an Extension Development Host. The compile task runs before launch. `npm run watch` recompiles during development.

`npm test` verifies scope resolution, shadowing, UTF-16 source offsets, incomplete code, nested call arguments, record fields, imported member visibility, current built-ins, actual TextMate tokenization, and compiler problem matching. `npm run test:integration` downloads VS Code 1.96.0 and exercises the registered providers in its extension host, including cross-file definitions, member completions, record outlines, and unsaved imported declarations. Set `VSCODE_VERSION=stable` to check the current stable version. Linux CI runs this command under Xvfb. Set `CHUCHU_COMPILER` to an installed Cheeku executable to also test release/debug builds, dirty-file saving, paths with spaces, and compiler diagnostics end to end.

`npm run package` produces a versioned VSIX, currently `chuchu-vscode-0.1.5.vsix`. The package has no production npm dependencies and contains the compiled extension, grammar, language configuration, snippets, documentation, and license. Packaging does not publish it to the Marketplace. Marketplace publication requires a verified `chuchu-lang` publisher account.

The editor providers use the [VS Code language feature API](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).
