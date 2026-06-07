# Dashboard Deployment Setup

## One-time setup (~20 minutes)

### 1. Push to GitHub

```bash
cd ~/Desktop/mkt-dashboard
git init
git add .
git commit -m "init: MKT dashboard"
git remote add origin https://github.com/chotot/mkt-dashboard.git  # replace
git push -u origin main
```

### 2. Enable GitHub Pages

GitHub repo → Settings → Pages → Source: **GitHub Actions**

### 3. Create GCP Service Account

Go to: https://console.cloud.google.com/iam-admin/serviceaccounts

```
1. Create Service Account → name: "mkt-dashboard-sync"
2. Roles:
   - BigQuery Data Viewer
   - BigQuery Job User
3. Keys → Create key → JSON → Download
```

Share the BQ dataset with the service account email.

### 4. Add GitHub Secrets

GitHub repo → Settings → Secrets and variables → Actions → New secret:

| Secret name | Value |
|---|---|
| `GCP_SA_KEY` | Paste the entire JSON key file content |
| `SHEETS_CSV_URL` | FC & Actual cost sheet: File → Share → Publish to web → CSV URL |
| `MTM_CSV_URL` | MTM metric sheet: same process → CSV URL |

### 5. Update BQ table names in sync_data.py

Edit `scripts/sync_data.py` lines:
```python
PROJECT_ID = "your-gcp-project-id"   # ← your GCP project
DATASET    = "mkt_reporting"          # ← your BQ dataset
```

And update table names in the SQL queries to match your actual BQ tables:
- `seller_revenue` → your Seller revenue table
- `vertical_monthly_kpi` → your MAU/DAU/Lead monthly table  
- `user_cohort_retention` → your cohort retention table
- `channel_monthly_metrics` → your channel breakdown table

### 6. Test the workflow

GitHub repo → Actions → "Weekly Data Sync + Deploy" → Run workflow

---

## How it works

```
Every Monday 11:00 AM VN time
         ↓
GitHub Actions wakes up (FREE tier, ~5 min runtime)
         ↓
scripts/sync_data.py runs:
  ├─ BigQuery: Revenue, MAU, DAU, Leads, Cohort (up to last Sunday)
  └─ Google Sheets: MKT cost (FC & Actual), MTM metrics
         ↓
public/data.json updated
         ↓
React app built (npm run build)
         ↓
GitHub Pages deployed → live URL
         ↓
Dashboard auto-reads new data.json on next load
```

## Cost
- GitHub Actions: **FREE** (2,000 min/month, this uses ~5 min/week = 20 min/month)
- BigQuery: **FREE** (1 TB queries/month; weekly sync uses ~1 GB)
- GitHub Pages: **FREE**
- **Total: $0/month**

## Live URL after setup
`https://[org-name].github.io/mkt-dashboard/`

## Manual sync
GitHub Actions → Run workflow → triggers immediately
