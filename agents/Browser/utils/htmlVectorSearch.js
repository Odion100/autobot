import { ChromaClient } from "chromadb";
import cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const vectorStore = new ChromaClient();

export async function findElements(targetElements = [], queryTexts = [], nResults = 3) {
  // const targetElements = [];
  // for (const container of containers) {
  //   targetElements.push(...parseHtml(container, filter));
  // }
  console.log("targetElements", targetElements, targetElements.length);
  if (!targetElements.length) return { results: [], distances: [] };
  const embeddingData = targetElements.reduce(
    (
      sum,
      { selector, innerText, attributes, container, containerNumber, number, type },
      i
    ) => {
      sum.documents.push(`${innerText}, ${attributes}`);
      sum.ids.push(`id${i}`);
      sum.metadatas.push({ selector, container, containerNumber, number, type });
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
  //console.log("embeddingData", embeddingData);

  await collection.add(embeddingData);
  const results = await collection.query({ queryTexts, nResults });
  console.log("results12", results, results.metadatas[0], queryTexts);
  return {
    results: results.metadatas[0],
    distances: results.distances[0],
  };
}

export async function findContainers(
  containers = [],
  queryTexts = [],
  nResults = 3,
  filter
) {
  const targetElements = containers.reduce(
    (acc, { selector, html, containerNumber, innerText }) => {
      if (innerText) acc.push({ selector, html, innerText, containerNumber });
      return acc;
    },
    []
  );
  console.log("findContainers", targetElements);
  if (!targetElements.length) return { results: [], distances: [] };
  const embeddingData = targetElements.reduce(
    (sum, { selector, innerText, containerNumber, html }, i) => {
      sum.documents.push(`${innerText}`);
      sum.ids.push(`id${i}`);
      sum.metadatas.push({ selector, containerNumber, html, innerText });
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
      name: "test5",
    });
  } catch (error) {
    console.log(error);
  }

  const collection = await vectorStore.createCollection({
    name: "test5",
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });
  //console.log("embeddingData", embeddingData);

  await collection.add(embeddingData);
  const results = await collection.query({ queryTexts, nResults });
  console.log("results1", results, results.metadatas[0], queryTexts);
  return {
    results: results.metadatas[0],
    distances: results.distances[0],
  };
}
const htmlVectorSearch = { findContainers, findElements };
export default htmlVectorSearch;
async function getEmbeddings(input) {
  // console.log("embeddings input", input);
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

function parseHtml({ html, selector, containerNumber }, filter = "*") {
  const $ = html.length ? cheerio.load(html) : null;

  return $(filter)
    .map((i, element) => ({
      tagName: $(element).get(0).tagName,
      selector: getFullSelector($(element)).replace(
        /^body\s*>\s*[^ >]+\s*>\s*/,
        `${selector} `
      ),
      // html: $.html(element).toString(),
      attributes: Object.keys(element.attribs)
        .filter((attr) => !["class", "style"].includes(attr))
        .map((attr) => `${attr}="${element.attribs[attr]}"`)
        .join(" "),
      innerText: $(element).text().replace(/\s+/g, " ").trim(),
      type: getElementType(element),
      container: selector,
      number: i + 1,
      containerNumber,
    }))
    .get();
}
function getSelector(el) {
  if (!el) return "";

  // Use ID if available and valid
  const id = el.attr("id");
  if (id && /^[a-zA-Z_-][\w-]*$/.test(id)) {
    return `#${id}`;
  }

  // Attempt to use class selectors if available
  const classSelector = getClassSelector(el);
  if (classSelector) {
    return classSelector;
  }

  // Fall back to tag name with nth-child if necessary
  return getChildSelector(el);
}

function getClassSelector(el) {
  const tagName = el.get(0).tagName.toLowerCase();
  const classList = el.attr("class") ? el.attr("class").split(/\s+/) : [];

  // Filter valid class names and join them with '.'
  const validClasses = classList
    .filter((cls) => /^[a-zA-Z_-][\w-]*$/.test(cls))
    .join(".");
  return validClasses ? `${tagName}.${validClasses}` : null;
}

function getChildSelector(el) {
  const tagName = el.get(0).tagName.toLowerCase();
  // Skip nth-child for the body tag
  if (tagName === "body") {
    return tagName;
  }
  const index = el.index() + 1; // nth-child is 1-indexed

  return `${tagName}:nth-child(${index})`;
}

function getFullSelector(element) {
  if (element.get(0).tagName.toLowerCase() === "html") return "html";

  let path = [];
  let parent = element;

  while (parent.length && parent.get(0).tagName.toLowerCase() !== "html") {
    const selector = getSelector(parent);
    path.unshift(selector);
    if (selector.startsWith("#")) {
      break;
    }
    parent = parent.parent();
  }

  return path.join(" > ");
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
const html = `<!DOCTYPE html>
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
// findElement([{ html }, { html }], ["Nested Div"], 3)
//   .then(async (res) => {
//     console.log("results -->", res);
//     //await vectorStore.reset();
//   })
//   .catch(console.error);
// console.log(parseHtml({ html }));
