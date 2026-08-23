# autobot

1. install node packages

```
  npm install

```

2. install chromadb

3. Start chromadb
   `chroma run --path ./vectorStore`
   `node index` 

## Electron shell (the autobot browser)

Needs **node ≥ 22** for everything shell-related (Electron 43 and Vite 8 both) — there's an `.nvmrc`, so `nvm use` sets it. Then:

```
npm start
```

Builds the chrome (`ui:build` runs automatically) and opens the browser frame: a React chrome (`electron/ui/` — tab rail, nav strip, hovering-agent placeholder) with every tab rendered as a WebContentsView beneath it — pages never contain our UI. Day-one tabs: SystemView as a local app (shows its title, not its URL) plus a web tab. Chrome development with hot reload: `npm run ui:dev`, then `AUTOBOT_UI_URL=http://localhost:5173 npm run shell`.

Env knobs: `AUTOBOT_START_URL` for the web tab's starting page, `AUTOBOT_CDP_PORT` (default `9223`), `AUTOBOT_SHELL_SHOW=0` windowless, `AUTOBOT_SMOKE=1` boots one plain page with no chrome/tabs (what `npm run smoke:electron` uses so the action lane drives a deterministic target).

**Developing the shell:** `npm run dev` — one command, both loops: nodemon relaunches Electron when anything in `electron/` changes (main process, preloads, home page), and the chrome runs off the Vite dev server so React edits hot-reload without any restart. Plain `npm start` stays the production-style boot (builds the chrome bundle, then launches).

Smoke tests for the AX action lane:

- `npm run smoke:ax` — Playwright-MCP action core driving its own Chrome (snapshot → ref → click → verify)
- `npm run smoke:electron` — the same loop attached to OUR shell over CDP

Three traps if you touch the Electron setup:

1. The shell entry must stay `.cjs` (`electron/main.cjs`). The repo is ESM, and an ESM entry breaks Electron's resolution of the builtin `electron` module under the default app.
2. Electron 43's installer needs node ≥ 22 (`nvm use 22`); v20 fails at install time with `ERR_REQUIRE_ESM`. If `node_modules/electron` was installed under v20, finish it with `node node_modules/electron/install.js` on v22.
3. Agent harnesses (VS Code / Claude Code) export `ELECTRON_RUN_AS_NODE=1`, which silently turns the Electron binary into plain node (no `app` APIs). `electron/launch.js` and `electron/smoke.js` scrub it from the child env — never spawn the binary raw with inherited env.

Files live with what they're coupled to — the launcher and shell smoke sit in `electron/`, the driver smoke next to `common/driver/axCore.js` — no catch-all scripts folder.

## Memory Store Selection

How to learn any new site quickly.

- For memory in the process of selecting element on the page we need the ingredients:
  An element, a description and a selector.
- So if label a bunch of elements with numbers and ask the model to provide a description
  for each element, we would only have to then map each description to its selector and save it in memory
  ---Failed to find correct Item found below
  search term search bar: input field to enter search terms
  results and dist [
  {
  container: '#navbar-main',
  description: 'This is the search button that users click to initiate the search after entering keywords in the search bar.',
  label: 'Search Button',
  selector: '#nav-search-submit-button'
  },
  {
  container: '#navbar-main',
  description: 'This is the search button that users click to initiate the search after entering keywords in the search bar.',
  label: 'Search Button',
  selector: '#nav-search-submit-button'
  }
  ] [ 0.4094160608265064, 0.4094160608265064 ]

---Correct Item found

search term search bar: The input field to type the search query
results and dist [
{
container: '#navbar-main',
description: 'This is the search bar where users can type in keywords to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
},
{
container: '#navbar-main',
description: 'This is the search button that users click to initiate a search after typing keywords into the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
}
] [ 0.3603773013292487, 0.38420645573529144 ]

---Correct Item found

search term search input: the input field to search for products
results and dist [
{
container: '#navbar-main',
description: 'This is a search bar where users can input keywords to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
},
{
container: '#navbar-main',
description: 'This is the search button that users click to initiate a search after entering keywords in the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
}
] [ 0.2903735600018936, 0.45432181770641766 ]

