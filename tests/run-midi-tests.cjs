// Use the project's TypeScript compiler so tests also run on Node 20.
// All assertions decode the produced SMF independently of its encoder.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
// Mirror Vite's raw import in Node, and compile the shared JS kernel on Node 20.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(specifier, parent, isMain) {
  if (specifier.endsWith('?raw')) return fs.readFileSync(path.resolve(path.dirname(parent.filename), specifier.slice(0, -4)), 'utf8');
  return originalLoad.call(this, specifier, parent, isMain);
};
const originalJs = require.extensions['.js'];
require.extensions['.js'] = (module, filename) => {
  if (!filename.endsWith('/services/masteringKernel.js')) return originalJs(module, filename);
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  }, fileName: filename }).outputText, filename);
};
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true
  }, fileName: filename });
  module._compile(outputText, filename);
};
for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.ts')).sort()) {
  require(path.join(__dirname, file));
}
