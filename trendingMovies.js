import * as cheerio from "cheerio";
import fs from "fs";
import { promises as fsPromises } from "fs";
import { format } from "date-fns";
import axios from "axios";
import { log } from "console";
import puppeteer from "puppeteer";
import fetch from "node-fetch";
import path from "path";

(async () => {
  const html = await fetchHtml("https://www.1tamilmv.phd");
  if (html === null) {
    return;
  }
  grabTrendingLinks(html);
})();

async function fetchHtml(url) {
  try {
    console.log(`Fetching page ${url}`);

    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    // await page.goto(url, { timeout: 60000 });
    await page.goto(url);
    await page.waitForSelector("body");
    const htmlContent = await page.$eval("body", (body) => body.innerHTML);
    await browser.close();

    return htmlContent;
  } catch (error) {
    console.error(`Error fetching page ${url}: ${error.message}`);
    return null;
  }
}

async function appendToJsonFile(data) {
  const jsonData = JSON.stringify(data, null, 2);
  const filePath = "savedData/trendingMovies.json";

  try {
    // Read existing file content
    const existingContent = await fsPromises.readFile(filePath, "utf-8");
    const existingData = existingContent ? JSON.parse(existingContent) : [];
    existingData.push(data);
    await fsPromises.writeFile(filePath, JSON.stringify(existingData, null, 2));
    console.log(`Data appended to ${filePath}`);
  } catch (error) {
    console.error(`Error appending data to ${filePath}:`, error.message);
  }
}

const jsonWriter = async (data) => {
  const jsonData = JSON.stringify(data, null, 2);
  const currentDate = new Date().toISOString().split("T")[0];

  // Specify the file path where you want to write the JSON data
  const filePath = path.join("savedData", `${currentDate}.json`);

  try {
    // Ensure the directory exists
    await fsPromises.mkdir("savedData", { recursive: true });

    // Write the JSON data to the file
    await fsPromises.writeFile(filePath, jsonData, "utf8");

    console.log(`JSON data successfully written to ${filePath}`);
  } catch (error) {
    console.error("Error writing JSON data:", error.message);
  }
};

async function grabTrendingLinks(html) {
  //clear targetFile
  log(`clear prev data in json file in - savedData/trendingMovies.json`);
  await fsPromises.writeFile("savedData/trendingMovies.json", "", "utf-8");

  log(`grabbing trending links`);
  const $ = cheerio.load(html);
  var links = [];

  const anchorTags = $("div.ipsWidget_inner.ipsPad.ipsType_richText  a");
  var indexOfLinks = 0;

  anchorTags.each((index, value) => {
    const link = value.attribs.href;

    if (link && link.includes("forums")) {
      links.push(link);
      indexOfLinks++;
    }
  });

  // remove repeated or duplicate entries in the links array
  const removeDuplicates = async (links) => {
    var unique = [];
    for (let i = 0; i < links.length; i++) {
      if (unique.indexOf(links[i]) === -1) {
        unique.push(links[i]);
      }
    }
    return unique;
  };

  const finalUrls = await removeDuplicates(links);
  const testUrl = [
    "https://www.1tamilmv.phd/index.php?/forums/topic/176738-0",
    "https://www.1tamilmv.phd/index.php?/forums/topic/176717-0",
    "https://www.1tamilmv.phd/index.php?/forums/topic/176718-0",
    // "https://www.1tamilmv.phd/index.php?/forums/topic/176731-0",
    // "https://www.1tamilmv.phd/index.php?/forums/topic/176722-0",
  ];
  await processLinks(finalUrls);
}

async function processLinks(links) {
  var goodLinksBasket = [];
  var badLinksBasket = [];
  var totalLinks = links.length;
  var counting = 0;

  for (const value of links) {
    const data = await getMoviesData(value);

    if (data?.torrlinks === null || typeof data?.torrlinks === "undefined") {
      badLinksBasket.push(data);
      counting += 1;
    } else {
      goodLinksBasket.push(data);
      //appendToJsonFile(data);
      counting += 1;
    }

    // Progress bar
    log(
      `\n${counting}/${totalLinks} links processing...  --- ${
        typeof data?.title === "undefined"
          ? "checking..."
          : data?.title
              .replace(".mkv", "")
              .replace(" - ESub", "")
              .replace("- HQ Clean Aud", "")
              .replace("HQ PreDVD", "")
              .replace("- HQ HDRip ", "")
              .replace("+ Tel + Hin + Kan", "")
              .match(/^(.*?\))/)?.[1]
              .trim()
              .slice(0, 50)
      }`
    );

    if (totalLinks === counting) {
      // Call your function to handle the results (goodLinksBasket, totalLinks)
      console.log("Updating database res...");
      //jsonWriter(goodLinksBasket, totalLinks);
    }
  }
}

async function getMoviesData(url) {
  log(`process Movies data to JSON`);
  const html = await fetchHtml(url);

  if (html === null) {
    log(`not valid html`);
    return;
  }

  try {
    const $ = cheerio.load(html);
    const torrData = [];

    const torrLinks = $('a[data-fileext="torrent"]');
    if (!torrLinks.length) {
      const result = {
        torrlinks: null,
      };
    } else {
      torrLinks.each((index, torrLink) => {
        const adUrl = torrLink.attribs.href;

        const adTitleTag = $(torrLink).find("span");
        const adTitle = adTitleTag.text().trim();

        torrData.push({
          torrName: adTitle.substring(adTitle.indexOf("-") + 2),
          downlink: adUrl,
        });
      });

      const magLinks = $('[href^="magnet"]')
        .map((index, element) => element.attribs.href)
        .get();
      const imgLinks = [];
      const imgSelectors = [
        "div.ipsType_normal.ipsType_richText.ipsPadding_bottom.ipsContained p a img[src]",
        "img.ipsImage_thumbnailed[src]",
      ];

      imgSelectors.forEach((selector) => {
        $(selector).each((index, imgLink) => {
          const a = imgLink.attribs.src;
          if (
            !a.includes("magnet") &&
            !a.includes("megaphone") &&
            !a.includes("gif") &&
            !a.includes("uTorrent")
          ) {
            imgLinks.push(a);
          }
        });
      });

      const result = {
        url: url || "default",
        title: torrData.length
          ? torrData[0].torrName.replace(".torrent", "")
          : "default",
        thumbnail: imgLinks.length ? imgLinks : "default",
        torrlinks: torrData.length ? torrData : "default",
        magLinks: magLinks.length ? magLinks : "default",
      };

      return result;
    }
  } catch (error) {
    console.error("Cheerio loading error:", error);
    return null;
  }
}
