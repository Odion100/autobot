// Browser shim for node builtins (fs, path, stream) reached only behind SystemLynx's isNode
// guards — file-upload helpers a page never runs. ESM on purpose: esbuild wraps alias targets as
// ESM, where `module.exports` throws. Named exports cover the destructured requires.
export class Readable {}
export const statSync = () => { throw new Error("fs is node-only"); };
export const createReadStream = () => { throw new Error("fs is node-only"); };
export const basename = (p) => String(p).split("/").pop();
export default { Readable, statSync, createReadStream, basename };
