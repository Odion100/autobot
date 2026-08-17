import WebAssistant from "./agents/WebAssistant/index.js";

WebAssistant.invoke("what can you do?").then(console.log).catch(console.error);
