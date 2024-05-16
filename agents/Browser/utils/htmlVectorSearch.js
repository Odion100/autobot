import { ChromaClient } from "chromadb";
import cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const vectorStore = new ChromaClient();

export default async function htmlVectorSearch(
  html,
  queryTexts = [],
  nResults = 3,
  selector
) {
  const elements = parseHtml(html, selector);

  if (!elements.length) return [];
  const embeddingData = elements.reduce(
    (sum, { html, selector, innerText, tagName, attributes }, i) => {
      sum.documents.push(`${innerText}, ${attributes}`);
      sum.ids.push(`id${i}`);
      sum.metadatas.push({ html, selector, tagName });
      return sum;
    },
    {
      ids: [],
      documents: [],
      metadatas: [],
    }
  );
  try {
    await vectorStore.deleteCollection({
      name: "test4",
    });
  } catch (error) {
    console.log(error);
  }
  const collection = await vectorStore.createCollection({
    name: "test4",
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });
  await collection.add(embeddingData);
  const results = await collection.query({ queryTexts, nResults });
  console.log("results1", results);
  return results.metadatas[0];
}

async function getEmbeddings(input) {
  console.log("input", input);
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input,
    encoding_format: "float",
  });
  //console.log(response);
  return response.data.map(({ embedding }) => embedding);
}
function embeddingFunction() {
  const fn = {};
  fn.generate = getEmbeddings;
  return fn;
}

function parseHtml(html, selector = "*") {
  const $ = html.length ? cheerio.load(html) : null;
  console.log("html-->", html, selector);
  return $(selector)
    .map((i, element) => ({
      tagName: $(element).get(0).tagName,
      selector: getFullSelector($(element)),
      html: $.html(element).toString(),
      attributes: Object.keys(element.attribs)
        .filter((attr) => !["class", "style"].includes(attr))
        .map((attr) => `${attr}="${element.attribs[attr]}"`)
        .join(" "),
      innerText: $(element)
        .text()
        .split("\n")
        .map((word) => word.trim())
        .filter((word) => word)
        .join(" "),
      number: i + 1,
      type: getElementType(element),
    }))
    .get();
}
function getSelector(el) {
  //console.log("el.attr", el.attr);
  if (!el) return "";
  if (el.attr("id") && /^[a-zA-Z_-][\w-]*$/.test(el.attr("id")))
    return `#${el.attr("id")}`;
  const selector = el.get(0).tagName;
  if (selector !== "body" && el.parent().children().length > 1) {
    if (el.attr("class")) {
      return getClassSelector(el);
    } else {
      return getChildSelector(el);
    }
  }
  return selector;
}
function getClassSelector(el) {
  let selector = el.get(0).tagName;

  if (el.attr("class")) {
    const classes = el
      .attr("class")
      .split(" ")
      .filter((str) => /^[a-zA-Z_-][\w-]*$/.test(str))
      .join(".")
      .trim();
    selector += `.${classes}`;
  }
  return selector;
}
function getChildSelector(el) {
  let selector = el.get(0).tagName;
  if (selector !== "body" && el.parent().children().length > 1) {
    const index = el.index();
    if (index !== -1) {
      const nthChild = index + 1; // nth-child is 1-indexed
      selector += `:nth-child(${nthChild})`;
    }
  }
  return selector;
}
function getFullSelector(element) {
  // console.log("tag1", element.get(0).tagName);
  if (element.get(0).tagName === "html") return "html";
  let parent = element.parent();
  let selector = getSelector(element);
  if (selector.charAt(0) === "#") return selector;
  // Iterate through parent nodes until reaching the document root or a parent with more than one child
  while (!["body", "html"].includes(parent.get(0).tagName) && !parent.attr("id")) {
    // if (parent.get(0)) console.log("tag2", parent.get(0).tagName);
    selector = `${getSelector(parent)} > ${selector}`;
    console.log("selector->", selector);
    parent = parent.parent();
  }
  // console.log("tag3", parent.get(0).tagName);

  // Return the first parent with more than one child or with an ID
  return getSelector(parent) + " > " + selector;
}
function getElementType(element) {
  const tagName = element.tagName;
  const attributes = element.attribs;

  // Check if element has an onclick attribute or is one of the other types of clickable elements
  if (
    attributes.onclick ||
    tagName === "a" ||
    tagName === "button" ||
    attributes.type === "button" ||
    attributes.type === "submit" ||
    attributes.type === "reset" ||
    attributes.type === "image" ||
    attributes.type === "file" ||
    attributes.type === "checkbox" ||
    attributes.type === "radio"
  ) {
    return "clickable";
  }
  // Check if element is an input or textarea
  else if (tagName === "input" || tagName === "textarea") {
    return "typeable";
  }
  // If not clickable or typeable, consider it as content
  else {
    return "content";
  }
}
const test = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Complex HTML Example</title>
    <style>
        .container {
            border: 1px solid black;
            padding: 10px;
        }
        .row {
            margin-bottom: 10px;
        }
        .col {
            float: left;
            width: 50%;
            padding: 5px;
            box-sizing: border-box;
        }
        .col:first-child {
            background-color: #f0f0f0;
        }
        .col:last-child {
            background-color: #e0e0e0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="row">
            <div class="col" id="first-column">
                <h2>Column 1</h2>
                <a>This is the first column.</a>
            </div>
            <div class="col">
                <h2>Column 2</h2>
                <a>This is the second column.</a>
                <div class="nested">
                    <h3>Nested Div</h3>
                    <a>This is a nested div inside column 2.</a>
                </div>
            </div>
        </div>
        <div class="row">
            <div class="col">
                <h2>Column 3</h2>
                <a>This is the third column.</a>
            </div>
            <div class="col">
                <h2>Column 4</h2>
                <a>This is the fourth column.</a>
            </div>
        </div>
    </div>
</body>
</html>
`;
// htmlVectorSearch(test, ["Nested Div"], 3)
//   .then(async (res) => {
//     console.log("results -->", res);
//     //await vectorStore.reset();
//   })
//   .catch(console.error);
// console.log(parseHtml(test));
