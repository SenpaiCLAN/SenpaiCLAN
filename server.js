const express = require("express");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const FormData = require("form-data");
require("dotenv").config();

const app = express();

// Set up multer for file uploads
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, or WEBP images are allowed."));
    }
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'form')));


// Environment variables validation
const { DISCORD_WEBHOOK_URL, SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON } = process.env;
if (!DISCORD_WEBHOOK_URL || !SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error("Missing required environment variables.");
    process.exit(1);
}

const GOOGLE_CREDENTIALS_PATH = path.join(__dirname, GOOGLE_SERVICE_ACCOUNT_JSON);

if (!fs.existsSync(GOOGLE_CREDENTIALS_PATH)) {
    console.error("Google credentials file not found.");
    process.exit(1);
}
const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf-8"));

// Google Sheets authentication
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'form', 'index.html'));
});

app.post("/submit", upload.single("screenshot"), async (req, res) => {
  const { name, discord, payment, sender, referral } = req.body;

  if (!name || !discord || !payment || !sender || !req.file) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: "All required fields must be filled." });
  }

  try {
    // Append data to Google Sheets
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient });
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "UTC" });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[name, discord, payment, sender, referral || "N/A", timestamp]],
      },
    });

    // Send data to Discord Webhook
    const formData = new FormData();
    const payload = {
        content: `📥 **New Registration**\n**Name:** ${name}\n**Discord:** ${discord}\n**Payment Method:** ${payment}\n**Sender Number:** ${sender}\n**Referral:** ${referral || "N/A"}`,
        embeds: [{
            title: "📸 Payment Screenshot",
            image: { url: `attachment://${req.file.originalname}` }
        }]
    };

    formData.append('payload_json', JSON.stringify(payload));
    formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);

    await axios.post(DISCORD_WEBHOOK_URL, formData, {
      headers: formData.getHeaders(),
    });

    res.status(200).json({ message: "Form submitted successfully!" });
  } catch (error) {
    console.error("Error during submission:", error.response ? error.response.data : error.message);
    res.status(500).json({ message: "An error occurred while processing your form." });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
