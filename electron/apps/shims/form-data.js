// Browser shim: the node `form-data` package is only reached behind SystemLynx's isNode guards —
// in a page, the platform's own FormData is the real thing. ESM on purpose: esbuild wraps these
// alias targets as ESM, where `module.exports` is a ReferenceError at runtime.
export default (typeof FormData !== "undefined" ? FormData : class FormDataUnavailable {});
