//! Five-field cron expressions for workflow group schedules.
//!
//! Fields are `minute hour day-of-month month day-of-week`, evaluated in the
//! time zone the caller supplies (the desktop and CLI use local time). Each
//! field accepts `*`, numbers, `a-b` ranges, `/step` on either, and comma
//! lists. Months accept `jan`..`dec` and weekdays `sun`..`sat`; `0` and `7`
//! both mean Sunday. As in Vixie cron, when both day fields are restricted a
//! day matches if either one does.

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, TimeZone, Timelike};

/// How far ahead to search before treating an expression as unsatisfiable.
/// Eight years always contains a leap day, so `29 2` style schedules resolve.
const SEARCH_DAYS: i64 = 366 * 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CronSchedule {
    minutes: u64,
    hours: u32,
    days_of_month: u32,
    months: u16,
    days_of_week: u8,
    day_of_month_restricted: bool,
    day_of_week_restricted: bool,
}

const MONTH_NAMES: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];
const DAY_NAMES: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

impl CronSchedule {
    /// Parse a five-field expression, rejecting anything it cannot evaluate.
    pub fn parse(expression: &str) -> Result<Self, String> {
        let fields: Vec<&str> = expression.split_whitespace().collect();
        if fields.len() != 5 {
            return Err(format!(
                "Cron schedules need 5 fields (minute hour day month weekday); got {}",
                fields.len()
            ));
        }
        let minutes = parse_field(fields[0], 0, 59, None, "minute")?;
        let hours = parse_field(fields[1], 0, 23, None, "hour")?;
        let days_of_month = parse_field(fields[2], 1, 31, None, "day of month")?;
        let months = parse_field(fields[3], 1, 12, Some(&MONTH_NAMES), "month")?;
        // Accept 0-7 so that 7 (Sunday) is valid, then fold 7 onto 0.
        let raw_days_of_week = parse_field(fields[4], 0, 7, Some(&DAY_NAMES), "weekday")?;
        let days_of_week = ((raw_days_of_week & 0x7f) | ((raw_days_of_week >> 7) & 1)) as u8;
        let schedule = Self {
            minutes,
            hours: hours as u32,
            days_of_month: days_of_month as u32,
            months: months as u16,
            days_of_week,
            day_of_month_restricted: fields[2] != "*",
            day_of_week_restricted: fields[4] != "*",
        };
        if !schedule.day_of_week_restricted && !schedule.any_valid_month_day() {
            return Err(format!(
                "Cron expression '{expression}' never matches a real date"
            ));
        }
        Ok(schedule)
    }

    fn any_valid_month_day(&self) -> bool {
        // Leap year so February 29 counts.
        (1..=12).any(|month| {
            self.months & (1 << month) != 0
                && (1..=31).any(|day| {
                    self.days_of_month & (1 << day) != 0
                        && NaiveDate::from_ymd_opt(2028, month, day).is_some()
                })
        })
    }

    fn day_matches(&self, date: NaiveDate) -> bool {
        if self.months & (1 << date.month()) == 0 {
            return false;
        }
        let dom = self.days_of_month & (1 << date.day()) != 0;
        let dow = self.days_of_week & (1 << date.weekday().num_days_from_sunday()) != 0;
        match (self.day_of_month_restricted, self.day_of_week_restricted) {
            (true, true) => dom || dow,
            (true, false) => dom,
            (false, true) => dow,
            (false, false) => true,
        }
    }

    /// True if the wall-clock minute of `at` (in its own zone) matches.
    pub fn matches<Tz: TimeZone>(&self, at: &DateTime<Tz>) -> bool {
        let local = at.naive_local();
        self.day_matches(local.date())
            && self.hours & (1 << local.hour()) != 0
            && self.minutes & (1 << local.minute()) != 0
    }

    /// The first matching minute strictly after `after`, in `after`'s zone.
    ///
    /// Wall-clock times skipped by a daylight-saving jump are skipped; a time
    /// repeated by a fall-back change fires once, at its first occurrence.
    pub fn next_after<Tz: TimeZone>(&self, after: &DateTime<Tz>) -> Option<DateTime<Tz>> {
        let tz = after.timezone();
        let start = after.naive_local().with_second(0)?.with_nanosecond(0)? + Duration::minutes(1);
        let mut date = start.date();
        for _ in 0..SEARCH_DAYS {
            if self.day_matches(date) {
                let first_day = date == start.date();
                for hour in 0..24u32 {
                    if self.hours & (1 << hour) == 0 || (first_day && hour < start.hour()) {
                        continue;
                    }
                    for minute in 0..60u32 {
                        if self.minutes & (1 << minute) == 0
                            || (first_day && hour == start.hour() && minute < start.minute())
                        {
                            continue;
                        }
                        let naive = date.and_hms_opt(hour, minute, 0)?;
                        let candidate = match tz.from_local_datetime(&naive) {
                            LocalResult::Single(value) => value,
                            LocalResult::Ambiguous(earliest, _) => earliest,
                            LocalResult::None => continue,
                        };
                        if candidate > *after {
                            return Some(candidate);
                        }
                    }
                }
            }
            date = date.succ_opt()?;
        }
        None
    }
}

fn parse_value(token: &str, names: Option<&[&str]>, label: &str) -> Result<u32, String> {
    if let Ok(value) = token.parse::<u32>() {
        return Ok(value);
    }
    if let Some(names) = names {
        let lower = token.to_ascii_lowercase();
        if let Some(index) = names.iter().position(|name| *name == lower) {
            // Months are 1-based, weekdays 0-based.
            return Ok(if names.len() == 12 {
                index as u32 + 1
            } else {
                index as u32
            });
        }
    }
    Err(format!("Invalid {label} value '{token}'"))
}

