// The suite runs on one clock wherever it runs. On GitHub's UTC runner a
// persona whose mornings cross a clock change read 0.15 kg a week where this
// laptop read 0.14, and Verify failed there for a day unseen (2026-10-31).
// Imported first, so nothing reads a date before the zone is set.
process.env.TZ = 'Europe/Bratislava';
