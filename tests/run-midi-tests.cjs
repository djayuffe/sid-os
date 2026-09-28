// Use the project's TypeScript compiler so tests also run on Node 20.
// All assertions decode the produced SMF independently of its encoder.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
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
