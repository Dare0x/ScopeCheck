# ScopePay Review

A reviewer can check the exact software release a freelancer delivered before authorizing an escrow payout. This is a companion to [ScopePay](https://github.com/Dare0x/ScopePay), built for the [SERV Hackathon 02 Open Track](https://www.openserv.ai/hackathon-2).

## Try the two releases

Use Node.js 22 or later.

```sh
npm ci
npm start
```

Open http://127.0.0.1:4180 to compare two GitHub CLI releases against one checklist. The opening comparison uses GitHub evidence captured on 10 November 2026. Select **Inspect receipt** for either release, then click **Check release** to fetch fresh GitHub evidence against the same checklist.

## Build a checklist with SERV

Copy `.env.example` to `.env.local`, set `SERV_REASONING_API_KEY` locally and restart the server. Enter the scope one requirement per line and click **Build checklist with SERV**. SERV Reasoning maps each original line to a published release, exact filename, exact GitHub Actions check or manual review. Confirm that the planned checks match the scope, then click **Check release**.

The reviewer supplies the agreed scope and repository. The app validates that the checklist preserves every line. GitHub supplies the release and its exact commit. CI checks must come from GitHub Actions on that commit. Missing or failed evidence and manual checks put the recommendation on hold. The browser shows a link to the evidence for every automated check.

## Link a real escrow milestone

On ScopePay v2 on Arbitrum Sepolia, the freelancer submits the exact release URL on the first line and the full lowercase commit SHA on the second line of the delivery note. Enter that same URL, the deal number and the milestone number here. The app reads ScopePay at a single block, checks the milestone’s funded and submitted state, and checks the commitment against the URL and the current Git tag’s resolved commit. A moved tag fails the commitment check. The link is optional for a standalone release review. The reviewer supplies the acceptance criteria separately from the onchain terms commitment.

The review is advisory and read-only. The client signs any payout separately in ScopePay. Use public GitHub releases, and keep credentials and private scope text out of the preview. The development server binds to localhost. A public instance would need authentication and limits for the inference endpoint.

## Verify the review rules

```sh
npm test
```

The tests cover a commit-specific CI check, missing attachments, mismatched repositories, manual review, and invalid SERV checklists. GitHub and SERV adapters are exercised with controlled responses. The two browser examples make live GitHub requests.

## Sources

- [SERV Chat Completions](https://docs.openserv.ai/serv-reasoning/api/chat-completions)
- [GitHub releases](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name), [Git references](https://docs.github.com/en/rest/git/refs#get-a-reference), and [check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)
- [ScopePay contract and demo deals](https://github.com/Dare0x/ScopePay)
