// Run with npm run test:i18n. No browser or Android device is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {buildSync} = require('esbuild');
const root = path.resolve(__dirname, '..');
const catalog = require('../src/i18n/en.json');

function walk(dir) {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry =>
        entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

// Every literal translation key must exist; placeholders cannot be dropped or
// reordered accidentally in the printf templates shared with the Go backend.
const placeholders = text => [...text.matchAll(/\{(?:\d+|pkg)\}|%(?:\.\d+)?[sdftvw]/g)].map(m => m[0]).sort();
for (const [key, value] of Object.entries(catalog)) {
    assert.ok(value.length, `Empty translation: ${key}`);
    assert.deepEqual(placeholders(value), placeholders(key), `Placeholder mismatch: ${key}`);
    assert.ok(!/[\u3400-\u9fff]/u.test(value), `Untranslated English: ${key}`);
}
let keysChecked = 0;
for (const file of walk(path.join(root, 'src')).filter(file => /\.tsx?$/.test(file))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' &&
            node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            const key = node.arguments[0].text;
            assert.ok(Object.hasOwn(catalog, key), `${file}: missing translation for ${key}`);
            keysChecked++;
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
}
const backendCatalog = require('../../internal/i18n/en.json');
for (const [key, value] of Object.entries(backendCatalog)) {
    assert.equal(catalog[key], value, `Backend/frontend catalog mismatch: ${key}`);
}

const bundle = buildSync({
    stdin: {
        contents: `export * from './src/i18n'; export * from './src/i18n/core';
            export {generatePerfCSV, clusterLabel, formatEventDetail} from './src/component/perf/perfFormat';
            export {quickActions, ACTION_META, actionLabel} from './src/data/quickActions';`,
        resolveDir: root, loader: 'ts',
    },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    define: {'process.env.NODE_ENV': '"production"'},
}).outputFiles[0].text;

function runtime({languages = ['en-US'], saved, blockedStorage = false, syncGate} = {}) {
    const storage = new Map(saved === undefined ? [] : [['language_mode', saved]]);
    const listeners = {};
    const calls = [];
    const navigator = {languages, language: languages[0]};
    const document = {documentElement: {lang: ''}};
    let rejectSync = false;
    const context = {
        module: {exports: {}}, exports: {}, console, setTimeout, clearTimeout,
        navigator, document,
        localStorage: {
            getItem: key => {if (blockedStorage) throw Error('blocked'); return storage.get(key) ?? null;},
            setItem: (key, value) => {if (blockedStorage) throw Error('blocked'); storage.set(key, value);},
        },
        window: {
            addEventListener: (event, listener) => {listeners[event] = listener;},
            go: {main: {App: {SetLanguage: async locale => {
                await syncGate?.(locale);
                if (rejectSync) throw Error('backend unavailable');
                calls.push(locale);
            }}}},
        },
    };
    vm.runInNewContext(bundle, context);
    return {api: context.module.exports, storage, navigator, document, calls, listeners,
        reject: value => {rejectSync = value;}};
}

(async () => {
    let releaseSync;
    const syncGate = new Promise(resolve => {releaseSync = resolve;});
    const racing = runtime({syncGate: () => syncGate});
    const explicitChoice = racing.api.useLanguageStore.getState().setMode('en');
    racing.navigator.languages = ['zh-CN'];
    racing.listeners.languagechange();
    releaseSync();
    await explicitChoice;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(racing.api.useLanguageStore.getState().mode, 'en',
        'A system change must not replace a pending explicit language choice');
    assert.equal(racing.calls.at(-1), 'en');

    let releaseStartup;
    const startupGate = new Promise(resolve => {releaseStartup = resolve;});
    const startup = runtime({syncGate: locale => locale === 'en' ? startupGate : undefined});
    const initializing = startup.api.initializeLanguage();
    await new Promise(resolve => setTimeout(resolve, 0));
    const startupChoice = startup.api.useLanguageStore.getState().setMode('zh-CN');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(startup.calls, [], 'Later sync must wait for startup sync');
    releaseStartup();
    await Promise.all([initializing, startupChoice]);
    assert.deepEqual(startup.calls, ['en', 'zh-CN']);
    assert.equal(startup.api.getLocale(), 'zh-CN');

    const first = runtime();
    const {api} = first;
    assert.equal(api.useLanguageStore.getState().mode, 'system');
    assert.equal(api.getLocale(), 'en');
    assert.equal(first.document.documentElement.lang, 'en');
    await api.initializeLanguage();
    assert.deepEqual(first.calls, ['en']);
    assert.equal(api.resolveLocale('system', ['zh-TW', 'en']), 'zh-CN');
    assert.equal(api.resolveLocale('system', ['ZH_cn']), 'zh-CN');
    assert.equal(api.resolveLocale('system', ['ja-JP', 'zh-CN']), 'en');
    assert.equal(api.resolveLocale('system', []), 'en');
    assert.equal(api.resolveLocale('en', ['zh-CN']), 'en');
    assert.equal(api.t('下载 {0}', ['file $& {1}.apk']), 'Download file $& {1}.apk');
    assert.equal(api.t('raw-device-output'), 'raw-device-output');
    for (const key of ['constructor', 'toString', '__proto__']) {
        assert.equal(api.translate('en', key), key, 'Unknown keys must not read Object.prototype');
    }

    await api.useLanguageStore.getState().setMode('zh-CN');
    assert.equal(first.storage.get('language_mode'), 'zh-CN');
    assert.equal(first.document.documentElement.lang, 'zh-CN');
    assert.equal(api.quickActions()[0].title, '常用');
    assert.equal(api.actionLabel('clear-data', 'old label'), '清除数据');
    assert.equal(runtime({saved: first.storage.get('language_mode')}).api.getLocale(), 'zh-CN');
    first.navigator.languages = ['ja'];
    first.listeners.languagechange();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(api.getLocale(), 'zh-CN', 'Explicit selection ignores system changes');

    await api.useLanguageStore.getState().setMode('system');
    assert.equal(api.getLocale(), 'en');
    first.navigator.languages = ['zh-CN'];
    first.listeners.languagechange();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(api.getLocale(), 'zh-CN', 'System mode reacts to languagechange');

    await Promise.all(['en', 'zh-CN', 'en'].map(mode => api.useLanguageStore.getState().setMode(mode)));
    assert.equal(api.getLocale(), 'en');
    assert.equal(first.calls.at(-1), 'en');
    assert.equal(api.quickActions()[0].title, 'Common');
    assert.equal(api.actionLabel('clear-data', 'old label'), 'Clear app data');
    assert.equal(api.actionLabel('install-apk-file', '安装 my app.apk'), 'Install my app.apk');
    assert.ok(api.ACTION_META()['clear-data'].danger.includes('{pkg}'));
    assert.equal(api.clusterLabel('小核'), 'Efficiency');
    assert.equal(api.clusterLabel('簇4'), 'Cluster 4');
    assert.equal(api.formatEventDetail('启动方式：activity'), 'Launch method: activity');
    const events = [{timestamp: 123456789, kind: 'died', process: 'com.test:push', pid: 12,
        reason: '低内存被杀', detail: 'device,raw\noutput', source: 'exit-info'}];
    const csv = api.generatePerfCSV('com.test', [], [], events);
    assert.ok(csv.includes('Killed due to low memory'));
    assert.ok(csv.includes('"device,raw\noutput"'), 'CSV preserves and escapes raw output');
    assert.ok(!/[\u3400-\u9fff]/u.test(csv));
    await api.useLanguageStore.getState().setMode('zh-CN');
    assert.ok(api.generatePerfCSV('com.test', [], [], events).includes('进程事件'));
    first.reject(true);
    await assert.rejects(api.useLanguageStore.getState().setMode('en'));
    assert.equal(api.getLocale(), 'zh-CN', 'Failed backend sync does not split UI/backend languages');
    first.reject(false);
    await api.useLanguageStore.getState().setMode('en');
    assert.equal(api.getLocale(), 'en', 'A failed update does not block later choices');

    assert.equal(runtime({saved: 'invalid', languages: ['zh-CN']}).api.getLocale(), 'zh-CN');
    const blocked = runtime({blockedStorage: true});
    await blocked.api.useLanguageStore.getState().setMode('zh-CN');
    assert.equal(blocked.api.getLocale(), 'zh-CN', 'Storage failure allows session-only changes');
    console.log(`i18n: ${keysChecked} source references checked; catalogs, detection, persistence, switching, backend sync, and CSV passed.`);
})().catch(error => {console.error(error); process.exitCode = 1;});
