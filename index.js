import FirecrawlApp from "@mendable/firecrawl-js";
import fs from 'fs-extra';

const app = new FirecrawlApp({
  apiKey: "fc-5005adb6a1b14e4ab9f484630101c13b",
});

// Function to safely read JSON file
async function safeReadJson(filePath) {
  try {
    if (await fs.pathExists(filePath)) {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  } catch (error) {
    console.error(`Error reading ${filePath}: ${error.message}`);
    // If JSON is corrupted, backup the file and return null
    if (await fs.pathExists(filePath)) {
      const backupPath = `${filePath}.backup-${Date.now()}`;
      await fs.copy(filePath, backupPath);
      console.log(`Backed up corrupted file to ${backupPath}`);
    }
    return null;
  }
}

// Function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to determine topic from URL
function determineTopicFromUrl(url) {
  const topicMap = {
    'data-structures': 'Data Structures',
    'algorithms': 'Algorithms',
    'operating-systems': 'Operating Systems',
    'dbms': 'Database Management',
    'computer-network': 'Computer Networks',
    'compiler-design': 'Compiler Design',
    'theory-of-computation': 'Theory of Computation',
    'computer-organization': 'Computer Organization',
    'digital-electronics': 'Digital Electronics',
    'programming-language': 'Programming Languages'
  };

  // Find matching topic from URL
  for (const [key, value] of Object.entries(topicMap)) {
    if (url.includes(key)) {
      return value;
    }
  }
  
  return 'General';
}

// Function to determine subtopic from content
function determineSubtopic(markdown) {
  // Extract first heading as subtopic
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  return headingMatch ? headingMatch[1].trim() : 'General';
}

// Modified scrapeUrl function
async function scrapeUrl(url, index, topic) {
  console.log(`Scraping ${url}... (Topic: ${topic})`);
  
  try {
    await delay(3000);
    
    const scrapeResult = await app.scrapeUrl(url, {
      formats: ["markdown", "links"],
    });

    if (!scrapeResult.success) {
      throw new Error(scrapeResult.error);
    }

    // Determine subtopic
    const subtopic = determineSubtopic(scrapeResult.markdown);

    // Extract nested links
    const nestedLinks = scrapeResult.links.filter(link => link.includes('/'));

    // Store in nested-links.json
    let nestedLinksJson = await safeReadJson('nested-links.json') || { links: [] };
    
    // Add each link as a separate object
    nestedLinks.forEach(link => {
      if (!nestedLinksJson.links.some(obj => obj.url === link)) {
        nestedLinksJson.links.push({
          url: link,
          scraped: false
        });
      }
    });

    // Write updated nested links to JSON
    await fs.writeJson('nested-links.json', nestedLinksJson, { spaces: 2 });

    // Create labeled scrape result data
    const labeledScrapeData = {
      url,
      topic,
      subtopic,
      markdown: scrapeResult.markdown,
      links: scrapeResult.links.filter(link => !link.includes('/')),
      nestedLinks
    };

    // Read existing labeled results or create new results object
    let labeledResults = await safeReadJson('labeled-results.json') || { topics: {} };

    // Initialize topic if it doesn't exist
    if (!labeledResults.topics[topic]) {
      labeledResults.topics[topic] = {};
    }

    // Add new result with index under appropriate topic
    labeledResults.topics[topic][`result_${index}`] = labeledScrapeData;
    
    // Write updated labeled results
    await fs.writeJson('labeled-results.json', labeledResults, { spaces: 2 });
    
    console.log(`Saved labeled results for ${url} under ${topic} - ${subtopic}`);
    return true;

  } catch (error) {
    // Handle error by adding to skipped.json
    let skippedUrls = await safeReadJson('skipped.json') || { urls: [] };

    if (!skippedUrls.urls.includes(url)) {
      skippedUrls.urls.push(url);
      await fs.writeJson('skipped.json', skippedUrls, { spaces: 2 });
    }

    console.error(`Failed to scrape ${url}: ${error.message}`);
    return false;
  }
}

// Function to manage progress state
async function manageProgress() {
  const progressFile = 'scraping-progress.json';
  
  return {
    async load() {
      return await safeReadJson(progressFile) || { 
        topics: {},
        lastProcessedIndex: {} 
      };
    },
    
    async save(topic, index) {
      const progress = await this.load();
      progress.lastProcessedIndex[topic] = index;
      await fs.writeJson(progressFile, progress, { spaces: 2 });
    }
  };
}

// Modified recursiveScrape function
async function recursiveScrape(startUrl) {
  let scrapedUrls = new Set();
  let topicIndices = {};
  const progress = await manageProgress();
  
  // Read labeled-links.json
  const labeledLinksJson = await safeReadJson('labeled-links.json');
  
  if (!labeledLinksJson || !labeledLinksJson.topics) {
    console.error('No topics found in labeled-links.json');
    return;
  }

  // Load previous progress
  const savedProgress = await progress.load();
  
  // We specifically want the Database Management topic
  const dbmsTopic = "Database Management";
  const dbmsUrls = labeledLinksJson.topics[dbmsTopic];
  
  if (!dbmsUrls) {
    console.error('Database Management topic not found');
    return;
  }

  // Find the starting URL index
  const startIndex = dbmsUrls.findIndex(url => url.includes('need-for-dbms'));
  if (startIndex === -1) {
    console.error('Start URL not found in Database Management topic');
    return;
  }

  console.log(`Processing Database Management starting from index ${startIndex}`);
  topicIndices[dbmsTopic] = startIndex;
  
  // Process only the Database Management URLs starting from need-for-dbms
  for (let i = startIndex; i < dbmsUrls.length; i++) {
    const url = dbmsUrls[i];
    
    if (scrapedUrls.has(url)) {
      continue;
    }

    const success = await scrapeUrl(url, topicIndices[dbmsTopic]++, dbmsTopic);
    if (success) {
      scrapedUrls.add(url);
      // Save progress after each successful scrape
      await progress.save(dbmsTopic, i + 1);
    }

    // Add a delay between requests
    await delay(3000);
  }

  console.log(`Scraping completed. Processed ${scrapedUrls.size} URLs in Database Management topic`);
}

// Start the scraping process
try {
  await recursiveScrape("https://www.geeksforgeeks.org/need-for-dbms");
} catch (error) {
  console.error("Error during scraping:", error);
}
