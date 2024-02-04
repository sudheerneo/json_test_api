import * as cheerio from "cheerio";
import fs from "fs";
import { promises as fsPromises } from "fs";
import { format } from "date-fns";
import axios from "axios";
import { assert, log } from "console";
import puppeteer from "puppeteer";
import fetch from "node-fetch";
import path from "path";
import { exec } from "child_process";
import { Worker } from "worker_threads";
// import data from "./savedData/2024-01-01.json" assert { type: "json" };

class Scrapper {
  constructor(url) {
    this.startScrape(url);
    this.browser = null;
  }

  startScrape = async (url) => {
    console.log("\nStarting.....");
    this.browser = await puppeteer.launch({ headless: "new" });
    const html = await this.fetchHtml(url);
    await this.browser.close();

    if (html === null) {
      return;
    }
    this.grabTrendingLinks(html);
  };

  grabTrendingLinks = async (html) => {
    //clear targetFile
    log(`clear prev data in json file in - savedData/trendingMovies.json`);
    // await new FileWriter().clearTrendingData();

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
    await this.processLinks(finalUrls.slice(0, 50));
  };

  fetchHtml = async (url) => {
    try {
      console.log(`Opening new tab ${url}`);
      const page = await this.browser.newPage();
      await page.goto(url, { timeout: 90000 });
      // await page.waitForSelector("body");
      await page.waitForSelector("body", { timeout: 90000 }); // Wait for the body element to appear
      const htmlContent = await page.$eval("body", (body) => body.innerHTML);
      await page.close();
      return htmlContent;
    } catch (error) {
      console.error(`Error fetching page ${url}: ${error.message}`);
      return null;
    }
  };

  processLinks = async (links) => {
    const goodLinksBasket = [];
    const badLinksBasket = [];
    const totalLinks = links.length;
    let counting = 0;

    // Wrap the entire process in a try-catch block for better error handling
    try {
      this.browser = await puppeteer.launch({
        headless: "new",
        timeout: 60000,
      });

      console.log(await this.browser.userAgent());

      const fetchAndProcess = async (url) => {
        try {
          const data = await this.getMoviesData(url);

          if (
            !data ||
            data.torrlinks === null ||
            typeof data.torrlinks === "undefined"
          ) {
            badLinksBasket.push(data);
          } else {
            goodLinksBasket.push(data);
          }

          counting += 1;

          // Progress bar
          log(
            `total opened tabs : ${(await this.browser.pages()).length}
            \n${counting}/${totalLinks} links processing...  --- ${
              typeof data?.title === "undefined"
                ? "checking..."
                : data?.title
                    .replace(".mkv", "")
                    .replace(" - ESub", "")
                    // ... (replace as needed)
                    .slice(0, 50)
            }`
          );
        } catch (error) {
          console.error(`Error processing URL ${url}: ${error.message}`);
        }
      };

      // Process URLs concurrently with a batch size of 10
      const batchSize = 50;
      const chunks = Array.from(
        { length: Math.ceil(links.length / batchSize) },
        (_, index) => links.slice(index * batchSize, (index + 1) * batchSize)
      );

      for (const chunk of chunks) {
        await Promise.all(chunk.map((url) => fetchAndProcess(url)));
      }

      // console.log("Updating database res...");
      new FileWriter().jsonWriter(goodLinksBasket, totalLinks);
    } catch (error) {
      console.error("Error in the main process:", error.message);
    } finally {
      // Close the browser outside the main try-catch block to ensure it gets closed
      if (this.browser) {
        await this.browser.close();
      }
    }
  };

  getMoviesData = async (url) => {
    // log(`process Movies data to JSON`);
    const html = await this.fetchHtml(url);

    if (html === null) {
      log(`not valid html`);
      return;
    }

    try {
      const $ = cheerio.load(html);
      const torrData = [];

      const torrLinks = $('a[data-fileext="torrent"]');
      if (!torrLinks.length) {
        return {
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

        return {
          url: url || "default",
          title: torrData.length
            ? torrData[0].torrName.replace(".torrent", "")
            : "default",
          thumbnail: imgLinks.length ? imgLinks : "default",
          torrlinks: torrData.length ? torrData : "default",
          magLinks: magLinks.length ? magLinks : "default",
          updatedOn: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error("Cheerio loading error:", error);
      return null;
    }
  };
}

class FileWriter {
  constructor() {}

  // clearTrendingData = async () => {
  //   await fsPromises.writeFile("savedData/trendingMovies.json", "", "utf-8");
  // };

  copyFileToGitFolder = async () => {
    //copy a file to the git folder
    try {
      // replacing dest file from source file
      const source = "/home/sudheer/scripts/node/savedData/trendingMovies.json";
      const dest =
        "/home/sudheer/Development/json_test_api/trendingMovies.json";
      await fsPromises.copyFile(source, dest);

      console.log(`Latest data successfully copied to ${dest}`);
      new GitUpload(); //git initializer
    } catch (error) {
      console.error("Error copied JSON data:", error.message);
    }
  };

  jsonWriter = async (data) => {
    var filteresData = data.filter(
      (movie, index) =>
        data.findIndex((item) => item.title === movie.title) === index
    );
    const jsonData = JSON.stringify(filteresData, null, 2);
    const currentDate = new Date().toISOString().split("T")[0];

    try {
      // Write the JSON data to the file
      await fsPromises.writeFile("testnodeFileCreate.json", jsonData, "utf8");

      console.log(
        `\nJSON data successfully written to testnodeFileCreate.json`
      );
      // await this.copyFileToGitFolder();
    } catch (error) {
      console.error("\nError writing JSON data:", error.message);
    }
  };
}

class GitUpload {
  constructor() {
    this.runShell();
  }

  //git updater throuth  shell
  runShell = () => {
    console.log(`Uploading to git Repo API...`);
    const scriptPath = "/home/sudheer/scripts/git_pusher.sh";

    exec(`sh ${scriptPath}`, (error) => {
      if (error) {
        console.error(`Error executing script: ${error.message}`);
        return;
      }

      console.log("Script executed successfully, Uploaded to git server api");
    });
  };
}

const domain = "https://www.1tamilmv.phd";
new Scrapper(domain);
