# Credit Card Fraud Dashboard

Group SAS’s ISRM research prototype visualizes synthetic credit card fraud alerts. The dashboard includes a searchable queue with Allow, Escalate for review, and Block (simulated) decisions, plus calibrated risk scores, case-level TreeSHAP explanations, and held-out model metrics.

The published site uses a synthetic experiment and performs no live scoring. TreeSHAP values describe contributions to the weighted model’s raw log-odds before calibration. The V1–V28 features have anonymized labels.

## Run locally

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open [localhost:8000](http://localhost:8000/). This serves HTML, CSS, JavaScript, and a versioned JSON snapshot. No API keys, database, or package installation are required to serve the site.

Run the same checks as GitHub Actions with Node.js 22 or newer.

```sh
npm run check
```

## Deploy on GitHub Pages

In the repository’s **Settings → Pages**, set **Source** to **GitHub Actions**. Push to `main`, or run **Check and deploy dashboard** from the **Actions** tab with `main` selected. Pull requests to `main` run validation without publishing. The deployment job publishes only `site/` and reports its URL in the `github-pages` environment.

See [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Regenerate the demo data

With Python 3.12, activate a virtual environment and run:

```sh
python -m pip install -r research/requirements.txt
python research/generate_snapshot.py
npm run check
```

The generator follows the group’s *ISRM Midterm | Explainable Ensemble Learning for Credit Card Fraud Alerts* notebook. It generates 45,000 synthetic cases with seed 42, trains baseline and class-weighted XGBoost models, fits sigmoid calibration on a separate split, and selects decision thresholds with false-positive budgets of 1% for review and 0.1% for simulated block on the tuning split. The dashboard contains the 6,750 held-out cases and the six strongest TreeSHAP contributions per case. XGBoost’s built-in TreeSHAP computes these contributions. Package and platform differences can change the regenerated model scores slightly.
