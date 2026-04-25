import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({
    service: "MYRMIDON Safe Browser API",
    status: "online"
  });
});

app.post("/sandbox", async (req, res) => {
  const { url } = req.body;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({
      error: "Invalid URL. Must include http:// or https://"
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox"
      ]
    });

    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 900
      }
    });

    const requests = [];
    const redirects = [];

    page.on("request", request => {
      requests.push(request.url());
    });

    page.on("response", response => {
      const status = response.status();

      if ([301, 302, 303, 307, 308].includes(status)) {
        redirects.push({
          url: response.url(),
          status
        });
      }
    });

    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    const title = await page.title();

    const bodyText = await page.locator("body")
      .innerText()
      .catch(() => "");

    const passwordFields = await page.locator(
      "input[type='password']"
    ).count();

    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png",
      encoding: "base64"
    });

    await browser.close();

    return res.json({
      input_url: url,
      final_url: page.url(),
      status: response?.status() || null,
      title,
      screenshot_base64: screenshot,
      redirects,
      requests: [...new Set(requests)].slice(0, 100),
      detections: {
        credential_form: passwordFields > 0,
        fake_cloudflare:
          /verify you are human|checking your browser|cloudflare/i.test(bodyText),

        powershell_lure:
          /powershell|win\s*\+\s*r|cmd\.exe|run command/i.test(bodyText),

        clipboard_lure:
          /copy and paste|clipboard|ctrl\+v/i.test(bodyText)
      }
    });

  } catch (error) {
    if (browser) {
      await browser.close();
    }

    return res.status(500).json({
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`MYRMIDON Safe Browser API running on port ${PORT}`);
});