
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
require("dotenv").config();

const app = express();

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, or WEBP images are allowed"));
    }
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("form"));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CREDENTIALS_PATH = path.join(__dirname, process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf-8"));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

app.post("/submit", upload.single("screenshot"), async (req, res) => {
  const { name, discord, payment, sender, referral } = req.body;

  if (!name || !discord || !payment || !sender) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).send("All required fields must be filled.");
  }

  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [[name, discord, payment, sender, referral || "", new Date().toLocaleString()]],
      },
    });

    const fileData = req.file
      ? {
          embeds: [{
            title: "📸 Screenshot Uploaded",
            image: { url: `attachment://${req.file.originalname}` }
          }],
          files: [{
            attachment: req.file.path,
            name: req.file.originalname
          }]
        }
      : {};

    await axios.post(DISCORD_WEBHOOK_URL, {
      content: `📥 **New Registration**\n**Name:** ${name}\n**Discord:** ${discord}\n**Payment:** ${payment}\n**Sender:** ${sender}\n**Referral:** ${referral || "N/A"}`,
      ...fileData
    }, {
      headers: { "Content-Type": "application/json" }
    });

    res.send("Form submitted successfully!");
  } catch (error) {
    console.error("Error during submission:", error);
    res.status(500).send("An error occurred while processing your form.");
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