---Correct Item found

search term Search Button: Button to submit the search query
results and dist [
{
container: '#navbar-backup-backup',
description: 'This is the search button that users click to initiate the search after entering their query in the search bar.',
label: 'Search Button',
selector: '#nav-bb-searchbar > form > input.nav-bb-button'
},
{
container: '#navbar-backup-backup',
description: 'This element is a search bar where users can type in keywords to search for products on the website. It includes a text input field and a search button.',
label: 'Search Bar',
selector: '#nav-bb-search'
}
] [ 0.22249066732398737, 0.34572621484491817 ]

---Correct Item found

search term search button: button to initiate search
results and dist [
{
container: '#navbar-main',
description: 'This element is the search button, used to execute the search query entered in the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
},
{
container: '#navbar-main',
description: 'This element is the search bar where users can type in their search queries to find products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
}
] [ 0.25862092655628555, 0.4325196782574596 ]

---Correct Item found

search term search button: button to initiate search on Amazon
results and dist [
{
container: '#navbar-main',
description: 'This element is the search button that users click to execute the search based on the input provided in the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
},
{
container: '#navbar-main',
description: 'This element is the search bar where users can enter keywords or phrases to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
}
] [ 0.38536916137185184, 0.4597425133704416 ]

---Correct Item found

search term search bar: The input field used to search for items on Amazon's website.
results and dist [
{
container: '#navbar-main',
description: 'This is the search bar where users can input keywords to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
},
{
container: '#desktop-grid-4',
description: "This link allows users to view all available Father's Day gift options by redirecting them to a dedicated page with more products.",
label: 'Shop All Link',
selector: '#CardInstancee9EohYdiYrmKAUr2coerRw > div.a-cardui-footer > a'
}
] [ 0.2563117574853562, 0.7282013737712459 ]

---Correct Item found

search term search button: button to initiate the search
results and dist [
{
container: '#navbar-main',
description: 'This element is the search button, which users click to execute their search query entered in the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
},
{
container: '#navbar-main',
description: 'This element is the search bar where users can type in their queries to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
}
] [ 0.2504359889476575, 0.43121627338719626 ]

---Correct Item found

search term search bar: input field for the search query
results and dist [
{
container: '#navbar-main',
description: 'This element is a search bar where users can type in keywords to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
},
{
container: '#navbar-main',
description: 'This element is the search button, which users click to initiate a search after typing keywords into the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
}
] [ 0.3978859497866376, 0.4131034335280319 ]

---Correct Item found

search term search button Button to submit the search query
results and dist [
{
container: '#navbar-main',
description: 'This is the search button, which users click to initiate a search query after entering text in the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
},
{
container: '#navbar-main',
description: 'This is the search bar where users can type in their queries to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
}
] [ 0.2485228564563513, 0.42333299059679497 ]

---Failed to find correct Item found below

search term search bar Input field to type search queries
results and dist [
{
container: '#navbar-main',
description: 'This is the search button that users click to initiate a search after entering keywords in the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
},
{
container: '#navbar-main',
description: 'This is the main search bar where users can enter keywords to search for products on Amazon.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
}
] [ 0.43998209211615624, 0.5036579201614126 ]

-- After updating prompt --
---Correct Item found
search term Search Bar This element allows users to search for products on Amazon by typing keywords.
results and dist [
{
container: '#navbar-main',
description: 'This is the search bar where users can type in keywords to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
},
{
container: '#navbar-main',
description: 'This element is a link that allows users to browse all available fun toys for spring. It provides an option to view more products beyond the showcased items.',
label: 'Shop All Link',
selector: '#nav-xshop > a.nav-a'
}
] [ 0.16371620489376804, 0.5778720173902736 ]
---Correct Item found
results and dist [
{
container: '#navbar-main',
description: 'This element is the search button. When clicked, it initiates the search based on the keywords entered in the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
},
{
container: '#navbar-main',
description: 'This element is the search bar where users can type in keywords to search for products on the website. It includes a dropdown for category selection and a text input field.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
}
] [ 0.07541176816312223, 0.26855817684426986 ]

