# AMS simplification, 2026-11-10

- New WhatsApp template and employee language choices: English and Cantonese. Existing Meta templates are not modified or resubmitted.
- Date inputs/displays use Hong Kong time. New sites default to Asia/Hong_Kong. Database instants remain UTC and historical records are not rewritten.
- Drafts automatically prepare local MP3, one HTTP request per file. Audition and per-purpose fixed-text editing are optional. Sending requires one explicit Send invitation action; audio preparation alone creates no calls or messages.
- Invitations contain location, dates, times and instructions. Confirmation/cancellation use shared fixed short notices. The cancellation notice asks staff to check WhatsApp or contact their supervisor for details.
- Local MP3 cache keys contain model version, voice/language, speed and rendered text, independent of job/site IDs. Identical text shares audio even after per-work editing. Native synthesis processes queue rather than failing on contention. Existing published plans and audio remain available; no automatic deletion of historical recordings.
- Azure settings and synthesis client are removed. An old active Azure configuration is presented as local MP3 for future work; previously saved plans continue playing their existing audio. A new save drops the Azure credential from that new settings version. Encrypted historical settings are retained with other history.
- Consent remains explicit. No source text entry is required; administrator confirmation is recorded automatically with existing consent timestamp and audit actor. Unchanged records preserve their consent source/time, and opt-out still blocks WhatsApp.

## Deployment

No database migration or .env edit is required for this change. Models already installed in the server volume remain available.

```bash
cd /home/joshuachow/workforce
git pull --ff-only
sudo docker compose build workforce-api web
sudo docker compose up -d --no-deps --wait --wait-timeout 180 workforce-api web
```

The separate WhatsApp containers do not need rebuilding. Refresh AMS after deployment. Verify the bilingual options, a site without a timezone input, and automatic local MP3 in a draft before sending an invitation.
