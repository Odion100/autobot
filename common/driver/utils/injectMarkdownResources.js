export default async function injectMarkdownResourcesAndStyles() {
  return new Promise((resolve) => {
    // Function to load a script
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    // Function to load a stylesheet
    function loadStylesheet(href) {
      return new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
      });
    }

    // Function to inject custom styles
    function injectCustomStyles() {
      const styles = `
   .markdown {
      line-height: 1.6;
    }
    .markdown > *:first-child {
      margin-top: 0 !important;
    }
    .markdown > *:last-child {
      margin-bottom: 0 !important;
    }
    .markdown a {
      color: #4183c4;
    }
    .markdown a.absent {
      color: #cc0000;
    }
    .markdown a.anchor {
      display: block;
      padding-left: 30px;
      margin-left: -30px;
      cursor: pointer;
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
    }
    .markdown h1,
    .markdown h2,
    .markdown h3,
    .markdown h4,
    .markdown h5,
    .markdown h6 {
      margin: 20px 0 10px;
      padding: 0;
      font-weight: bold;
      -webkit-font-smoothing: antialiased;
      cursor: text;
      position: relative;
      color: #5960b6 !important;
    }
    .markdown h1:hover a.anchor,
    .markdown h2:hover a.anchor,
    .markdown h3:hover a.anchor,
    .markdown h4:hover a.anchor,
    .markdown h5:hover a.anchor,
    .markdown h6:hover a.anchor {
      text-decoration: none;
    }
    .markdown h1 tt,
    .markdown h1 code {
      font-size: inherit;
    }
    .markdown h2 tt,
    .markdown h2 code {
      font-size: inherit;
    }
    .markdown h3 tt,
    .markdown h3 code {
      font-size: inherit;
    }
    .markdown h4 tt,
    .markdown h4 code {
      font-size: inherit;
    }
    .markdown h5 tt,
    .markdown h5 code {
      font-size: inherit;
    }
    .markdown h6 tt,
    .markdown h6 code {
      font-size: inherit;
    }
    .markdown h1 {
      font-size: 28px;
      color: black;
    }
    .markdown h2 {
      font-size: 24px;
      border-bottom: 1px solid #cccccc;
      color: black;
    }
    .markdown h3 {
      font-size: 18px;
    }
    .markdown h4 {
      font-size: 16px;
    }
    .markdown h5 {
      font-size: 14px;
    }
    .markdown h6 {
      color: #777777;
      font-size: 14px;
    }
    .markdown p,
    .markdown blockquote,
    .markdown ul,
    .markdown ol,
    .markdown dl,
    .markdown li,
    .markdown table,
    .markdown pre {
      margin: 15px 0;
      color: #fff !important;
    }
    .markdown hr {
      border: 0 none;
      color: #cccccc;
      height: 4px;
      padding: 0;
      border-bottom: 1px solid;
    }
    .markdown > h2:first-child {
      margin-top: 0;
      padding-top: 0;
    }
    .markdown > h1:first-child {
      margin-top: 0;
      padding-top: 0;
    }
    .markdown > h1:first-child + h2 {
      margin-top: 0;
      padding-top: 0;
    }
    .markdown > h3:first-child, .markdown > h4:first-child, .markdown > h5:first-child, .markdown > h6:first-child {
      margin-top: 0;
      padding-top: 0;
    }
    .markdown a:first-child h1,
    .markdown a:first-child h2,
    .markdown a:first-child h3,
    .markdown a:first-child h4,
    .markdown a:first-child h5,
    .markdown a:first-child h6 {
      margin-top: 0;
      padding-top: 0;
    }
    .markdown h1 p,
    .markdown h2 p,
    .markdown h3 p,
    .markdown h4 p,
    .markdown h5 p,
    .markdown h6 p {
      margin-top: 0;
    }
    .markdown li p.first {
      display: inline-block;
    }
    .markdown li {
      margin: 0;
    }
    .markdown ul,
    .markdown ol {
      padding-left: 30px;
    }
    .markdown ul :first-child,
    .markdown ol :first-child {
      margin-top: 0;
    }
    .markdown dl {
      padding: 0;
    }
    .markdown dl dt {
      font-size: 14px;
      font-weight: bold;
      font-style: italic;
      padding: 0;
      margin: 15px 0 5px;
    }
    .markdown dl dt:first-child {
      padding: 0;
    }
    .markdown dl dt > :first-child {
      margin-top: 0;
    }
    .markdown dl dt > :last-child {
      margin-bottom: 0;
    }
    .markdown dl dd {
      margin: 0 0 15px;
      padding: 0 15px;
    }
    .markdown dl dd > :first-child {
      margin-top: 0;
    }
    .markdown dl dd > :last-child {
      margin-bottom: 0;
    }
    .markdown ul, .markdown ol {
      padding-left: 2em;
      margin: 1em 0;
    }

    .markdown ul {
      list-style-type: disc;
    }

    .markdown ul ul {
      list-style-type: circle;
    }

    .markdown ul ul ul {
      list-style-type: square;
    }

    .markdown ol {
      list-style-type: decimal;
    }

    .markdown ol ol {
      list-style-type: lower-alpha;
    }

    .markdown ol ol ol {
      list-style-type: lower-roman;
    }

    .markdown li {
      margin-bottom: 0.5em;
    }

    .markdown li > p {
      margin-top: 1em;
    }

    .markdown li > :first-child {
      margin-top: 0;
    }

    .markdown li > :last-child {
      margin-bottom: 0;
    }
    .markdown blockquote {
      border-left: 3px solid #c3c3c3;
      color: #777777;
      font-size: 14px;
      text-indent: 8px;
    }
    .markdown blockquote > :first-child {
      margin-top: 0;
    }
    .markdown blockquote > :last-child {
      margin-bottom: 0;
    }
    .markdown table {
      padding: 0;
      border-collapse: collapse;
    }
    .markdown table tr {
      border-top: 1px solid #282c34;
      margin: 0;
      padding: 0;
    }
    .markdown table thead {
      background-color: #282c34;
    }
    .markdown table tr:nth-child(2n) {
      background-color: #282c34;
    }
    .markdown table tr th {
      font-weight: bold;
      border: 1px solid #262626;
      margin: 0;
      padding: 6px 13px;
    }
    .markdown table tr td {
      border: 1px solid #262626;
      margin: 0;
      padding: 6px 13px;
    }
    .markdown table tr th :first-child,
    .markdown table tr td :first-child {
      margin-top: 0;
    }
    .markdown table tr th :last-child,
    .markdown table tr td :last-child {
      margin-bottom: 0;
    }
    .markdown img {
      max-width: 100%;
    }
    .markdown span.frame {
      display: block;
      overflow: hidden;
    }
    .markdown span.frame > span {
      border: 1px solid #dddddd;
      display: block;
      float: left;
      overflow: hidden;
      margin: 13px 0 0;
      padding: 7px;
      width: auto;
    }
    .markdown span.frame span img {
      display: block;
      float: left;
    }
    .markdown span.frame span span {
      clear: both;
      color: #333333;
      display: block;
      padding: 5px 0 0;
    }
    .markdown span.align-center {
      display: block;
      overflow: hidden;
      clear: both;
    }
    .markdown span.align-center > span {
      display: block;
      overflow: hidden;
      margin: 13px auto 0;
      text-align: center;
    }
    .markdown span.align-center span img {
      margin: 0 auto;
      text-align: center;
    }
    .markdown span.align-right {
      display: block;
      overflow: hidden;
      clear: both;
    }
    .markdown span.align-right > span {
      display: block;
      overflow: hidden;
      margin: 13px 0 0;
      text-align: right;
    }
    .markdown span.align-right span img {
      margin: 0;
      text-align: right;
    }
    .markdown span.float-left {
      display: block;
      margin-right: 13px;
      overflow: hidden;
      float: left;
    }
    .markdown span.float-left span {
      margin: 13px 0 0;
    }
    .markdown span.float-right {
      display: block;
      margin-left: 13px;
      overflow: hidden;
      float: right;
    }
    .markdown span.float-right > span {
      display: block;
      overflow: hidden;
      margin: 13px auto 0;
      text-align: right;
    }
    .markdown code,
    .markdown tt {
      margin: 0 2px;
      padding: 2px 3px;
      white-space: nowrap;
      background-color: #efeeee;
      border-radius: 3px;
      color: #3f51b5;
      font-size: 14px;
    }
    .markdown pre code {
      margin: 0;
      padding: 0;
      white-space: pre;
      border: none;
      background: transparent;
    }
    .markdown .highlight pre {
      font-size: 13px;
    }
    .markdown pre {
      font-size: 13px;
    }
    .markdown pre code,
    .markdown pre tt {
      background-color: transparent;
      border: none;
    }
    .markdown sup {
      font-size: 0.83em;
      vertical-align: super;
      line-height: 0;
    }
    .markdown * {
      -webkit-print-color-adjust: exact;
    }
    @media screen and (min-width: 914px) {
      .markdown body {
        width: 854px;
        margin: 0 auto;
      }
    }
    @media print {
      .markdown table, .markdown pre {
        page-break-inside: avoid;
      }
      .markdown pre {
        word-wrap: break-word;
      }
    }/*# sourceMappingURL=styles.css.map */
      `; // Include the full CSS you provided here

      const styleElement = document.createElement("style");
      styleElement.textContent = styles;
      document.head.appendChild(styleElement);
    }

    // Load all required resources
    Promise.all([
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/marked/2.0.3/marked.min.js"),
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/prism/1.24.1/prism.min.js"),
      loadScript(
        "https://cdnjs.cloudflare.com/ajax/libs/prism/1.24.1/components/prism-javascript.min.js"
      ),
      // loadStylesheet(
      //   "https://cdnjs.cloudflare.com/ajax/libs/prism/1.24.1/themes/prism-tomorrow.min.css"
      // ),
    ])
      .then(() => {
        injectCustomStyles();
        resolve();
      })
      .catch((error) => {
        console.error("Error loading resources:", error);
        resolve(); // Resolve anyway to not block the process
      });
  });
}
