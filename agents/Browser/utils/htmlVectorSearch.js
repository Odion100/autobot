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
  tagNameFilters
) {
  const elements = parseHtml(html);
  const embeddingData = elements.reduce(
    (sum, { html, selector, innerText, tagName }, i) => {
      sum.documents.push(innerText || "none");
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
  });
  await collection.add(embeddingData);
  const query = { queryTexts, nResults };
  if (tagNameFilters) query.where = { tagName: { $in: tagNameFilters } };
  return (await collection.query(query)).metadatas;
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

function parseHtml(html) {
  const $ = html.length ? cheerio.load(html) : null;
  return $("*")
    .map((i, element) => ({
      tagName: $(element).get(0).tagName,
      selector: $(element)
        .parents()
        .addBack()
        .map((index, el) => {
          const tagName = el.tagName.toLowerCase();
          const id = el.attribs.id ? `#${el.attribs.id}` : "";
          const classes = el.attribs.class
            ? `.${el.attribs.class.replace(/\s+/g, ".")}`
            : "";
          return tagName + id + classes;
        })
        .get()
        .join(" > "),
      html: $.html(element).toString(),
      innerText: $(element)
        .text()
        .split("\n")
        .map((word) => word.trim())
        .filter((word) => word)
        .join(" "),
    }))
    .get();
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
                <p>This is the first column.</p>
            </div>
            <div class="col">
                <h2>Column 2</h2>
                <p>This is the second column.</p>
                <div class="nested">
                    <h3>Nested Div</h3>
                    <p>This is a nested div inside column 2.</p>
                </div>
            </div>
        </div>
        <div class="row">
            <div class="col">
                <h2>Column 3</h2>
                <p>This is the third column.</p>
            </div>
            <div class="col">
                <h2>Column 4</h2>
                <p>This is the fourth column.</p>
            </div>
        </div>
    </div>
</body>
</html>
`;
htmlVectorSearch(test, ["Nested Div"], 20)
  .then(async (res) => {
    console.log("results -->", res);
    //await vectorStore.reset();
  })
  .catch(console.error);
// console.log(parseHtml(test));
