// Business dates are Saudi dates (Asia/Riyadh, UTC+3, no DST). new Date().toISOString() is UTC and is a day behind between 00:00 and 03:00 in Riyadh.
export const riyadhToday = (now = Date.now()) => new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
