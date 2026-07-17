// Expo installs these WinterCG globals lazily. Resolve them while Jest is in
// setup scope so later assertions cannot trigger a module load between tests.
void globalThis.TextDecoder
void globalThis.TextDecoderStream
void globalThis.TextEncoderStream
void globalThis.URL
void globalThis.URLSearchParams
void globalThis.DOMException
void (globalThis as Record<string, unknown>).__ExpoImportMetaRegistry
void globalThis.structuredClone
void globalThis.fetch
