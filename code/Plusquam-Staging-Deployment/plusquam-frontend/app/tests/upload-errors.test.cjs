const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
    .replaceAll('import.meta.env', '({ VITE_API_BASE: "https://synthetic.invalid" })');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, fetch: (...args) => fetchMock(...args) });
  return exports;
}
let fetchMock;
const errors = load('lib/apiErrors.ts');
const { translations } = load('i18n/translations.ts');
const { api } = load('lib/api.ts', {
  './apiErrors': errors,
  './session': { getToken: () => null },
});
const upload = { filename: 'broken.pdf', contentType: 'application/pdf', dataBase64: 'YmFk' };
async function rejection(call, status, body, raw = false) {
  fetchMock = async () => new Response(raw ? body : JSON.stringify(body), { status });
  try { await call(); assert.fail('Expected rejection'); } catch (error) { return error; }
}
test('project creation maps invalid PDF to safe English and German inline messages', async () => {
  const error = await rejection(() => api.createProject({ upload }), 400, { error: 'file must be a valid PDF' });
  const key = errors.projectSubmitErrorKey(error);
  assert.equal(key, 'form.upload.invalid_pdf');
  assert.equal(translations.en[key], 'This file isn’t a valid PDF. Please upload a valid PDF or DOCX.');
  assert.match(translations.de[key], /keine gültige PDF-Datei/);
});
test('known validation errors map to translated messages', async () => {
  for (const [status, message, expected] of [
    [400, 'file must be a valid DOCX document', 'invalid_docx'],
    [400, 'only PDF and DOCX files are supported', 'invalid'],
    [400, 'could not extract text from uploaded document', 'unreadable'],
    [413, 'file too large (maximum 4 MB)', 'too_large'],
    [413, 'file too large or empty', 'empty_or_large'],
  ]) {
    const error = await rejection(() => api.createProject({ upload }), status, { error: message });
    const key = errors.projectSubmitErrorKey(error);
    assert.equal(key, `form.upload.${expected}`);
    assert.ok(translations.en[key]); assert.ok(translations.de[key]);
  }
});
test('unknown, malformed, wrong-status and unrelated errors stay generic', async () => {
  for (const [call, status, body, raw] of [
    [() => api.createProject({ upload }), 400, { error: 'internal database secret' }],
    [() => api.createProject({ upload }), 400, '<html>internal secret</html>', true],
    [() => api.createProject({ upload }), 400, { error: { secret: true } }],
    [() => api.createProject({ upload }), 400, { error: 'toString' }],
    [() => api.createProject({ upload }), 500, { error: 'file must be a valid PDF' }],
    [() => api.createProject({}), 400, { error: 'file must be a valid PDF' }],
    [() => api.startAssessment('test'), 400, { error: 'file must be a valid PDF' }],
  ]) {
    const error = await rejection(call, status, body, raw);
    assert.equal(error.message, `API request failed (${status})`);
    assert.equal(errors.projectSubmitErrorKey(error), 'form.submit_error');
  }
  assert.equal(errors.projectSubmitErrorKey(new Error('network internals')), 'form.submit_error');
});
