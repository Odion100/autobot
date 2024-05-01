import { ChromaClient } from "chromadb";
import puppeteer from "puppeteer";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import cheerio from "cheerio";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// console.log(chromadb);

const vectorStore = new ChromaClient();

async function naturalLanguageSelector(
  url,
  elements = [],
  queryTexts = [],
  nResults = 3
) {
  const html = await getPage({ url });
  const targetElements = getElements(html, elements);
  // return console.log(targetElements, targetElements.length);
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
function getElements(html, elements = []) {
  const $ = html.length ? cheerio.load(html) : null;
  console.log(elements.join(", "));

  const htmlStrings = [];
  for (const element of elements) {
    const htmlElements = $(element);

    htmlElements.each((index, element) => {
      const el = cheerio.load($.html(element));
      const e = el(element.tagName);
      const innerText = e.text();
      e.empty();
      e.text(innerText);
      //console.log("el--->", el(element.tagName).text());
      htmlStrings.push($.html(e));
    });
  }
  // throw htmlStrings;
  return htmlStrings;
}

naturalLanguageSelector("https://www.google.com", ["button"], ["search"])
  .then(async (res) => {
    console.log("results -->", res);
    //await vectorStore.reset();
  })
  .catch(console.error);