fn parse_field(
    field: &str,
    min: u32,
    max: u32,
    names: Option<&[&str]>,
    label: &str,
) -> Result<u64, String> {
    let mut mask = 0u64;
    for part in field.split(',') {
        if part.is_empty() {
            return Err(format!("Empty item in {label} field '{field}'"));
        }
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => {
                let step: u32 = step
                    .parse()
                    .map_err(|_| format!("Invalid {label} step in '{part}'"))?;
                if step == 0 {
                    return Err(format!("The {label} step in '{part}' must be at least 1"));
                }
                (range, step)
            }
            None => (part, 1),
        };
        let (start, end) = if range == "*" {
            (min, max)
        } else if let Some((start, end)) = range.split_once('-') {
            (
                parse_value(start, names, label)?,
                parse_value(end, names, label)?,
            )
        } else {
            let value = parse_value(range, names, label)?;
            // `5/15` means "from 5 to the end, every 15", as in Vixie cron.
            (value, if part.contains('/') { max } else { value })
        };
        if start < min || end > max || start > end {
            return Err(format!(
                "The {label} range in '{part}' must be within {min}-{max}"
            ));
        }
        let mut value = start;
        while value <= end {
            mask |= 1 << value;
            value += step;
        }
    }
    Ok(mask)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, Utc};

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn count_matches(expression: &str, start: &str, days: i64) -> usize {
        let schedule = CronSchedule::parse(expression).unwrap();
        let start = utc(start);
        (0..days * 24 * 60)
            .filter(|minute| schedule.matches(&(start + Duration::minutes(*minute))))
            .count()
    }

    #[test]
    fn sunday_accepts_zero_and_seven() {
        // 2026-11-01 is a Sunday.
        assert_eq!(count_matches("0 9 * * 0", "2026-11-01T00:00:00Z", 7), 1);
        assert_eq!(count_matches("0 9 * * 7", "2026-11-01T00:00:00Z", 7), 1);
        assert_eq!(count_matches("0 9 * * sun", "2026-11-01T00:00:00Z", 7), 1);
    }

    #[test]
    fn day_of_month_and_month_are_honoured() {
        assert_eq!(count_matches("0 9 1 * *", "2026-11-01T00:00:00Z", 30), 1);
        assert_eq!(count_matches("0 9 * 6 *", "2026-11-01T00:00:00Z", 30), 0);
        assert_eq!(count_matches("0 9 * nov *", "2026-11-01T00:00:00Z", 30), 30);
    }

    #[test]
    fn stepped_ranges_and_lists_expand() {
        assert_eq!(
            count_matches("0-30/10 * * * *", "2026-11-01T00:00:00Z", 1),
            96
        );
        assert_eq!(count_matches("5/20 * * * *", "2026-11-01T00:00:00Z", 1), 72);
        assert_eq!(count_matches("0 9 * * 1-5", "2026-11-01T00:00:00Z", 7), 5);
    }

    #[test]
    fn restricted_day_fields_match_either_one() {
        // The 13th or any Friday, Vixie cron semantics.
        let schedule = CronSchedule::parse("0 0 13 * 5").unwrap();
        assert!(schedule.matches(&utc("2026-11-13T00:00:00Z"))); // Friday 13th
        assert!(schedule.matches(&utc("2026-11-06T00:00:00Z"))); // Friday
        assert!(schedule.matches(&utc("2026-12-13T00:00:00Z"))); // Sunday 13th
        assert!(!schedule.matches(&utc("2026-11-07T00:00:00Z")));
    }

    #[test]
    fn next_after_finds_following_occurrence() {
        let schedule = CronSchedule::parse("0 9 * * 0").unwrap();
        assert_eq!(
            schedule.next_after(&utc("2026-11-01T09:00:00Z")),
            Some(utc("2026-11-08T09:00:00Z"))
        );
        let monthly = CronSchedule::parse("30 6 1 * *").unwrap();
        assert_eq!(
            monthly.next_after(&utc("2026-11-20T00:00:00Z")),
            Some(utc("2026-12-01T06:30:00Z"))
        );
        let leap = CronSchedule::parse("0 0 29 2 *").unwrap();
        assert_eq!(
            leap.next_after(&utc("2026-03-01T00:00:00Z")),
            Some(utc("2028-02-29T00:00:00Z"))
        );
    }

    #[test]
    fn next_after_uses_the_callers_wall_clock() {
        // 09:00 at UTC+02:00 is 07:00 UTC.
        let zone = FixedOffset::east_opt(2 * 3600).unwrap();
        let after = utc("2026-11-22T00:00:00Z").with_timezone(&zone);
        let next = CronSchedule::parse("0 9 * * *")
            .unwrap()
            .next_after(&after)
            .unwrap();
        assert_eq!(next.with_timezone(&Utc), utc("2026-11-22T07:00:00Z"));
    }

    #[test]
    fn rejects_invalid_expressions() {
        for bad in [
            "0 9 * *",
            "60 * * * *",
            "* 24 * * *",
            "* * 0 * *",
            "* * * 13 *",
            "* * * * 8",
            "*/0 * * * *",
            "5-1 * * * *",
            "a * * * *",
            "1,,2 * * * *",
            "0 0 31 2 *",
        ] {
            assert!(
                CronSchedule::parse(bad).is_err(),
                "{bad} should be rejected"
            );
        }
    }
}
