# E-DNA Quiz Backend API

Node.js/Express backend for the E-DNA Quiz application with async PDF generation, S3 storage, Supabase database, and GoHighLevel integration.

## 🚀 Features

- **Async PDF Generation**: Generate PDFs from React components using Puppeteer in background
- **S3 Storage**: Upload and serve PDFs via AWS S3 with presigned URLs
- **Supabase Database**: Store quiz results and user data
- **GHL Integration**: Webhook for post-purchase PDF delivery
- **Email Verification**: Supabase OTP authentication
- **Fast Response**: Non-blocking PDF generation for instant user experience

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- AWS Account (S3 bucket)
- Supabase Account
- GoHighLevel Account (optional, for email automation)

## 🛠️ Installation

1. **Clone the repository**
```bash
git clone <your-backend-repo-url>
cd backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:
- AWS S3 credentials
- Supabase service role key
- GoHighLevel API key
- Frontend URL

4. **Start the server**
```bash
npm start
```

Server will run on `http://localhost:3001`

## 📁 Project Structure

```
backend/
├── src/
│   ├── index.js              # Main Express server
│   ├── s3.js                 # S3 upload/presigned URLs
│   ├── supabase-db.js        # Supabase database operations
│   ├── ghl.js                # GoHighLevel email integration
│   ├── pdf-from-component.js # Puppeteer PDF generation
│   └── pdf-full.js           # Legacy PDF generator (backup)
├── temp/                     # Temporary PDF storage (auto-deleted)
├── .env                      # Environment variables (DO NOT COMMIT)
├── .env.example              # Environment template
├── .gitignore                # Git ignore rules
├── package.json              # Dependencies
└── README.md                 # This file
```

## 🔌 API Endpoints

### Health Check
```
GET /health
```
Returns server status and timestamp.

### Save Results (Fast, Async PDF)
```
POST /api/quiz/save-results
```
**Body:**
```json
{
  "email": "user@example.com",
  "name": "User Name",
  "results": { /* quiz results object */ }
}
```
**Response:** Immediate (1-2 seconds)
- Saves to Supabase instantly
- Triggers background PDF generation
- Returns `resultId`

### Generate PDF (Synchronous - Legacy)
```
POST /api/quiz/generate-pdf
```
**Body:** Same as above
**Response:** After PDF generation (20-30 seconds)
- Generates PDF synchronously
- Uploads to S3
- Saves to Supabase
- Returns `pdfUrl` and `resultId`

### GHL Webhook (Get PDF URL)
```
POST /api/ghl/get-pdf
```
**Body:**
```json
{
  "email": "user@example.com"
}
```
**Response:**
```json
{
  "success": true,
  "email": "user@example.com",
  "pdfUrl": "https://s3.amazonaws.com/...",
  "core_type": "architect",
  "subtype": "Systemized Builder"
}
```

### Send Email via GHL
```
POST /api/quiz/send-email
```
Sends PDF link via GoHighLevel email automation.

## 🗄️ Database Schema (Supabase)

### Table: `quiz_results`
```sql
CREATE TABLE quiz_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  core_type TEXT NOT NULL,
  subtype TEXT NOT NULL,
  decision_mastery INTEGER,
  core_level INTEGER,
  mirror_awareness INTEGER,
  integration_level INTEGER,
  pdf_url TEXT,
  payment_status TEXT DEFAULT 'pending',
  payment_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_quiz_results_email ON quiz_results(email);
CREATE INDEX idx_quiz_results_created_at ON quiz_results(created_at DESC);
```

## 🔐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | Yes |
| `NODE_ENV` | Environment (development/production) | Yes |
| `AWS_REGION` | AWS region (e.g., us-east-1) | Yes |
| `AWS_ACCESS_KEY_ID` | AWS access key | Yes |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Yes |
| `S3_BUCKET_NAME` | S3 bucket name | Yes |
| `FRONTEND_URL` | Frontend URL for PDF generation | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Yes |
| `GHL_API_KEY` | GoHighLevel API key | Optional |
| `GHL_SENDER_EMAIL` | GHL sender email | Optional |
| `GHL_SENDER_NAME` | GHL sender name | Optional |

## 🚢 Deployment

### Railway / Render / Heroku

1. **Set environment variables** in your deployment platform
2. **Deploy from GitHub**
3. **Ensure Puppeteer dependencies are installed:**
   ```json
   "engines": {
     "node": "18.x"
   }
   ```

### AWS EC2 / VPS

1. **Install Chrome/Chromium for Puppeteer:**
   ```bash
   sudo apt-get update
   sudo apt-get install -y chromium-browser
   ```

2. **Set environment variables:**
   ```bash
   export PORT=3001
   export NODE_ENV=production
   # ... other variables
   ```

3. **Start with PM2:**
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name edna-backend
   pm2 save
   ```

## 🧪 Testing

### Test Health Check
```bash
curl http://localhost:3001/health
```

### Test PDF Generation (Async)
```bash
curl -X POST http://localhost:3001/api/quiz/save-results \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User",
    "results": {
      "core_type": "architect",
      "subtype": ["Systemized Builder"],
      "core_type_mastery": 85
    }
  }'
```

### Test GHL Webhook
```bash
curl -X POST http://localhost:3001/api/ghl/get-pdf \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

## 📝 Package Dependencies

```json
{
  "express": "^4.18.2",
  "cors": "^2.8.5",
  "dotenv": "^16.3.1",
  "@supabase/supabase-js": "^2.38.4",
  "@aws-sdk/client-s3": "^3.454.0",
  "@aws-sdk/s3-request-presigner": "^3.454.0",
  "puppeteer": "^22.0.0",
  "uuid": "^9.0.1",
  "node-fetch": "^3.3.2"
}
```

## ⚠️ Important Notes

1. **S3 Bucket Policy**: Ensure your S3 bucket allows `GetObject` for presigned URLs
2. **Supabase RLS**: Service role key bypasses Row Level Security
3. **Puppeteer**: Requires Chrome/Chromium in production
4. **PDF Generation**: Background process can take 20-30 seconds
5. **Temp Files**: Automatically deleted after 5 seconds

## 🐛 Troubleshooting

### Puppeteer Fails in Production
- Install Chrome dependencies: `apt-get install -y chromium-browser`
- Or use Puppeteer with `chrome-aws-lambda` for Lambda/Serverless

### S3 403 Forbidden
- Check bucket policy allows GetObject
- Verify IAM user has s3:GetObject permission

### Supabase Connection Error
- Verify SUPABASE_URL and SUPABASE_SERVICE_KEY
- Check if service role key is correct (not anon key)

### Frontend Not Accessible
- Update FRONTEND_URL in .env
- Ensure CORS is configured for your frontend domain

## 📄 License

Proprietary - Brandscaling

## 👥 Support

For issues or questions, contact the development team.
