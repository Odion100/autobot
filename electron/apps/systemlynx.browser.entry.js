// window.systemlynx IS SYSTEMLYNX — the client side of the library, exposed whole (his words:
// "if you want to deconcatenate the built-in client, or create your own client, or call any
// other object systemlynx exposes, you have it").
//
// This replicates exactly what the package's own index.js produces when isNode is false: the
// pre-created Client and HttpClient, the create* factories, and the server-only pieces null —
// the same nulls the package itself exports off-node. It is hand-assembled from the client-side
// modules only because a bundler follows every require, and the index's server branch would drag
// express and friends into a page that can never run them.
const createClient = require("systemlynx/systemlynx/Client/Client");
const createHttpClient = require("systemlynx/systemlynx/HttpClient/HttpClient");
const createDispatcher = require("systemlynx/systemlynx/Dispatcher/Dispatcher");

const HttpClient = createHttpClient();
const Client = createClient();
const Dispatcher = new createDispatcher();

window.systemlynx = {
  // pre-created, for convenient destructuring — the package's own convention
  Client,
  HttpClient,
  Dispatcher,
  // the factories, for an app that wants its own (BUApp: createClient(HttpClient) with its
  // cookie-session HTTP layer)
  createClient,
  createHttpClient,
  createDispatcher,
  // server-side abstractions do not exist in a page — null, exactly as the package nulls them
  // when isNode is false. An app that needs to HOST a service is a node process, not a tab.
  App: null,
  Service: null,
  ServerManager: null,
  LoadBalancer: null,
};
