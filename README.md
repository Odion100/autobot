# autobot

1. install node packages

```
  npm install

```

2. install chromadb

3. Start chromadb
   `chroma run --path ./vectorStore`
   `node index` 
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
