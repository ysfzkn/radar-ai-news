// The horizon keeps Istanbul's hours: from 19:00 to 06:00 there (UTC+3, no daylight saving) the
// page gets the class `night`, and the stylesheet draws a moon instead of the sun and the gulls,
// and lights a few windows. The hour comes from the reader's own clock; nothing is fetched. Without
// this script the horizon shows the day.
try {
  const hour = (new Date().getUTCHours() + 3) % 24;
  document.documentElement.classList.toggle("night", hour >= 19 || hour < 6);
} catch {
  // The day stays.
}