---

search term Price Filter This element filters the search results based on the selected price range.
results and dist [
{
container: '#nav-main',
description: 'This is the search bar where users can enter keywords to search for products on the website.',
label: 'Search Bar',
selector: '#nav-xshop > a.nav-a'
},
{
container: '#nav-belt',
description: 'This element is the language selection dropdown, allowing users to choose their preferred language for the website.',
label: 'Language Selection Dropdown',
selector: '#icp-nav-flyout'
}
] [ 0.560230982979641, 0.6408175165343586 ]

---Failed to find correct Item found below
search term Search Bar This element allows users to input search queries to find products on the website.
results and dist [
{
container: '#navbar-backup-backup',
description: "This element is a link labeled 'Cart'. It directs users to their shopping cart page where they can view and manage the items they intend to purchase.",
label: 'Cart Link',
selector: '#navbar-backup-backup > div > div.nav-bb-right > a:nth-child(3)'
},
{
container: '#navbar-backup-backup',
description: "This element is a section titled 'Customers' most-loved' showcasing popular product categories like Women's fashion, Men's fashion, Beauty, and Home, encouraging users to explore highly rated items.",
label: "Customers' Most-Loved Section",
selector: '#navbar-backup-backup > div > div.nav-bb-right > a.nav-bb-lr-divider'
}
] [ 0.584398433217153, 0.5853116001108488 ]

---

search term Search Bar This element allows users to input text for what they want to search on Amazon.
results and dist [
{
container: '#navbar-main',
description: 'This element is the search bar where users can type in keywords to search for products on Amazon.',
label: 'Search Bar',
selector: '#twotabsearchtextbox'
},
{
container: '#navbar-main',
description: 'This element is the search button that users click to initiate the search after typing keywords into the search bar.',
label: 'Search Button',
selector: '#nav-search-submit-button'
}
] [ 0.11479814802900834, 0.3114428544286685 ]

---Failed to find correct Item found below
search term Search Button This element initiates the search based on the input in the search bar.
results and dist [
{
container: '#navbar-main',
description: 'This element allows users to view and manage their orders and returns.',
label: 'Returns & Orders',
selector: '#nav-orders'
},
{
container: '#navbar-main',
description: 'This element provides access to user account options and lists, allowing users to sign in, view, and manage their account and lists.',
label: 'Account & Lists',
selector: '#nav-link-accountList'
}
] [ 0.6439885357764434, 0.6991084455538954 ]
---Failed to find correct Item found below
search term Custom Price Minimum This element allows users to input the minimum price for the filter.
results and dist [
{
container: '#a-page > div.a-section.a-padding-medium.auth-workflow',
description: "This element contains links to Amazon's Conditions of Use and Privacy Notice, which users must agree to in order to continue using the service.",
label: 'Conditions of Use and Privacy Notice Links',
selector: '#legalTextRow > a:nth-child(1)'
}
] [ 0.7628619577332714 ]

---Failed to find correct Item found below
search term search button button to trigger search
results and dist [
{
container: '#navbar-backup-backup',
description: 'This element is a search bar where users can input keywords to search for products or content on the website.',
label: 'Search Bar',
selector: '#nav-bb-search',
type: 'typeable'
},
{
container: '#navbar-backup-backup',
description: "This element is the cart icon that shows the number of items in the user's shopping cart. Clicking it takes the user to the cart page.",
label: 'Cart Icon',
selector: '#navbar-backup-backup > div.nav-bb > div.nav-bb-right > a:nth-child(3)',
type: 'clickable'
}
] [ 0.4316488191925615, 0.7053611378897349 ]
---Correct Item found
search term search bar input field to search products on Amazon
results and dist [
{
container: '#navbar-main',
description: 'This is the search bar where users can type in keywords to search for products on the website.',
label: 'Search Bar',
selector: '#twotabsearchtextbox',
type: 'typeable'
},
{
description: "This element is a link that directs users to sales and deals related to women's fashion items under $30.",
label: 'Shop Sales and Deals Link'
}
] [ 0.35938135780868596, 0.721913169356438 ]
