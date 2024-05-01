import { ChromaClient } from "chromadb";
import puppeteer from "puppeteer";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import cheerio from "cheerio";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// console.log(chromadb);

const vectorStore = new ChromaClient();

async function naturalLanguageSelector(url, queryTexts = [], nResults = 3) {
  /// const html = await getPage({ url });
  console.log(path.join(process.cwd()), "---<> path is within");
  const targetElements = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "nls.test.json"), "utf-8")
  );
  //   return console.log(targetElements.length);
  const embeddingData = targetElements.reduce(
    (sum, element, i) => {
      sum.documents.push(element);
      sum.ids.push(`id${i}`);
      sum.metadatas.push({ html: element });
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
  return await collection.query({ queryTexts, nResults });
}

async function getEmbeddings(input) {
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

async function getPage({ url }) {
  // Launch the browser and open a new blank page
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 0, height: 0 });

  // Navigate the page to a URL
  await page.goto(url);

  // Get the HTML content of the page
  const html = await page.content();

  // Close the browser
  // await browser.close();

  return html;
}

const targetElements = [
  "button",
  "input[type='text']",
  "input[type='checkbox']",
  "input[type='radio']",
  "select",
  "textarea",
  "a",
  "input[type='submit']",
  "form",
  "img",
];
function parseHtml(html, chunkSize = 1500) {
  // Load HTML content using Cheerio
  const $ = html.length ? cheerio.load(html) : null;
  console.log('$("body").text.length', $("body").text().length);

  // Remove irrelevant elements
  $("script, style, head, path noscript link meta").remove();

  console.log('$("body").text.length', $("body").text().length);
  // Array to store chunked HTML strings
  const htmlContent = [];

  // Recursive function to traverse the HTML tree and chunk the content
  function extractContent(parent) {
    let innerText = parent.text();
    const interActiveElements = parent.find(
      'button, input[type="text"], input[type="checkbox"], input[type="radio"], select, textarea, a, input[type="submit"], form, img'
    );
    if (innerText.length <= chunkSize && interActiveElements.length <= 20) {
      parent.find("svg").remove();

      const uniqueAttributes = {};
      const elementsTxt = interActiveElements
        .map((index, element) => {
          const elementText = $(element).text();
          innerText = innerText.replace(elementText, "");
          $(element).empty();
          $(element).text(elementText);
          //remove repetitive attributes
          const attributes = element.attribs;
          // console.log("attributes-->", Object.keys(attributes));
          for (const key in attributes) {
            let value = attributes[key];
            if (!uniqueAttributes[key]) uniqueAttributes[key] = [];
            if (uniqueAttributes[key].includes(value)) {
              $(element).removeAttr(key);
            } else {
              uniqueAttributes[key].push(value);
            }
          }
          return $.html(element).toString();
        })
        .get()
        .join("");

      innerText = innerText
        .split("\n")
        .map((word) => word.trim())
        .filter((word) => word)
        .join(" ");

      console.log("--------------------------------->");
      console.log("text: ", innerText);
      console.log("<---------------");
      console.log("elements: ", elementsTxt);
      console.log("--------------------------------->");
      const pageSection = `${innerText} ${elementsTxt}`;
      if (pageSection.trim()) htmlContent.push(pageSection);
    } else {
      console.log("checking children -->");
      parent.children().each((index, child) => {
        console.log("next child -->");
        extractContent($(child));
      });
    }
  }

  // Start chunking from the body element
  extractContent($("body"));

  // Return the array of chunked HTML strings
  return htmlContent;
}
function removeDuplicateAttributes(elements, $) {
  const uniqueAttributes = {};

  elements.each((index, element) => {
    const attributes = element.attribs;
    console.log("attributes-->", Object.keys(attributes));
    for (const key in attributes) {
      let value = attributes[key].split(" ");
      if (!uniqueAttributes[key]) uniqueAttributes[key] = new Set();
      if (uniqueAttributes[key].has(value)) $(element).removeAttr(key);
      uniqueAttributes[key].add(value);
    }
  });
}

naturalLanguageSelector(
  "https://www.amazon.com/s?k=natural+soap&ref=nb_sb_noss",
  ["listing"],
  20
)
  .then(async (res) => {
    console.log("results -->", res);
    //await vectorStore.reset();
  })
  .catch(console.error);
