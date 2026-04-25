import express from "express";
import cors from "cors";
import { chromium } from "playwright";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());

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
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
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

    const passwordFields = await page.locator("input[type='password']").count();

    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png"
    });

    const screenshotBase64 = screenshotBuffer.toString("base64");

    const finalUrl = page.url();

    await browser.close();

    return res.json({
      input_url: url,
      final_url: finalUrl,
      status: response?.status() || null,
      title,
      screenshot_base64: screenshotBase64,
      redirects,
      requests: [...new Set(requests)].slice(0, 150),
      detections: {
        credential_form: passwordFields > 0,
        fake_cloudflare: /verify you are human|checking your browser|cloudflare|just a moment/i.test(bodyText),
        powershell_lure: /powershell|win\s*\+\s*r|cmd\.exe|run command|mshta|rundll32/i.test(bodyText),
        clipboard_lure: /copy and paste|clipboard|ctrl\+v|press ctrl/i.test(bodyText),
        suspicious_download_lure: /download|open file|enable content|enable macros|invoice|payment/i.test(bodyText)
      }
    });

  } catch (error) {
    if (browser) await browser.close();

    return res.status(500).json({
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`MYRMIDON Safe Browser API running on port ${PORT}`);
});