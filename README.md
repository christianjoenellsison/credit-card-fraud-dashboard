# Credit Card Fraud Dashboard

This is the first milestone of Group SAS’s ISRN research prototype. The single read-only page shows six synthetic transactions with calibrated risk scores and simulated Allow, Escalate for review, and Block decisions. The examples come from the earlier synthetic experiment and illustrate the three possible actions.

## Run locally

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open [localhost:8000](http://localhost:8000/). The site consists of HTML and CSS.

## GitHub Pages

The site is published from the root of `main` with **Deploy from a branch** selected in the repository’s [Pages settings](https://github.com/christianjoenellsison/credit-card-fraud-dashboard/settings/pages). Pushes to `main` deploy the two static site files. The **Check dashboard** workflow verifies that both files are present.
